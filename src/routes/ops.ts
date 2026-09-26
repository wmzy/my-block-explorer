// Ops summary routes: the read-only backend for the /ops operator
// dashboard (src/views/Ops.tsx) — storage footprint, indexing/watch/
// deep-scan counts and rate-limiter totals in one request. Gated by the
// OPT-IN admin tier (requireAdminTokenIfConfigured), NOT the strict SQL
// tier: every fact here is local-process or own-database only (fs sizes,
// row counts, in-process counters) and none of it executes raw SQL, so a
// zero-config local session stays open; once ADMIN_TOKEN is set,
// enforcement is identical to every other gated route.
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

export default app;
