/**
 * EventStatistics coverage metric: progress is the union of covered range
 * intervals over the [min fromBlock, max toBlock] span — overlaps must not
 * double-count (sweep-merge), completed ranges count fully, and every
 * checkpointed range (indexing, paused, errored) counts its walked blocks.
 * These tests pin the sweep directly plus render-level checks that the bar
 * consumes the same endpoint as IndexingRangeManager, scopes the metric to
 * the configured ranges, and polls at the manager's 3s cadence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import EventStatistics, { computeIndexingCoverage } from '@/components/events/EventStatistics';
import { get } from '@/util/http';

vi.mock('@/util/http', () => ({
  get: vi.fn(),
}));

const range = (
  fromBlock: number | string,
  toBlock: number | string,
  status: 'pending' | 'indexing' | 'paused' | 'completed' | 'error',
  extra: { currentBlock?: number | string | null; direction?: 'forward' | 'backward' } = {},
) => ({
  fromBlock,
  toBlock,
  status,
  direction: extra.direction ?? 'forward',
  currentBlock: extra.currentBlock ?? null,
});

describe('computeIndexingCoverage', () => {
  it('returns zero for an empty range set', () => {
    expect(computeIndexingCoverage([])).toEqual({ coveredBlocks: 0, spanBlocks: 0, coverage: 0 });
  });

  it('does not double-count overlapping completed ranges', () => {
    // [0,100] and [50,150] overlap on [50,100]: union is 151 blocks, span 151.
    const result = computeIndexingCoverage([
      range(0, 100, 'completed'),
      range(50, 150, 'completed'),
    ]);
    expect(result.coveredBlocks).toBe(151);
    expect(result.spanBlocks).toBe(151);
    expect(result.coverage).toBe(100);
  });

  it('counts only the covered share when ranges do not span the full distance', () => {
    // Completed [0,100] (101 blocks) + pending [1000,2000] contributes nothing;
    // span is [0,2000] = 2001 blocks.
    const result = computeIndexingCoverage([range(0, 100, 'completed'), range(1000, 2000, 'pending')]);
    expect(result.coveredBlocks).toBe(101);
    expect(result.spanBlocks).toBe(2001);
    expect(result.coverage).toBeCloseTo((101 / 2001) * 100, 5);
  });

  it('counts the walked prefix of a forward-indexing range', () => {
    const result = computeIndexingCoverage([range(0, 1000, 'indexing', { currentBlock: 250 })]);
    expect(result.coveredBlocks).toBe(251);
  });

  it('counts the walked suffix of a backward-indexing range, not the prefix', () => {
    // Backward indexing walks down from toBlock: only [750,1000] is done.
    const result = computeIndexingCoverage([
      range(0, 1000, 'indexing', { currentBlock: 750, direction: 'backward' }),
    ]);
    expect(result.coveredBlocks).toBe(251);
  });

  it('counts the walked blocks of a paused range (~90% of its span)', () => {
    // Paused forward range [0,100] checkpointed at 90: [0,90] = 91 of 101.
    const result = computeIndexingCoverage([range(0, 100, 'paused', { currentBlock: 90 })]);
    expect(result.coveredBlocks).toBe(91);
    expect(result.spanBlocks).toBe(101);
    expect(result.coverage).toBeCloseTo((91 / 101) * 100, 5);
  });

  it('counts the walked blocks of an errored backward range, not the untouched prefix', () => {
    // Errored backward range [0,1000] checkpointed at 750: only [750,1000]
    // was walked before the failure.
    const result = computeIndexingCoverage([
      range(0, 1000, 'error', { currentBlock: 750, direction: 'backward' }),
    ]);
    expect(result.coveredBlocks).toBe(251);
  });

  it('merges a paused range into an overlapping completed range without double-counting', () => {
    // Completed [0,100] plus paused [50,150] checkpointed at 100 (walked
    // [50,100], already covered) — union stays 101 of the 151-block span.
    const result = computeIndexingCoverage([
      range(0, 100, 'completed'),
      range(50, 150, 'paused', { currentBlock: 100 }),
    ]);
    expect(result.coveredBlocks).toBe(101);
    expect(result.spanBlocks).toBe(151);
  });

  it('contributes nothing from pending or checkpoint-less paused ranges', () => {
    const result = computeIndexingCoverage([
      range(0, 100, 'pending'),
      range(200, 300, 'paused'),
      range(400, 500, 'error'),
    ]);
    expect(result.coveredBlocks).toBe(0);
    expect(result.coverage).toBe(0);
  });

  it('clips a runaway currentBlock to the range bounds', () => {
    const result = computeIndexingCoverage([range(0, 1000, 'indexing', { currentBlock: 5000 })]);
    expect(result.coveredBlocks).toBe(1001);
    expect(result.coverage).toBe(100);
  });

  it('accepts string block numbers from bigint JSON serialization', () => {
    const result = computeIndexingCoverage([
      range('18000000', '18001000', 'completed'),
      range('18000500', '18002000', 'indexing', { currentBlock: '18001000' }),
    ]);
    // Union: [18000000,18001000] completed (1001) + [18000500,18001000] walked
    // (501, fully contained in the completed part) = 1001; span 2001.
    expect(result.coveredBlocks).toBe(1001);
    expect(result.spanBlocks).toBe(2001);
  });
});

describe('EventStatistics coverage metric', () => {
  const ADDRESS = '0x1234567890123456789012345678901234567890';

  const mockEndpoints = (
    ranges: unknown[],
    status: 'idle' | 'indexing' = 'idle',
  ) => {
    vi.mocked(get).mockImplementation(async (url: string) => {
      if (url.endsWith('/events/ranges')) return { ranges };
      return {
        chainId: 1,
        contractAddress: ADDRESS,
        status,
        creationBlock: 0,
        lastIndexedBlock: 0,
        latestBlock: 0,
        totalEventsIndexed: 0,
        eventTypes: [],
      };
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders union coverage from the ranges endpoint, replacing the linear Blocks metric', async () => {
    // Completed [0,99] (100 blocks) + forward indexing [100,299] walked to
    // 199 (100 blocks) over a [0,299] span = 200/300 = 66.7%.
    mockEndpoints([
      range(0, 99, 'completed'),
      range(100, 299, 'indexing', { currentBlock: 199 }),
    ]);

    render(
      <EventStatistics chainId={1} contractAddress={ADDRESS as `0x${string}`} />,
    );

    expect(await screen.findByText(/Indexing coverage/)).toBeInTheDocument();
    expect(screen.getByText(/66\.7%/)).toBeInTheDocument();
    // The denominator hint keeps 100% from reading as "complete contract
    // history" — it is scoped to the configured ranges.
    expect(screen.getByText(/of your configured block ranges/)).toBeInTheDocument();
    expect(screen.queryByText(/Blocks:/)).toBeNull();
  });

  it('renders walked paused/error coverage alongside completed ranges', async () => {
    // Completed [0,99] (100) + paused [100,299] walked to 199 (100) over a
    // [0,299] span = 66.7% — a paused range contributes its walked blocks.
    mockEndpoints([
      range(0, 99, 'completed'),
      range(100, 299, 'paused', { currentBlock: 199 }),
    ]);

    render(
      <EventStatistics chainId={1} contractAddress={ADDRESS as `0x${string}`} />,
    );

    expect(await screen.findByText(/66\.7%/)).toBeInTheDocument();
  });

  it('polls both endpoints at the 3s cadence shared with IndexingRangeManager', async () => {
    vi.useFakeTimers();
    mockEndpoints([range(0, 1000, 'indexing', { currentBlock: 250 })], 'indexing');

    render(
      <EventStatistics chainId={1} contractAddress={ADDRESS as `0x${string}`} />,
    );

    // Settle the initial fetch under fake timers, then watch one tick land
    // exactly at 3s (the old 5s cadence would still be silent).
    await act(async () => {});
    expect(screen.getByText(/Indexing coverage/)).toBeInTheDocument();
    vi.mocked(get).mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(vi.mocked(get)).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(vi.mocked(get)).toHaveBeenCalledTimes(2); // status + ranges
  });

  it('polls at 3s when a range is indexing even if the aggregate status lags at idle', async () => {
    vi.useFakeTimers();
    mockEndpoints([range(0, 1000, 'indexing', { currentBlock: 250 })], 'idle');

    render(
      <EventStatistics chainId={1} contractAddress={ADDRESS as `0x${string}`} />,
    );

    await act(async () => {});
    vi.mocked(get).mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(vi.mocked(get)).toHaveBeenCalledTimes(2);
  });
});
