import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import { blockService } from '../services/BlockService';
import { getChainName } from '../config/chains';

const logger = createLogger('blocks-routes');
import {
  getValidatedChainId,
  getValidatedBlockNumber,
} from '../server/validation';
import { formatBlockForApi, safeJsonResponse } from '../utils/serialization';

const app = new Hono();

app.get('/chains/:chainId/blocks/latest', async (c) => {
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
  }
  catch (error) {
    logger.error({ err: error }, 'Latest block API error');
    return c.json({ error: 'Failed to get latest block' }, 500);
  }
});

app.get('/chains/:chainId/blocks/:blockNumber', async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const blockNumber = getValidatedBlockNumber(c.req.param('blockNumber'));

  try {
    const block = await blockService.getBlockByNumber(
      chainId,
      BigInt(blockNumber),
    );

    if (!block) {
      return c.json({ error: 'Block not found' }, 404);
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
  }
  catch (error) {
    logger.error({ err: error }, 'Block API error');
    return c.json({ error: 'Failed to get block' }, 500);
  }
});

app.get('/chains/:chainId/blocks', async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const limit = parseInt(c.req.query('limit') ?? '20');
  const offset = parseInt(c.req.query('offset') ?? '0');

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
  }
  catch (error) {
    logger.error({ err: error }, 'Blocks list API error');
    return c.json({ error: 'Failed to get blocks' }, 500);
  }
});

export default app;
