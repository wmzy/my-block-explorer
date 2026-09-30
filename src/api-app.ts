import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { timing } from 'hono/timing';
import { loggerMiddleware } from './middleware/logger';
import { corsMiddleware } from './middleware/cors';
import { createLogger } from './server/logger';
import { appVersion } from './version';
import { createApiError } from './utils/api-error';
import blocksRoutes from './routes/blocks';
import transactionsRoutes from './routes/transactions';
import addressesRoutes from './routes/addresses';
import transfersRoutes from './routes/transfers';
import searchRoutes from './routes/search';
import statsRoutes from './routes/stats';
import contractsRoutes from './routes/contracts';
import eventsRoutes from './routes/events';
import rpcConfigRoutes from './routes/rpc-config';
import chainsRoutes from './routes/chains';
import storageRoutes from './routes/storage';
import signaturesRoutes from './routes/signatures';
import labelsRoutes from './routes/labels';
import verifyRoutes from './routes/verify';
import approvalsRoutes from './routes/approvals';
import openapiRoutes from './routes/openapi';
import sqlRoutes from './routes/sql';
import opsRoutes from './routes/ops';
import watchRoutes from './routes/watch';
import streamRoutes from './routes/stream';
import debugRoutes from './routes/debug';
import { reconcileInterruptedRanges } from './services/EventIndexingService';
import { reconcileInterruptedAddressScans } from './services/AddressScanService';
import { ensureBuiltInChainsLoaded } from './config/chains';

const logger = createLogger('api-app');

const app = new Hono();

// Shared request-body ceiling (see the bodyLimit middleware below).
const MAX_BODY_BYTES = 8 * 1024 * 1024;

app.use('*', corsMiddleware);
app.use('*', loggerMiddleware);
app.use('*', timing());

// Request body ceiling for EVERY route (mounted before all route modules
// so nothing can dodge it): 8 MB. The largest legitimate body is a
// verify/compile source bundle (verifyRoutes accepts full standard-json
// inputs) at ≤2 MB in practice; 8 MB leaves 4x headroom without leaving
// the door open to unbounded JSON/byte bodies eating memory. The default
// bodyLimit answer is a plain-text 413 page — this onError keeps the
// canonical createApiError envelope so util/http.ts's toApiError can
// read the code, exactly like every other error path.
app.use(
  '*',
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: c =>
      c.json(
        createApiError(
          413,
          'payload_too_large',
          `Request body exceeds the ${MAX_BODY_BYTES / (1024 * 1024)} MB limit.`,
        ),
        413,
      ),
  }),
);

app.onError((e, c) => {
  if (e instanceof HTTPException) {
    // An exception constructed with a prebuilt Response keeps its exact
    // body (none exist today; the guard preserves that contract).
    if (e.res) return e.getResponse();

    // Thrown HTTPExceptions — the validator 400s from server/validation.ts
    // that blocks/transactions/addresses/... let escape — must render as
    // the API's canonical JSON envelope (createApiError, the same shape
    // notFound/500/admin-token paths use), not Hono's plain-text exception
    // page: util/http.ts's toApiError only reads JSON bodies, so a
    // plain-text 400 degraded to a bare "HTTP 400" with the reason lost.
    // The validator's short message doubles as the machine-readable `error`
    // code, matching openapi.ts's documented {error, message} shape (e.g.
    // 'Unknown ids → 400 { "error": "Unsupported chain" }').
    const message = e.message || `HTTP ${e.status}`;
    return c.json(
      createApiError(e.status, message, message),
      e.status as 400 | 401 | 403 | 404 | 500,
    );
  }

  logger.error(e, 'Unhandled API error');

  // The 500 body must not leak internals (SQL text, driver messages); the
  // real cause lives only in the pino log line above.
  return c.json(createApiError(500, 'internal_error', 'Internal Server Error'), 500);
});

app.get('/api', c => {
  return c.json({
    name: 'My Block Explorer API',
    version: appVersion(),
    description: 'A modern blockchain explorer API',
    endpoints: {
      health: '/api/health',
      search: '/api/search?q={query}',
      stats: '/api/stats/overview',
      blocks: '/api/blocks',
      transactions: '/api/transactions',
      addresses: '/api/addresses',
    },
    timestamp: new Date().toISOString(),
  });
});

// Ungated by design: discovery probes this from the browser, and a public
// deployment can verify its security posture from outside. `version` stays
// for frontend ServiceInfo (useAutoDiscovery reads it opportunistically).
app.get('/api/health', c => {
  return c.json({
    status: 'ok',
    adminTokenConfigured: Boolean(process.env.ADMIN_TOKEN),
    debugApiEnabled: process.env.ENABLE_DEBUG_API === '1',
    version: appVersion(),
    timestamp: new Date().toISOString(),
  });
});

// Custom-chain registration (/api/chains/custom…): mounted before the
// chain-scoped sub-apps below so the literal "custom" segment can never
// be captured by one of their :chainId param patterns.
app.route('/api', chainsRoutes);
app.route('/api', blocksRoutes);
app.route('/api', transactionsRoutes);
app.route('/api', addressesRoutes);
app.route('/api', transfersRoutes);
app.route('/api', searchRoutes);
app.route('/api', statsRoutes);
app.route('/api', contractsRoutes);
app.route('/api', eventsRoutes);
app.route('/api', rpcConfigRoutes);
app.route('/api', storageRoutes);
app.route('/api', signaturesRoutes);
app.route('/api', labelsRoutes);
app.route('/api', verifyRoutes);
app.route('/api', approvalsRoutes);
// OpenAPI description of the API surface: GET /api/openapi.json serving a
// hand-maintained 3.1 spec (docs/API.md + the route files stay the source
// of truth — the spec says so itself). Open by design: it documents paths,
// it leaks no secrets, and it carries no admin gate.
app.route('/api', openapiRoutes);
// SQL console: admin-only read-only queries against this explorer's own
// DuckDB (POST /api/sql/query + GET /api/sql/tables). Gated by the STRICT
// admin tier inside the sub-app — unlike the opt-in gates, it fails closed
// when ADMIN_TOKEN is unset, because this surface executes raw SQL.
app.route('/api', sqlRoutes);
// Ops summary: the /ops operator dashboard's read-only snapshot (storage
// sizes, indexing/watch/deep-scan counts, rate-limiter totals). Gated by
// the OPT-IN admin tier inside the sub-app — unlike the SQL console's
// strict gate it executes no raw SQL, so a zero-config local session stays
// open; each section degrades independently to {error:'unavailable'}
// instead of failing the whole endpoint. The sub-app's /ops/uninstall
// pair is the exception: it strict-gates (requireAdminToken, fail-closed)
// because it erases all server data.
app.route('/api', opsRoutes);
// Watch subscriptions: server-side address watching (WatchService tick +
// getLogs per subscription, ring buffer + SSE `watch` frames). Mounting
// the module also starts the watcher (it self-starts at module scope and
// is a no-op until a subscription exists).
app.route('/api', watchRoutes);
// SSE block stream: mounted with the API sub-apps but self-manages its
// response lifecycle (streamSSE + heartbeat + abort handling inside).
app.route('/api', streamRoutes);
// Debug routes expose raw SQL execution: mounted only when explicitly
// opted in via ENABLE_DEBUG_API=1, and gated by requireAdminTokenIfConfigured
// inside the sub-app (x-admin-token once ADMIN_TOKEN is set; open in a
// zero-config local session). A non-loopback HOST with this flag refuses
// to boot unless ALLOW_INSECURE_START=1 — see src/startupChecks.ts.
if (process.env.ENABLE_DEBUG_API === '1') {
  app.route('/debug', debugRoutes);
}

// Startup reconciliation ("zombie walk"): flip indexing ranges and address
// deep-scan jobs stranded in 'running' by a previous process to 'error' so
// Resume becomes available. Exported and awaited by the standalone server
// BEFORE listen (src/server.ts) instead of firing at module load: the
// blanket UPDATE ... WHERE status='running' must land before this process
// can accept a request that starts a new job, or it may flip that fresh
// job to 'error'. The vite dev bridge imports this module without
// server.ts and deliberately does NOT reconcile — a dev boot reconciles
// nothing; stranded rows are picked up by the next standalone start.
// Failures are logged here, never thrown: a failed reconciliation must
// not block the server from booting.
export async function reconcileStartupState(): Promise<void> {
  await Promise.all([
    // Full viem chain registry before listen: the custom-chain 409 gate
    // (isBuiltInChainProtected) and chain-id validation must not miss a
    // REAL viem chain just because the barrel had not loaded yet. Never
    // rejects — a failed import warns inside config/chains and the
    // curated subset keeps serving (honest degrade, boot proceeds).
    ensureBuiltInChainsLoaded(),
    reconcileInterruptedRanges().catch(err =>
      logger.error({ err }, 'Failed to reconcile interrupted indexing ranges'),
    ),
    reconcileInterruptedAddressScans().catch(err =>
      logger.error({ err }, 'Failed to reconcile interrupted address scans'),
    ),
  ]);
}

// Full viem chain registry for the vite dev bridge: src/server.ts awaits
// ensureBuiltInChainsLoaded() pre-listen (reconcileStartupState above),
// but the dev bridge loads this module WITHOUT server.ts — without this
// kick its chain-id validation and the custom-chain 409 gate would serve
// the curated subset indefinitely. Fire-and-forget: requests answered in
// the milliseconds the barrel takes to import see the subset, exactly
// like the frontend's first paint.
void ensureBuiltInChainsLoaded();

app.notFound(c => {
  return c.json(
    createApiError(404, 'Not Found', `API endpoint not found: ${c.req.path}`, {
      availableEndpoints: [
        '/api',
        '/api/health',
        '/api/search?q={query}',
        '/api/stats/overview',
        '/api/chains/{chainId}/blocks',
        '/api/chains/{chainId}/transactions',
        '/api/chains/{chainId}/addresses/{address}',
        '/api/chains/{chainId}/contracts/{address}/events',
      ],
    }),
    404,
  );
});

export default app;
