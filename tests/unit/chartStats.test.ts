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
  TX_SAMPLES_PER_DAY,
  TX_SAMPLE_BUDGET,
  aggregateDailyGas,
  boundaryDayStarts,
  chartCacheKey,
  classifyChartsFailure,
  clearChartStatsCaches,
  deriveBlocksPerDay,
  extrapolateSampledTransactions,
  fetchChartStats,
  findDayBoundary,
  gasCoverageLabel,
  realFeeWindowLength,
  sampledTxPositions,
  txSamplesForDays,
  txSamplingLabel,
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

// --- sampled tx/day series (pure builders) ---

describe('txSamplesForDays', () => {
  it('gives every day the full K while the budget allows', () => {
    expect(txSamplesForDays(CHART_DAY_COUNT)).toBe(16);
    expect(txSamplesForDays(32)).toBe(16); // floor(512/32) still 16
    expect(txSamplesForDays(1)).toBe(16);
  });

  it('floors the per-day count once the grid would bust the whole-series budget', () => {
    expect(txSamplesForDays(33)).toBe(15); // floor(512/33)
    expect(txSamplesForDays(512)).toBe(1);
    expect(txSamplesForDays(600)).toBe(0);
    expect(txSamplesForDays(0)).toBe(0);
  });
});

describe('sampledTxPositions', () => {
  it('spreads samples at stratum midpoints across the day span', () => {
    const positions = sampledTxPositions(1000, 8200, 16);
    expect(positions).toHaveLength(16);
    // Midpoints of sixteen equal 450-block strata.
    expect(positions[0]).toBe(1225);
    expect(positions[15]).toBe(7975);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    for (const position of positions) {
      expect(position).toBeGreaterThanOrEqual(1000);
      expect(position).toBeLessThan(8200);
    }
  });

  it('degenerates to every block when the count reaches the span', () => {
    expect(sampledTxPositions(50, 55, 16)).toEqual([50, 51, 52, 53, 54]);
    expect(sampledTxPositions(50, 55, 5)).toEqual([50, 51, 52, 53, 54]);
  });

  it('returns nothing for empty spans or non-positive counts', () => {
    expect(sampledTxPositions(10, 10, 16)).toEqual([]);
    expect(sampledTxPositions(10, 20, 0)).toEqual([]);
  });
});

describe('extrapolateSampledTransactions', () => {
  const samples = (counts: readonly number[]) =>
    counts.map((transactions, index) => ({ block: 100 + index, transactions }));

  it('scales the sampled sum up to the whole day', () => {
    const point = extrapolateSampledTransactions(
      0,
      7200,
      samples([3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9, 3]),
      8,
    );
    // Sum 80 over 16 samples of a 7200-block day: 80 × 450.
    expect(point).toEqual({ dayStart: 0, transactions: 36_000, samples: 16, blocksInDay: 7200 });
  });

  it('rescales by the resolved share, not the attempted count', () => {
    // 8 of 16 blocks answered (the minimum): the sum covers 8 sampled
    // blocks, so it scales by 7200/8.
    const point = extrapolateSampledTransactions(0, 7200, samples([2, 2, 2, 2, 3, 3, 3, 3]), 8);
    expect(point?.transactions).toBe(20 * 900);
    expect(point?.samples).toBe(8);
  });

  it('keeps a below-minimum day absent — a gap, never a zero', () => {
    expect(extrapolateSampledTransactions(0, 7200, samples([5, 5, 5, 5, 5, 5, 5]), 8)).toBeNull();
  });

  it('keeps a genuinely empty sampled day as real zero data', () => {
    // Eight answered samples that all hold 0 transactions extrapolate to
    // 0 — sampled data, not an unresolvable gap.
    expect(extrapolateSampledTransactions(0, 7200, samples([0, 0, 0, 0, 0, 0, 0, 0]), 8)).toEqual({
      dayStart: 0,
      transactions: 0,
      samples: 8,
      blocksInDay: 7200,
    });
  });

  it('scales days with uneven block counts by their own span', () => {
    // A 100-block day sampled at 3 blocks: sum 30 × (100/3) = 1000.
    const point = extrapolateSampledTransactions(0, 100, samples([10, 20, 0]), 3);
    expect(point).toEqual({ dayStart: 0, transactions: 1000, samples: 3, blocksInDay: 100 });
  });

  it('refuses degenerate spans', () => {
    expect(extrapolateSampledTransactions(0, 0, samples([1, 2, 3]), 1)).toBeNull();
    expect(extrapolateSampledTransactions(0, -5, samples([1]), 1)).toBeNull();
  });
});

describe('txSamplingLabel', () => {
  it('discloses the sampling basis verbatim', () => {
    expect(
      txSamplingLabel({
        txPerDay: [{ dayStart: 0, transactions: 1, samples: 16, blocksInDay: 7200 }],
        txSamplesPerDay: 16,
      }),
    ).toBe('extrapolated from 16 sampled blocks per day — counts, not indexer truth');
  });

  it('returns null with nothing sampled', () => {
    expect(txSamplingLabel({ txPerDay: [], txSamplesPerDay: 16 })).toBeNull();
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
  txCountCalls: number;
  txInFlight: number;
  txPeakInFlight: number;
  failHead: boolean;
  pre1559: boolean;
  /** Fail tx-count probes for exactly these block numbers. */
  txFailBlocks: Set<number>;
  txMethodUnsupported: boolean;
};

const weiOfGwei = (gwei: number): bigint => BigInt(Math.round(gwei * 1_000_000_000));

// Deterministic per-block transaction count for the synthetic chain.
const txCountOf = (block: number): number => (block % 150) + 10;

const makeFakeClient = (head = HEAD) => {
  const state: ClientState = {
    blockNumberCalls: 0,
    blockCalls: 0,
    feeCalls: 0,
    txCountCalls: 0,
    txInFlight: 0,
    txPeakInFlight: 0,
    failHead: false,
    pre1559: false,
    txFailBlocks: new Set(),
    txMethodUnsupported: false,
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
    getBlockTransactionCount: async ({ blockNumber }: { blockNumber: bigint }) => {
      state.txCountCalls += 1;
      state.txInFlight += 1;
      state.txPeakInFlight = Math.max(state.txPeakInFlight, state.txInFlight);
      try {
        // A microtask hop lets sibling pool workers overlap this probe,
        // so the concurrency cap is observable.
        await Promise.resolve();
        const n = Number(blockNumber);
        if (state.txMethodUnsupported) {
          throw new Error(
            'The method eth_getBlockTransactionCount does not exist/is not available',
          );
        }
        if (state.txFailBlocks.has(n)) {
          throw new Error('Request failed: eth_getBlockTransactionCountByNumber');
        }
        return txCountOf(n);
      } finally {
        state.txInFlight -= 1;
      }
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
    // The sampled tx/day series charted every day at full sample depth,
    // inside its whole-series RPC budget and its concurrency cap.
    expect(result.txUnavailableReason).toBeNull();
    expect(snapshot.txSamplesPerDay).toBe(TX_SAMPLES_PER_DAY);
    expect(snapshot.txPerDay).toHaveLength(CHART_DAY_COUNT);
    for (const day of snapshot.txPerDay) {
      expect(day.samples).toBe(TX_SAMPLES_PER_DAY);
      expect(day.blocksInDay).toBe(7200);
    }
    const firstTxDay = snapshot.txPerDay[0];
    const firstSpanStart = expectedBoundary(snapshot.gridDayStarts[0]);
    const firstSamples = sampledTxPositions(firstSpanStart, firstSpanStart + 7200, TX_SAMPLES_PER_DAY);
    expect(firstTxDay.transactions).toBe(
      Math.round(
        (firstSamples.reduce((total, block) => total + txCountOf(block), 0) * 7200) /
        TX_SAMPLES_PER_DAY,
      ),
    );
    expect(state.txCountCalls).toBe(CHART_DAY_COUNT * TX_SAMPLES_PER_DAY);
    expect(state.txCountCalls).toBeLessThanOrEqual(TX_SAMPLE_BUDGET);
    expect(state.txPeakInFlight).toBeLessThanOrEqual(4);
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

  it('leaves RPC-flaky tx samples as day gaps, never zeros', async () => {
    const { client, state } = makeFakeClient();
    // Two charted days on the synthetic chain's grid: one thinned below
    // the 8-sample minimum (absent), one thinned to 13 (kept, rescaled).
    const starts = boundaryDayStarts(FIXED_NOW);
    const thinDayStart = starts[10];
    const dropDayStart = starts[11];
    const spanOf = (dayStart: number) => {
      const start = expectedBoundary(dayStart);
      return sampledTxPositions(start, start + 7200, TX_SAMPLES_PER_DAY);
    };
    state.txFailBlocks = new Set([
      ...spanOf(thinDayStart).slice(0, 3),
      ...spanOf(dropDayStart).slice(0, 9),
    ]);
    mockCreateRpcClient.mockResolvedValue(client as unknown as PublicClient);

    const result = await fetchChartStats(1);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const { snapshot, txUnavailableReason } = result;
    expect(txUnavailableReason).toBeNull();
    expect(snapshot.txPerDay).toHaveLength(CHART_DAY_COUNT - 1);
    // The sub-minimum day is absent — no fabricated zero point.
    expect(snapshot.txPerDay.map(day => day.dayStart)).not.toContain(dropDayStart);
    // The thinned-but-viable day keeps its point, rescaled to its 13
    // answered samples: sum(13 counts) × 7200/13.
    const thinned = snapshot.txPerDay.find(day => day.dayStart === thinDayStart);
    expect(thinned?.samples).toBe(13);
    const answered = spanOf(thinDayStart).slice(3);
    expect(thinned?.transactions).toBe(
      Math.round(
        (answered.reduce((total, block) => total + txCountOf(block), 0) * 7200) / 13,
      ),
    );
    // Every sample was still attempted — flakiness spends the budget, it
    // does not shortcut it.
    expect(state.txCountCalls).toBe(CHART_DAY_COUNT * TX_SAMPLES_PER_DAY);
  });

  it('classifies a tx-count method gap while the boundary charts survive', async () => {
    const { client, state } = makeFakeClient();
    state.txMethodUnsupported = true;
    mockCreateRpcClient.mockResolvedValue(client as unknown as PublicClient);

    const result = await fetchChartStats(1);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.txUnavailableReason).toBe('method-not-supported');
    expect(result.snapshot.txPerDay).toEqual([]);
    expect(result.snapshot.txSamplesPerDay).toBe(TX_SAMPLES_PER_DAY);
    // The other series are unaffected.
    expect(result.snapshot.blocksPerDay).toHaveLength(CHART_DAY_COUNT);
    expect(result.snapshot.gasDaily).toHaveLength(CHART_DAY_COUNT);
    expect(result.gasUnavailableReason).toBeNull();
    expect(state.txCountCalls).toBe(CHART_DAY_COUNT * TX_SAMPLES_PER_DAY);
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
