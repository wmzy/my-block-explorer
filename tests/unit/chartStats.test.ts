// Chart statistics service: the pure derivation helpers (day-boundary
// bisection, blocks-per-day derivation, fee-window aggregation, cache-key
// derivation) plus the fetch layer over a mocked RPC client. The only
// network edge is the shared viem client factory — no test here touches
// a real RPC. The synthetic chain is exact: 12-second blocks starting at
// CHAIN_START, so every expected block number is computable by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PublicClient } from 'viem';

import {
  CHART_DAY_COUNT,
  MAX_BOUNDARY_PROBES,
  aggregateDailyGas,
  boundaryDayStarts,
  chartCacheKey,
  classifyChartsFailure,
  clearChartStatsCaches,
  deriveBlocksPerDay,
  fetchChartStats,
  findDayBoundary,
  gasCoverageLabel,
  realFeeWindowLength,
  utcDayKey,
  utcDayStart,
  type BlockHeaderLike,
  type DayBoundary,
} from '@/services/chartStats';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/utils/realTimeData', () => ({ createRpcClient: vi.fn() }));

const mockCreateRpcClient = vi.mocked(createRpcClient);

// --- synthetic chain ---
// Anchored to a frozen "now" (the fetch layer derives its day grid from
// Date.now(), so the chain must live in the same present); 12-second
// blocks make every expected block number computable by hand.

const BLOCK_TIME = 12;
const HEAD = 300_000; // ~41.7 days of 12s blocks
const FIXED_NOW = Date.UTC(2026, 8, 22, 15, 4, 5); // 2026-09-22T15:04:05Z
const CHAIN_START = Math.floor(FIXED_NOW / 1000) - (HEAD - 1) * BLOCK_TIME;
const MS_PER_DAY = 86_400_000;

// Timestamp of block n (1-based).
const ts = (block: number): number => CHAIN_START + (block - 1) * BLOCK_TIME;

// First block whose timestamp is at/after the given UTC day start.
const expectedBoundary = (dayStart: number): number =>
  Math.ceil((dayStart / 1000 - CHAIN_START) / BLOCK_TIME) + 1;

const header = (block: number): BlockHeaderLike => ({
  timestamp: ts(block),
  gasUsed: BigInt(30_000_000 - (block % 50) * 100_000),
  baseFeePerGas: 20_000_000_000n,
});

const oracle = (block: number): BlockHeaderLike | null =>
  block >= 1 && block <= HEAD ? header(block) : null;

const HEAD_MS = FIXED_NOW;

// --- time helpers / cache key ---

describe('utc time helpers', () => {
  it('floors to UTC midnight and keys the calendar day', () => {
    const morning = Date.UTC(2026, 8, 22, 5, 30, 12, 500);
    expect(utcDayStart(morning)).toBe(Date.UTC(2026, 8, 22));
    expect(utcDayKey(morning)).toBe('2026-09-22');
    // UTC, never local: 23:30 UTC on the 21st is still the 21st.
    expect(utcDayKey(Date.UTC(2026, 8, 21, 23, 30))).toBe('2026-09-21');
  });

  it('derives the snapshot cache key from chain and UTC day', () => {
    expect(chartCacheKey(1, '2026-09-22')).toBe('chart-stats:1:2026-09-22');
    expect(chartCacheKey(137, '2026-01-01')).not.toBe(chartCacheKey(1, '2026-01-01'));
  });

  it('lists dayCount + 1 boundary day starts, oldest → newest, ending today', () => {
    const now = Date.UTC(2026, 8, 22, 15);
    const starts = boundaryDayStarts(now);
    expect(starts).toHaveLength(CHART_DAY_COUNT + 1);
    expect(starts[starts.length - 1]).toBe(Date.UTC(2026, 8, 22));
    expect(starts[0]).toBe(Date.UTC(2026, 8, 22) - CHART_DAY_COUNT * MS_PER_DAY);
    for (let i = 1; i < starts.length; i += 1) {
      expect(starts[i] - starts[i - 1]).toBe(MS_PER_DAY);
    }
  });
});

// --- day-boundary bisection ---

describe('findDayBoundary', () => {
  it('finds the exact first block at/after the day start', async () => {
    const dayStart = Date.UTC(2026, 8, 20);
    const boundary = await findDayBoundary(
      block => Promise.resolve(oracle(block)),
      dayStart,
      1,
      HEAD,
    );
    expect(boundary).not.toBeNull();
    expect(boundary?.block).toBe(expectedBoundary(dayStart));
    expect(boundary?.dayStart).toBe(dayStart);
    expect(boundary?.timestamp).toBe(ts(expectedBoundary(dayStart)));
    expect(boundary?.gasUsed).toBe(header(expectedBoundary(dayStart)).gasUsed);
  });

  it('keeps the previous day\'s boundary as floor: same answer, fewer probes', async () => {
    const older = Date.UTC(2026, 8, 19);
    const newer = Date.UTC(2026, 8, 20);
    let probes = 0;
    const countingOracle = (block: number) => {
      probes += 1;
      return Promise.resolve(oracle(block));
    };
    const floorBoundary = await findDayBoundary(countingOracle, older, 1, HEAD);
    expect(floorBoundary?.block).toBe(expectedBoundary(older));
    const probesFromGenesis = probes;
    probes = 0;
    const nextBoundary = await findDayBoundary(
      countingOracle,
      newer,
      floorBoundary?.block ?? 1,
      HEAD,
    );
    expect(nextBoundary?.block).toBe(expectedBoundary(newer));
    // The reused floor shrinks the range, so the second search may not
    // probe more than the first (and both stay far under the cap).
    expect(probes).toBeLessThanOrEqual(probesFromGenesis);
    expect(probes).toBeLessThanOrEqual(MAX_BOUNDARY_PROBES);
  });

  it('bounds the probe count by the logarithm of the range', async () => {
    let probes = 0;
    const boundary = await findDayBoundary(
      block => {
        probes += 1;
        return Promise.resolve(oracle(block));
      },
      Date.UTC(2026, 8, 20),
      1,
      HEAD,
    );
    expect(boundary?.block).toBe(expectedBoundary(Date.UTC(2026, 8, 20)));
    // ceiling + floor probes + one per bisection step
    expect(probes).toBeLessThanOrEqual(2 + Math.ceil(Math.log2(HEAD - 1)));
  });

  it('returns null for a day not mined yet', async () => {
    const beyondHead = (ts(HEAD) + 10) * 1000;
    expect(
      await findDayBoundary(block => Promise.resolve(oracle(block)), beyondHead, 1, HEAD),
    ).toBeNull();
  });

  it('resolves block 1 when the chain starts at/after the target (young chain)', async () => {
    const beforeGenesis = (CHAIN_START - 3600) * 1000;
    const boundary = await findDayBoundary(
      block => Promise.resolve(oracle(block)),
      beforeGenesis,
      1,
      HEAD,
    );
    expect(boundary?.block).toBe(1);
  });

  it('refuses an inconsistent bracket instead of guessing downward', async () => {
    // Floor 50 sits at/after the target but is not the chain's first
    // block — the honest answer is "not resolvable in this bracket".
    const target = ts(50) * 1000;
    expect(
      await findDayBoundary(block => Promise.resolve(oracle(block)), target, 50, HEAD),
    ).toBeNull();
  });

  it('returns null when the probe budget is exhausted', async () => {
    expect(
      await findDayBoundary(
        block => Promise.resolve(oracle(block)),
        Date.UTC(2026, 8, 20),
        1,
        HEAD,
        1,
      ),
    ).toBeNull();
  });

  it('returns null when a probed block is missing', async () => {
    expect(
      await findDayBoundary(
        block => Promise.resolve(block === HEAD ? null : oracle(block)),
        Date.UTC(2026, 8, 20),
        1,
        HEAD,
      ),
    ).toBeNull();
  });
});

// --- blocks-per-day derivation (gap preservation) ---

describe('deriveBlocksPerDay', () => {
  const day = (n: number): number => Date.UTC(2026, 8, 1 + n);
  const boundaryAt = (dayStart: number, block: number): DayBoundary => ({
    dayStart,
    block,
    timestamp: block * BLOCK_TIME,
    gasUsed: 1_000_000n,
    baseFeePerGas: null,
  });

  it('derives one point per day from consecutive boundaries', () => {
    const boundaries = new Map<number, DayBoundary>([
      [day(0), boundaryAt(day(0), 100)],
      [day(1), boundaryAt(day(1), 7300)],
      [day(2), boundaryAt(day(2), 14_500)],
      [day(3), boundaryAt(day(3), 21_712)],
    ]);
    const points = deriveBlocksPerDay(boundaries, [day(0), day(1), day(2)]);
    expect(points).toEqual([
      { dayStart: day(0), blocks: 7200 },
      { dayStart: day(1), blocks: 7200 },
      { dayStart: day(2), blocks: 7212 },
    ]);
  });

  it('drops exactly the days around a missing boundary — a gap, never a zero', () => {
    const boundaries = new Map<number, DayBoundary>([
      [day(0), boundaryAt(day(0), 100)],
      // day(1) unresolvable
      [day(2), boundaryAt(day(2), 14_500)],
      [day(3), boundaryAt(day(3), 21_712)],
    ]);
    const points = deriveBlocksPerDay(boundaries, [day(0), day(1), day(2)]);
    expect(points).toEqual([{ dayStart: day(2), blocks: 7212 }]);
  });

  it('drops a non-monotonic pair defensively instead of a negative count', () => {
    const boundaries = new Map<number, DayBoundary>([
      [day(0), boundaryAt(day(0), 100)],
      [day(1), boundaryAt(day(1), 99)],
      [day(2), boundaryAt(day(2), 7_300)],
    ]);
    const points = deriveBlocksPerDay(boundaries, [day(0), day(1)]);
    expect(points).toEqual([{ dayStart: day(1), blocks: 7201 }]);
  });
});

// --- fee-window handling ---

describe('realFeeWindowLength', () => {
  it('drops exactly the speculative next-block entry when the node followed the spec', () => {
    expect(realFeeWindowLength(121, 120)).toBe(120);
    expect(realFeeWindowLength(4097, 4096)).toBe(4096);
  });

  it('takes shorter responses at face value (silently capped windows)', () => {
    expect(realFeeWindowLength(1024, 4096)).toBe(1024);
    expect(realFeeWindowLength(0, 4096)).toBe(0);
  });
});

describe('aggregateDailyGas', () => {
  const wei = (gwei: number): bigint => BigInt(Math.round(gwei * 1_000_000_000));

  it('averages a full day and marks it complete', () => {
    const point = aggregateDailyGas(0, 100, 103, [
      { oldestBlock: 100, baseFeePerGas: [wei(10), wei(20), wei(30)], reward: [[wei(1)], [wei(2)], [wei(3)]] },
    ]);
    expect(point).not.toBeNull();
    expect(point?.coveredBlocks).toBe(3);
    expect(point?.complete).toBe(true);
    expect(point?.avgBaseFeeGwei).toBeCloseTo(20, 8);
    expect(point?.avgPriorityFeeGwei).toBeCloseTo(2, 8);
    expect(point?.firstCoveredBlock).toBe(100);
    expect(point?.lastCoveredBlock).toBe(102);
  });

  it('merges chunked windows and clips blocks outside the day span', () => {
    const point = aggregateDailyGas(0, 100, 104, [
      { oldestBlock: 99, baseFeePerGas: [wei(1), wei(10), wei(10)], reward: [[wei(1)], [wei(1)], [wei(1)]] },
      { oldestBlock: 102, baseFeePerGas: [wei(30), wei(40), wei(999)], reward: [[wei(4)], [wei(4)], [wei(4)]] },
    ]);
    // Block 99 is before the span; block 104 is past the exclusive end.
    expect(point?.coveredBlocks).toBe(4);
    expect(point?.complete).toBe(true);
    expect(point?.avgBaseFeeGwei).toBeCloseTo((10 + 10 + 30 + 40) / 4, 8);
    expect(point?.firstCoveredBlock).toBe(100);
    expect(point?.lastCoveredBlock).toBe(103);
  });

  it('never double-counts overlapping windows', () => {
    const point = aggregateDailyGas(0, 100, 102, [
      { oldestBlock: 100, baseFeePerGas: [wei(10), wei(20)], reward: [[wei(1)], [wei(2)]] },
      { oldestBlock: 101, baseFeePerGas: [wei(20), wei(30)], reward: [[wei(2)], [wei(3)]] },
    ]);
    // Block 101 appears in both windows but counts once (last-write values
    // are identical here); block 102 is outside the span.
    expect(point?.coveredBlocks).toBe(2);
    expect(point?.complete).toBe(true);
  });

  it('keeps partial coverage honest: complete=false and only real blocks counted', () => {
    const point = aggregateDailyGas(0, 100, 110, [
      { oldestBlock: 100, baseFeePerGas: [wei(10), wei(20), wei(30)] },
    ]);
    expect(point?.coveredBlocks).toBe(3);
    expect(point?.complete).toBe(false);
    expect(point?.endBlockExclusive).toBe(110);
  });

  it('leaves the priority average null when no reward entries exist', () => {
    const point = aggregateDailyGas(0, 100, 102, [
      { oldestBlock: 100, baseFeePerGas: [wei(10), wei(20)] },
    ]);
    expect(point?.avgPriorityFeeGwei).toBeNull();
  });

  it('averages rewards only over entries that carry them', () => {
    const point = aggregateDailyGas(0, 100, 103, [
      {
        oldestBlock: 100,
        baseFeePerGas: [wei(10), wei(20), wei(30)],
        reward: [[wei(3)], [], [wei(9)]],
      },
    ]);
    expect(point?.avgPriorityFeeGwei).toBeCloseTo(6, 8);
  });

  it('returns null when nothing in the span was covered', () => {
    expect(aggregateDailyGas(0, 100, 110, [])).toBeNull();
    expect(
      aggregateDailyGas(0, 100, 110, [{ oldestBlock: 200, baseFeePerGas: [wei(1)] }]),
    ).toBeNull();
  });
});

describe('gasCoverageLabel', () => {
  it('labels the covered block window with count, share and block numbers', () => {
    const label = gasCoverageLabel({
      gasDaily: [
        {
          dayStart: 0,
          startBlock: 100,
          endBlockExclusive: 200,
          coveredBlocks: 90,
          firstCoveredBlock: 100,
          lastCoveredBlock: 189,
          avgBaseFeeGwei: 1,
          avgPriorityFeeGwei: null,
          complete: false,
        },
      ],
      gasCoveredBlocks: 9_000,
      gasExpectedBlocks: 10_000,
    });
    expect(label).toBe(
      'fee windows cover 9,000 of 10,000 charted blocks (90.0%) · #100–#189',
    );
  });

  it('returns null with nothing charted', () => {
    expect(gasCoverageLabel({ gasDaily: [], gasCoveredBlocks: 0, gasExpectedBlocks: 0 })).toBeNull();
  });
});

// --- failure classification ---

describe('classifyChartsFailure', () => {
  it('recognizes unimplemented methods through viem\'s error wrapping', () => {
    const wrapped = new Error('Request failed', {
      cause: new Error('The method eth_getBlockByNumber does not exist/is not available'),
    });
    expect(classifyChartsFailure(wrapped)).toBe('method-not-supported');
    expect(classifyChartsFailure(new Error('Method not found'))).toBe('method-not-supported');
  });

  it('keeps everything else a plain rpc error', () => {
    expect(classifyChartsFailure(new Error('fetch failed'))).toBe('rpc-error');
    expect(classifyChartsFailure(new Error('Request failed'))).toBe('rpc-error');
  });
});

// --- fetch layer (mocked RPC client) ---

type ClientState = {
  blockNumberCalls: number;
  blockCalls: number;
  feeCalls: number;
  failHead: boolean;
  pre1559: boolean;
};

const weiOfGwei = (gwei: number): bigint => BigInt(Math.round(gwei * 1_000_000_000));

const makeFakeClient = (head = HEAD) => {
  const state: ClientState = {
    blockNumberCalls: 0,
    blockCalls: 0,
    feeCalls: 0,
    failHead: false,
    pre1559: false,
  };
  const client = {
    getBlockNumber: async (): Promise<bigint> => {
      state.blockNumberCalls += 1;
      if (state.failHead) throw new Error('Request failed: getBlockNumber');
      return BigInt(head);
    },
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
      state.blockCalls += 1;
      const n = Number(blockNumber);
      const stamp = CHAIN_START + (n - 1) * BLOCK_TIME;
      return {
        timestamp: BigInt(stamp),
        gasUsed: BigInt(30_000_000 - (n % 50) * 100_000),
        baseFeePerGas: 20_000_000_000n,
      };
    },
    getFeeHistory: async ({
      blockCount,
      blockNumber,
    }: {
      blockCount: number;
      blockNumber?: bigint;
      rewardPercentiles: number[];
    }) => {
      state.feeCalls += 1;
      const newest = Number(blockNumber);
      const oldest = newest - blockCount + 1;
      const baseFeePerGas: bigint[] = [];
      const reward: bigint[][] = [];
      for (let block = oldest; block <= newest; block += 1) {
        const gwei = state.pre1559 ? 0 : 10 + (block % 100);
        baseFeePerGas.push(weiOfGwei(gwei));
        reward.push([weiOfGwei(state.pre1559 ? 0 : 1 + (block % 5) / 10)]);
      }
      // Spec's speculative next-block prediction.
      baseFeePerGas.push(0n);
      return { oldestBlock: BigInt(oldest), baseFeePerGas, gasUsedRatio: [], reward };
    },
  };
  return { client, state };
};

describe('fetchChartStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearChartStatsCaches();
    // The fetch layer derives its day grid and cache key from Date.now():
    // freeze the clock to FIXED_NOW so the synthetic chain (anchored to
    // the same instant) is always "41 days old, head right now".
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('guards non-positive chain ids without touching an endpoint', async () => {
    const result = await fetchChartStats(0);
    expect(result).toEqual({ status: 'unavailable', chainId: 0, reason: 'unsupported-chain' });
    expect(mockCreateRpcClient).not.toHaveBeenCalled();
  });

  it('derives the full 30-day series from the synthetic 12s chain', async () => {
    const { client, state } = makeFakeClient();
    mockCreateRpcClient.mockResolvedValue(client as unknown as PublicClient);

    const result = await fetchChartStats(1);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const { snapshot, gasUnavailableReason } = result;
    expect(gasUnavailableReason).toBeNull();
    expect(snapshot.gridDayStarts).toHaveLength(CHART_DAY_COUNT);
    expect(snapshot.blocksPerDay).toHaveLength(CHART_DAY_COUNT);
    // 86400 / 12 = exactly 7200 blocks per UTC day on this chain.
    for (const point of snapshot.blocksPerDay) expect(point.blocks).toBe(7200);
    expect(snapshot.boundaryHeaders).toHaveLength(CHART_DAY_COUNT);
    expect(snapshot.gasDaily).toHaveLength(CHART_DAY_COUNT);
    for (const day of snapshot.gasDaily) {
      expect(day.complete).toBe(true);
      expect(day.coveredBlocks).toBe(7200);
      expect(day.avgBaseFeeGwei).toBeGreaterThan(10);
      expect(day.avgBaseFeeGwei).toBeLessThan(110);
      expect(day.avgPriorityFeeGwei).not.toBeNull();
    }
    expect(snapshot.gasCoveredBlocks).toBe(CHART_DAY_COUNT * 7200);
    expect(snapshot.gasExpectedBlocks).toBe(CHART_DAY_COUNT * 7200);
    expect(snapshot.dayKey).toBe(utcDayKey(HEAD_MS));
    // The boundary bisections actually probed blocks.
    expect(state.blockCalls).toBeGreaterThan(CHART_DAY_COUNT);
    expect(state.feeCalls).toBeGreaterThan(CHART_DAY_COUNT);
  });

  it('chunked fee windows follow the adaptive ceiling (4096 then the rest)', async () => {
    const { client, state } = makeFakeClient();
    mockCreateRpcClient.mockResolvedValue(client as unknown as PublicClient);

    const result = await fetchChartStats(1);
    if (result.status !== 'ok') throw new Error('expected ok');
    // 7200-block days split into 4096 + 3104 — two requests per day.
    expect(state.feeCalls).toBe(CHART_DAY_COUNT * 2);
  });

  it('settles ok snapshots into the UTC-day cache: a second call is free', async () => {
    const { client, state } = makeFakeClient();
    mockCreateRpcClient.mockResolvedValue(client as unknown as PublicClient);

    const first = await fetchChartStats(1);
    const callsAfterFirst = state.blockNumberCalls + state.blockCalls + state.feeCalls;
    const second = await fetchChartStats(1);

    expect(second).toEqual(first);
    expect(state.blockNumberCalls + state.blockCalls + state.feeCalls).toBe(callsAfterFirst);
  });

  it('does not cache failures: the next call retries the RPC', async () => {
    const { client, state } = makeFakeClient();
    state.failHead = true;
    mockCreateRpcClient.mockResolvedValue(client as unknown as PublicClient);

    const failed = await fetchChartStats(1);
    expect(failed).toEqual({ status: 'unavailable', chainId: 1, reason: 'rpc-error' });

    state.failHead = false;
    const retried = await fetchChartStats(1);
    expect(retried.status).toBe('ok');
    expect(state.blockNumberCalls).toBe(2);
  });

  it('refuses to fabricate a fee chart from an all-zero pre-EIP-1559 response', async () => {
    const { client, state } = makeFakeClient();
    state.pre1559 = true;
    mockCreateRpcClient.mockResolvedValue(client as unknown as PublicClient);

    const result = await fetchChartStats(1);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.gasUnavailableReason).toBe('pre-eip-1559');
    expect(result.snapshot.gasDaily).toEqual([]);
    expect(result.snapshot.gasCoveredBlocks).toBe(0);
    // Boundary-derived charts are unaffected.
    expect(result.snapshot.blocksPerDay).toHaveLength(CHART_DAY_COUNT);
  });

  it('reports insufficient history on a chain younger than a day', async () => {
    // 100 blocks × 12s = 20 minutes of history.
    const { client } = makeFakeClient(100);
    mockCreateRpcClient.mockResolvedValue(client as unknown as PublicClient);

    const result = await fetchChartStats(1);
    expect(result).toEqual({
      status: 'unavailable',
      chainId: 1,
      reason: 'insufficient-history',
    });
  });
});
