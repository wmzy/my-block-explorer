import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
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
import performanceRoutes from './routes/performance';
import rpcConfigRoutes from './routes/rpc-config';
import chainsRoutes from './routes/chains';
import storageRoutes from './routes/storage';
import signaturesRoutes from './routes/signatures';
import labelsRoutes from './routes/labels';
import verifyRoutes from './routes/verify';
import approvalsRoutes from './routes/approvals';
import sqlRoutes from './routes/sql';
import watchRoutes from './routes/watch';
import streamRoutes from './routes/stream';
import debugRoutes from './routes/debug';
import { reconcileInterruptedRanges } from './services/EventIndexingService';
import { reconcileInterruptedAddressScans } from './services/AddressScanService';

const logger = createLogger('api-app');

const app = new Hono();

app.use('*', corsMiddleware);
app.use('*', loggerMiddleware);
app.use('*', timing());

app.onError((e, c) => {
  if (e instanceof HTTPException) {
    return e.getResponse();
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
app.route('/api', performanceRoutes);
app.route('/api', rpcConfigRoutes);
app.route('/api', storageRoutes);
app.route('/api', signaturesRoutes);
app.route('/api', labelsRoutes);
app.route('/api', verifyRoutes);
app.route('/api', approvalsRoutes);
// SQL console: admin-only read-only queries against this explorer's own
// DuckDB (POST /api/sql/query + GET /api/sql/tables). Gated by the STRICT
// admin tier inside the sub-app — unlike the opt-in gates, it fails closed
// when ADMIN_TOKEN is unset, because this surface executes raw SQL.
app.route('/api', sqlRoutes);
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

// Startup reconciliation: flip indexing ranges stranded by a previous
// process to 'error' so Resume becomes available (see
// reconcileInterruptedRanges). Fire-and-forget — module load must not block
// on the database, and a failure to reconcile is logged, not fatal.
void reconcileInterruptedRanges().catch(err =>
  logger.error({ err }, 'Failed to reconcile interrupted indexing ranges'),
);

// Same fire-and-forget startup reconciliation for address deep-scan jobs:
// rows stuck in 'running' from a previous process flip to 'error' so the
// Deep Scan panel offers Resume from the last checkpointed cursor.
void reconcileInterruptedAddressScans().catch(err =>
  logger.error({ err }, 'Failed to reconcile interrupted address scans'),
);

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
