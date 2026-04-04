import { Hono } from 'hono';
import type { Abi } from 'viem';
import { createLogger } from '../server/logger';
import { getChainName, isChainSupported, getSupportedChainIds } from '../config/chains';
import { getValidatedChainId, getValidatedAddress } from '../server/validation';
import {
  addIndexingRange,
  getIndexingRanges,
  updateIndexingRange,
  deleteIndexingRange,
  startIndexingRange,
  pauseIndexingRange,
  resumeIndexingRange,
  getActiveRangeJob,
  getContractEvents,
  getEventStatistics,
  getIndexingStatus,
  updateRangeStatus,
  createRangeAll,
  createRangeRecent,
  createRangeFirst,
  createRangeContinue,
} from '../services/EventIndexingService';
import { safeJsonResponse } from '../utils/serialization';
import { contractSourceService } from '../services/ContractSourceService';

const logger = createLogger('events-routes');
const app = new Hono();

const validateChainAndAddress = (chainIdStr: string, addressStr: string) => {
  const chainId = getValidatedChainId(chainIdStr);
  const address = getValidatedAddress(addressStr);

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return {
      error: {
        error: 'Unsupported chain',
        message: `Chain ID ${chainId} is not supported`,
        supportedChains: getSupportedChainIds(),
      },
      status: 400 as const,
    };
  }

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return {
      error: {
        error: 'Invalid contract address',
        message: 'Address must be a valid 42-character hexadecimal string starting with 0x',
      },
      status: 400 as const,
    };
  }

  return { chainId, address: address.toLowerCase() as `0x${string}` };
};

// GET /chains/:chainId/contracts/:address/events/statistics
app.get('/chains/:chainId/contracts/:address/events/statistics', async c => {
  const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in result) return c.json(result.error, result.status);

  const { chainId, address } = result;

  try {
    const stats = await getEventStatistics(chainId, address);

    c.header('X-Chain-Name', getChainName(chainId));
    c.header('Cache-Control', 'public, max-age=30');

    return c.json(
      safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        ...stats,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    logger.error({ err: error }, 'Event statistics API error');
    return c.json(
      {
        error: 'Failed to fetch event statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

// GET /chains/:chainId/contracts/:address/events/indexing-status
app.get('/chains/:chainId/contracts/:address/events/indexing-status', async c => {
  const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in result) return c.json(result.error, result.status);

  const { chainId, address } = result;

  try {
    const status = await getIndexingStatus(chainId, address);

    c.header('X-Data-Source', 'database');
    c.header('X-Chain-Name', getChainName(chainId));
    c.header('Cache-Control', 'public, max-age=5');

    return c.json(status);
  } catch (error) {
    logger.error({ err: error }, 'Event indexing status API error');
    return c.json({
      chainId,
      contractAddress: address,
      status: 'error',
      creationBlock: 0,
      lastIndexedBlock: 0,
      latestBlock: 0,
      lastFinalizedBlock: 0,
      totalEventsIndexed: 0,
      eventTypes: [],
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /chains/:chainId/contracts/:address/events — query indexed events
app.get('/chains/:chainId/contracts/:address/events', async c => {
  const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in result) return c.json(result.error, result.status);

  const { chainId, address } = result;

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1'));
  const pageSize = Math.min(Math.max(1, parseInt(c.req.query('pageSize') ?? '50')), 1000);
  const eventName = c.req.query('eventName') ?? undefined;
  const fromBlock = c.req.query('fromBlock') ? parseInt(c.req.query('fromBlock')!) : undefined;
  const toBlock = c.req.query('toBlock') ? parseInt(c.req.query('toBlock')!) : undefined;

  try {
    const data = await getContractEvents(chainId, address, {
      page,
      pageSize,
      eventName,
      fromBlock,
      toBlock,
    });

    c.header('X-Data-Source', 'database');
    c.header('X-Chain-Name', getChainName(chainId));
    c.header('Cache-Control', 'public, max-age=10');

    return c.json(
      safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        ...data,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    logger.error({ err: error }, 'Contract events API error');
    return c.json(
      {
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        events: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
        timestamp: new Date().toISOString(),
      },
      500,
    );
  }
});

// GET /chains/:chainId/contracts/:address/events/ranges — get all ranges
app.get('/chains/:chainId/contracts/:address/events/ranges', async c => {
  const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in result) return c.json(result.error, result.status);

  const { chainId, address } = result;

  try {
    const ranges = await getIndexingRanges(chainId, address);

    c.header('X-Chain-Name', getChainName(chainId));
    c.header('Cache-Control', 'public, max-age=10');

    return c.json(
      safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        ranges,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    logger.error({ err: error }, 'Get indexing ranges API error');
    return c.json(
      {
        error: 'Failed to fetch indexing ranges',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

// POST /chains/:chainId/contracts/:address/events/ranges — add new range
app.post('/chains/:chainId/contracts/:address/events/ranges', async c => {
  const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in result) return c.json(result.error, result.status);

  const { chainId, address } = result;

  try {
    const body = await c.req.json();
    const { fromBlock, toBlock, direction, priority } = body;

    const validBlockTags = ['latest', 'finalized', 'safe', 'earliest'];
    const isValidFromBlock =
      typeof fromBlock === 'number' ||
      (typeof fromBlock === 'string' && validBlockTags.includes(fromBlock));
    const isValidToBlock =
      typeof toBlock === 'number' ||
      (typeof toBlock === 'string' && validBlockTags.includes(toBlock));

    if (!isValidFromBlock || !isValidToBlock) {
      return c.json(
        {
          error: 'Invalid request body',
          message:
            'fromBlock and toBlock are required and must be numbers or valid block tags (latest, finalized, safe, earliest)',
        },
        400,
      );
    }

    const response = await addIndexingRange(chainId, address, {
      fromBlock: fromBlock as import('@/types/events').BlockTagInput,
      toBlock: toBlock as import('@/types/events').BlockTagInput,
      direction,
      priority,
    });

    if (!response.success) {
      return c.json(
        {
          error: 'Failed to add indexing range',
          message: response.error,
          overlaps: response.overlaps,
        },
        400,
      );
    }

    c.header('X-Chain-Name', getChainName(chainId));

    return c.json(
      safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        rangeId: response.rangeId,
        overlaps: response.overlaps,
        timestamp: new Date().toISOString(),
      }),
      201,
    );
  } catch (error) {
    logger.error({ err: error }, 'Add indexing range API error');
    return c.json(
      {
        error: 'Failed to add indexing range',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

// POST /chains/:chainId/contracts/:address/events/ranges/quick — quick creation modes
app.post('/chains/:chainId/contracts/:address/events/ranges/quick', async c => {
  const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in result) return c.json(result.error, result.status);

  const { chainId, address } = result;

  try {
    const body = await c.req.json();
    const { mode, blockCount, direction, priority } = body;

    const validModes = ['all', 'recent', 'first', 'continue'];
    if (!mode || typeof mode !== 'string' || !validModes.includes(mode)) {
      return c.json(
        {
          error: 'Invalid request body',
          message: 'mode is required and must be one of: all, recent, first, continue',
        },
        400,
      );
    }

    const needsBlockCount = ['recent', 'first', 'continue'].includes(mode);
    if (needsBlockCount && (typeof blockCount !== 'number' || blockCount <= 0)) {
      return c.json(
        {
          error: 'Invalid request body',
          message:
            'blockCount is required and must be a positive number for mode: recent, first, continue',
        },
        400,
      );
    }

    let response:
      | { success: boolean; rangeId?: number; fromBlock?: number; toBlock?: number; error?: string }
      | undefined;
    switch (mode) {
      case 'all':
        response = await createRangeAll(chainId, address, { direction, priority });
        break;
      case 'recent':
        response = await createRangeRecent(chainId, address, blockCount, { direction, priority });
        break;
      case 'first':
        response = await createRangeFirst(chainId, address, blockCount, { direction, priority });
        break;
      case 'continue':
        response = await createRangeContinue(chainId, address, blockCount, { direction, priority });
        break;
    }

    if (!response?.success) {
      return c.json(
        {
          error: `Failed to create range with mode: ${mode}`,
          message: response?.error ?? 'Unknown error',
        },
        400,
      );
    }

    c.header('X-Chain-Name', getChainName(chainId));

    return c.json(
      safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        rangeId: response.rangeId,
        fromBlock: response.fromBlock,
        toBlock: response.toBlock,
        mode,
        timestamp: new Date().toISOString(),
      }),
      201,
    );
  } catch (error) {
    logger.error({ err: error }, 'Quick create indexing range API error');
    return c.json(
      {
        error: 'Failed to create indexing range',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

// PATCH /chains/:chainId/contracts/:address/events/ranges/:rangeId — update range
app.patch('/chains/:chainId/contracts/:address/events/ranges/:rangeId', async c => {
  const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in result) return c.json(result.error, result.status);

  const { chainId, address } = result;
  const rangeId = parseInt(c.req.param('rangeId'));

  if (isNaN(rangeId)) {
    return c.json(
      {
        error: 'Invalid rangeId',
        message: 'rangeId must be a number',
      },
      400,
    );
  }

  try {
    const body = await c.req.json();
    const { fromBlock, toBlock, direction, priority } = body;

    const response = await updateIndexingRange(chainId, address, rangeId, {
      fromBlock,
      toBlock,
      direction,
      priority,
    });

    if (!response.success) {
      return c.json(
        {
          error: 'Failed to update indexing range',
          message: response.error,
          overlaps: response.overlaps,
        },
        400,
      );
    }

    c.header('X-Chain-Name', getChainName(chainId));

    return c.json(
      safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        rangeId,
        overlaps: response.overlaps,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    logger.error({ err: error }, 'Update indexing range API error');
    return c.json(
      {
        error: 'Failed to update indexing range',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

// DELETE /chains/:chainId/contracts/:address/events/ranges/:rangeId — delete range
app.delete('/chains/:chainId/contracts/:address/events/ranges/:rangeId', async c => {
  const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in result) return c.json(result.error, result.status);

  const { chainId, address } = result;
  const rangeId = parseInt(c.req.param('rangeId'));

  if (isNaN(rangeId)) {
    return c.json(
      {
        error: 'Invalid rangeId',
        message: 'rangeId must be a number',
      },
      400,
    );
  }

  try {
    const response = await deleteIndexingRange(chainId, address, rangeId);

    if (!response.success) {
      return c.json(
        {
          error: 'Failed to delete indexing range',
          message: response.error,
        },
        400,
      );
    }

    c.header('X-Chain-Name', getChainName(chainId));

    return c.json(
      safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        rangeId,
        deleted: true,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    logger.error({ err: error }, 'Delete indexing range API error');
    return c.json(
      {
        error: 'Failed to delete indexing range',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

// POST /chains/:chainId/contracts/:address/events/ranges/:rangeId/start — start indexing
app.post('/chains/:chainId/contracts/:address/events/ranges/:rangeId/start', async c => {
  const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in result) return c.json(result.error, result.status);

  const { chainId, address } = result;
  const rangeId = parseInt(c.req.param('rangeId'));

  if (isNaN(rangeId)) {
    return c.json(
      {
        error: 'Invalid rangeId',
        message: 'rangeId must be a number',
      },
      400,
    );
  }

  try {
    let abi: unknown[] = [];

    try {
      const body = await c.req.json();
      if (body.abi && Array.isArray(body.abi)) {
        abi = body.abi;
      }
    } catch {
      // no body or invalid JSON
    }

    if (abi.length === 0) {
      try {
        const contractSource = await contractSourceService.getContractSource(chainId, address);
        const abiStr = contractSource?.implementationContract?.abi ?? contractSource?.abi;
        if (abiStr) {
          abi = JSON.parse(abiStr);
        }
      } catch {
        // ABI not available
      }
    }

    if (abi.length === 0) {
      return c.json(
        {
          error: 'No ABI available',
          message:
            'Contract ABI is required for indexing. Verify the contract on a block explorer first.',
        },
        400,
      );
    }

    const response = await startIndexingRange(chainId, address, rangeId, abi as Abi);

    if (!response.success) {
      return c.json(
        {
          error: 'Failed to start indexing range',
          message: response.error,
        },
        400,
      );
    }

    c.header('X-Chain-Name', getChainName(chainId));

    return c.json(
      safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        rangeId,
        status: 'indexing',
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    logger.error({ err: error }, 'Start indexing range API error');
    return c.json(
      {
        error: 'Failed to start indexing range',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

// POST /chains/:chainId/contracts/:address/events/ranges/:rangeId/pause — pause indexing
app.post('/chains/:chainId/contracts/:address/events/ranges/:rangeId/pause', async c => {
  const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in result) return c.json(result.error, result.status);

  const { chainId, address } = result;
  const rangeId = parseInt(c.req.param('rangeId'));

  if (isNaN(rangeId)) {
    return c.json(
      {
        error: 'Invalid rangeId',
        message: 'rangeId must be a number',
      },
      400,
    );
  }

  try {
    const isActive = getActiveRangeJob(chainId, address, rangeId);

    if (!isActive) {
      const ranges = await getIndexingRanges(chainId, address);
      const range = ranges.find(r => r.rangeId === rangeId);

      if (!range) {
        return c.json({ error: 'Range not found' }, 404);
      }

      if (range.currentBlock !== null && range.toBlock !== null) {
        const currentBlock = range.currentBlock;
        const toBlock = range.toBlock;
        const fromBlock = range.fromBlock;
        const isComplete =
          range.direction === 'forward' ? currentBlock >= toBlock : currentBlock <= fromBlock;

        if (isComplete) {
          await updateRangeStatus(chainId, address, rangeId, 'completed');
          return c.json(
            safeJsonResponse({
              chainId,
              chainName: getChainName(chainId),
              contractAddress: address,
              rangeId,
              status: 'completed',
              message: 'Range was already complete, status updated',
              timestamp: new Date().toISOString(),
            }),
          );
        }
      }

      return c.json(
        {
          error: 'No active indexing job',
          message: 'Range is not currently being indexed',
        },
        400,
      );
    }

    pauseIndexingRange(chainId, address, rangeId);

    c.header('X-Chain-Name', getChainName(chainId));

    return c.json(
      safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        rangeId,
        status: 'paused',
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    logger.error({ err: error }, 'Pause indexing range API error');
    return c.json(
      {
        error: 'Failed to pause indexing range',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

// POST /chains/:chainId/contracts/:address/events/ranges/:rangeId/resume — resume indexing
app.post('/chains/:chainId/contracts/:address/events/ranges/:rangeId/resume', async c => {
  const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in result) return c.json(result.error, result.status);

  const { chainId, address } = result;
  const rangeId = parseInt(c.req.param('rangeId'));

  if (isNaN(rangeId)) {
    return c.json(
      {
        error: 'Invalid rangeId',
        message: 'rangeId must be a number',
      },
      400,
    );
  }

  try {
    let abi: unknown[] = [];

    try {
      const body = await c.req.json();
      if (body.abi && Array.isArray(body.abi)) {
        abi = body.abi;
      }
    } catch {
      // no body or invalid JSON
    }

    if (abi.length === 0) {
      try {
        const contractSource = await contractSourceService.getContractSource(chainId, address);
        const abiStr = contractSource?.implementationContract?.abi ?? contractSource?.abi;
        if (abiStr) {
          abi = JSON.parse(abiStr);
        }
      } catch {
        // ABI not available
      }
    }

    if (abi.length === 0) {
      return c.json(
        {
          error: 'No ABI available',
          message:
            'Contract ABI is required for indexing. Verify the contract on a block explorer first.',
        },
        400,
      );
    }

    const response = await resumeIndexingRange(chainId, address, rangeId, abi as Abi);

    if (!response.success) {
      return c.json(
        {
          error: 'Failed to resume indexing range',
          message: response.error,
        },
        400,
      );
    }

    c.header('X-Chain-Name', getChainName(chainId));

    return c.json(
      safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        rangeId,
        status: 'indexing',
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (error) {
    logger.error({ err: error }, 'Resume indexing range API error');
    return c.json(
      {
        error: 'Failed to resume indexing range',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

export default app;
