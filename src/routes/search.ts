import { Hono } from 'hono';
import { searchService } from '../services/SearchService';
import {
  getChainName,
  getChainSymbol,
  isChainSupported,
  getSupportedChainIds,
} from '../config/chains';
import { getValidatedChainId } from '../server/validation';
import { safeJsonResponse } from '../utils/serialization';
import { createLogger } from '../server/logger';

const app = new Hono();
const logger = createLogger('search-routes');

app.get('/search/history', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 50);

  try {
    const history = await searchService.getSearchHistory(0, limit);
    return c.json({ history, timestamp: new Date().toISOString() });
  }
  catch (error) {
    logger.error({ err: error }, 'Search history API error');
    return c.json({ error: 'Failed to get search history' }, 500);
  }
});

app.get('/search', async (c) => {
  const query = c.req.query('q');

  if (!query) {
    return c.json(
      {
        error: 'Missing query parameter',
        message: 'Please provide a \'q\' parameter',
      },
      400,
    );
  }

  try {
    const chainIds = getSupportedChainIds();
    const defaultChainId = chainIds[0] ?? 1;

    const result = await searchService.search(defaultChainId, query);
    return c.json({
      ...result,
      timestamp: new Date().toISOString(),
    });
  }
  catch (error) {
    logger.error({ err: error, query }, 'Global search failed');
    return c.json(
      {
        query,
        type: 'unknown',
        found: false,
        data: null,
        error: error instanceof Error ? error.message : 'Search failed',
        timestamp: new Date().toISOString(),
      },
      500,
    );
  }
});

app.get('/chains/:chainId/search', async (c) => {
  const chainIdParam = c.req.param('chainId');
  const query = c.req.query('q');

  if (!chainIdParam) {
    return c.json(
      {
        error: 'Missing chain ID',
        message: 'Please provide a valid chain ID',
      },
      400,
    );
  }

  const chainId = parseInt(chainIdParam);
  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return c.json(
      {
        error: 'Unsupported chain',
        message: `Chain ID ${chainId} is not supported`,
        supportedChains: getSupportedChainIds(),
      },
      400,
    );
  }

  if (!query) {
    return c.json(
      {
        error: 'Missing query parameter',
        message: 'Please provide a \'q\' parameter',
      },
      400,
    );
  }

  try {
    const searchResult = await searchService.search(chainId, query);

    c.header('X-Data-Source', searchResult.found ? 'blockchain' : 'cache');
    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      chainSymbol: getChainSymbol(chainId),
      query: searchResult.query,
      type: searchResult.type,
      found: searchResult.found,
      data: searchResult.data ?? null,
      suggestions: searchResult.suggestions ?? [],
      error: searchResult.error ?? null,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  }
  catch (error) {
    logger.error({ err: error }, 'Search API error');

    return c.json(
      {
        error: 'Search failed',
        message:
          error instanceof Error ? error.message : 'Internal server error',
      },
      500,
    );
  }
});

export default app;
