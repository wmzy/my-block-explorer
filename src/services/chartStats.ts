// Chart statistics service: the ~30-day daily series behind the Charts
// page (/chain/:chainId/charts).
//
// Honesty contract first: this explorer's DuckDB event tables only cover
// user-configured ranges, so these charts NEVER present themselves as
// indexer truth. Everything is derived client-side from three RPC sources —
// eth_getBlockByNumber headers (one binary-searched boundary per UTC day),
// chunked eth_feeHistory windows, and uniformly sampled
// eth_getBlockTransactionCount probes (the extrapolated tx/day series) —
// and every series carries a source label saying exactly what was sampled.
// Gaps stay gaps: a day that could not be resolved is absent from the
// series, never zero-filled.
//
// Cost model: the first load of a chain on a given UTC day probes ~31 day
// boundaries (a timestamp bisection each, reusing the previous day's block
// as the floor so ranges shrink), one fee-history request per chunk of
// each charted day, and at most 16 tx-count samples per charted day under
// a hard whole-series budget (TX_SAMPLE_BUDGET). The settled snapshot is
// cached in-memory per
// (chainId, UTC day): the 60s poll and remounts resolve from the cache,
// and only a new UTC day makes the key stale. Failed or insufficient
// computations never occupy the day slot — the next poll retries instead
// of serving a dead RPC's verdict until midnight.
import { createRpcClient } from '@/utils/realTimeData';
import { formatNumber } from '@/utils/format';

import { bindQueryFn, createQueryCache } from '@/util/useQuery';

import { createPolledQueryHook, type PolledQueryResult } from './polledQuery';

// Complete UTC days charted. Today is only the anchor boundary that
// closes the newest complete day — an in-progress day never gets a
// "blocks per day" point.
export const CHART_DAY_COUNT = 30;

// Probe ceiling for one day-boundary bisection. Mainnet-sized ranges need
// ~25 probes for the oldest boundary (floor 1) and ~13 for the newest;
// anything beyond this cap degrades to an honest gap instead of grinding.
export const MAX_BOUNDARY_PROBES = 40;

// The first fee-history request for a day asks for the whole day at once;
// providers that cap the window shrink this remembered ceiling per chain
// (never grows back within a session — success-driven regrowth
// oscillates against the cap).
const INITIAL_FEE_CHUNK_BLOCKS = 4096;
const MIN_FEE_CHUNK_BLOCKS = 64;

// Fee windows of different days are independent: a small pool keeps the
// first Charts load from serializing one request per chunk.
const FEE_DAY_CONCURRENCY = 3;

// The extrapolated tx/day series samples K blocks uniformly inside each
// charted day's span and scales the sampled sum up to the whole day.
export const TX_SAMPLES_PER_DAY = 16;

// Hard ceiling on eth_getBlockTransactionCount calls for the whole
// snapshot: 30 charted days × 16 samples = 480, and the ceiling keeps a
// hypothetically wider day grid from multiplying the RPC budget.
export const TX_SAMPLE_BUDGET = 512;

// Concurrent tx-count probes: enough to keep a 480-call first load moving
// without leaning on the provider.
const TX_SAMPLE_CONCURRENCY = 4;

// A settled snapshot is immutable for the rest of the UTC day, so a poll
// cadence only re-checks the day cache (plus retries unsettled failures).
const CHARTS_POLL_INTERVAL = 60_000;

const MS_PER_DAY = 86_400_000;
const GWEI = 1_000_000_000;

// --- types ---

/** Header slice the boundary search needs from every probed block. */
export type BlockHeaderLike = {
  timestamp: number;
  gasUsed: bigint;
  baseFeePerGas: bigint | null;
};

/**
 * One resolved day boundary: the first block mined at/after the UTC day
 * start. Its header doubles as the day's single gas-used sample.
 */
export type DayBoundary = {
  /** UTC midnight this boundary belongs to, ms epoch. */
  dayStart: number;
  block: number;
  /** The boundary block's own timestamp, seconds. */
  timestamp: number;
  gasUsed: bigint;
  baseFeePerGas: bigint | null;
};

export type BlocksPerDayPoint = { dayStart: number; blocks: number };

export type DailyGasPoint = {
  dayStart: number;
  /** The day's boundary block — the intended window start. */
  startBlock: number;
  /** The next day's boundary block (exclusive end). */
  endBlockExclusive: number;
  /** Blocks actually included in the averages (≤ the day's span). */
  coveredBlocks: number;
  firstCoveredBlock: number;
  lastCoveredBlock: number;
  avgBaseFeeGwei: number;
  /**
   * Mean 25th-percentile reward over covered blocks, or null when the
   * node returned no reward entries at all.
   */
  avgPriorityFeeGwei: number | null;
  /** true iff every block of the day's span was averaged. */
  complete: boolean;
};

/** Structural slice of viem's FeeHistory, pre-trimmed of the speculative tail. */
export type FeeWindowSample = {
  oldestBlock: number;
  baseFeePerGas: readonly bigint[];
  reward?: readonly (readonly bigint[])[];
};

// Why the page (boundary-derived charts) cannot render.
export type ChartsUnavailableReason =
  | 'unsupported-chain'
  | 'rpc-error'
  | 'method-not-supported'
  | 'insufficient-history';

// Why the fee section specifically cannot render while boundary charts do.
export type GasChartUnavailableReason =
  | 'rpc-cap'
  | 'method-not-supported'
  | 'pre-eip-1559'
  | 'rpc-error';

// Why the sampled tx/day card specifically cannot render while boundary
// charts do. No 'rpc-cap' variant: eth_getBlockTransactionCount takes one
// block, there is no window for a provider to cap — the existing values
// already cover every genuine failure of this method.
export type TxChartUnavailableReason = 'method-not-supported' | 'rpc-error';

/** One extrapolated day of the sampled tx/day series. */
export type TxPerDayPoint = {
  dayStart: number;
  /** Extrapolated transaction count: sampled sum × blocks-per-sample. */
  transactions: number;
  /** Sampled blocks the estimate actually rests on. */
  samples: number;
  /** Blocks in the day's span (what the sum was scaled to). */
  blocksInDay: number;
};

export type ChartsSnapshot = {
  chainId: number;
  /** UTC day the series was computed for ('YYYY-MM-DD'). */
  dayKey: string;
  computedAt: number;
  headBlock: number;
  /**
   * UTC day starts the series attempted, oldest → newest: the render
   * grid. A day without a point renders as a gap, never as zero.
   */
  gridDayStarts: number[];
  /** One point per day whose BOTH boundaries resolved, oldest → newest. */
  blocksPerDay: BlocksPerDayPoint[];
  /** The boundary block's header per charted day — the sampled series. */
  boundaryHeaders: DayBoundary[];
  /** Daily fee averages; partial days keep their point with complete=false. */
  gasDaily: DailyGasPoint[];
  gasCoveredBlocks: number;
  gasExpectedBlocks: number;
  /**
   * Extrapolated daily transaction counts from uniformly sampled blocks.
   * A day whose sampling fell below half its attempted samples is absent
   * — a gap, never a zero.
   */
  txPerDay: TxPerDayPoint[];
  /** Sample blocks attempted per day (the sampling basis the label cites). */
  txSamplesPerDay: number;
};

// Both variants carry the chain: the query layer's store keeps the last
// settle across an args switch, so the view refuses another chain's data.
export type ChartsResult =
  | {
    status: 'ok';
    chainId: number;
    snapshot: ChartsSnapshot;
    gasUnavailableReason: GasChartUnavailableReason | null;
    txUnavailableReason: TxChartUnavailableReason | null;
  }
  | { status: 'unavailable'; chainId: number; reason: ChartsUnavailableReason };

// --- pure time helpers ---

/** Floor to the UTC midnight of the given instant, ms epoch. */
export function utcDayStart(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

/** UTC calendar day of the given instant ('YYYY-MM-DD'). */
export function utcDayKey(ms: number): string {
  return new Date(utcDayStart(ms)).toISOString().slice(0, 10);
}

/** In-memory snapshot cache key: one settled series per (chain, UTC day). */
export function chartCacheKey(chainId: number, dayKey: string): string {
  return `chart-stats:${chainId}:${dayKey}`;
}

/**
 * Day starts to resolve boundaries for, oldest → newest: the charted
 * complete days plus TODAY, whose boundary closes the newest complete
 * day. Returns dayCount + 1 entries.
 */
export function boundaryDayStarts(nowMs: number, dayCount = CHART_DAY_COUNT): number[] {
  const today = utcDayStart(nowMs);
  return Array.from(
    { length: dayCount + 1 },
    (_, index) => today - (dayCount - index) * MS_PER_DAY,
  );
}

// --- day-boundary estimation (binary search over block timestamps) ---

/**
 * Find the first block whose timestamp is at/after the day start, inside
 * [floor, ceiling], by bisecting the monotone block timestamps. `probe`
 * returns null for a missing block (or an exhausted budget), which makes
 * the boundary unresolvable — an honest gap, never a guess.
 *
 * Floor reuse is the cost lever: callers pass the previous day's boundary
 * as the floor, so each successive bisection runs over a shrinking range
 * instead of the whole chain.
 */
export async function findDayBoundary(
  probe: (block: number) => Promise<BlockHeaderLike | null>,
  dayStart: number,
  floor: number,
  ceiling: number,
  maxProbes = MAX_BOUNDARY_PROBES,
): Promise<DayBoundary | null> {
  const target = Math.floor(dayStart / 1000);
  if (!(ceiling > floor)) return null;
  let budget = maxProbes;
  const ask = async (block: number): Promise<BlockHeaderLike | null> => {
    if (budget <= 0) return null;
    budget -= 1;
    return probe(block);
  };
  // Invariant: lo's timestamp < target, hi's timestamp >= target; the
  // answer is the smallest known block at/after the target.
  const ceilingHeader = await ask(ceiling);
  if (ceilingHeader === null || ceilingHeader.timestamp < target) return null;
  let hi = ceiling;
  let hiHeader = ceilingHeader;
  let lo = Math.max(1, floor);
  const floorHeader = await ask(lo);
  if (floorHeader === null) return null;
  if (floorHeader.timestamp >= target) {
    // The floor itself is at/after the target. Honest only when no
    // earlier block exists (young chain, floor 1); otherwise the caller's
    // bracket was inconsistent — refuse instead of guessing downward.
    return lo === 1
      ? { dayStart, block: 1, ...floorHeader }
      : null;
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const header = await ask(mid);
    if (header === null) return null;
    if (header.timestamp >= target) {
      hi = mid;
      hiHeader = header;
    } else {
      lo = mid;
    }
  }
  return { dayStart, block: hi, ...hiHeader };
}

// --- blocks-per-day derivation (gap-preserving) ---

/**
 * One point per grid day whose own AND next-day boundaries both resolved
 * with a positive block delta. A missing or non-monotonic boundary drops
 * exactly that day's point — the series keeps a gap, never a zero.
 */
export function deriveBlocksPerDay(
  boundaries: ReadonlyMap<number, DayBoundary>,
  gridDayStarts: readonly number[],
): BlocksPerDayPoint[] {
  const points: BlocksPerDayPoint[] = [];
  for (const dayStart of gridDayStarts) {
    const start = boundaries.get(dayStart);
    const next = boundaries.get(dayStart + MS_PER_DAY);
    if (start === undefined || next === undefined) continue;
    const blocks = next.block - start.block;
    if (blocks <= 0) continue;
    points.push({ dayStart, blocks });
  }
  return points;
}

// --- fee-window handling ---

/**
 * Real mined blocks in an eth_feeHistory response: the spec appends one
 * speculative next-block prediction to baseFeePerGas, so a response of
 * requestedCount + 1 entries holds exactly requestedCount real blocks;
 * anything shorter is taken at face value (providers that silently cap
 * the window), bounded by the request.
 */
export function realFeeWindowLength(returnedLength: number, requestedCount: number): number {
  if (returnedLength === requestedCount + 1) return requestedCount;
  return Math.min(returnedLength, requestedCount);
}

/**
 * Merge fee windows into one day's averages. Blocks are counted once each
 * (overlapping windows cannot double-count), clipped to the day's
 [startBlock, endBlockExclusive) span, and coverage is reported honestly:
 * `complete` is true only when every block of the span was averaged.
 * Priority averages use only entries that carry a reward array; none at
 * all leaves the priority average null.
 */
export function aggregateDailyGas(
  dayStart: number,
  startBlock: number,
  endBlockExclusive: number,
  windows: readonly FeeWindowSample[],
): DailyGasPoint | null {
  const seen = new Set<number>();
  let baseFeeSumWei = 0n;
  let rewardSumWei = 0n;
  let covered = 0;
  let rewarded = 0;
  let firstBlock = startBlock;
  let lastBlock = startBlock;
  for (const window of windows) {
    const count = window.baseFeePerGas.length;
    for (let i = 0; i < count; i += 1) {
      const block = window.oldestBlock + i;
      if (block < startBlock || block >= endBlockExclusive || seen.has(block)) continue;
      seen.add(block);
      covered += 1;
      baseFeeSumWei += window.baseFeePerGas[i];
      if (block < firstBlock || covered === 1) firstBlock = block;
      if (block > lastBlock || covered === 1) lastBlock = block;
      const reward = window.reward?.[i];
      if (reward !== undefined && reward.length > 0) {
        rewarded += 1;
        rewardSumWei += reward[0];
      }
    }
  }
  if (covered === 0) return null;
  return {
    dayStart,
    startBlock,
    endBlockExclusive,
    coveredBlocks: covered,
    firstCoveredBlock: firstBlock,
    lastCoveredBlock: lastBlock,
    avgBaseFeeGwei: Number(baseFeeSumWei) / covered / GWEI,
    avgPriorityFeeGwei: rewarded > 0 ? Number(rewardSumWei) / rewarded / GWEI : null,
    complete: covered === endBlockExclusive - startBlock,
  };
}

/**
 * Source label for the fee chart: the block window the averages actually
 * cover (count and numbers), never a wall-clock claim the data cannot
 * support. Null when there is nothing to describe.
 */
export function gasCoverageLabel(
  snapshot: Pick<ChartsSnapshot, 'gasDaily' | 'gasCoveredBlocks' | 'gasExpectedBlocks'>,
): string | null {
  const points = snapshot.gasDaily;
  if (points.length === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const pct =
    snapshot.gasExpectedBlocks > 0
      ? ` (${((snapshot.gasCoveredBlocks / snapshot.gasExpectedBlocks) * 100).toFixed(1)}%)`
      : '';
  return `fee windows cover ${formatNumber(snapshot.gasCoveredBlocks)} of ${formatNumber(
    snapshot.gasExpectedBlocks,
  )} charted blocks${pct} · #${formatNumber(first.firstCoveredBlock)}–#${formatNumber(
    last.lastCoveredBlock,
  )}`;
}

// --- sampled tx/day series (extrapolated, gap-preserving) ---

/**
 * Sample blocks attempted per charted day once the whole-series RPC
 * budget is divided over the grid: K per day, floored when a wider grid
 * would multiply past TX_SAMPLE_BUDGET, zero when the grid cannot afford
 * a single sample per day.
 */
export function txSamplesForDays(dayCount: number): number {
  if (dayCount <= 0) return 0;
  return Math.min(TX_SAMPLES_PER_DAY, Math.floor(TX_SAMPLE_BUDGET / dayCount));
}

/**
 * Uniformly spread sample positions across a day's [startBlock,
 * endBlockExclusive) span: the midpoints of `count` equal strata. A count
 * at or above the span degenerates to every block of the day.
 */
export function sampledTxPositions(
  startBlock: number,
  endBlockExclusive: number,
  count: number,
): number[] {
  const span = endBlockExclusive - startBlock;
  if (span <= 0 || count <= 0) return [];
  const take = Math.min(count, span);
  const positions: number[] = [];
  for (let i = 0; i < take; i += 1) {
    positions.push(startBlock + Math.floor(((i + 0.5) * span) / take));
  }
  return positions;
}

/**
 * Scale one day's resolved sample counts into an extrapolated daily
 * estimate: sum × (blocksInDay / samples). Fewer than `minSamples`
 * resolved samples leaves the day ABSENT — a gap, never a zero and never
 * a thin-sample guess dressed up as data.
 */
export function extrapolateSampledTransactions(
  dayStart: number,
  blocksInDay: number,
  resolved: ReadonlyArray<{ block: number; transactions: number }>,
  minSamples: number,
): TxPerDayPoint | null {
  if (blocksInDay <= 0 || resolved.length < Math.max(1, minSamples)) return null;
  const sum = resolved.reduce((total, sample) => total + sample.transactions, 0);
  return {
    dayStart,
    transactions: Math.round((sum * blocksInDay) / resolved.length),
    samples: resolved.length,
    blocksInDay,
  };
}

/**
 * Source label for the sampled tx/day chart: the sampling basis in plain
 * terms, riding the card header verbatim. Null when nothing was sampled.
 */
export function txSamplingLabel(
  snapshot: Pick<ChartsSnapshot, 'txPerDay' | 'txSamplesPerDay'>,
): string | null {
  if (snapshot.txPerDay.length === 0) return null;
  return `extrapolated from ${snapshot.txSamplesPerDay} sampled blocks per day — counts, not indexer truth`;
}

// --- failure classification ---

// Collects the error's whole cause chain: viem wraps JSON-RPC errors
// (where "method not found" lives) several layers deep.
const errorChainText = (error: unknown): string => {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.length > 0 ? parts.join(' ') : String(error);
};

const METHOD_UNSUPPORTED_PATTERN =
  /(method[^\n]*not[^\n]*(found|exist|available|support))|not[^\n]*supported|does not exist|unimplemented/i;

const RPC_WINDOW_CAP_PATTERN =
  /(too large|exceed|limit|range too|maximum|too many|block count|block range)/i;

/**
 * Classify a failed probe for the honest unavailable state. Only the
 * reason travels; raw provider text never reaches the UI.
 */
export function classifyChartsFailure(error: unknown): 'method-not-supported' | 'rpc-error' {
  const text = errorChainText(error);
  return METHOD_UNSUPPORTED_PATTERN.test(text) ? 'method-not-supported' : 'rpc-error';
}

// --- fetch layer ---

// Structural slice of the viem client this service touches; the real
// PublicClient assigns as-is and tests can hand in a plain fake.
type ChartClient = {
  getBlockNumber(): Promise<bigint>;
  getBlock(args: { blockNumber: bigint }): Promise<{
    timestamp: bigint;
    gasUsed: bigint;
    baseFeePerGas: bigint | null;
  }>;
  getFeeHistory(args: {
    blockCount: number;
    blockNumber?: bigint;
    rewardPercentiles: number[];
  }): Promise<{
    oldestBlock: bigint;
    baseFeePerGas: readonly bigint[];
    gasUsedRatio?: readonly number[];
    reward?: readonly (readonly bigint[])[];
  }>;
  getBlockTransactionCount(args: { blockNumber: bigint }): Promise<number>;
};

const headerOf = (block: {
  timestamp: bigint;
  gasUsed: bigint;
  baseFeePerGas: bigint | null;
}): BlockHeaderLike => ({
  timestamp: Number(block.timestamp),
  gasUsed: block.gasUsed,
  baseFeePerGas: block.baseFeePerGas,
});

// Remembered per-chain fee-window ceiling (adaptive shrink only).
const providerFeeCeilings = new Map<number, number>();

type DayGasOutcome = { point: DailyGasPoint | null; reason: GasChartUnavailableReason | null };

/**
 * Fetch one day's fee windows with adaptive chunking: ask for the whole
 * remaining span, halve the remembered ceiling when the provider rejects
 * a window as too large, and adopt the served length when a provider
 * silently caps. Returns nulls-with-reason on failure; partial coverage
 * stays real (complete=false on the aggregated point).
 */
async function fetchDayGas(
  client: ChartClient,
  chainId: number,
  dayStart: number,
  startBlock: number,
  endBlockExclusive: number,
): Promise<DayGasOutcome> {
  let cursor = startBlock;
  const windows: FeeWindowSample[] = [];
  for (;;) {
    const cap = providerFeeCeilings.get(chainId) ?? INITIAL_FEE_CHUNK_BLOCKS;
    const want = Math.min(cap, endBlockExclusive - cursor);
    if (want <= 0) break;
    let history: Awaited<ReturnType<ChartClient['getFeeHistory']>>;
    try {
      history = await client.getFeeHistory({
        blockCount: want,
        blockNumber: BigInt(cursor + want - 1),
        rewardPercentiles: [25],
      });
    } catch (error) {
      const text = errorChainText(error);
      if (METHOD_UNSUPPORTED_PATTERN.test(text)) {
        return { point: null, reason: 'method-not-supported' };
      }
      if (RPC_WINDOW_CAP_PATTERN.test(text)) {
        if (cap <= MIN_FEE_CHUNK_BLOCKS) return { point: null, reason: 'rpc-cap' };
        providerFeeCeilings.set(
          chainId,
          Math.max(MIN_FEE_CHUNK_BLOCKS, Math.floor(cap / 2)),
        );
        continue;
      }
      return { point: null, reason: 'rpc-error' };
    }
    const real = realFeeWindowLength(history.baseFeePerGas.length, want);
    if (real > 0 && real < want) {
      // Provider silently served less than asked — remember so later
      // chunks request what it actually serves.
      const known = providerFeeCeilings.get(chainId) ?? INITIAL_FEE_CHUNK_BLOCKS;
      providerFeeCeilings.set(chainId, Math.min(known, real));
    }
    if (real <= 0) break;
    const oldest = Number(history.oldestBlock);
    windows.push({
      oldestBlock: oldest,
      baseFeePerGas: history.baseFeePerGas.slice(0, real),
      reward: history.reward?.slice(0, real),
    });
    cursor = Math.max(cursor, oldest) + real;
  }
  const point = aggregateDailyGas(dayStart, startBlock, endBlockExclusive, windows);
  return { point, reason: point === null ? 'rpc-error' : null };
}

/** One charted day's block span, closed by two resolved boundaries. */
type DaySpan = { dayStart: number; startBlock: number; endBlockExclusive: number };

type TxSeriesOutcome = { points: TxPerDayPoint[]; reason: TxChartUnavailableReason | null };

/**
 * Sample every charted day's span uniformly (K blocks per day under the
 * whole-series budget), fetch each sample's transaction count at a small
 * fixed concurrency, and scale each resolved sum up to its day. A sample
 * that errors is simply unresolvable — RPC flakiness thins a day's
 * evidence, and a day below half its attempted samples stays absent (a
 * gap, never a zero). A reason is reported only when every day gapped;
 * any method-not-found outranks plain rpc errors for the honest copy.
 */
async function fetchSampledTxPerDay(
  client: ChartClient,
  spans: readonly DaySpan[],
): Promise<TxSeriesOutcome> {
  const samplesPerDay = txSamplesForDays(spans.length);
  if (samplesPerDay <= 0) return { points: [], reason: null };
  const daySamples = spans.map(span => ({
    ...span,
    blocks: sampledTxPositions(span.startBlock, span.endBlockExclusive, samplesPerDay),
  }));
  const tasks: number[] = [];
  for (const day of daySamples) tasks.push(...day.blocks);
  const counts = new Map<number, number>();
  let methodUnsupported = false;
  let sawFailure = false;
  let nextSample = 0;
  const workers = Array.from(
    { length: Math.min(TX_SAMPLE_CONCURRENCY, tasks.length) },
    async () => {
      for (;;) {
        const index = nextSample;
        nextSample += 1;
        if (index >= tasks.length) return;
        try {
          const count = await client.getBlockTransactionCount({
            blockNumber: BigInt(tasks[index]),
          });
          if (Number.isFinite(count) && count >= 0) counts.set(tasks[index], count);
        } catch (error) {
          sawFailure = true;
          if (METHOD_UNSUPPORTED_PATTERN.test(errorChainText(error))) methodUnsupported = true;
        }
      }
    },
  );
  await Promise.all(workers);
  const minSamples = Math.ceil(samplesPerDay / 2);
  const points: TxPerDayPoint[] = [];
  for (const day of daySamples) {
    const resolved = day.blocks
      .map(block => {
        const count = counts.get(block);
        return count === undefined ? null : { block, transactions: count };
      })
      .filter((sample): sample is { block: number; transactions: number } => sample !== null);
    const point = extrapolateSampledTransactions(
      day.dayStart,
      day.endBlockExclusive - day.startBlock,
      resolved,
      minSamples,
    );
    if (point !== null) points.push(point);
  }
  const reason: TxChartUnavailableReason | null =
    points.length > 0
      ? null
      : methodUnsupported
        ? 'method-not-supported'
        : sawFailure
          ? 'rpc-error'
          : null;
  return { points, reason };
}

async function computeChartsSnapshot(chainId: number, nowMs: number): Promise<ChartsResult> {
  const client = await createRpcClient(chainId);
  const head = Number(await client.getBlockNumber());
  if (!(head >= 1)) {
    return { status: 'unavailable', chainId, reason: 'insufficient-history' };
  }

  // Boundaries oldest → newest with floor reuse: each resolved boundary
  // narrows the next day's search range.
  const starts = boundaryDayStarts(nowMs);
  const boundaries = new Map<number, DayBoundary>();
  let floor = 1;
  for (const dayStart of starts) {
    const boundary = await findDayBoundary(
      block => client.getBlock({ blockNumber: BigInt(block) }).then(headerOf, () => null),
      dayStart,
      floor,
      head,
    );
    if (boundary !== null) {
      boundaries.set(dayStart, boundary);
      floor = boundary.block;
    }
  }

  const grid = starts.slice(0, -1);
  const blocksPerDay = deriveBlocksPerDay(boundaries, grid);
  if (blocksPerDay.length === 0) {
    return { status: 'unavailable', chainId, reason: 'insufficient-history' };
  }
  const boundaryHeaders = blocksPerDay
    .map(point => boundaries.get(point.dayStart))
    .filter((b): b is DayBoundary => b !== undefined);

  // Fee windows per charted day, a few days at a time; the outcome order
  // follows the (already oldest→newest) input regardless of completion
  // order.
  const outcomes: DayGasOutcome[] = new Array(blocksPerDay.length);
  let nextDay = 0;
  const workers = Array.from(
    { length: Math.min(FEE_DAY_CONCURRENCY, blocksPerDay.length) },
    async () => {
      for (;;) {
        const index = nextDay;
        nextDay += 1;
        if (index >= blocksPerDay.length) return;
        const point = blocksPerDay[index];
        const start = boundaries.get(point.dayStart);
        const end = boundaries.get(point.dayStart + MS_PER_DAY);
        if (start === undefined || end === undefined) {
          outcomes[index] = { point: null, reason: null };
          continue;
        }
        outcomes[index] = await fetchDayGas(
          client,
          chainId,
          point.dayStart,
          start.block,
          end.block,
        );
      }
    },
  );
  await Promise.all(workers);

  // Sampled tx/day series: uniform K samples inside each charted day's
  // span (the same resolved boundaries), scaled to whole days.
  const txSpans: DaySpan[] = blocksPerDay.flatMap(point => {
    const start = boundaries.get(point.dayStart);
    const end = boundaries.get(point.dayStart + MS_PER_DAY);
    return start === undefined || end === undefined
      ? []
      : [{ dayStart: point.dayStart, startBlock: start.block, endBlockExclusive: end.block }];
  });
  const txOutcome = await fetchSampledTxPerDay(client, txSpans);

  const gasDaily = outcomes
    .map(outcome => outcome.point)
    .filter((point): point is DailyGasPoint => point !== null)
    .sort((a, b) => a.dayStart - b.dayStart);
  const gasCoveredBlocks = gasDaily.reduce((total, point) => total + point.coveredBlocks, 0);
  const gasExpectedBlocks = blocksPerDay.reduce((total, point) => total + point.blocks, 0);

  // An all-zero base-fee window is the pre-EIP-1559 response shape, not a
  // real 0-gwei market — refuse to fabricate a flat "free gas" chart.
  const gasUnavailableReason: GasChartUnavailableReason | null =
    gasDaily.length === 0
      ? (outcomes.find(outcome => outcome.reason !== null)?.reason ?? 'rpc-error')
      : gasDaily.every(point => point.avgBaseFeeGwei <= 0)
        ? 'pre-eip-1559'
        : null;
  const chartedGasDaily = gasUnavailableReason === 'pre-eip-1559' ? [] : gasDaily;

  return {
    status: 'ok',
    chainId,
    snapshot: {
      chainId,
      dayKey: utcDayKey(nowMs),
      computedAt: Date.now(),
      headBlock: head,
      gridDayStarts: grid,
      blocksPerDay,
      boundaryHeaders,
      gasDaily: chartedGasDaily,
      gasCoveredBlocks: gasUnavailableReason === 'pre-eip-1559' ? 0 : gasCoveredBlocks,
      gasExpectedBlocks,
      txPerDay: txOutcome.points,
      txSamplesPerDay: txSamplesForDays(txSpans.length),
    },
    gasUnavailableReason,
    txUnavailableReason: txOutcome.reason,
  };
}

// --- snapshot cache: one settled series per (chain, UTC day) ---

const snapshotCache = new Map<string, Promise<ChartsResult>>();

/** Test/maintenance hook: forget every settled snapshot and fee ceiling. */
export function clearChartStatsCaches(): void {
  snapshotCache.clear();
  providerFeeCeilings.clear();
}

/**
 * Fetch the daily chart series for a chain. Never throws: failures settle
 * as an explicit unavailable state with a classified reason. Settled ok
 * snapshots occupy the chain's UTC-day slot (the 60s poll resolves from
 * the cache); unavailable results never do, so each tick retries.
 */
export async function fetchChartStats(chainId: number): Promise<ChartsResult> {
  // Same invalid-arg guard the other RPC services use: a non-positive id
  // resolves without touching an endpoint.
  if (!(chainId > 0)) {
    return { status: 'unavailable', chainId, reason: 'unsupported-chain' };
  }
  const now = Date.now();
  const key = chartCacheKey(chainId, utcDayKey(now));
  const cached = snapshotCache.get(key);
  if (cached) return cached;
  const settled: Promise<ChartsResult> = computeChartsSnapshot(chainId, now).then(
    result => {
      if (result.status === 'unavailable' && snapshotCache.get(key) === settled) {
        snapshotCache.delete(key);
      }
      return result;
    },
    error => {
      if (snapshotCache.get(key) === settled) snapshotCache.delete(key);
      return { status: 'unavailable', chainId, reason: classifyChartsFailure(error) };
    },
  );
  snapshotCache.set(key, settled);
  // Keep only the current day per chain — yesterday's slot ages out on
  // UTC rollover instead of piling up.
  for (const other of snapshotCache.keys()) {
    if (other !== key && other.startsWith(`chart-stats:${chainId}:`)) {
      snapshotCache.delete(other);
    }
  }
  return settled;
}

export const chartStatsCache = createQueryCache<ChartsResult, [number]>('chart-stats');

const queryChartStats = bindQueryFn(fetchChartStats, chartStatsCache);

const useChartStatsQuery = createPolledQueryHook({
  queryFn: queryChartStats,
  interval: CHARTS_POLL_INTERVAL,
});

/**
 * Polled chart series for a chain (60s cadence; ticks resolve from the
 * UTC-day snapshot cache once settled). Chain switches land on a fresh
 * cache key, so the page resets to its first-load state instead of
 * showing the previous chain's series.
 */
export function useChartStats(chainId: number): PolledQueryResult<ChartsResult> {
  return useChartStatsQuery([chainId]);
}
