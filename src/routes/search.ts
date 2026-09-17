import { Hono } from 'hono';
import { searchService } from '../services/SearchService';
import {
  getChainName,
  getSortedChains,
  getSupportedChainIds,
  isChainSupported,
  getChainSymbol,
} from '../config/chains';
import { detectSearchType, sanitizeInput } from '../utils/validation';
import { safeJsonResponse } from '../utils/serialization';
import { createLogger } from '../server/logger';

const app = new Hono();
const logger = createLogger('search-routes');

app.get('/search/history', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 50);
  // Optional chain scope: absent or invalid falls back to the global
  // history. Legacy rows (no chain recorded) stay visible either way.
  const chainIdParam = c.req.query('chainId');
  const parsedChainId = chainIdParam ? parseInt(chainIdParam, 10) : NaN;
  const chainId = !isNaN(parsedChainId) && parsedChainId > 0 ? parsedChainId : undefined;

  try {
    const history = await searchService.getSearchHistory(chainId, limit);
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
    // Same detection as every other entry point (utils/validation is the
    // single source of truth). Transaction/block hashes and block numbers
    // are chain-relative: without a chain in scope the global endpoint
    // cannot resolve them, so it reports the ambiguity plus the chains to
    // retry on instead of silently searching one default chain.
    const sanitized = sanitizeInput(query.trim());
    const searchType = detectSearchType(sanitized);

    if (searchType === 'hash' || searchType === 'block') {
      return c.json({
        found: false,
        needsChain: true,
        type: searchType === 'hash' ? 'transaction' : 'block',
        query: sanitized,
        supportedChains: getSortedChains().map(chain => ({ chainId: chain.id, name: chain.name })),
        timestamp: new Date().toISOString(),
      });
    }

    // Chain scope for the remaining query types (addresses, free text):
    // an explicit ?chainId= wins when supported; otherwise mainnet, else
    // the head of the sorted chain list. The chosen chain is echoed as
    // searchedChainId so clients know exactly what was searched.
    const chainIdParam = c.req.query('chainId');
    const requestedChainId = chainIdParam ? parseInt(chainIdParam, 10) : NaN;
    const searchedChainId
      = !isNaN(requestedChainId) && isChainSupported(requestedChainId)
        ? requestedChainId
        : isChainSupported(1)
          ? 1
          : (getSortedChains()[0]?.id ?? 1);

    const result = await searchService.search(searchedChainId, sanitized);
    return c.json({
      ...result,
      searchedChainId,
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
      degraded: searchResult.degraded ?? null,
      degradedReasons: searchResult.degradedReasons ?? null,
      message: searchResult.message ?? null,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  }
  catch (error) {
    logger.error({ err: error }, 'Search API error');

    return c.json(
      {
        error: 'Search failed',
        message: error instanceof Error ? error.message : 'Internal server error',
      },
      500,
    );
  }
});

export default app;
