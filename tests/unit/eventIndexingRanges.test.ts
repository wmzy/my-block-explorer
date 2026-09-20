/**
 * Range-bound semantics of EventIndexingService:
 * - block tags materialize to concrete numbers before storage (no sentinel
 *   rows are written; Contract D),
 * - legacy sentinel rows are resolved defensively when indexing starts, so
 *   getLogs never runs with negative bounds,
 * - an unknown creation block is never fabricated (Contract C): Index All
 *   starts at the real creation block or genesis, First errors explicitly,
 * - catchup extends the furthest indexed block to the chain tip (Contract B).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  getContractCreationBlock: vi.fn(),
}));

vi.mock('@/services/RpcManager', () => ({
  rpcManager: { getClient: mocks.getClient },
}));

// getContractCreationBlockCached probes the chain through this helper; the
// mock decides per test whether creation is known (resolves) or unknown
// (rejects -> the cache returns null).
vi.mock('@/utils/events', () => ({
  getContractCreationBlock: mocks.getContractCreationBlock,
}));

// Factory mock without importOriginal: loading the real drizzle module would
// open the DuckDB file. The chainable builders below cover every query shape
// the range functions use; selects are routed by table identity.
const dbState = vi.hoisted(() => ({
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  updates: [] as Array<{ table: unknown; set: Record<string, unknown> }>,
  creationInfoRows: [] as Array<Record<string, unknown>>,
  orderedRangeRows: [] as Array<Record<string, unknown>>,
  rawRangeRows: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/database/drizzle', async () => {
  const { indexingRanges, contractCreationInfo } = await import('@/database/schema');
  const S = dbState;

  const rowsFor = (table: unknown, ordered: boolean): Array<Record<string, unknown>> => {
    if (table === indexingRanges) {
      const rows = ordered ? S.orderedRangeRows : S.rawRangeRows;
      return rows.map(r => ({ ...r }));
    }
    if (table === contractCreationInfo) {
      return S.creationInfoRows.map(r => ({ ...r }));
    }
    return [];
  };

  // Drizzle query builders are thenable; awaiting resolves the routed rows.
  const selectBuilder = (withFields: boolean) => {
    const state = { table: undefined as unknown, ordered: false };
    const b: Record<string, unknown> = {
      from: (t: unknown) => {
        state.table = t;
        return b;
      },
      where: () => b,
      limit: () => b,
      orderBy: () => {
        state.ordered = true;
        return b;
      },
      then: (res: unknown, rej: unknown) =>
        Promise.resolve(withFields ? [{ maxId: 0 }] : rowsFor(state.table, state.ordered)).then(
          res as never,
          rej as never,
        ),
    };
    return b;
  };

  const insertBuilder = (table: unknown) => {
    const b: Record<string, unknown> = {
      values: (v: Record<string, unknown>) => {
        S.inserts.push({ table, values: v });
        return b;
      },
      onConflictDoUpdate: () => b,
      then: (res: unknown, rej: unknown) => Promise.resolve([]).then(res as never, rej as never),
    };
    return b;
  };

  const updateBuilder = (table: unknown) => {
    const b: Record<string, unknown> = {
      set: (s: Record<string, unknown>) => {
        S.updates.push({ table, set: s });
        return b;
      },
      where: () => b,
      then: (res: unknown, rej: unknown) => Promise.resolve([]).then(res as never, rej as never),
    };
    return b;
  };

  return {
    db: {
      select: (...args: unknown[]) => selectBuilder(args.length > 0),
      insert: (t: unknown) => insertBuilder(t),
      update: (t: unknown) => updateBuilder(t),
      delete: () => ({ where: () => Promise.resolve([]) }),
    },
  };
});

import {
  addIndexingRange,
  updateIndexingRange,
  startIndexingRange,
  createRangeAll,
  createRangeFirst,
  createRangeContinue,
  createRangeCatchup,
} from '@/services/EventIndexingService';
import { indexingRanges } from '@/database/schema';
import type { Abi } from 'viem';

const CHAIN_ID = 1;
const ADDRESS = '0x1234567890123456789012345678901234567890' as `0x${string}`;
const EMPTY_ABI = [] as Abi;

// One chain-tip-per-test client: 'latest'/'finalized' tags and getBlockNumber
// all resolve to `tip`, so tests control the resolved toBlock concretely.
const makeClient = (tip: bigint) => ({
  getBlockNumber: vi.fn(async () => tip),
  getBlock: vi.fn(async () => ({ number: tip })),
  getLogs: vi.fn(async (_args: { address: `0x${string}`; fromBlock: bigint; toBlock: bigint }) => []),
});

const rangeRow = (overrides: Record<string, unknown> = {}) => ({
  chainId: CHAIN_ID,
  address: ADDRESS,
  rangeId: 1,
  fromBlock: 100n,
  toBlock: 200n,
  direction: 'forward',
  currentBlock: null,
  status: 'pending',
  totalEventsIndexed: 0,
  errorMessage: null,
  priority: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const lastInsert = () => dbState.inserts.at(-1);
const lastUpdateSet = () => dbState.updates.at(-1)?.set;

beforeEach(() => {
  dbState.inserts.length = 0;
  dbState.updates.length = 0;
  dbState.creationInfoRows.length = 0;
  dbState.orderedRangeRows.length = 0;
  dbState.rawRangeRows.length = 0;
  mocks.getClient.mockReset().mockResolvedValue(makeClient(20_000_000n));
  // Default: creation unknown (probe fails) unless a test opts into known.
  mocks.getContractCreationBlock.mockReset().mockRejectedValue(new Error('no bytecode'));
});

describe('addIndexingRange stores only concrete numbers', () => {
  it('materializes block tags at creation time (earliest/latest -> 0/tip)', async () => {
    const result = await addIndexingRange(CHAIN_ID, ADDRESS, {
      fromBlock: 'earliest',
      toBlock: 'latest',
    });

    expect(result.success).toBe(true);
    expect(result.rangeId).toBe(1);
    expect(lastInsert()?.table).toBe(indexingRanges);
    expect(lastInsert()?.values.fromBlock).toBe(0n);
    expect(lastInsert()?.values.toBlock).toBe(20_000_000n);
  });

  it('stores numeric bounds unchanged', async () => {
    const result = await addIndexingRange(CHAIN_ID, ADDRESS, { fromBlock: 100, toBlock: 200 });

    expect(result.success).toBe(true);
    expect(lastInsert()?.values.fromBlock).toBe(100n);
    expect(lastInsert()?.values.toBlock).toBe(200n);
  });

  it('rejects a start before a known creation block, without storing a row', async () => {
    dbState.creationInfoRows.push({ creationBlockNumber: 5000n });

    const result = await addIndexingRange(CHAIN_ID, ADDRESS, { fromBlock: 50, toBlock: 200 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('(5000)');
    expect(dbState.inserts).toHaveLength(0);
  });

  it('accepts any start when the creation block is unknown', async () => {
    const result = await addIndexingRange(CHAIN_ID, ADDRESS, { fromBlock: 0, toBlock: 200 });

    expect(result.success).toBe(true);
    expect(lastInsert()?.values.fromBlock).toBe(0n);
  });

  it('clamps a numeric toBlock beyond the chain head and reports the truncation', async () => {
    // Tip is 20,000,000: a numeric 25M toBlock cannot exist on this chain.
    const result = await addIndexingRange(CHAIN_ID, ADDRESS, {
      fromBlock: 100,
      toBlock: 25_000_000,
    });

    expect(result.success).toBe(true);
    expect(lastInsert()?.values.fromBlock).toBe(100n);
    expect(lastInsert()?.values.toBlock).toBe(20_000_000n);
    expect(result.truncatedToBlock).toBe(20_000_000);
    // The resolved bounds ride along so quick creators report real bounds.
    expect(result.fromBlock).toBe(100);
    expect(result.toBlock).toBe(20_000_000);
  });

  it('rejects a numeric range entirely at or beyond the head, without storing a row', async () => {
    const result = await addIndexingRange(CHAIN_ID, ADDRESS, {
      fromBlock: 20_000_000,
      toBlock: 25_000_000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('fromBlock must be below the chain head');
    expect(dbState.inserts).toHaveLength(0);
  });

  it('never truncates a tag-resolved toBlock (tags resolve at or below the head)', async () => {
    const result = await addIndexingRange(CHAIN_ID, ADDRESS, { fromBlock: 0, toBlock: 'latest' });

    expect(result.success).toBe(true);
    expect(result.truncatedToBlock).toBeUndefined();
    expect(lastInsert()?.values.toBlock).toBe(20_000_000n);
  });
});

describe('updateIndexingRange materializes bounds', () => {
  it('resolves a legacy sentinel row to concrete numbers on update', async () => {
    dbState.rawRangeRows.push(rangeRow({ fromBlock: -4n, toBlock: -1n }));

    const result = await updateIndexingRange(CHAIN_ID, ADDRESS, 1, { toBlock: 5000 });

    expect(result.success).toBe(true);
    expect(lastUpdateSet()?.fromBlock).toBe(0n);
    expect(lastUpdateSet()?.toBlock).toBe(5000n);
  });

  it('resolves block tags passed as updates', async () => {
    dbState.rawRangeRows.push(rangeRow({ fromBlock: 100n, toBlock: 200n }));

    const result = await updateIndexingRange(CHAIN_ID, ADDRESS, 1, { toBlock: 'latest' });

    expect(result.success).toBe(true);
    expect(lastUpdateSet()?.fromBlock).toBe(100n);
    expect(lastUpdateSet()?.toBlock).toBe(20_000_000n);
  });

  it('rejects an update before a known creation block, without writing', async () => {
    dbState.creationInfoRows.push({ creationBlockNumber: 5000n });
    dbState.rawRangeRows.push(rangeRow());

    const result = await updateIndexingRange(CHAIN_ID, ADDRESS, 1, { fromBlock: 10 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('(5000)');
    expect(dbState.updates).toHaveLength(0);
  });
});

describe('startIndexingRange resolves legacy sentinel rows', () => {
  it('never calls getLogs with negative bounds for a sentinel row', async () => {
    dbState.rawRangeRows.push(
      rangeRow({ fromBlock: -4n, toBlock: -1n, currentBlock: null }),
    );
    const client = makeClient(12_345n);
    mocks.getClient.mockReset().mockResolvedValue(client);

    const result = await startIndexingRange(CHAIN_ID, ADDRESS, 1, EMPTY_ABI);

    expect(result.success).toBe(true);
    expect(client.getLogs.mock.calls.length).toBeGreaterThan(0);
    for (const [args] of client.getLogs.mock.calls) {
      expect(args.fromBlock).toBeGreaterThanOrEqual(0n);
      expect(args.toBlock).toBeGreaterThanOrEqual(0n);
    }
    // earliest -> 0, latest sentinel -> the chain tip.
    expect(client.getLogs.mock.calls[0][0].fromBlock).toBe(0n);
    expect(client.getLogs.mock.calls.at(-1)?.[0].toBlock).toBe(12_345n);
    // Completed at the resolved tip with concrete progress recorded.
    expect(lastUpdateSet()).toMatchObject({ currentBlock: 12_345n, status: 'completed' });
  });
});

describe('createRangeAll (Index All)', () => {
  it('starts exactly at a known creation block', async () => {
    dbState.creationInfoRows.push({ creationBlockNumber: 5_000_000n });

    // 5M -> 20M is a 15M-block span: past the full-history gate, so the
    // confirmation rides along to preserve the test's intent.
    const result = await createRangeAll(CHAIN_ID, ADDRESS, { confirmFullHistory: true });

    expect(result.success).toBe(true);
    expect(lastInsert()?.values.fromBlock).toBe(5_000_000n);
    expect(lastInsert()?.values.toBlock).toBe(20_000_000n);
  });

  it('starts from genesis when the creation block is unknown', async () => {
    // 20M blocks of span — confirmed, so the genesis start is exercised
    // rather than the gate.
    const result = await createRangeAll(CHAIN_ID, ADDRESS, { confirmFullHistory: true });

    expect(result.success).toBe(true);
    expect(lastInsert()?.values.fromBlock).toBe(0n);
    expect(lastInsert()?.values.toBlock).toBe(20_000_000n);
  });
});

describe('createRangeAll full-history gate', () => {
  it('refuses an unconfirmed full-history span without storing a row', async () => {
    // Tip 20M, creation unknown -> a 20M-block span from genesis.
    const result = await createRangeAll(CHAIN_ID, ADDRESS);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('full-history-unconfirmed');
    expect(result.spanBlocks).toBe(20_000_000);
    expect(result.fromBlock).toBe(0);
    expect(result.head).toBe(20_000_000);
    expect(result.error).toContain('20,000,000');
    expect(dbState.inserts).toHaveLength(0);
  });

  it('indexes the full history once explicitly confirmed', async () => {
    const result = await createRangeAll(CHAIN_ID, ADDRESS, { confirmFullHistory: true });

    expect(result.success).toBe(true);
    expect(lastInsert()?.values.fromBlock).toBe(0n);
    expect(lastInsert()?.values.toBlock).toBe(20_000_000n);
  });

  it('skips the gate when the span is at most a million blocks', async () => {
    // Creation at 19,999,500 -> a 500-block span: no confirmation needed.
    dbState.creationInfoRows.push({ creationBlockNumber: 19_999_500n });

    const result = await createRangeAll(CHAIN_ID, ADDRESS);

    expect(result.success).toBe(true);
    expect(lastInsert()?.values.fromBlock).toBe(19_999_500n);
  });
});

describe('createRangeFirst (First N blocks)', () => {
  it('errors explicitly when the creation block is unknown', async () => {
    const result = await createRangeFirst(CHAIN_ID, ADDRESS, 100);

    expect(result).toEqual({
      success: false,
      error: 'Contract creation block unknown — enter a start block manually',
    });
    expect(dbState.inserts).toHaveLength(0);
  });

  it('spans creation block to creation block + blockCount when known', async () => {
    dbState.creationInfoRows.push({ creationBlockNumber: 5000n });

    const result = await createRangeFirst(CHAIN_ID, ADDRESS, 100);

    expect(result.success).toBe(true);
    expect(lastInsert()?.values.fromBlock).toBe(5000n);
    expect(lastInsert()?.values.toBlock).toBe(5100n);
  });
});

describe('createRangeContinue (Continue N blocks)', () => {
  it('continues from the furthest existing toBlock, not the first listed range', async () => {
    // First row by ordering ends at 200; the furthest range ends at 900 —
    // continuing from ranges[0] would silently skip 200..900.
    dbState.orderedRangeRows.push(
      rangeRow({ rangeId: 1, fromBlock: 10n, toBlock: 200n }),
      rangeRow({ rangeId: 2, fromBlock: 500n, toBlock: 900n }),
    );

    const result = await createRangeContinue(CHAIN_ID, ADDRESS, 100);

    expect(result.success).toBe(true);
    expect(lastInsert()?.values.fromBlock).toBe(900n);
    expect(lastInsert()?.values.toBlock).toBe(1000n);
  });

  it('fails with the contract error when no previous range exists', async () => {
    const result = await createRangeContinue(CHAIN_ID, ADDRESS, 100);

    expect(result).toEqual({
      success: false,
      error: 'No previous range found. Cannot continue.',
    });
    expect(dbState.inserts).toHaveLength(0);
  });
});

describe('createRangeCatchup (Catch up to tip)', () => {
  it('extends from the furthest indexed block to the chain tip', async () => {
    // First row by ordering is NOT the furthest: catchup must take the max
    // toBlock across every existing range, inclusive start.
    dbState.orderedRangeRows.push(
      rangeRow({ rangeId: 1, fromBlock: 10n, toBlock: 100n }),
      rangeRow({ rangeId: 2, fromBlock: 500n, toBlock: 900n }),
    );

    const result = await createRangeCatchup(CHAIN_ID, ADDRESS);

    expect(result.success).toBe(true);
    expect(lastInsert()?.values.fromBlock).toBe(900n);
    expect(lastInsert()?.values.toBlock).toBe(20_000_000n);
  });

  it('fails with the contract error when no previous range exists', async () => {
    const result = await createRangeCatchup(CHAIN_ID, ADDRESS);

    expect(result).toEqual({
      success: false,
      error: 'No previous range found. Cannot catch up.',
    });
    expect(dbState.inserts).toHaveLength(0);
  });
});
