import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import {
  getChainName,
  isChainSupported,
  getSupportedChainIds,
} from '../config/chains';
import {
  getValidatedChainId,
  getValidatedAddress,
} from '../server/validation';
import {
  startIndexing,
  stopIndexing,
  getIndexingStatus,
  getContractEvents,
  getEventStatistics,
} from '../services/EventIndexingService';
import { contractSourceService } from '../services/ContractSourceService';
import { safeJsonResponse } from '../utils/serialization';

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
app.get('/chains/:chainId/contracts/:address/events/statistics', async (c) => {
  const result = validateChainAndAddress(
    c.req.param('chainId'),
    c.req.param('address'),
  );
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
  }
  catch (error) {
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
app.get(
  '/chains/:chainId/contracts/:address/events/indexing-status',
  async (c) => {
    const result = validateChainAndAddress(
      c.req.param('chainId'),
      c.req.param('address'),
    );
    if ('error' in result) return c.json(result.error, result.status);

    const { chainId, address } = result;

    try {
      const status = await getIndexingStatus(chainId, address);

      c.header('X-Data-Source', 'database');
      c.header('X-Chain-Name', getChainName(chainId));
      c.header('Cache-Control', 'public, max-age=5');

      return c.json(status);
    }
    catch (error) {
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
        errorMessage:
          error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

// POST /chains/:chainId/contracts/:address/events/index — trigger indexing
app.post(
  '/chains/:chainId/contracts/:address/events/index',
  async (c) => {
    const result = validateChainAndAddress(
      c.req.param('chainId'),
      c.req.param('address'),
    );
    if ('error' in result) return c.json(result.error, result.status);

    const { chainId, address } = result;

    try {
      let abi: unknown[] = [];

      try {
        const body = await c.req.json();
        if (body.abi && Array.isArray(body.abi)) {
          abi = body.abi;
        }
      }
      catch {
        // no body or invalid JSON
      }

      if (abi.length === 0) {
        try {
          const contractSource
            = await contractSourceService.getContractSource(chainId, address);
          const abiStr
            = contractSource?.implementationContract?.abi ?? contractSource?.abi;
          if (abiStr) {
            abi = JSON.parse(abiStr);
          }
        }
        catch {
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

      startIndexing(chainId, address, abi as any).catch((err) => {
        logger.error(
          { err, chainId, address },
          'Background indexing failed',
        );
      });

      return c.json({
        message: 'Indexing started',
        chainId,
        contractAddress: address,
      });
    }
    catch (error) {
      logger.error({ err: error }, 'Failed to start indexing');
      return c.json(
        {
          error: 'Failed to start indexing',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      );
    }
  },
);

// DELETE /chains/:chainId/contracts/:address/events/index — stop indexing
app.delete(
  '/chains/:chainId/contracts/:address/events/index',
  async (c) => {
    const result = validateChainAndAddress(
      c.req.param('chainId'),
      c.req.param('address'),
    );
    if ('error' in result) return c.json(result.error, result.status);

    const { chainId, address } = result;
    stopIndexing(chainId, address);
    return c.json({ message: 'Indexing stopped', chainId, contractAddress: address });
  },
);

// GET /chains/:chainId/contracts/:address/events — query indexed events
app.get('/chains/:chainId/contracts/:address/events', async (c) => {
  const result = validateChainAndAddress(
    c.req.param('chainId'),
    c.req.param('address'),
  );
  if ('error' in result) return c.json(result.error, result.status);

  const { chainId, address } = result;

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1'));
  const pageSize = Math.min(
    Math.max(1, parseInt(c.req.query('pageSize') ?? '50')),
    1000,
  );
  const eventName = c.req.query('eventName') || undefined;
  const fromBlock = c.req.query('fromBlock')
    ? parseInt(c.req.query('fromBlock')!)
    : undefined;
  const toBlock = c.req.query('toBlock')
    ? parseInt(c.req.query('toBlock')!)
    : undefined;

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
  }
  catch (error) {
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

export default app;
