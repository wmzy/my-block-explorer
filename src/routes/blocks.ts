import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import { blockService } from '../services/BlockService';
import { getChainName } from '../config/chains';

const logger = createLogger('blocks-routes');
import { getValidatedChainId, getValidatedBlockNumber } from '../server/validation';
import { formatBlockForApi, safeJsonResponse } from '../utils/serialization';
import { respondError } from '../utils/api-error';

const app = new Hono();

app.get('/chains/:chainId/blocks/latest', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));

  try {
    const block = await blockService.getLatestBlock(chainId);
    c.header('X-Data-Source', 'blockchain');
    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      block: formatBlockForApi(block),
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, 'Latest block API error');
    return respondError(c, 500, 'internal_error', 'Failed to get latest block');
  }
});

app.get('/chains/:chainId/blocks/:blockNumber', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const blockNumber = getValidatedBlockNumber(c.req.param('blockNumber'));

  try {
    const block = await blockService.getBlockByNumber(chainId, BigInt(blockNumber));

    if (!block) {
      return respondError(c, 404, 'block_not_found', 'Block not found');
    }

    c.header('X-Data-Source', 'blockchain');
    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      block: formatBlockForApi(block),
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, 'Block API error');
    return respondError(c, 500, 'internal_error', 'Failed to get block');
  }
});

// Pagination sanity bounds mirroring transactions.ts: junk or non-positive
// values 400 instead of feeding NaN into DuckDB (the service catch would
// swallow the error and return an honest-looking EMPTY page), oversized
// values clamp so a runaway client cannot scan arbitrarily deep.
const MAX_BLOCK_OFFSET = 100_000;
const MAX_BLOCK_LIMIT = 100;

const parseOffsetParam = (raw: string | undefined): number | null => {
  if (raw === undefined || raw === '') return 0;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return null;
  return Math.min(Math.max(parsed, 0), MAX_BLOCK_OFFSET);
};

const parseLimitParam = (raw: string | undefined): number | null => {
  if (raw === undefined || raw === '') return 20;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) return null;
  return Math.min(parsed, MAX_BLOCK_LIMIT);
};

app.get('/chains/:chainId/blocks', async c => {
  const chainId = getValidatedChainId(c.req.param('chainId'));

  const limit = parseLimitParam(c.req.query('limit'));
  const offset = parseOffsetParam(c.req.query('offset'));

  if (limit === null) {
    return respondError(c, 400, 'invalid_limit', 'limit must be a positive integer');
  }

  if (offset === null) {
    return respondError(c, 400, 'invalid_offset', 'offset must be a non-negative integer');
  }

  try {
    const result = await blockService.getBlocks(chainId, limit, offset);
    c.header('X-Data-Source', 'database');
    c.header('X-Chain-Name', getChainName(chainId));

    const responseData = safeJsonResponse({
      chainId,
      chainName: getChainName(chainId),
      blocks: result.blocks.map(formatBlockForApi),
      total: result.total,
      timestamp: new Date().toISOString(),
    });

    return c.json(responseData);
  } catch (error) {
    logger.error({ err: error }, 'Blocks list API error');
    return respondError(c, 500, 'internal_error', 'Failed to get blocks');
  }
});

export default app;
