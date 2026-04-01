import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { timing } from 'hono/timing';
import { loggerMiddleware } from './middleware/logger';
import { corsMiddleware } from './middleware/cors';
import { createLogger } from './server/logger';
import { createApiError } from './utils/api-error';
import blocksRoutes from './routes/blocks';
import transactionsRoutes from './routes/transactions';
import addressesRoutes from './routes/addresses';
import searchRoutes from './routes/search';
import statsRoutes from './routes/stats';
import contractsRoutes from './routes/contracts';
import eventsRoutes from './routes/events';
import performanceRoutes from './routes/performance';
import rpcConfigRoutes from './routes/rpc-config';
import storageRoutes from './routes/storage';
import debugRoutes from './routes/debug';

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

  return c.json(createApiError(500, 'Internal Server Error', e.message), 500);
});

app.get('/api', c => {
  return c.json({
    name: 'Block Explorer API',
    version: '1.0.0',
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

app.get('/api/health', c => {
  return c.json({
    status: 'healthy',
    message: 'Block Explorer API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.route('/api', blocksRoutes);
app.route('/api', transactionsRoutes);
app.route('/api', addressesRoutes);
app.route('/api', searchRoutes);
app.route('/api', statsRoutes);
app.route('/api', contractsRoutes);
app.route('/api', eventsRoutes);
app.route('/api', performanceRoutes);
app.route('/api', rpcConfigRoutes);
app.route('/api', storageRoutes);
app.route('/debug', debugRoutes);

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
