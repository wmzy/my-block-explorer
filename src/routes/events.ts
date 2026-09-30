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
import { createApiError, respondError } from '../utils/api-error';
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
  } catch (error) {
    return {
      error: createApiError(
        400,
        'invalid_address',
        error instanceof HTTPException
          ? error.message
          : 'Address must be a valid 42-character hexadecimal string starting with 0x',
      ),
      status: 400 as const,
    };
  }

  if (isNaN(chainId) || !isChainSupported(chainId)) {
    return {
      error: createApiError(400, 'unsupported_chain', `Chain ID ${chainId} is not supported`, {
        supportedChains: getSupportedChainIds(),
      }),
      status: 400 as const,
    };
  }

  // Storage keys stay lowercase (C-3): rows written before checksum-tight
  // validation remain reachable.
  return { chainId, address: address.toLowerCase() as `0x${string}` };
};

// Query params shared by the events list and export endpoints. Malformed
// argFilters fail loudly with 400 instead of being ignored: silently dropping
// them would present unfiltered results as if they were filtered. The same
// goes for non-scalar filter values — a typo like {a: [1,2]} must not run the
// query unfiltered and return a wrong answer that looks right — and for junk
// block bounds, which must not be treated as absent.
type ApiErrorBody = ReturnType<typeof createApiError>;

type ParsedEventFilters =
  | (EventArgFiltersOwner & { topics?: EventTopicFilters })
  | { error: ApiErrorBody; status: 400 };

type EventArgFiltersOwner = {
  eventName?: string;
  fromBlock?: number;
  toBlock?: number;
  argFilters?: EventArgFilters;
};

const parseEventFilters = (searchParams: URLSearchParams): ParsedEventFilters => {
  // Same loud-400 contract as page/pageSize above: junk like 'abc' used to
  // be treated as absent, silently dropping the bound. Empty string and
  // missing stay absent, and only plain decimal is honored — hex block
  // numbers were never meaningful input (parseInt with radix 10 reads
  // '0x10' as 0) and the UI only ever sends Number.prototype.toString().
  const parseBlock = (
    key: string,
    errorCode: string,
  ): number | undefined | { error: ApiErrorBody; status: 400 } => {
    const raw = searchParams.get(key);
    if (raw === null || raw === '') return undefined;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      return {
        error: createApiError(
          400,
          errorCode,
          `${key} must be a decimal block number, e.g. ${key}=18000000`,
        ),
        status: 400 as const,
      };
    }
    return parsed;
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
        error: createApiError(
          400,
          'invalid_arg_filters',
          'argFilters must be a JSON object of {argName: string | number | boolean}',
        ),
        status: 400 as const,
      };
    }
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return {
          error: createApiError(
            400,
            'invalid_arg_filters',
            `argFilters.${key} must be a scalar — expected the shape {argName: string | number | boolean}`,
          ),
          status: 400 as const,
        };
      }
    }
    argFilters = parsed as EventArgFilters;
  }

  const topics: EventTopicFilters = {};
  for (const key of ['topic0', 'topic1', 'topic2', 'topic3'] as const) {
    const raw = searchParams.get(key);
    if (raw !== null && raw !== '') {
      topics[key] = raw.toLowerCase();
    }
  }

  const eventName = searchParams.get('eventName');

  const fromBlock = parseBlock('fromBlock', 'invalid_from_block');
  if (typeof fromBlock === 'object') return { error: fromBlock.error, status: fromBlock.status };
  const toBlock = parseBlock('toBlock', 'invalid_to_block');
  if (typeof toBlock === 'object') return { error: toBlock.error, status: toBlock.status };

  return {
    eventName: eventName !== null && eventName !== '' ? eventName : undefined,
    fromBlock,
    toBlock,
    argFilters,
    topics: (topics.topic0 ?? topics.topic1 ?? topics.topic2 ?? topics.topic3) ? topics : undefined,
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
    return respondError(
      c,
      500,
      'internal_error',
      error instanceof Error ? error.message : 'Failed to fetch event statistics',
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
      createApiError(
        503,
        'indexing_status_unavailable',
        error instanceof Error ? error.message : 'Failed to load indexing status',
      ),
      503,
    );
  }
});

// GET /chains/:chainId/contracts/:address/events — query indexed events
app.get('/chains/:chainId/contracts/:address/events', async c => {
  const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
  if ('error' in result) return c.json(result.error, result.status);

  const { chainId, address } = result;

  // Pagination params fail loudly with 400 on non-numeric input (same
  // contract as addresses.ts): NaN would otherwise flow into the SQL
  // offset and surface as a 500. Missing/empty keeps the defaults, pages
  // below 1 keep the clamp-to-1 behavior, pageSize stays capped at 1000.
  const rawPage = c.req.query('page');
  const rawPageSize = c.req.query('pageSize');
  const parsedPage = rawPage === undefined || rawPage === '' ? 1 : parseInt(rawPage, 10);
  const parsedPageSize =
    rawPageSize === undefined || rawPageSize === '' ? 50 : parseInt(rawPageSize, 10);

  if (Number.isNaN(parsedPage)) {
    return respondError(c, 400, 'invalid_page', 'page must be a positive integer');
  }
  if (Number.isNaN(parsedPageSize)) {
    return respondError(c, 400, 'invalid_page_size', 'pageSize must be a positive integer');
  }
  const page = Math.max(1, parsedPage);
  const pageSize = Math.min(Math.max(1, parsedPageSize), 1000);
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
    return respondError(c, 500, 'internal_error', 'Failed to query contract events');
  }
});

// GET /chains/:chainId/contracts/:address/events/export — CSV of the filtered set
// CSV export re-runs the filtered query and serializes up to 100k rows, so
// it carries the tightest limit in the API: 5/min with a burst of 2.
const exportRateLimiter = createRateLimiter({
  name: 'events-export',
  requestsPerMinute: 5,
  burst: 2,
});
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
      return respondError(
        c,
        400,
        'too_many_rows',
        'Export limited to 100,000 rows; narrow your filters',
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
    return respondError(
      c,
      500,
      'internal_error',
      error instanceof Error ? error.message : 'Failed to export events',
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
    return respondError(
      c,
      500,
      'internal_error',
      error instanceof Error ? error.message : 'Failed to fetch indexing ranges',
    );
  }
});

// POST /chains/:chainId/contracts/:address/events/ranges — add new range
app.post(
  '/chains/:chainId/contracts/:address/events/ranges',
  requireAdminTokenIfConfigured,
  async c => {
    const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
    if ('error' in result) return c.json(result.error, result.status);

    const { chainId, address } = result;

    try {
      const body = await c.req.json();
      const { fromBlock, toBlock, direction, priority } = body;

      if (!isValidBlockBound(fromBlock) || !isValidBlockBound(toBlock)) {
        return respondError(
          c,
          400,
          'invalid_bounds',
          'fromBlock and toBlock are required and must be numbers or valid block tags (latest, finalized, safe, earliest)',
        );
      }

      const response = await addIndexingRange(chainId, address, {
        fromBlock,
        toBlock,
        direction,
        priority,
      });

      if (!response.success) {
        return respondError(c, 400, 'range_overlap', response.error, {
          overlaps: response.overlaps,
        });
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
      return respondError(
        c,
        500,
        'internal_error',
        error instanceof Error ? error.message : 'Failed to add indexing range',
      );
    }
  },
);

// POST /chains/:chainId/contracts/:address/events/ranges/quick — quick creation modes
app.post(
  '/chains/:chainId/contracts/:address/events/ranges/quick',
  requireAdminTokenIfConfigured,
  async c => {
    const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
    if ('error' in result) return c.json(result.error, result.status);

    const { chainId, address } = result;

    try {
      const body = await c.req.json();
      const { mode, blockCount, direction, priority, abi, confirmFullHistory } = body;

      const validModes = ['all', 'recent', 'first', 'continue', 'catchup'];
      if (!mode || typeof mode !== 'string' || !validModes.includes(mode)) {
        return respondError(
          c,
          400,
          'invalid_mode',
          'mode is required and must be one of: all, recent, first, continue, catchup',
        );
      }

      const needsBlockCount = ['recent', 'first', 'continue'].includes(mode);
      if (needsBlockCount && (typeof blockCount !== 'number' || blockCount <= 0)) {
        return respondError(
          c,
          400,
          'invalid_block_count',
          'blockCount is required and must be a positive number for mode: recent, first, continue',
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
          response = await createRangeContinue(chainId, address, blockCount, {
            direction,
            priority,
          });
          break;
        case 'catchup':
          response = await createRangeCatchup(chainId, address, { direction, priority });
          break;
      }

      if (!response?.success) {
        // Catchup without history has its own contract error body.
        if (response?.error === 'No previous range found. Cannot catch up.') {
          return respondError(c, 400, 'no_previous_range', response.error);
        }
        // The full-history gate is a confirmation prompt, not a failure:
        // mirror the span facts into `details` — the frontend HTTP layer
        // (toApiError) only surfaces message/code/details, so that is the
        // channel the UI reads the reason from.
        if (response?.reason === 'full-history-unconfirmed') {
          return c.json(
            createApiError(
              400,
              'full_history_confirmation_required',
              response.error ?? 'Full history confirmation required',
              {
                reason: response.reason,
                spanBlocks: response.spanBlocks,
                fromBlock: response.fromBlock,
                head: response.head,
              },
            ),
            400,
          );
        }
        return respondError(
          c,
          400,
          'range_create_failed',
          response?.error ?? `Failed to create range with mode: ${mode}`,
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
      return respondError(
        c,
        500,
        'internal_error',
        error instanceof Error ? error.message : 'Failed to create indexing range',
      );
    }
  },
);

// PATCH /chains/:chainId/contracts/:address/events/ranges/:rangeId — update range
app.patch(
  '/chains/:chainId/contracts/:address/events/ranges/:rangeId',
  requireAdminTokenIfConfigured,
  async c => {
    const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
    if ('error' in result) return c.json(result.error, result.status);

    const { chainId, address } = result;
    const rangeId = parseInt(c.req.param('rangeId'));

    if (isNaN(rangeId)) {
      return respondError(c, 400, 'invalid_range_id', 'rangeId must be a number');
    }

    try {
      const body = await c.req.json();
      const { fromBlock, toBlock, direction, priority } = body;

      if (
        (fromBlock !== undefined && !isValidBlockBound(fromBlock)) ||
        (toBlock !== undefined && !isValidBlockBound(toBlock))
      ) {
        return respondError(
          c,
          400,
          'invalid_bounds',
          'fromBlock and toBlock must be numbers or valid block tags (latest, finalized, safe, earliest)',
        );
      }

      const response = await updateIndexingRange(chainId, address, rangeId, {
        fromBlock,
        toBlock,
        direction,
        priority,
      });

      if (!response.success) {
        return respondError(c, 400, 'range_overlap', response.error, {
          overlaps: response.overlaps,
        });
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
      return respondError(
        c,
        500,
        'internal_error',
        error instanceof Error ? error.message : 'Failed to update indexing range',
      );
    }
  },
);

// DELETE /chains/:chainId/contracts/:address/events/ranges/:rangeId — delete range
app.delete(
  '/chains/:chainId/contracts/:address/events/ranges/:rangeId',
  requireAdminTokenIfConfigured,
  async c => {
    const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
    if ('error' in result) return c.json(result.error, result.status);

    const { chainId, address } = result;
    const rangeId = parseInt(c.req.param('rangeId'));

    if (isNaN(rangeId)) {
      return respondError(c, 400, 'invalid_range_id', 'rangeId must be a number');
    }

    try {
      const response = await deleteIndexingRange(chainId, address, rangeId);

      if (!response.success) {
        // A missing range is the same 404 resource state the pause/start/
        // resume routes return; other failures (e.g. deleting while
        // indexing) are state conflicts and stay 400.
        if (response.error === 'Range not found') {
          return respondError(c, 404, 'range_not_found', 'Range not found');
        }
        return respondError(c, 400, 'invalid_state', response.error);
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
      return respondError(
        c,
        500,
        'internal_error',
        error instanceof Error ? error.message : 'Failed to delete indexing range',
      );
    }
  },
);

// POST /chains/:chainId/contracts/:address/events/ranges/:rangeId/start — start indexing
app.post(
  '/chains/:chainId/contracts/:address/events/ranges/:rangeId/start',
  requireAdminTokenIfConfigured,
  async c => {
    const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
    if ('error' in result) return c.json(result.error, result.status);

    const { chainId, address } = result;
    const rangeId = parseInt(c.req.param('rangeId'));

    if (isNaN(rangeId)) {
      return respondError(c, 400, 'invalid_range_id', 'rangeId must be a number');
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
        return respondError(
          c,
          400,
          'abi_unavailable',
          'Contract ABI is required for indexing. Verify the contract on a block explorer first.',
        );
      }

      // Fail fast on invalid states so clients still get actionable 400s
      // before the (potentially hours-long) indexing work is kicked off.
      if (getActiveRangeJob(chainId, address, rangeId)) {
        return respondError(c, 400, 'invalid_state', 'Range is already being indexed');
      }

      const ranges = await getIndexingRanges(chainId, address);
      const range = ranges.find(r => r.rangeId === rangeId);

      if (!range) {
        // Mirrors the pause route: a missing range is a 404 resource state,
        // while state conflicts (already indexing/completed) stay 400.
        return respondError(c, 404, 'range_not_found', 'Range not found');
      }

      if (range.status === 'completed') {
        return respondError(c, 400, 'invalid_state', 'Range is already completed');
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
      return respondError(
        c,
        500,
        'internal_error',
        error instanceof Error ? error.message : 'Failed to start indexing range',
      );
    }
  },
);

// POST /chains/:chainId/contracts/:address/events/ranges/:rangeId/pause — pause indexing
app.post(
  '/chains/:chainId/contracts/:address/events/ranges/:rangeId/pause',
  requireAdminTokenIfConfigured,
  async c => {
    const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
    if ('error' in result) return c.json(result.error, result.status);

    const { chainId, address } = result;
    const rangeId = parseInt(c.req.param('rangeId'));

    if (isNaN(rangeId)) {
      return respondError(c, 400, 'invalid_range_id', 'rangeId must be a number');
    }

    try {
      const isActive = getActiveRangeJob(chainId, address, rangeId);

      if (!isActive) {
        const ranges = await getIndexingRanges(chainId, address);
        const range = ranges.find(r => r.rangeId === rangeId);

        if (!range) {
          return respondError(c, 404, 'range_not_found', 'Range not found');
        }

        if (range.currentBlock !== null && range.toBlock !== null) {
          const currentBlock = range.currentBlock;
          const toBlock = range.toBlock;
          const fromBlock = range.fromBlock;
          const isComplete =
            range.direction === 'forward' ? currentBlock >= toBlock : currentBlock <= fromBlock;

          if (isComplete) {
            // Consume the CAS result instead of ignoring it: the service
            // refuses status flips on rows still in live 'indexing' (the
            // indexing loop's compare-and-set writes own that row's final
            // status, possibly from a peer process sharing the database).
            // Answering the canned 'completed' body anyway would overstate
            // the outcome while the row actually stays 'indexing', so the
            // refusal surfaces as 400 invalid_state — the state-invalid
            // convention this file uses per AGENTS.md (no 409s anywhere) —
            // and a row deleted in the race surfaces as the same 404 the
            // other range routes return.
            const flip = await updateRangeStatus(chainId, address, rangeId, 'completed');
            if (!flip.success) {
              if (flip.error === 'Range not found') {
                return respondError(c, 404, 'range_not_found', 'Range not found');
              }
              return respondError(
                c,
                400,
                'invalid_state',
                flip.error ?? 'Range status could not be updated',
              );
            }
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

        return respondError(c, 400, 'no_active_job', 'Range is not currently being indexed');
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
      return respondError(
        c,
        500,
        'internal_error',
        error instanceof Error ? error.message : 'Failed to pause indexing range',
      );
    }
  },
);

// POST /chains/:chainId/contracts/:address/events/ranges/:rangeId/resume — resume indexing
app.post(
  '/chains/:chainId/contracts/:address/events/ranges/:rangeId/resume',
  requireAdminTokenIfConfigured,
  async c => {
    const result = validateChainAndAddress(c.req.param('chainId'), c.req.param('address'));
    if ('error' in result) return c.json(result.error, result.status);

    const { chainId, address } = result;
    const rangeId = parseInt(c.req.param('rangeId'));

    if (isNaN(rangeId)) {
      return respondError(c, 400, 'invalid_range_id', 'rangeId must be a number');
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
        return respondError(
          c,
          400,
          'abi_unavailable',
          'Contract ABI is required for indexing. Verify the contract on a block explorer first.',
        );
      }

      // Fail fast on invalid states so clients still get actionable 400s
      // before the (potentially hours-long) indexing work is kicked off.
      if (getActiveRangeJob(chainId, address, rangeId)) {
        return respondError(c, 400, 'invalid_state', 'Range is already being indexed');
      }

      const ranges = await getIndexingRanges(chainId, address);
      const range = ranges.find(r => r.rangeId === rangeId);

      if (!range) {
        // Mirrors the pause route: a missing range is a 404 resource state,
        // while state conflicts (already indexing / not paused) stay 400.
        return respondError(c, 404, 'range_not_found', 'Range not found');
      }

      if (range.status !== 'paused' && range.status !== 'error') {
        return respondError(c, 400, 'invalid_state', 'Can only resume paused or errored ranges');
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
      return respondError(
        c,
        500,
        'internal_error',
        error instanceof Error ? error.message : 'Failed to resume indexing range',
      );
    }
  },
);

export default app;
