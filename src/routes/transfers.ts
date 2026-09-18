import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger } from '../server/logger';
import {
  getValidatedChainId,
  getValidatedAddress,
} from '../server/validation';
import { tokenTransferService } from '../services/TokenTransferService';
import { safeJsonResponse } from '../utils/serialization';

const logger = createLogger('transfers-routes');

const app = new Hono();

// Query params. catch() keeps the documented fallback on junk input
// ('abc', out-of-range numbers) instead of 400ing.
const cursorSchema = z.coerce.number().int().min(0).catch(0);
const limitSchema = z.coerce.number().int().min(1).max(100).catch(25);
const windowSchema = z.coerce.number().int().min(1).max(50_000_000).optional().catch(undefined);
// Cache-bypass flag: only the exact literal '1' forces a re-scan; junk
// values ('true', '0', 'abc') degrade to a cache-serving read instead of
// 400ing, matching the fallback philosophy of the schemas above.
const refreshSchema = z.literal('1').optional().catch(undefined);

// On-demand token transfer list (eth_getLogs sweep). Stateless and
// read-only: no auth gate, no DuckDB writes — symbol/decimals enrichment
// happens in the frontend.
app.get('/chains/:chainId/addresses/:address/transfers', async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  const cursor = cursorSchema.parse(c.req.query('cursor'));
  const limit = limitSchema.parse(c.req.query('limit'));
  const windowBlocks = windowSchema.parse(c.req.query('window'));
  const refresh = refreshSchema.parse(c.req.query('refresh')) === '1';

  try {
    const result = await tokenTransferService.getTokenTransfers(
      chainId,
      address,
      cursor,
      limit,
      windowBlocks,
      refresh,
    );

    const responseData = safeJsonResponse({
      transfers: result.transfers,
      nextCursor: result.nextCursor,
      coverage: result.coverage,
      windowBlocks: result.windowBlocks,
    });

    return c.json(responseData);
  }
  catch (error) {
    logger.error({ err: error }, 'Token transfers API error');
    return c.json({ error: 'Failed to get token transfers' }, 500);
  }
});

export default app;
