/**
 * Range-bound semantics of EventIndexingService:
 * - block tags materialize to concrete numbers before storage (no sentinel
 *   rows are written; Contract D),
 * - legacy sentinel rows are resolved defensively when indexing starts, so
 *   getLogs never runs with negative bounds,
 * - an unknown creation block is never fabricated (Contract C): Index All
 *   starts at the real creation block or genesis, First errors explicitly,
 * - catchup extends the furthest indexed block to the chain tip (Contract B),
 * - insert durability: only duplicate-class row errors are skippable; any
 *   other insert failure fails the range (status 'error') WITHOUT advancing
 *   the checkpoint, so a resume replays the batch instead of losing rows,
 * - provider range caps: a shrinkable getLogs error halves the span, keeps
 *   tiling the window without gaps, and the learned per-chain ceiling makes
 *   later batches (and later jobs) start small.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  getContractCreationBlock: vi.fn(),
}));

// createLogger children share these spies: the service's insert-failure and
// duplicate-skip decisions must be observable (and pino must stay silent in
// test output). The alias resolves to the same file the service imports
// relatively, so the mock intercepts both.
const logMocks = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/server/logger', () => ({
  createLogger: () => logMocks,
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
  // What a getNextRangeId select (coalesce(max(range_id), 0)) reports;
  // bumpable by tests to simulate a concurrent insert landing between the
  // read and the write.
  maxId: 0,
  // Optional per-insert-call rejection: consulted when the builder is
  // awaited, so tests can fail the chunk insert, the row retry, or both.
  insertReject: null as null | ((table: unknown, values: unknown) => Error | null),
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
        Promise.resolve(
          withFields ? [{ maxId: S.maxId }] : rowsFor(state.table, state.ordered),
        ).then(res as never, rej as never),
    };
    return b;
  };

  const insertBuilder = (table: unknown) => {
    let lastValues: unknown = undefined;
    const b: Record<string, unknown> = {
      values: (v: Record<string, unknown>) => {
        lastValues = v;
        S.inserts.push({ table, values: v });
        return b;
      },
      onConflictDoUpdate: () => b,
      then: (res: unknown, rej: unknown) => {
        const err = S.insertReject ? S.insertReject(table, lastValues) : null;
        const settled = err ? Promise.reject(err) : Promise.resolve([]);
        return settled.then(res as never, rej as never);
      },
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
import type { Abi, Log } from 'viem';

const CHAIN_ID = 1;
const ADDRESS = '0x1234567890123456789012345678901234567890' as `0x${string}`;
const EMPTY_ABI = [] as Abi;

// One chain-tip-per-test client: 'latest'/'finalized' tags and getBlockNumber
// all resolve to `tip`, so tests control the resolved toBlock concretely.
const makeClient = (tip: bigint) => ({
  getBlockNumber: vi.fn(async (): Promise<bigint> => tip),
  getBlock: vi.fn(async () => ({ number: tip, timestamp: 1_700_000_000n })),
  getLogs: vi.fn(
    async (
      _args: { address: `0x${string}`; fromBlock: bigint; toBlock: bigint },
    ): Promise<Log[]> => [],
  ),
});

// A minimal decodable Transfer event so decodeLogs produces real rows and
// insertEvents is actually exercised (empty-ABI logs decode to nothing and
// would skip the insert path entirely).
const TRANSFER_ABI = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { type: 'address', name: 'from', indexed: true },
      { type: 'uint256', name: 'value', indexed: true },
    ],
  },
] as Abi;

const TRANSFER_TOPIC0 =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as `0x${string}`;

const makeLog = (blockNumber: number, logIndex = 0): Log =>
  ({
    address: ADDRESS,
    blockNumber: BigInt(blockNumber),
    blockHash: `0x${'ab'.repeat(32)}`,
    transactionHash: `0x${'cd'.repeat(32)}`,
    transactionIndex: 0,
    logIndex,
    removed: false,
    data: '0x',
    topics: [
      TRANSFER_TOPIC0,
      `0x${'11'.repeat(20)}`,
      `0x${'22'.repeat(32)}`,
    ],
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
  dbState.maxId = 0;
  dbState.insertReject = null;
  logMocks.warn.mockClear();
  logMocks.error.mockClear();
  logMocks.info.mockClear();
  logMocks.debug.mockClear();
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

describe('addIndexingRange range-id race (read-then-insert)', () => {
  // Two concurrent adds for the same (chain, address) both mint
  // max(range_id)+1; the loser's insert dies on the range PK (23505).
  // The service must recompute once and retry once — and still error
  // honestly if the duplicate class persists.
  const duplicateError = () => {
    const err = new Error(
      'Constraint Error: Duplicate key "1:0x1234..:1" violates primary key constraint',
    ) as Error & { code?: string };
    err.code = '23505';
    return err;
  };

  it('recomputes the id once and retries the insert after losing the race', async () => {
    // The concurrent winner's row lands between our read and our insert:
    // our first insert (rangeId 1) hits the PK, and the re-read now sees
    // the winner's row as max(range_id).
    dbState.insertReject = (table, values) => {
      if (
        table === indexingRanges &&
        (values as { rangeId?: number }).rangeId === 1 &&
        dbState.maxId === 0
      ) {
        dbState.maxId = 1;
        return duplicateError();
      }
      return null;
    };

    const result = await addIndexingRange(CHAIN_ID, ADDRESS, { fromBlock: 100, toBlock: 200 });

    expect(result.success).toBe(true);
    expect(result.rangeId).toBe(2);
    const rangeInserts = dbState.inserts.filter(i => i.table === indexingRanges);
    expect(rangeInserts).toHaveLength(2);
    expect(rangeInserts[1]?.values.rangeId).toBe(2);
  });

  it('errors honestly when the retry hits a duplicate-class failure again', async () => {
    dbState.insertReject = table => {
      if (table === indexingRanges) return duplicateError();
      return null;
    };

    await expect(
      addIndexingRange(CHAIN_ID, ADDRESS, { fromBlock: 100, toBlock: 200 }),
    ).rejects.toThrow(/Duplicate key/);
    // Exactly one recompute + one retry — no retry loop.
    const rangeInserts = dbState.inserts.filter(i => i.table === indexingRanges);
    expect(rangeInserts).toHaveLength(2);
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
    dbState.rawRangeRows.push(rangeRow({ fromBlock: -4n, toBlock: -1n, currentBlock: null }));
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

describe('insert durability: row insert errors', () => {
  it('a non-constraint row error fails the range, error-logs, and never advances the checkpoint', async () => {
    dbState.rawRangeRows.push(rangeRow({ fromBlock: 100n, toBlock: 200n }));
    const client = makeClient(20_000_000n);
    client.getLogs.mockImplementation(async () => [makeLog(100)]);
    mocks.getClient.mockResolvedValue(client);
    // Every contract_events insert fails with a lock error — the exact class
    // the old blanket catch used to swallow while the range 'completed'.
    dbState.insertReject = () => new Error('IO Error: lock conflict');

    const result = await startIndexingRange(CHAIN_ID, ADDRESS, 1, TRANSFER_ABI);

    // The failure surfaces instead of silently completing.
    expect(result.success).toBe(false);
    expect(result.error).toContain('lock conflict');
    const errorUpdate = dbState.updates.find(u => u.set.status === 'error');
    expect(errorUpdate).toBeDefined();
    expect(errorUpdate?.set.errorMessage).toContain('lock conflict');
    expect(logMocks.error).toHaveBeenCalled();
    // Checkpoint discipline: no update ever carried a currentBlock, so the
    // failed batch was NOT recorded as done — a resume replays it.
    for (const u of dbState.updates) {
      expect(u.set.currentBlock).toBeUndefined();
    }
  });

  it('a chunk-level failure with a passing row retry still stores the rows', async () => {
    dbState.rawRangeRows.push(rangeRow({ fromBlock: 100n, toBlock: 200n }));
    const client = makeClient(20_000_000n);
    client.getLogs.mockImplementation(async () => [makeLog(100)]);
    mocks.getClient.mockResolvedValue(client);
    // Chunk insert fails (batch aborts), single-row insert succeeds.
    let chunkFailed = false;
    dbState.insertReject = (_table, values) => {
      if (Array.isArray(values) && values.length > 1 && !chunkFailed) {
        chunkFailed = true;
        return new Error('[23505] Constraint Error: Duplicate key violates constraint');
      }
      return null;
    };

    const result = await startIndexingRange(CHAIN_ID, ADDRESS, 1, TRANSFER_ABI);

    expect(result.success).toBe(true);
    expect(dbState.updates.at(-1)?.set.status).toBe('completed');
    const rowInserts = dbState.inserts.filter(
      i => Array.isArray(i.values) && i.values.length === 1,
    );
    expect(rowInserts).toHaveLength(1);
  });

  it('skips genuine duplicate-key row errors and completes the range', async () => {
    dbState.rawRangeRows.push(rangeRow({ fromBlock: 100n, toBlock: 200n }));
    const client = makeClient(20_000_000n);
    client.getLogs.mockImplementation(async () => [makeLog(100)]);
    mocks.getClient.mockResolvedValue(client);
    // Chunk AND row inserts fail with the duckdb duplicate shape: dedup is
    // legitimate (the row already exists under the PK), so the row is
    // skipped, warned about, and the range still completes.
    dbState.insertReject = () =>
      new Error('Constraint Error: Duplicate key "1:0xcd..:0" violates primary key constraint');

    const result = await startIndexingRange(CHAIN_ID, ADDRESS, 1, TRANSFER_ABI);

    expect(result.success).toBe(true);
    expect(dbState.updates.at(-1)?.set.status).toBe('completed');
    expect(dbState.updates.some(u => u.set.status === 'error')).toBe(false);
    expect(logMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ transactionHash: `0x${'cd'.repeat(32)}`, logIndex: 0 }),
      'Skipped duplicate event row',
    );
  });

  it('an adapter-coded unique violation (code 23505, terse message) is also dedup', async () => {
    dbState.rawRangeRows.push(rangeRow({ fromBlock: 100n, toBlock: 200n }));
    const client = makeClient(20_000_000n);
    client.getLogs.mockImplementation(async () => [makeLog(100)]);
    mocks.getClient.mockResolvedValue(client);
    dbState.insertReject = () => {
      const err = new Error('insert failed') as Error & { code?: string };
      err.code = '23505';
      return err;
    };

    const result = await startIndexingRange(CHAIN_ID, ADDRESS, 1, TRANSFER_ABI);

    expect(result.success).toBe(true);
    expect(dbState.updates.at(-1)?.set.status).toBe('completed');
  });
});

describe('getLogs provider range-cap adaptation', () => {
  // Distinct chain ids per test: the learned ceiling map is module-level
  // state inside the service and must not leak between tests.
  const CAP_CHAIN = 7701;

  const cappedClient = (tip: bigint, cap: bigint, served: Array<{ from: bigint; to: bigint }>) => {
    const client = makeClient(tip);
    client.getLogs.mockImplementation(async ({ fromBlock, toBlock }) => {
      if (toBlock - fromBlock + 1n > cap) {
        throw new Error('Limit exceeded: block range too large for this provider');
      }
      served.push({ from: fromBlock, to: toBlock });
      return [];
    });
    return client;
  };

  it('halves the span on a range-cap error, tiles the window without gaps, and reuses the ceiling', async () => {
    const served: Array<{ from: bigint; to: bigint }> = [];
    const client = cappedClient(20_000_000n, 500n, served);
    mocks.getClient.mockResolvedValue(client);
    // Two BATCH_SIZE windows: [0,1999] and [2000,3999].
    dbState.rawRangeRows.push(rangeRow({ fromBlock: 0n, toBlock: 3_999n }));

    const result = await startIndexingRange(CAP_CHAIN, ADDRESS, 1, EMPTY_ABI);

    expect(result.success).toBe(true);
    const spans = client.getLogs.mock.calls.map(([args]) => args.toBlock - args.fromBlock + 1n);
    // First window shrank 2000 -> 1000 -> 500 before succeeding.
    expect(spans.slice(0, 3)).toEqual([2000n, 1000n, 500n]);
    // Every subsequent call — including the whole second window — starts at
    // the remembered 500-block ceiling, never back at 2000.
    for (const span of spans.slice(3)) {
      expect(span).toBe(500n);
    }
    // No silent loss: the successful spans tile [0, 3999] contiguously.
    expect(served[0]?.from).toBe(0n);
    expect(served.at(-1)?.to).toBe(3_999n);
    for (let i = 1; i < served.length; i++) {
      expect(served[i].from).toBe(served[i - 1].to + 1n);
    }
  });

  it('a later job on the same chain starts at the remembered ceiling', async () => {
    const served: Array<{ from: bigint; to: bigint }> = [];
    const chainId = CAP_CHAIN + 1;
    const client1 = cappedClient(20_000_000n, 500n, served);
    mocks.getClient.mockResolvedValue(client1);
    dbState.rawRangeRows.push(rangeRow({ fromBlock: 0n, toBlock: 1_999n }));
    await startIndexingRange(chainId, ADDRESS, 1, EMPTY_ABI);

    // Second job, same chain, fresh client: the ceiling (500) must be
    // applied to its very first getLogs instead of re-failing at 2000.
    const served2: Array<{ from: bigint; to: bigint }> = [];
    const client2 = cappedClient(20_000_000n, 500n, served2);
    mocks.getClient.mockResolvedValue(client2);
    dbState.rawRangeRows.length = 0;
    dbState.rawRangeRows.push(rangeRow({ rangeId: 2, fromBlock: 100_000n, toBlock: 101_999n }));

    const result = await startIndexingRange(chainId, ADDRESS, 2, EMPTY_ABI);

    expect(result.success).toBe(true);
    const firstCall = client2.getLogs.mock.calls[0][0];
    expect(firstCall.fromBlock).toBe(100_000n);
    expect(firstCall.toBlock - firstCall.fromBlock + 1n).toBe(500n);
  });
});
