// Deep scan service (PM review Wave 3): the persistent, resumable
// per-address transaction-discovery job. The backend walks the chain
// block-by-block from a start bound, verifying balance checkpoints, and
// upgrades the address's transaction history from heuristic partial
// discovery toward proven completeness — the only sanctioned 'complete'
// path in the product (a genesis-anchored walk that finished).
//
// Endpoints (pinned contract, base /api/chains/:chainId/addresses/:address/scan):
// - POST ""        → 202 {job} (400 invalid_bounds / scan_conflict)
// - POST "/pause"  → 202 {job} (400 invalid_state when not running)
// - POST "/resume" → 202 {job} (400 when not paused)
// - POST "/catchup" → 202 {job} — extend a SETTLED walk's frozen toBlock
//   to the current chain head (400 invalid_state when the walk is live /
//   already_caught_up when it already ends at the head; 404 no_scan_job)
// - DELETE ""      → 204, idempotent, removes the job AND its findings
// - GET ""         → 200 {job} | 404 {error:'no_scan_job'}
// - GET "/internal-transactions?offset=&limit=" → 200 {transactions,
//   total, offset, limit} — internal-tx rows recorded by includeTraces
//   walks (an unknown address answers 200 with an empty list)
// Writes are admin-gated (x-admin-token, opt-in tier); reads are open.
//
// Deliberately independent of services/addresses.ts: the tx-history
// payload carries the job inline (`deepScan`), and that payload flows
// through parseScanJob here instead — the panel never imports the
// orchestrator's module.
import {
  hashArgs,
  useArgsStatus,
  useCache,
  useInjectable,
  useLoading,
  usePolling,
  useRefresh,
  useResultSelect,
  useRun,
  type CacheProvider,
} from 'react-toolroom/async';
import * as ff from 'fetch-fun';

import { ApiError } from '@/util/apiError';
import { DEFAULT_STALE_TIME } from '@/util/loaderCache';
import { bindQueryFn, createQueryCache } from '@/util/useQuery';
import { api, del, get, post, withSignal, type ApiClient } from '@/util/http';

export const SCAN_JOB_STATUSES = ['pending', 'running', 'paused', 'error', 'complete'] as const;

export type ScanJobStatus = (typeof SCAN_JOB_STATUSES)[number];

// Wire shape of a scan job, verbatim from the pinned contract. Numeric
// bounds are concrete resolved block numbers (tags like 'earliest'/
// 'latest' resolve once at creation and never ride stored rows).
// coverage === 'complete' ONLY when status === 'complete' AND
// fromBlock === 0 — the genesis anchor is the sole bound where "no
// activity outside the walk" is provable; everything else stays null.
export type ScanJob = {
  status: ScanJobStatus;
  fromBlock: number;
  toBlock: number;
  cursorBlock: number;
  blocksWalked: number;
  blocksTotal: number;
  txsFound: number;
  errorMessage: string | null;
  coverage: 'complete' | null;
  updatedAt: string;
  // Internal-tx recording (additive): tracesRequested mirrors the
  // create-body flag; tracesSupported is null until the walk probed the
  // RPC's trace capability; tracesRecorded counts persisted rows. These
  // NEVER feed the coverage derivation above — recorded rows are a
  // bonus artifact of the walk, not a coverage source.
  tracesRequested: boolean;
  tracesSupported: boolean | null;
  tracesRecorded: number;
};

const nonNegativeInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

/**
 * Narrow pure guard for a scan-job payload: every field must match the
 * contract shape or the whole payload rejects to null. Never throws —
 * unknown status, non-numeric bounds, nested junk and missing fields all
 * degrade to "no parseable job" so the panel renders its fallbacks
 * instead of crashing on a legacy or malformed payload.
 */
export function parseScanJob(payload: unknown): ScanJob | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const status = SCAN_JOB_STATUSES.find(s => s === p.status);
  if (status === undefined) return null;
  const fromBlock = nonNegativeInteger(p.fromBlock);
  const toBlock = nonNegativeInteger(p.toBlock);
  const cursorBlock = nonNegativeInteger(p.cursorBlock);
  const blocksWalked = nonNegativeInteger(p.blocksWalked);
  const blocksTotal = nonNegativeInteger(p.blocksTotal);
  const txsFound = nonNegativeInteger(p.txsFound);
  if (
    fromBlock === null || toBlock === null || cursorBlock === null
    || blocksWalked === null || blocksTotal === null || txsFound === null
  ) {
    return null;
  }
  if (typeof p.updatedAt !== 'string' || p.updatedAt === '') return null;
  if (p.errorMessage !== null && typeof p.errorMessage !== 'string') return null;
  if (p.coverage !== null && p.coverage !== 'complete') return null;
  return {
    status,
    fromBlock,
    toBlock,
    cursorBlock,
    blocksWalked,
    blocksTotal,
    txsFound,
    errorMessage: p.errorMessage,
    coverage: p.coverage,
    updatedAt: p.updatedAt,
    // Additive traces fields tolerate legacy payloads (no key at all):
    // not requested, capability unprobed, nothing recorded.
    tracesRequested: p.tracesRequested === true,
    tracesSupported: typeof p.tracesSupported === 'boolean' ? p.tracesSupported : null,
    tracesRecorded: nonNegativeInteger(p.tracesRecorded) ?? 0,
  };
}

/**
 * Read the job riding a transactions payload (`deepScan` field). The
 * payload arrives as unknown from the orchestrator's untyped perspective
 * (the field is additive — legacy responses carry no key at all), so the
 * read is defensive end to end: absent/junk field → null.
 */
export function scanJobFromTxPayload(payload: unknown): ScanJob | null {
  if (typeof payload !== 'object' || payload === null) return null;
  return parseScanJob((payload as Record<string, unknown>).deepScan);
}

// Error mapping for the scan endpoints: identical to the base chain in
// util/http (message/code/details extraction, timeout → 408, network →
// status 0) with ONE extension — the pinned scan 400s discriminate via
// the body's `error` field ('scan_conflict', 'invalid_bounds'), which
// the base mapper drops when a `message` also rides the body. Here that
// discriminator additionally surfaces as ApiError.code so the panel can
// branch on scan_conflict verbatim instead of sniffing message copy.
// Piping mapError REPLACES the base mapper (fetch-fun semantics), so this
// replicates the base branches it replaces.
const scanApi: ApiClient = api.pipe(
  ff.mapError,
  (e: unknown): unknown => {
    if (e instanceof ff.HTTPError) {
      const body: Record<string, unknown> =
        typeof e.data === 'object' && e.data !== null
          ? (e.data as Record<string, unknown>)
          : {};
      const message = typeof body.message === 'string' ? body.message : undefined;
      const errorText = typeof body.error === 'string' ? body.error : undefined;
      const code = typeof body.code === 'string' ? body.code : errorText;
      return new ApiError(
        message ?? errorText ?? `HTTP ${e.status}`,
        e.status,
        code,
        'details' in body ? body.details : undefined,
      );
    }
    if (e instanceof ff.TimeoutError) return new ApiError('Request timeout', 408);
    if (e instanceof ff.NetworkError) return new ApiError(e.message, 0);
    return e;
  },
);

// 200/202 bodies are the job DTO itself — FLAT, the shape every scan
// route's own tests pin (`c.json(toScanJobDto(row))`); the {job}-wrapped
// envelope is additionally accepted so the shape the first frontend
// tests froze keeps parsing (labels.ts parseLabelResponse pattern — a
// bad shape still fails loudly instead of rendering a lie).
const jobFromEnvelope = (body: unknown): ScanJob => {
  const record: Record<string, unknown> =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const job = parseScanJob(record) ?? parseScanJob(record.job);
  if (job === null) throw new ApiError('Malformed scan job response', 0);
  return job;
};

/**
 * GET the current scan job. A 404 settles as null — "no job row" is a
 * valid state (the panel's intro state), not an error. Other failures
 * reject; the query layer surfaces them to the hook's error channel.
 */
export async function fetchScanJob(
  chainId: number,
  address: string,
  signal?: AbortSignal,
): Promise<ScanJob | null | undefined> {
  if (!(chainId > 0) || address.length === 0) return undefined;
  try {
    const body = await get<unknown>(
      `/api/chains/${chainId}/addresses/${address}/scan`,
      undefined,
      withSignal(scanApi, signal),
    );
    return jobFromEnvelope(body);
  }
  catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export type StartScanOptions = {
  /** Concrete start block; omitted → 'earliest' (the only bound that can ever claim complete coverage). */
  fromBlock?: number;
  /** Replace an existing job with different bounds (resets progress). */
  force?: boolean;
  /**
   * Record internal transactions while walking (slower — each block the
   * walk stops on gets traced). Rides the POST body ONLY when true, so
   * an unchecked toggle keeps the wire byte-identical to today.
   */
  includeTraces?: boolean;
};

/** POST the scan job (create). Rejects with ApiError; 400 scan_conflict when a job exists with different bounds and force was not set. */
export async function startScanJob(
  chainId: number,
  address: string,
  options: StartScanOptions = {},
): Promise<ScanJob> {
  const body: { fromBlock: number | 'earliest'; force?: boolean; includeTraces?: boolean } = {
    fromBlock: options.fromBlock ?? 'earliest',
  };
  if (options.force) body.force = true;
  if (options.includeTraces) body.includeTraces = true;
  return jobFromEnvelope(
    await post<unknown>(
      `/api/chains/${chainId}/addresses/${address}/scan`,
      body,
      scanApi,
    ),
  );
}

/** POST /pause. Rejects with ApiError 400 invalid_state when the job is not running. */
export async function pauseScanJob(chainId: number, address: string): Promise<ScanJob> {
  return jobFromEnvelope(
    await post<unknown>(`/api/chains/${chainId}/addresses/${address}/scan/pause`, {}, scanApi),
  );
}

/** POST /resume. Rejects with ApiError 400 when the job is not paused. */
export async function resumeScanJob(chainId: number, address: string): Promise<ScanJob> {
  return jobFromEnvelope(
    await post<unknown>(`/api/chains/${chainId}/addresses/${address}/scan/resume`, {}, scanApi),
  );
}

/**
 * POST /catchup: extend a SETTLED walk's frozen end bound to the current
 * chain head — the backend re-queues the job and resumes from the
 * checkpointed cursor, findings intact. Rejects with ApiError 400
 * invalid_state while the walk is live and 400 already_caught_up when it
 * already ends at the head (both discriminate via ApiError.code, like
 * the start 400s); a 404 — the job vanished, e.g. deleted in another
 * tab — resolves as null rather than an error (fetchScanJob's semantics:
 * "no job row" is a valid state), so callers simply refetch.
 */
export async function catchupScanJob(chainId: number, address: string): Promise<ScanJob | null> {
  try {
    return jobFromEnvelope(
      await post<unknown>(`/api/chains/${chainId}/addresses/${address}/scan/catchup`, {}, scanApi),
    );
  }
  catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** DELETE the job AND its persisted findings. Idempotent (204). */
export function deleteScanJob(chainId: number, address: string): Promise<unknown> {
  return del<unknown>(`/api/chains/${chainId}/addresses/${address}/scan`, scanApi);
}

// One recorded internal transaction, field names verbatim from the pinned
// contract. value is a wei decimal string; callType is the callTracer
// vocabulary ('call'/'callcode'/'delegatecall'/'staticcall'); tracePath
// is the depth-joined position inside the parent tx (e.g. '0' or '0.1').
export type InternalTxRecord = {
  transactionHash: string;
  blockNumber: number;
  from: string;
  to: string;
  value: string;
  callType: string;
  reverted: boolean;
  tracePath: string;
  timestamp: string;
};

// The internal-transactions list envelope (pinned contract): newest-first
// rows (blockNumber desc, then tx index) with server-side pagination.
export type InternalTxnsResult = {
  transactions: InternalTxRecord[];
  total: number;
  offset: number;
  limit: number;
};

// Wei travels as a bare decimal string — anything else (hex, number,
// negative sign) is a malformed row, not a zero.
const weiDecimalString = (value: unknown): string | null =>
  typeof value === 'string' && /^\d+$/.test(value) ? value : null;

const parseInternalTxRecord = (payload: unknown): InternalTxRecord | null => {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const blockNumber = nonNegativeInteger(p.blockNumber);
  const value = weiDecimalString(p.value);
  if (blockNumber === null || value === null) return null;
  if (
    typeof p.transactionHash !== 'string' || p.transactionHash === ''
    || typeof p.from !== 'string'
    || typeof p.to !== 'string'
    || typeof p.callType !== 'string' || p.callType === ''
    || typeof p.tracePath !== 'string' || p.tracePath === ''
    || typeof p.timestamp !== 'string' || p.timestamp === ''
    || typeof p.reverted !== 'boolean'
  ) {
    return null;
  }
  return {
    transactionHash: p.transactionHash,
    blockNumber,
    from: p.from,
    to: p.to,
    value,
    callType: p.callType,
    reverted: p.reverted,
    tracePath: p.tracePath,
    timestamp: p.timestamp,
  };
};

/**
 * Narrow pure guard for the internal-transactions list response: every
 * row field and the pagination envelope must match the contract or the
 * whole payload rejects to null (same rule as parseScanJob — a
 * malformed body never renders a partial lie).
 */
export function parseInternalTxnsResult(payload: unknown): InternalTxnsResult | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (!Array.isArray(p.transactions)) return null;
  const total = nonNegativeInteger(p.total);
  const offset = nonNegativeInteger(p.offset);
  const limit = nonNegativeInteger(p.limit);
  if (total === null || offset === null || limit === null) return null;
  const transactions: InternalTxRecord[] = [];
  for (const row of p.transactions) {
    const record = parseInternalTxRecord(row);
    if (record === null) return null;
    transactions.push(record);
  }
  return { transactions, total, offset, limit };
}

export type FetchInternalTxnsOptions = {
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
};

/**
 * GET the internal transactions a deep scan recorded (the includeTraces
 * walk's persisted findings). The backend answers 200 with an empty list
 * for an unknown address, so a rejection means transport trouble; a body
 * that fails the narrow parse settles as null so the view can honestly
 * report nothing loadable instead of guessing.
 */
export async function fetchInternalTransactions(
  chainId: number,
  address: string,
  options: FetchInternalTxnsOptions = {},
): Promise<InternalTxnsResult | null> {
  const body = await get<unknown>(
    `/api/chains/${chainId}/addresses/${address}/scan/internal-transactions`,
    { offset: options.offset, limit: options.limit },
    withSignal(scanApi, options.signal),
  );
  return parseInternalTxnsResult(body);
}

// Live read of the job with active-only polling: the 3s cadence runs
// ONLY while the job is pending/running; settled jobs (paused/error/
// complete) and the no-job state swap to a never-firing interval. The
// composition mirrors services/chainRpc.ts useTransactionByHash (the
// conditional-polling precedent) rather than createPolledQueryHook,
// because a usePolling tick only reaches the stores this hook reads when
// the poller shares the same useInjectable instance as the useRun below
// (see polledQuery.ts header). usePolling's default also skips ticks
// while the document is hidden, and the timer is cleaned up on unmount —
// switching away from the transactions tab unmounts this panel and stops
// the cadence entirely.
const scanJobCache = createQueryCache<ScanJob | null | undefined, [number, string]>(
  'address-scan-job',
);

const queryScanJob = bindQueryFn(fetchScanJob, scanJobCache);

const SCAN_POLL_INTERVAL = 3_000;

// usePolling has no disabled state; the stopped cadence is expressed as
// the largest setInterval delay environments accept without clamping the
// timer down to 1 ms (~24.8 days) — chainRpc.ts's proven constant.
const POLL_DISABLED_INTERVAL = 2_147_483_000;

// useResultSelect always applies select when a result exists; a
// module-level identity keeps the reference stable.
const identity = <T>(r: T) => r;

export type ScanJobQueryResult = {
  data: ScanJob | null | undefined;
  loading: boolean;
  fetching: boolean;
  error: Error | undefined;
  failureCount: number;
  stale: boolean;
  dataUpdatedAt: number | undefined;
  refetch: () => void | Promise<unknown>;
};

/**
 * The current scan job: null = no job row, undefined = disabled key
 * (chainId <= 0 / blank address) or nothing settled yet. Polls every 3s
 * only while a job is pending/running.
 */
export function useScanJob(chainId: number, address: string): ScanJobQueryResult {
  // Same widening createQueryHook/polledQuery perform: the runtime call
  // signature is [...K, signal?] and the cache slot widens with it.
  const runArgs = [chainId, address] as unknown as [number, string, signal?: AbortSignal];
  const provider = scanJobCache as unknown as CacheProvider<
    ScanJob | null | undefined,
    [number, string, signal?: AbortSignal]
  >;

  const injectable = useInjectable(queryScanJob, { name: queryScanJob.name || 'query' });
  const stale = useCache(injectable, provider, DEFAULT_STALE_TIME);
  const data = useResultSelect(injectable, identity);
  const fetching = useLoading(injectable);
  const status = useArgsStatus(injectable, runArgs);
  const loading = status.loading && status.data === undefined;

  useRun(injectable, runArgs, { signal: true, hash: hashArgs });

  const active = data?.status === 'pending' || data?.status === 'running';
  usePolling(injectable, active ? SCAN_POLL_INTERVAL : POLL_DISABLED_INTERVAL, {
    args: [chainId, address] as unknown as [number, string, signal?: AbortSignal],
  });

  const refetch = useRefresh(injectable, runArgs, provider);

  return {
    data,
    loading,
    fetching,
    error: status.error,
    failureCount: status.failureCount,
    stale,
    dataUpdatedAt: status.dataUpdatedAt,
    refetch,
  };
}
