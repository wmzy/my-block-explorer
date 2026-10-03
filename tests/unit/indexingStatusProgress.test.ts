// The event-indexing RANGE summary is the progress surface the UI polls
// every 3s (EventStatistics + IndexingRangeManager both read it). Two
// arithmetic defects lived in `getIndexingStatus`'s range aggregation, both
// from treating block numbers as if they were half-open:
//
//   1. `rangeSize = toBlock - fromBlock` — a range from 0 to 0 covers ONE
//      block, not zero. The aggregate denominator was short by one per
//      range (so totalProgress could never reach 100%), and a completed
//      range contributed `rangeSize` covered blocks while the walk had
//      actually covered `rangeSize + 1`.
//   2. `progress = (currentBlock - fromBlock) / rangeSize` — the walk
//      persists the LAST block a batch covered (batchTo forward, batchFrom
//      backward), so the walked count is inclusive of the checkpoint. A
//      range that had walked exactly its first block (a checkpoint at
//      block 0, the shape of every genesis-anchored range) reported 0/0 =
//      0% and could never be distinguished from "never started".
//
// Both halves are driven through the REAL service against a mocked db /
// rpc, so the assertions read the payload the API actually serves.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  // Rows served by each of the three selects the function runs, in call order.
  supportingRows: [] as unknown[][],
  selectCall: 0,
}));

// EventIndexingService reads `db` from database/drizzle (the schema tables
// come from database/schema and are plain column definitions — no mock
// needed). Mocking the wrong module silently runs the REAL DuckDB, which
// answers zero rows and makes every assertion look like a service bug.
vi.mock('@/database/drizzle', () => ({
  db: {
    select: () => {
      const rows = mocks.supportingRows[mocks.selectCall] ?? [];
      mocks.selectCall += 1;
      const node: Record<string, unknown> = {};
      for (const method of ['from', 'where', 'orderBy', 'limit', 'groupBy']) {
        node[method] = () => node;
      }
      node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject);
      return node;
    },
  },
}));

vi.mock('@/services/RpcManager', () => ({
  rpcManager: { getClient: vi.fn().mockResolvedValue({ getBlockNumber: vi.fn().mockResolvedValue(30_000n) }) },
}));

import { getIndexingStatus } from '@/services/EventIndexingService';

const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;

const rangeRow = (fields: {
  rangeId: number;
  status: string;
  fromBlock: bigint;
  toBlock: bigint;
  currentBlock: bigint | null;
  direction: string;
}) => ({ chainId: 1, address: ADDRESS, priority: 0, createdAt: new Date(0), ...fields });

const loadWith = (ranges: ReturnType<typeof rangeRow>[]) => {
  mocks.selectCall = 0;
  // select order: indexingProgress row, event types, event count, ranges.
  mocks.supportingRows = [[], [], [{ count: '0' }], ranges];
};

beforeEach(() => {
  loadWith([]);
});

describe('getIndexingStatus — range progress arithmetic', () => {
  it('counts the checkpointed block, so a range that walked its first block is not 0%', async () => {
    // Forward, 0..1000, checkpointed at 0: exactly one block walked.
    loadWith([rangeRow({ rangeId: 1, status: 'indexing', fromBlock: 0n, toBlock: 1000n, currentBlock: 0n, direction: 'forward' })]);

    const status = await getIndexingStatus(1, ADDRESS);

    const range = status.ranges[0];
    expect(range.progress).toBeGreaterThan(0);
    expect(range.progress).toBeCloseTo((1 / 1001) * 100, 6);
  });

  it('reaches 100% for a completed range and never exceeds it', async () => {
    loadWith([rangeRow({ rangeId: 1, status: 'completed', fromBlock: 0n, toBlock: 1000n, currentBlock: 1000n, direction: 'forward' })]);

    const status = await getIndexingStatus(1, ADDRESS);

    expect(status.ranges[0].progress).toBe(100);
    expect(status.totalProgress).toBe(100);
  });

  it('reports a fully walked backward range (checkpoint at genesis) as 100%', async () => {
    // Backward walks from toBlock down to fromBlock; a checkpoint at 0 means
    // the whole span is covered.
    loadWith([rangeRow({ rangeId: 1, status: 'paused', fromBlock: 0n, toBlock: 1000n, currentBlock: 0n, direction: 'backward' })]);

    const status = await getIndexingStatus(1, ADDRESS);

    expect(status.ranges[0].progress).toBe(100);
  });

  it('reports a genuinely unstarted range as 0%', async () => {
    loadWith([rangeRow({ rangeId: 1, status: 'pending', fromBlock: 0n, toBlock: 1000n, currentBlock: null, direction: 'forward' })]);

    const status = await getIndexingStatus(1, ADDRESS);

    expect(status.ranges[0].progress).toBe(0);
    expect(status.totalProgress).toBe(0);
  });
});
