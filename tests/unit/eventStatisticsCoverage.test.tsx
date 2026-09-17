/**
 * EventStatistics coverage metric: progress is the union of covered range
 * intervals over the [min fromBlock, max toBlock] span — overlaps must not
 * double-count (sweep-merge), and only completed + walked indexing blocks
 * count. These tests pin the sweep directly plus one render-level check that
 * the bar consumes the same endpoint as IndexingRangeManager.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('contributes nothing from pending, paused, and errored ranges', () => {
    const result = computeIndexingCoverage([
      range(0, 100, 'paused', { currentBlock: 90 }),
      range(0, 100, 'error', { currentBlock: 90 }),
      range(0, 100, 'pending'),
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

  const mockEndpoints = (ranges: unknown[]) => {
    vi.mocked(get).mockImplementation(async (url: string) => {
      if (url.endsWith('/events/ranges')) return { ranges };
      return {
        chainId: 1,
        contractAddress: ADDRESS,
        status: 'idle' as const,
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
    expect(screen.queryByText(/Blocks:/)).toBeNull();
  });
});
