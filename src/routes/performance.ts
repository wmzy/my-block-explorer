import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import { eventPerformanceOptimizerManager } from '../services/EventPerformanceOptimizer';

const logger = createLogger('performance-routes');
import { getChainName } from '../config/chains';

const app = new Hono();

app.get('/performance/events', async (c) => {
  try {
    const chainIdParam = c.req.query('chainId');
    const chainId = chainIdParam ? parseInt(chainIdParam) : null;

    let metrics;
    if (chainId) {
      const optimizer
        = eventPerformanceOptimizerManager.getOptimizer(chainId);
      metrics = {
        chainId,
        chainName: getChainName(chainId),
        performance: optimizer.getPerformanceMetrics(),
        cache: optimizer.getCacheStatistics(),
        thresholds: optimizer.getThresholds(),
        strategies: optimizer.getStrategies(),
      };
    }
    else {
      metrics = eventPerformanceOptimizerManager.getAggregatedMetrics();
    }

    c.header('X-Data-Source', 'monitoring');
    c.header('Cache-Control', 'no-cache');

    return c.json({
      performance: metrics,
      system: {
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
      requirements: {
        cachedQueryMaxMs: 9,
        uncachedQueryMaxMs: 100,
        largeDatasetMaxMs: 200,
      },
    });
  }
  catch (error) {
    logger.error({ err: error }, 'Performance monitoring API error');
    return c.json({ error: 'Failed to get performance metrics' }, 500);
  }
});

app.post('/performance/clear-cache', async (c) => {
  try {
    const body = await c.req.json();
    const { chainId } = body;

    if (chainId) {
      const optimizer
        = eventPerformanceOptimizerManager.getOptimizer(chainId);
      optimizer.clearCaches();
    }
    else {
      eventPerformanceOptimizerManager.clearAllCaches();
    }

    return c.json({ success: true, message: 'Cache cleared successfully' });
  }
  catch (error) {
    logger.error({ err: error }, 'Clear cache API error');
    return c.json({ error: 'Failed to clear cache' }, 500);
  }
});

app.post('/performance/warmup', async (c) => {
  try {
    const body = await c.req.json();
    const { chainId, contracts } = body;

    if (!chainId || !contracts) {
      return c.json({ error: 'Missing chainId or contracts array' }, 400);
    }

    const optimizer
      = eventPerformanceOptimizerManager.getOptimizer(chainId);
    await optimizer.warmUpCaches(contracts);

    return c.json({ success: true, message: 'Cache warmup completed' });
  }
  catch (error) {
    logger.error({ err: error }, 'Cache warmup API error');
    return c.json({ error: 'Failed to warm up cache' }, 500);
  }
});

export default app;
