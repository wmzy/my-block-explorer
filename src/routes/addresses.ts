import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import { addressService } from '../services/AddressService';
import { getChainName } from '../config/chains';

const logger = createLogger('addresses-routes');
import {
  getValidatedChainId,
  getValidatedAddress,
} from '../server/validation';
import { formatTransactionForApi, safeJsonResponse } from '../utils/serialization';
import { createRateLimiter } from '../middleware/rate-limit';
import {
  ADDRESS_EXPORT_MAX_ROWS,
  buildAddressTransactionsCsv,
} from '../services/AddressExportService';

const app = new Hono();

app.get('/chains/:chainId/addresses/:address', async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    const addressInfo = await addressService.getAddressInfo(chainId, address);
    c.header('X-Data-Source', 'blockchain');
    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address: addressInfo,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  }
  catch (error) {
    logger.error({ err: error }, 'Address API error');
    return c.json({ error: 'Failed to get address info' }, 500);
  }
});

app.get('/chains/:chainId/addresses/:address/persistent', async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    const persistentData
      = await addressService.getPersistentAddressData(chainId, address);

    c.header('X-Data-Source', 'database');
    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address,
      ...persistentData,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  }
  catch (error) {
    logger.error({ err: error }, 'Address persistent data API error');
    return c.json({ error: 'Failed to get address persistent data' }, 500);
  }
});

// Per-address transaction history can fall back to live RPC scans when the
// DuckDB cache is cold, so the endpoint is rate-limited per client.
const addressTransactionsRateLimiter = createRateLimiter({ name: 'address-transactions', requestsPerMinute: 10, burst: 3 });

// Pagination params fail loudly with 400 on non-numeric input instead of
// silently degrading to NaN arithmetic (same philosophy as the offset
// validation in transactions.ts). Non-positive limits are rejected too;
// pages below 1 keep the existing clamp-to-1 behavior.
app.get('/chains/:chainId/addresses/:address/transactions', addressTransactionsRateLimiter, async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  const rawLimit = c.req.query('limit');
  const rawPage = c.req.query('page');
  const parsedLimit = rawLimit === undefined || rawLimit === '' ? 20 : parseInt(rawLimit, 10);
  const parsedPage = rawPage === undefined || rawPage === '' ? 1 : parseInt(rawPage, 10);

  if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
    return c.json(
      {
        error: 'invalid_limit',
        message: 'limit must be a positive integer',
      },
      400,
    );
  }
  if (Number.isNaN(parsedPage)) {
    return c.json(
      {
        error: 'invalid_page',
        message: 'page must be a positive integer',
      },
      400,
    );
  }

  const limit = Math.min(parsedLimit, 50);
  const page = Math.max(parsedPage, 1);
  const offset = (page - 1) * limit;

  // Optional search-window override in blocks. Only fully-numeric values
  // count — anything else ('abc', partial digits) falls back to the
  // txCount-tiered default. The service clamps to 1..50_000_000 and
  // echoes the effective window in `searchWindowBlocks`.
  const rawWindow = c.req.query('window');
  const windowBlocks =
    rawWindow !== undefined && /^\d+$/.test(rawWindow) ? Number(rawWindow) : undefined;

  // Additive opt-in (?balanceHistory=1): attaches `balancePoints` — the
  // cumulative discovered-delta series computed from the SAME cached
  // discovery set this endpoint paginates (see AddressService). Only the
  // literal '1' opts in; any other value keeps the response payload
  // byte-identical for existing consumers.
  const includeBalanceHistory = c.req.query('balanceHistory') === '1';

  try {
    const result = await addressService.getAddressTransactions(
      chainId,
      address,
      limit,
      offset,
      windowBlocks,
      { includeBalancePoints: includeBalanceHistory },
    );
    c.header('X-Data-Source', result.method);
    c.header('X-Chain-Name', getChainName(chainId));

    const totalPages = Math.max(1, Math.ceil(result.total / limit));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      address,
      transactions: result.transactions.map(formatTransactionForApi),
      total: result.total,
      pagination: {
        page,
        limit,
        totalPages,
        total: result.total,
      },
      method: result.method,
      coverage: result.coverage,
      reason: result.reason,
      searchWindowBlocks: result.searchWindowBlocks,
      ...(includeBalanceHistory
        ? {
            // Per-tx cumulative discovered deltas + the leading 0 anchor;
            // count includes the anchor (discovered txs + 1 when non-empty).
            balancePoints: result.balancePoints ?? [],
            balancePointsCount: result.balancePoints?.length ?? 0,
          }
        : {}),
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  }
  catch (error) {
    logger.error({ err: error }, 'Address transactions API error');
    return c.json({ error: 'Failed to get address transactions' }, 500);
  }
});

// GET /chains/:chainId/addresses/:address/transactions/export — CSV of the
// SAME discovered set the transactions list paginates through (identical
// service call, params and validation), so the download always matches
// what the list shows. Like the list, the export re-runs a potentially
// expensive heuristic scan, so it carries its own tight limiter (mirroring
// the events export route's 5/min with a burst of 2).
const addressTransactionsExportRateLimiter = createRateLimiter({
  name: 'address-transactions-export',
  requestsPerMinute: 5,
  burst: 2,
});
app.get(
  '/chains/:chainId/addresses/:address/transactions/export',
  addressTransactionsExportRateLimiter,
  async (c) => {
    const chainId = getValidatedChainId(c.req.param('chainId'));
    const address = getValidatedAddress(c.req.param('address'));

    // Same window parsing as the list endpoint: only fully-numeric values
    // count, anything else falls back to the txCount-tiered default. The
    // service clamps and echoes the effective window.
    const rawWindow = c.req.query('window');
    const windowBlocks =
      rawWindow !== undefined && /^\d+$/.test(rawWindow) ? Number(rawWindow) : undefined;

    // Chunked exports start at a non-negative integer offset; anything
    // else fails loudly (same philosophy as the list's page validation)
    // rather than exporting from a mystery position. The regex runs first
    // so parseInt's lenient suffix handling ('12abc' → 12) never slips in.
    const rawOffset = c.req.query('offset') ?? '';
    if (rawOffset !== '' && !/^\d+$/.test(rawOffset)) {
      return c.json(
        { error: 'invalid_offset', message: 'offset must be a non-negative integer' },
        400,
      );
    }
    const parsedOffset = rawOffset === '' ? 0 : parseInt(rawOffset, 10);

    try {
      // One service call for the whole discovered set (the discovery
      // budget is bounded server-side; limit here is the export cap).
      const result = await addressService.getAddressTransactions(
        chainId,
        address,
        ADDRESS_EXPORT_MAX_ROWS,
        parsedOffset,
        windowBlocks,
      );

      // Refuse instead of truncating: a silently capped CSV would look
      // complete (heuristic windows stay far below the cap; backstop).
      if (result.total > ADDRESS_EXPORT_MAX_ROWS) {
        return c.json(
          {
            error: 'too_many_rows',
            message: `Export limited to ${ADDRESS_EXPORT_MAX_ROWS.toLocaleString()} rows; ${result.total.toLocaleString()} discovered — narrow the window`,
          },
          400,
        );
      }

      const csv = buildAddressTransactionsCsv(result.transactions);

      // ISO timestamp with filesystem-hostile characters stripped.
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      c.header('Content-Type', 'text/csv; charset=utf-8');
      c.header(
        'Content-Disposition',
        `attachment; filename="address-transactions-${chainId}-${address.toLowerCase()}-${timestamp}.csv"`,
      );
      c.header('Cache-Control', 'no-store');
      // An empty discovered set still downloads: header-only CSV, an
      // honest "nothing found", not an error.
      return c.body(csv);
    }
    catch (error) {
      logger.error({ err: error }, 'Address transactions export API error');
      return c.json({ error: 'Failed to export address transactions' }, 500);
    }
  },
);

export default app;
