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
  createRangeCatchup,
  type EventArgFilters,
  type EventTopicFilters,
} from '../services/EventIndexingService';
import {
  buildEventsCsv,
  EXPORT_MAX_ROWS,
  fetchFilteredEventsForExport,
  getFilteredEventCount,
} from '../services/EventExportService';
import { safeJsonResponse } from '../utils/serialization';
import { contractSourceService } from '../services/ContractSourceService';
import { requireAdminTokenIfConfigured } from '../middleware/admin-token';
import type { BlockTagInput } from '@/types/events';

const logger = createLogger('events-routes');
const app = new Hono();

const VALID_BLOCK_TAGS = ['latest', 'finalized', 'safe', 'earliest'];

// Range bounds arrive as concrete block numbers or one of the supported
// block tags; the service resolves tags to concrete numbers before storing.
const isValidBlockBound = (value: unknown): value is BlockTagInput =>
  typeof value === 'number' || (typeof value === 'string' && VALID_BLOCK_TAGS.includes(value));

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

// Query params shared by the events list and export endpoints. Malformed
// argFilters fail loudly with 400 instead of being ignored: silently dropping
// them would present unfiltered results as if they were filtered.
type ParsedEventFilters =
  | (EventArgFiltersOwner & { topics?: EventTopicFilters })
  | { error: { error: string; message: string }; status: 400 };

type EventArgFiltersOwner = {
  eventName?: string;
  fromBlock?: number;
  toBlock?: number;
  argFilters?: EventArgFilters;
};

const parseEventFilters = (searchParams: URLSearchParams): ParsedEventFilters => {
  const parseBlock = (key: string): number | undefined => {
    const raw = searchParams.get(key);
    if (raw === null || raw === '') return undefined;
    const parsed = parseInt(raw, 10);
    // Unparseable block numbers are treated as absent rather than 500-ing.
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  let argFilters: EventArgFilters | undefined;
  const argFiltersRaw = searchParams.get('argFilters');
  if (argFiltersRaw !== null && argFiltersRaw !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(argFiltersRaw);
    } catch {
      parsed = undefined;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        error: {
          error: 'Invalid argFilters',
          message: 'argFilters must be a JSON object of {argName: string | number | boolean}',
        },
        status: 400 as const,
      };
    }
    const scalarEntries = Object.entries(parsed as Record<string, unknown>).filter(
      ([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
    );
    argFilters = Object.fromEntries(scalarEntries) as EventArgFilters;
  }

  const topics: EventTopicFilters = {};
  for (const key of ['topic0', 'topic1', 'topic2', 'topic3'] as const) {
    const raw = searchParams.get(key);
    if (raw !== null && raw !== '') {
      topics[key] = raw.toLowerCase();
    }
  }

  const eventName = searchParams.get('eventName');

  return {
    eventName: eventName !== null && eventName !== '' ? eventName : undefined,
    fromBlock: parseBlock('fromBlock'),
    toBlock: parseBlock('toBlock'),
    argFilters,
    topics:
      topics.topic0 ?? topics.topic1 ?? topics.topic2 ?? topics.topic3 ? topics : undefined,
  };
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
  const parsedFilters = parseEventFilters(new URL(c.req.url).searchParams);
  if ('error' in parsedFilters) return c.json(parsedFilters.error, parsedFilters.status);

  try {
    const data = await getContractEvents(chainId, address, {
      page,
      pageSize,
      eventName: parsedFilters.eventName,
      fromBlock: parsedFilters.fromBlock,
      toBlock: parsedFilters.toBlock,
      argFilters: parsedFilters.argFilters,
      topics: parsedFilters.topics,
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

// GET /chains/:chainId/contracts/:address/events/export — CSV of the filtered set
app.get('/chains/:chainId/contracts/:address/events/export', async c => {
  const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in result) return c.json(result.error, result.status);

  const { chainId, address } = result;

  const parsedFilters = parseEventFilters(new URL(c.req.url).searchParams);
  if ('error' in parsedFilters) return c.json(parsedFilters.error, parsedFilters.status);

  try {
    // Refuse instead of truncating: a silently capped CSV would look complete.
    const count = await getFilteredEventCount(chainId, address, parsedFilters);
    if (count > EXPORT_MAX_ROWS) {
      return c.json(
        {
          error: 'Export limit exceeded',
          message: 'Export limited to 100,000 rows; narrow your filters',
        },
        400,
      );
    }

    const rows = await fetchFilteredEventsForExport(chainId, address, parsedFilters);
    const csv = buildEventsCsv(rows);

    // ISO timestamp with filesystem-hostile characters stripped.
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header(
      'Content-Disposition',
      `attachment; filename="events-${chainId}-${address}-${timestamp}.csv"`,
    );
    c.header('Cache-Control', 'no-store');
    return c.body(csv);
  } catch (error) {
    logger.error({ err: error }, 'Event export API error');
    return c.json(
      {
        error: 'Failed to export events',
        message: error instanceof Error ? error.message : 'Unknown error',
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
app.post('/chains/:chainId/contracts/:address/events/ranges', requireAdminTokenIfConfigured, async c => {
  const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in result) return c.json(result.error, result.status);

  const { chainId, address } = result;

  try {
    const body = await c.req.json();
    const { fromBlock, toBlock, direction, priority } = body;

    if (!isValidBlockBound(fromBlock) || !isValidBlockBound(toBlock)) {
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
      fromBlock,
      toBlock,
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
app.post('/chains/:chainId/contracts/:address/events/ranges/quick', requireAdminTokenIfConfigured, async c => {
  const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in result) return c.json(result.error, result.status);

  const { chainId, address } = result;

  try {
    const body = await c.req.json();
    const { mode, blockCount, direction, priority } = body;

    const validModes = ['all', 'recent', 'first', 'continue', 'catchup'];
    if (!mode || typeof mode !== 'string' || !validModes.includes(mode)) {
      return c.json(
        {
          error: 'Invalid request body',
          message: 'mode is required and must be one of: all, recent, first, continue, catchup',
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
      case 'catchup':
        response = await createRangeCatchup(chainId, address, { direction, priority });
        break;
    }

    if (!response?.success) {
      // Catchup without history has its own contract error body.
      if (response?.error === 'No previous range found. Cannot catch up.') {
        return c.json({ error: response.error }, 400);
      }
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
app.patch('/chains/:chainId/contracts/:address/events/ranges/:rangeId', requireAdminTokenIfConfigured, async c => {
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

    if (
      (fromBlock !== undefined && !isValidBlockBound(fromBlock)) ||
      (toBlock !== undefined && !isValidBlockBound(toBlock))
    ) {
      return c.json(
        {
          error: 'Invalid request body',
          message:
            'fromBlock and toBlock must be numbers or valid block tags (latest, finalized, safe, earliest)',
        },
        400,
      );
    }

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
app.delete('/chains/:chainId/contracts/:address/events/ranges/:rangeId', requireAdminTokenIfConfigured, async c => {
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
app.post('/chains/:chainId/contracts/:address/events/ranges/:rangeId/start', requireAdminTokenIfConfigured, async c => {
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

    // Fail fast on invalid states so clients still get actionable 400s
    // before the (potentially hours-long) indexing work is kicked off.
    if (getActiveRangeJob(chainId, address, rangeId)) {
      return c.json(
        {
          error: 'Failed to start indexing range',
          message: 'Range is already being indexed',
        },
        400,
      );
    }

    const ranges = await getIndexingRanges(chainId, address);
    const range = ranges.find(r => r.rangeId === rangeId);

    if (!range) {
      return c.json(
        {
          error: 'Failed to start indexing range',
          message: 'Range not found',
        },
        400,
      );
    }

    if (range.status === 'completed') {
      return c.json(
        {
          error: 'Failed to start indexing range',
          message: 'Range is already completed',
        },
        400,
      );
    }

    // Indexing a range can run for hours: acknowledge immediately and let
    // the loop continue in the background. Progress is observable via the
    // ranges and indexing-status endpoints.
    void startIndexingRange(chainId, address, rangeId, abi as Abi).catch(err =>
      logger.error({ err }, 'Background indexing failed'),
    );

    c.header('X-Chain-Name', getChainName(chainId));

    return c.json(
      {
        chainId,
        contractAddress: address,
        rangeId,
        started: true,
        status: 'indexing',
        message: 'Indexing started in background; poll ranges or indexing-status for progress',
      },
      202,
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
app.post('/chains/:chainId/contracts/:address/events/ranges/:rangeId/pause', requireAdminTokenIfConfigured, async c => {
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
app.post('/chains/:chainId/contracts/:address/events/ranges/:rangeId/resume', requireAdminTokenIfConfigured, async c => {
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

    // Fail fast on invalid states so clients still get actionable 400s
    // before the (potentially hours-long) indexing work is kicked off.
    if (getActiveRangeJob(chainId, address, rangeId)) {
      return c.json(
        {
          error: 'Failed to resume indexing range',
          message: 'Range is already being indexed',
        },
        400,
      );
    }

    const ranges = await getIndexingRanges(chainId, address);
    const range = ranges.find(r => r.rangeId === rangeId);

    if (!range) {
      return c.json(
        {
          error: 'Failed to resume indexing range',
          message: 'Range not found',
        },
        400,
      );
    }

    if (range.status !== 'paused' && range.status !== 'error') {
      return c.json(
        {
          error: 'Failed to resume indexing range',
          message: 'Can only resume paused or errored ranges',
        },
        400,
      );
    }

    // Resuming re-runs the remaining (potentially hours-long) indexing work:
    // acknowledge immediately and let the loop continue in the background.
    // Progress is observable via the ranges and indexing-status endpoints.
    void resumeIndexingRange(chainId, address, rangeId, abi as Abi).catch(err =>
      logger.error({ err }, 'Background indexing failed'),
    );

    c.header('X-Chain-Name', getChainName(chainId));

    return c.json(
      {
        chainId,
        contractAddress: address,
        rangeId,
        started: true,
        status: 'indexing',
        message: 'Indexing started in background; poll ranges or indexing-status for progress',
      },
      202,
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
