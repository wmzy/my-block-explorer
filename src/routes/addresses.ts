import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import { addressService } from '../services/AddressService';
import type { DiscoveredTransaction } from '../services/AddressService';
import {
  catchupScanJob,
  createOrReplaceScanJob,
  deleteScanJob,
  getScanFindings,
  getScanJobRow,
  hydrateFindings,
  isScanJobActive,
  listInternalTransactions,
  pauseScanJob,
  resumeScanJob,
  toScanJobDto,
  validateScanJobBody,
  type ScanJobDto,
} from '../services/AddressScanService';
import { requireAdminTokenIfConfigured } from '../middleware/admin-token';
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

// Wei-denominated value filter params: exactly a non-negative integer
// decimal string parses (BigInt-exact on the wire); anything else —
// negative, NaN, fractional, scientific — is undefined here and a loud
// 400 at the call site (never a silent fallthrough).
const WEI_VALUE_RE = /^\d+$/;
const parseWeiFilterParam = (raw: string | undefined): bigint | undefined => {
  if (raw === undefined) return undefined;
  if (!WEI_VALUE_RE.test(raw)) return undefined;
  return BigInt(raw);
};

// Method (function-selector) filter param: exactly '0x' + 8 hex chars
// (case-insensitive hex — the comparison lowercases both ends). Anything
// else is a loud 400 at the call site, never a silent fallthrough.
const METHOD_SELECTOR_RE = /^0x[0-9a-fA-F]{8}$/;

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

  // Optional narrowing filters (?fromAddress / ?toAddress / ?minValue /
  // ?maxValue / ?method), applied server-side over the SAME cached
  // discovered set for the current window — never a new scan, never a
  // coverage claim. Empty-string params read as absent (the limit/page
  // convention). Addresses validate through the same two-tier
  // getValidatedAddress as the path param; wei values must be
  // non-negative integer decimals (BigInt-exact — 'NaN', fractions,
  // negatives are loud 400s, not silent fallthroughs); the method filter
  // must be a 0x-prefixed 4-byte selector (hex case-insensitive,
  // compared lowercase-exact against the rows' own selectors).
  const echoParam = (raw: string | undefined): string | undefined =>
    raw !== undefined && raw !== '' ? raw : undefined;
  const rawFromAddress = echoParam(c.req.query('fromAddress'));
  const rawToAddress = echoParam(c.req.query('toAddress'));
  const rawMinValue = echoParam(c.req.query('minValue'));
  const rawMaxValue = echoParam(c.req.query('maxValue'));
  const rawMethod = echoParam(c.req.query('method'));

  let fromAddressFilter: string | undefined;
  if (rawFromAddress !== undefined) {
    try {
      fromAddressFilter = getValidatedAddress(rawFromAddress);
    } catch {
      return c.json(
        {
          error: 'invalid_address',
          message: 'fromAddress must be a valid hex address',
        },
        400,
      );
    }
  }
  let toAddressFilter: string | undefined;
  if (rawToAddress !== undefined) {
    try {
      toAddressFilter = getValidatedAddress(rawToAddress);
    } catch {
      return c.json(
        {
          error: 'invalid_address',
          message: 'toAddress must be a valid hex address',
        },
        400,
      );
    }
  }
  const parsedMinValue = parseWeiFilterParam(rawMinValue);
  const parsedMaxValue = parseWeiFilterParam(rawMaxValue);
  if (rawMinValue !== undefined && parsedMinValue === undefined) {
    return c.json(
      {
        error: 'invalid_value',
        message: 'minValue must be a non-negative integer wei amount',
      },
      400,
    );
  }
  if (rawMaxValue !== undefined && parsedMaxValue === undefined) {
    return c.json(
      {
        error: 'invalid_value',
        message: 'maxValue must be a non-negative integer wei amount',
      },
      400,
    );
  }
  // Method filter: validated as a 4-byte selector, forwarded lowercase
  // (the service compares lowercase-exact against row selectors).
  if (rawMethod !== undefined && !METHOD_SELECTOR_RE.test(rawMethod)) {
    return c.json(
      {
        error: 'invalid_method',
        message: 'method must be a 0x-prefixed 4-byte selector (0x + 8 hex characters)',
      },
      400,
    );
  }
  const methodFilter = rawMethod !== undefined ? rawMethod.toLowerCase() : undefined;

  // The service only sees a filters object when at least one filter is
  // present — the unfiltered call shape (and response) stays untouched.
  const txFilters =
    fromAddressFilter === undefined && toAddressFilter === undefined
    && parsedMinValue === undefined && parsedMaxValue === undefined
    && methodFilter === undefined
      ? undefined
      : {
          ...(fromAddressFilter !== undefined ? { fromAddress: fromAddressFilter } : {}),
          ...(toAddressFilter !== undefined ? { toAddress: toAddressFilter } : {}),
          ...(parsedMinValue !== undefined ? { minValue: parsedMinValue } : {}),
          ...(parsedMaxValue !== undefined ? { maxValue: parsedMaxValue } : {}),
          ...(methodFilter !== undefined ? { method: methodFilter } : {}),
        };

  try {
    // Additive deep-scan contract: the `deepScan` field appears ONLY when
    // a scan job row exists (no row → legacy response byte-identical).
    // Persisted findings merge into the discovered list; a completed
    // genesis-anchored walk is the ONLY sanctioned coverage lift.
    let scanJobDto: ScanJobDto | undefined;
    let deepScanFindings: DiscoveredTransaction[] | undefined;
    try {
      const scanJobRow = await getScanJobRow(chainId, address);
      if (scanJobRow) {
        scanJobDto = toScanJobDto(scanJobRow);
        const findingRows = await getScanFindings(chainId, address);
        if (findingRows.length > 0) {
          deepScanFindings = await hydrateFindings(chainId, address, findingRows);
        }
      }
    } catch (error) {
      // The deep-scan enrichment is additive: any failure in the lookup,
      // findings read, or RPC hydration degrades to the heuristic-only
      // legacy-shaped response rather than failing the endpoint (a
      // DuckDB hiccup must not 500 the core tx list).
      logger.warn(
        { err: error, chainId, address },
        'Deep-scan enrichment failed; serving heuristic-only list',
      );
    }

    const result = await addressService.getAddressTransactions(
      chainId,
      address,
      limit,
      offset,
      windowBlocks,
      {
        includeBalancePoints: includeBalanceHistory,
        ...(deepScanFindings ? { deepScanFindings } : {}),
        ...(txFilters ? { filters: txFilters } : {}),
      },
    );
    c.header('X-Data-Source', result.method);
    c.header('X-Chain-Name', getChainName(chainId));

    const totalPages = Math.max(1, Math.ceil(result.total / limit));
    // The only sanctioned 'complete' in the product: a finished,
    // genesis-anchored deep scan. Everything else keeps the honest
    // heuristic coverage verdict.
    const coverageLifted = scanJobDto?.coverage === 'complete';

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
      coverage: coverageLifted ? 'complete' : result.coverage,
      reason: coverageLifted ? 'deep-scan' : result.reason,
      searchWindowBlocks: result.searchWindowBlocks,
      ...(includeBalanceHistory
        ? {
            // Per-tx cumulative discovered deltas + the leading 0 anchor;
            // count includes the anchor (discovered txs + 1 when non-empty).
            balancePoints: result.balancePoints ?? [],
            balancePointsCount: result.balancePoints?.length ?? 0,
          }
        : {}),
      // Echo of the filters applied, exactly as received — present ONLY
      // when at least one filter param was sent (unfiltered responses
      // stay byte-identical). `total`/pagination above already describe
      // the filtered view; filters never claim completeness.
      ...(txFilters
        ? {
            filtersApplied: {
              ...(rawFromAddress !== undefined ? { fromAddress: rawFromAddress } : {}),
              ...(rawToAddress !== undefined ? { toAddress: rawToAddress } : {}),
              ...(rawMinValue !== undefined ? { minValue: rawMinValue } : {}),
              ...(rawMaxValue !== undefined ? { maxValue: rawMaxValue } : {}),
              ...(rawMethod !== undefined ? { method: rawMethod } : {}),
            },
          }
        : {}),
      ...(scanJobDto ? { deepScan: scanJobDto } : {}),
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

// ============================================================
// Deep scan — persistent per-address transaction-discovery jobs.
// Writes (create/pause/resume/delete) are admin-opt-in gated and share
// one 3/min burst-2 bucket (a scan job drives long-lived RPC walks);
// GET is an open read. Tag bounds resolve ONCE at creation to concrete
// numbers; stored rows never carry tags.
// ============================================================
const addressScanWriteLimiter = createRateLimiter({
  name: 'address-scan-write',
  requestsPerMinute: 3,
  burst: 2,
});

// POST /chains/:chainId/addresses/:address/scan — create (202), return
// the existing job when the resolved bounds match (200, idempotent),
// 400 invalid_bounds on bad bodies/bounds, 400 scan_conflict when a job
// with different bounds exists unless force resets it. The walk runs in
// the background (202-async start); poll GET for progress.
app.post('/chains/:chainId/addresses/:address/scan', requireAdminTokenIfConfigured, addressScanWriteLimiter, async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    // Empty or non-JSON body → default bounds (earliest..latest).
  }

  const validated = validateScanJobBody(body);
  if (!validated.ok) {
    return c.json({ error: 'invalid_bounds', message: validated.message }, 400);
  }

  try {
    const outcome = await createOrReplaceScanJob(chainId, address, {
      fromBlock: validated.fromBlock,
      toBlock: validated.toBlock,
      force: validated.force,
      includeTraces: validated.includeTraces,
    });
    if (!outcome.ok) {
      return c.json({ error: 'invalid_bounds', message: outcome.message }, 400);
    }
    if (outcome.result.outcome === 'conflict') {
      return c.json({ error: 'scan_conflict', message: outcome.result.message }, 400);
    }

    c.header('X-Chain-Name', getChainName(chainId));
    return c.json(
      toScanJobDto(outcome.result.job),
      outcome.result.outcome === 'created' ? 202 : 200,
    );
  } catch (error) {
    logger.error({ err: error }, 'Create address scan API error');
    return c.json({ error: 'Failed to create address scan' }, 500);
  }
});

// GET /chains/:chainId/addresses/:address/scan — open read of the job
// (404 when no job row exists).
app.get('/chains/:chainId/addresses/:address/scan', async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    const row = await getScanJobRow(chainId, address);
    if (!row) {
      return c.json({ error: 'no_scan_job' }, 404);
    }
    c.header('X-Chain-Name', getChainName(chainId));
    return c.json(toScanJobDto(row));
  } catch (error) {
    logger.error({ err: error }, 'Get address scan API error');
    return c.json({ error: 'Failed to get address scan' }, 500);
  }
});

// GET /chains/:chainId/addresses/:address/scan/internal-transactions —
// the internal transactions a traced deep scan recorded, paginated
// newest-first. An address with no rows (unknown, or a walk that never
// opted into tracing, or a provider without debug_traceTransaction) is
// an honest empty page, never an error. Open read like GET /scan: a
// DuckDB page, not an RPC walk, so it draws no limiter bucket.
app.get('/chains/:chainId/addresses/:address/scan/internal-transactions', async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  // Same fail-loud pagination philosophy as the transactions list
  // (~parseInt + NaN check): non-numeric, negative offset, and
  // non-positive limit are 400s instead of silent NaN arithmetic; the
  // page cap is 100.
  const rawOffset = c.req.query('offset');
  const rawLimit = c.req.query('limit');
  const parsedOffset = rawOffset === undefined || rawOffset === '' ? 0 : parseInt(rawOffset, 10);
  const parsedLimit = rawLimit === undefined || rawLimit === '' ? 50 : parseInt(rawLimit, 10);

  if (Number.isNaN(parsedOffset) || parsedOffset < 0) {
    return c.json(
      { error: 'invalid_offset', message: 'offset must be a non-negative integer' },
      400,
    );
  }
  if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
    return c.json(
      { error: 'invalid_limit', message: 'limit must be a positive integer' },
      400,
    );
  }
  const limit = Math.min(parsedLimit, 100);

  try {
    const page = await listInternalTransactions(chainId, address, {
      offset: parsedOffset,
      limit,
    });
    c.header('X-Chain-Name', getChainName(chainId));
    return c.json(page);
  } catch (error) {
    logger.error({ err: error }, 'List scan internal transactions API error');
    return c.json({ error: 'Failed to list internal transactions' }, 500);
  }
});

// POST /chains/:chainId/addresses/:address/scan/pause — flags the live
// loop; the job settles into 'paused' at its last checkpointed cursor.
app.post('/chains/:chainId/addresses/:address/scan/pause', requireAdminTokenIfConfigured, addressScanWriteLimiter, async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    const row = await getScanJobRow(chainId, address);
    // Only a genuinely walking job can pause: the row claims 'running'
    // AND a live loop exists for it. A 'running' row without a loop is a
    // restart-stranded job (reconcile flips it to 'error' at startup).
    if (row?.status !== 'running' || !isScanJobActive(chainId, address)) {
      return c.json(
        {
          error: 'invalid_state',
          message: `Scan job is not running (status: ${row?.status ?? 'none'})`,
        },
        400,
      );
    }

    pauseScanJob(chainId, address);

    c.header('X-Chain-Name', getChainName(chainId));
    // The row still reads 'running' until the loop settles the current
    // segment; polling GET observes the 'paused' flip within a segment.
    return c.json(toScanJobDto(row), 202);
  } catch (error) {
    logger.error({ err: error }, 'Pause address scan API error');
    return c.json({ error: 'Failed to pause address scan' }, 500);
  }
});

// POST /chains/:chainId/addresses/:address/scan/resume — continue a
// paused job exactly from its checkpointed cursor.
app.post('/chains/:chainId/addresses/:address/scan/resume', requireAdminTokenIfConfigured, addressScanWriteLimiter, async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    const resumed = await resumeScanJob(chainId, address);
    if (!resumed.ok) {
      return c.json({ error: 'invalid_state', message: resumed.message }, 400);
    }

    c.header('X-Chain-Name', getChainName(chainId));
    return c.json(toScanJobDto(resumed.job), 202);
  } catch (error) {
    logger.error({ err: error }, 'Resume address scan API error');
    return c.json({ error: 'Failed to resume address scan' }, 500);
  }
});

// POST /chains/:chainId/addresses/:address/scan/catchup — extend a
// settled walk's toBlock to the CURRENT chain head, preserving cursor
// and findings. 404 no_scan_job / 400 invalid_state (running — extending
// bounds under a live loop is unsafe) / 400 already_caught_up / 202 with
// the updated job (blocksTotal recomputed, blocksWalked unchanged so
// progress dips honestly; a completed walk requeues and resumes from
// cursor + 1).
app.post('/chains/:chainId/addresses/:address/scan/catchup', requireAdminTokenIfConfigured, addressScanWriteLimiter, async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    const result = await catchupScanJob(chainId, address);
    if (!result.ok) {
      if (result.error === 'no_scan_job') {
        return c.json({ error: 'no_scan_job' }, 404);
      }
      return c.json({ error: result.error, message: result.message }, 400);
    }

    c.header('X-Chain-Name', getChainName(chainId));
    return c.json(toScanJobDto(result.job), 202);
  } catch (error) {
    logger.error({ err: error }, 'Catch up address scan API error');
    return c.json({ error: 'Failed to catch up address scan' }, 500);
  }
});

// DELETE /chains/:chainId/addresses/:address/scan — idempotent removal
// of the job row AND its findings.
app.delete('/chains/:chainId/addresses/:address/scan', requireAdminTokenIfConfigured, addressScanWriteLimiter, async (c) => {
  const chainId = getValidatedChainId(c.req.param('chainId'));
  const address = getValidatedAddress(c.req.param('address'));

  try {
    await deleteScanJob(chainId, address);
    return c.body(null, 204);
  } catch (error) {
    logger.error({ err: error }, 'Delete address scan API error');
    return c.json({ error: 'Failed to delete address scan' }, 500);
  }
});

export default app;
