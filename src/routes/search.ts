import { Hono } from 'hono';
import { searchService } from '../services/SearchService';
import {
  getChainName,
  getSortedChains,
  getSupportedChainIds,
  isChainSupported,
  getChainSymbol,
  POPULAR_CHAINS,
} from '../config/chains';
import { detectSearchType, sanitizeInput } from '../utils/validation';
import { safeJsonResponse } from '../utils/serialization';
import { createRateLimiter } from '../middleware/rate-limit';
import { createLogger } from '../server/logger';

const app = new Hono();
const logger = createLogger('search-routes');

// Global search fans out to three live RPC lookups per request — a cheap
// abuse surface when the instance is public. Generous bucket: normal
// interactive search never trips it.
const searchRateLimiter = createRateLimiter({ name: 'search', requestsPerMinute: 30, burst: 10 });

app.get('/search', searchRateLimiter, async (c) => {
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
    // are chain-relative, but an explicit ?chainId= declares the chain:
    // with a supported one in scope the global endpoint resolves them on
    // that chain exactly like the per-chain endpoint. Only without a
    // usable hint do they stay ambiguous — the endpoint then reports the
    // ambiguity plus the chains to retry on instead of silently searching
    // a default chain.
    const sanitized = sanitizeInput(query.trim());
    const searchType = detectSearchType(sanitized);

    const chainIdParam = c.req.query('chainId');
    const requestedChainId = chainIdParam ? parseInt(chainIdParam, 10) : NaN;
    const hasChainHint = !isNaN(requestedChainId) && isChainSupported(requestedChainId);

    if ((searchType === 'hash' || searchType === 'block') && !hasChainHint) {
      return c.json({
        found: false,
        needsChain: true,
        type: searchType === 'hash' ? 'transaction' : 'block',
        query: sanitized,
        // The picker list is the curated popular set, not the full viem
        // chain universe (thousands of entries, many dead): scope says
        // so, and each entry carries its native symbol for filtering.
        // Every other chain stays reachable directly via its /chain/:id
        // pages and the per-chain search endpoint.
        scope: 'popular',
        supportedChains: POPULAR_CHAINS.map(chain => ({
          chainId: chain.id,
          name: chain.name,
          symbol: chain.nativeCurrency.symbol,
        })),
        timestamp: new Date().toISOString(),
      });
    }

    // Chain scope for the remaining queries (addresses, free text) and
    // the now hint-resolvable hash/block ones: a valid ?chainId= wins;
    // otherwise mainnet, else the head of the sorted chain list. The
    // chosen chain is echoed as searchedChainId so clients know exactly
    // what was searched.
    const searchedChainId = hasChainHint
      ? requestedChainId
      : isChainSupported(1)
        ? 1
        : (getSortedChains()[0]?.id ?? 1);

    const result = await searchService.search(searchedChainId, sanitized);
    // Hash/block hits now flow through this endpoint too, and their Block/
    // Transaction payloads carry BigInt fields (number, timestamp, gasUsed)
    // that raw JSON.stringify would throw on — the same reason the
    // per-chain endpoint serializes through safeJsonResponse. The shape is
    // unchanged for every existing consumer (BigInt-free payloads
    // serialize identically). The spread also carries the additive
    // suggestionsChainId whenever the miss path produced suggestions: the
    // chain the endpoint actually picked for them (== searchedChainId
    // here), so clients never guess a chain to link suggestion lines to.
    return c.json(
      safeJsonResponse({
        ...result,
        searchedChainId,
        timestamp: new Date().toISOString(),
      }),
    );
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
      // Additive echo of the chain the suggestion lines were resolved on
      // (same value as the top-level chainId here) so both search
      // endpoints expose one uniform suggestion-attribution field.
      suggestionsChainId: searchResult.suggestionsChainId ?? null,
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
