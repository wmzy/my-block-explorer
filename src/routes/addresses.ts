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

  try {
    const result = await addressService.getAddressTransactions(
      chainId,
      address,
      limit,
      offset,
      windowBlocks,
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
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  }
  catch (error) {
    logger.error({ err: error }, 'Address transactions API error');
    return c.json({ error: 'Failed to get address transactions' }, 500);
  }
});

export default app;
