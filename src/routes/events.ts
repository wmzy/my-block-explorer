import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Abi } from 'viem';
import { createLogger } from '../server/logger';
import { createRateLimiter } from '../middleware/rate-limit';
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

  // Address validation is delegated to getValidatedAddress: all-lowercase
  // (or all-uppercase) passes — the checksum-less convention — while a
  // mixed-case address must carry a correct EIP-55 checksum. Its
  // HTTPException is converted to the JSON error shape used across this
  // file instead of escaping as Hono's plain-text exception response.
  let address: string;
  try {
    address = getValidatedAddress(addressStr);
  }
  catch (error) {
    return {
      error: {
        error: 'Invalid contract address',
        message:
          error instanceof HTTPException
            ? error.message
            : 'Address must be a valid 42-character hexadecimal string starting with 0x',
      },
      status: 400 as const,
    };
  }

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

  // Storage keys stay lowercase (C-3): rows written before checksum-tight
  // validation remain reachable.
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

// ABI resolution shared by the start/resume/quick routes: an explicit
// request-body ABI wins, then the server-side contract source
// (implementation side first). Empty when neither has one.
const resolveIndexingAbi = async (
  bodyAbi: unknown,
  chainId: number,
  address: `0x${string}`,
): Promise<unknown[]> => {
  if (Array.isArray(bodyAbi) && bodyAbi.length > 0) return bodyAbi;
  try {
    const contractSource = await contractSourceService.getContractSource(chainId, address);
    const abiStr = contractSource?.implementationContract?.abi ?? contractSource?.abi;
    if (abiStr) return JSON.parse(abiStr) as unknown[];
  } catch {
    // ABI not available
  }
  return [];
};

// Quick-create auto-start: a freshly created 'pending' range reads as
// "indexing started" in the UI, so mirror the /start route's semantics and
// kick the background job off immediately. The returned outcome rides
// along on the quick response instead of failing the create: a missing
// ABI keeps the range pending and startable later.
const autoStartQuickRange = async (
  chainId: number,
  address: `0x${string}`,
  rangeId: number,
  bodyAbi: unknown,
): Promise<{ started: boolean; startError?: string }> => {
  const abi = await resolveIndexingAbi(bodyAbi, chainId, address);

  if (abi.length === 0) {
    return {
      started: false,
      startError:
        'No ABI available — the range stays pending. Verify the contract or send an abi in the request body, then start it.',
    };
  }

  if (getActiveRangeJob(chainId, address, rangeId)) {
    return { started: false, startError: 'Range is already being indexed' };
  }

  // Indexing a range can run for hours: acknowledge immediately and let
  // the loop continue in the background, exactly like the /start route.
  void startIndexingRange(chainId, address, rangeId, abi as Abi).catch(err =>
    logger.error({ err }, 'Background indexing failed'),
  );
  return { started: true };
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
    // 503 + error envelope: answering 200 with zeroed counters would
    // fabricate an "indexed nothing" state the database never reported.
    return c.json(
      {
        error: 'indexing_status_unavailable',
        message: error instanceof Error ? error.message : 'Failed to load indexing status',
      },
      503,
    );
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
    // Error envelope, never a success shape: a 500 body that looks like an
    // empty result page invites clients to render backend failures as
    // "no events found".
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to query contract events',
      },
      500,
    );
  }
});

// GET /chains/:chainId/contracts/:address/events/export — CSV of the filtered set
// CSV export re-runs the filtered query and serializes up to 100k rows, so
// it carries the tightest limit in the API: 5/min with a burst of 2.
const exportRateLimiter = createRateLimiter({ name: 'events-export', requestsPerMinute: 5, burst: 2 });
app.get('/chains/:chainId/contracts/:address/events/export', exportRateLimiter, async c => {
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
        // Present when the service clamped a numeric toBlock to the chain
        // head — the UI turns it into an inline notice.
        truncatedToBlock: response.truncatedToBlock,
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
    const { mode, blockCount, direction, priority, abi, confirmFullHistory } = body;

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
      | {
        success: boolean;
        rangeId?: number;
        fromBlock?: number;
        toBlock?: number;
        truncatedToBlock?: number;
        reason?: 'full-history-unconfirmed';
        spanBlocks?: number;
        head?: number;
        error?: string;
      }
      | undefined;
    switch (mode) {
      case 'all':
        response = await createRangeAll(chainId, address, {
          direction,
          priority,
          // Strict true: only an explicit confirmation unlocks full history.
          confirmFullHistory: confirmFullHistory === true,
        });
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
      // The full-history gate is a confirmation prompt, not a failure:
      // mirror the span facts and duplicate them into `details` — the
      // frontend HTTP layer (toApiError) only surfaces message/code/
      // details, so that is the channel the UI reads the reason from.
      if (response?.reason === 'full-history-unconfirmed') {
        return c.json(
          {
            error: 'Full history confirmation required',
            message: response.error,
            reason: response.reason,
            spanBlocks: response.spanBlocks,
            fromBlock: response.fromBlock,
            head: response.head,
            details: {
              reason: response.reason,
              spanBlocks: response.spanBlocks,
              fromBlock: response.fromBlock,
              head: response.head,
            },
          },
          400,
        );
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

    // Auto-start the created range right away — same semantics the /start
    // route applies (body ABI → contract-source ABI, background job). A
    // start failure keeps the range pending and is reported, not thrown.
    const autoStart =
      typeof response.rangeId === 'number'
        ? await autoStartQuickRange(chainId, address, response.rangeId, abi)
        : { started: false as const };

    return c.json(
      safeJsonResponse({
        chainId,
        chainName: getChainName(chainId),
        contractAddress: address,
        rangeId: response.rangeId,
        fromBlock: response.fromBlock,
        toBlock: response.toBlock,
        truncatedToBlock: response.truncatedToBlock,
        mode,
        started: autoStart.started,
        startError: autoStart.startError,
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
      // A missing range is the same 404 resource state the pause/start/
      // resume routes return; other failures (e.g. deleting while
      // indexing) are state conflicts and stay 400.
      if (response.error === 'Range not found') {
        return c.json({ error: 'Range not found' }, 404);
      }
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
    let bodyAbi: unknown;
    try {
      const body = await c.req.json();
      bodyAbi = body.abi;
    } catch {
      // no body or invalid JSON
    }

    const abi = await resolveIndexingAbi(bodyAbi, chainId, address);

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
      // Mirrors the pause route: a missing range is a 404 resource state,
      // while state conflicts (already indexing/completed) stay 400.
      return c.json({ error: 'Range not found' }, 404);
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
    let bodyAbi: unknown;
    try {
      const body = await c.req.json();
      bodyAbi = body.abi;
    } catch {
      // no body or invalid JSON
    }

    const abi = await resolveIndexingAbi(bodyAbi, chainId, address);

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
      // Mirrors the pause route: a missing range is a 404 resource state,
      // while state conflicts (already indexing / not paused) stay 400.
      return c.json({ error: 'Range not found' }, 404);
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
