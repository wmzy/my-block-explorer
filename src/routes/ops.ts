// Ops routes: the backend for the /ops operator dashboard
// (src/views/Ops.tsx). GET /ops/summary is the read-only snapshot
// (storage footprint, indexing/watch/deep-scan counts, rate-limiter
// totals in one request); the /ops/uninstall pair is the in-server face
// of the CLI uninstall (preview = the shared enumeration with sizes,
// execute = the self-destruct, services/selfDestruct.ts). Everything is
// gated by the OPT-IN admin tier (requireAdminTokenIfConfigured), NOT
// the strict SQL tier: every fact here is local-process or own-database
// only (fs sizes, row counts, in-process counters) and none of it
// executes raw SQL, so a zero-config local session stays open; once
// ADMIN_TOKEN is set, enforcement is identical to every other gated
// route. The destructive endpoint demands a typed confirmation phrase
// verbatim — the UI makes the operator type it.
//
// Honesty rules: sections are assembled with Promise.allSettled — a
// failing section (e.g. watch stats on a database from before the webhook
// column) degrades ONLY its own key to {error:'unavailable'} and lands in
// the server log with the reason; the endpoint never turns a section
// failure into a 500. Counts are table-derived or in-process facts, never
// estimates.
import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import { requireAdminTokenIfConfigured } from '../middleware/admin-token';
import { createRateLimiter, getRateLimitStats } from '../middleware/rate-limit';
import { createApiError } from '../utils/api-error';
import {
  collectTargetStats,
  resolveUninstallTargets,
  type TargetStats,
} from '../uninstall';
import {
  SELF_DESTRUCT_GRACE_MS,
  UNINSTALL_CONFIRM_PHRASE,
  scheduleSelfDestruct,
} from '../services/selfDestruct';
import {
  collectDeepScanSummary,
  collectIndexingSummary,
  collectMetaSummary,
  collectStorageSummary,
  collectWatchSummary,
} from '../services/OpsService';

const logger = createLogger('ops-routes');

const app = new Hono();

// Opt-in gate for the whole sub-app (debug.ts precedent): a zero-config
// local session keeps the dashboard working; with ADMIN_TOKEN configured
// the x-admin-token header is enforced exactly like the strict tier.
//
// The pattern is the sub-app's own prefix, never '*': Hono hoists a
// mounted sub-app's use('*') to <base>/* on the parent, where it swallows
// every sibling route mounted after this one (see the sql.ts gate note —
// that leak 403'd watch/SSE/ops in zero-config sessions).
app.use('/ops/*', requireAdminTokenIfConfigured);

// 6/min sustained, burst 3 (the SQL console's allowance): the summary is
// cheap but scans the data/ directory, and the dashboard polls at 30s —
// the poll consumes 2/min, leaving burst room for manual refreshes.
const opsSummaryLimiter = createRateLimiter({
  name: 'ops-summary',
  requestsPerMinute: 6,
  burst: 3,
});

// Section keys in Promise.allSettled order — log context for a degraded
// section, so the operator can find the real reason in the server log.
type SectionKey = 'storage' | 'indexing' | 'watch' | 'deepScan';

// One settled outcome → its value, or the honest degraded shape with the
// failure logged once under the section's name.
function sectionValue<T>(
  outcome: PromiseSettledResult<T>,
  section: SectionKey,
): T | { error: 'unavailable' } {
  if (outcome.status === 'fulfilled') return outcome.value;
  logger.warn({ err: outcome.reason, section }, 'Ops summary section unavailable');
  return { error: 'unavailable' };
}

/**
 * GET /api/ops/summary — the one-glance operator snapshot. Response:
 * { meta, storage, indexing, watch, rateLimit, deepScan } where every
 * non-meta section is either its real value or {error:'unavailable'}
 * (meta and rateLimit are process-local facts that cannot fail).
 */
app.get('/ops/summary', opsSummaryLimiter, async c => {
  const settled = await Promise.allSettled([
    collectStorageSummary(),
    collectIndexingSummary(),
    collectWatchSummary(),
    collectDeepScanSummary(),
  ]);

  c.header('Cache-Control', 'no-store');
  return c.json({
    meta: collectMetaSummary(),
    storage: sectionValue(settled[0], 'storage'),
    indexing: sectionValue(settled[1], 'indexing'),
    watch: sectionValue(settled[2], 'watch'),
    rateLimit: { buckets: getRateLimitStats() },
    deepScan: sectionValue(settled[3], 'deepScan'),
  });
});

// --- Uninstall (the /ops danger zone) ---
//
// The in-server face of `my-block-explorer uninstall`: preview enumerates
// EXACTLY the paths the CLI would delete (src/uninstall.ts is the one
// enumeration both share — never a second list); execute arms the
// self-destruct (services/selfDestruct.ts: close listeners + DuckDB
// handles, then delete, then exit) and answers 202 first so the
// confirmation reaches the browser before the sockets die.
//
// Confirmation contract: the body must carry `confirm: "uninstall"`
// (UNINSTALL_CONFIRM_PHRASE, twin constant in services/opsSummary.ts) —
// the UI makes the operator TYPE it, the API demands it verbatim, so no
// stray click or confused client can erase data.

// 4/min, burst 3: opening the dialog (preview) plus one confirmation are
// one operator gesture; a script cycling the destructive endpoint cannot.
const opsUninstallLimiter = createRateLimiter({
  name: 'ops-uninstall',
  requestsPerMinute: 4,
  burst: 3,
});

const previewEntry = (entry: TargetStats) => ({
  kind: entry.target.kind,
  path: entry.target.path,
  label: entry.target.label,
  exists: entry.exists,
  bytes: entry.bytes,
  files: entry.files,
});

// POST /api/ops/uninstall/preview — what WOULD be deleted, with sizes.
// Reads the filesystem only; deletes nothing.
app.post('/ops/uninstall/preview', opsUninstallLimiter, async c => {
  const targets = resolveUninstallTargets({ cwd: process.cwd() });
  const stats = await collectTargetStats(targets);
  const existing = stats.filter(entry => entry.exists);
  c.header('Cache-Control', 'no-store');
  return c.json({
    targets: stats.map(previewEntry),
    existingBytes: existing.reduce((sum, entry) => sum + entry.bytes, 0),
    existingFiles: existing.reduce((sum, entry) => sum + entry.files, 0),
    confirmPhrase: UNINSTALL_CONFIRM_PHRASE,
  });
});

// POST /api/ops/uninstall — arm the self-destruct. 202 + grace window,
// then the process tears everything down and exits; a second arm attempt
// inside the window is a 409 (scheduleSelfDestruct is one-shot).
app.post('/ops/uninstall', opsUninstallLimiter, async c => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      createApiError(400, 'invalid_json', 'Request body must be JSON: {"confirm": "uninstall"}.'),
      400,
    );
  }
  const confirm =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).confirm
      : undefined;
  if (confirm !== UNINSTALL_CONFIRM_PHRASE) {
    return c.json(
      createApiError(
        400,
        'confirmation_mismatch',
        `Confirmation mismatch — the body must carry {"confirm": "${UNINSTALL_CONFIRM_PHRASE}"} verbatim.`,
      ),
      400,
    );
  }
  if (!scheduleSelfDestruct()) {
    return c.json(
      createApiError(
        409,
        'already_scheduled',
        'Self-destruct already armed — this backend is shutting down.',
      ),
      409,
    );
  }
  logger.warn('Self-destruct armed via /api/ops/uninstall — shutting down and erasing data.');
  c.header('Cache-Control', 'no-store');
  return c.json({ status: 'scheduled', graceMs: SELF_DESTRUCT_GRACE_MS }, 202);
});

export default app;
