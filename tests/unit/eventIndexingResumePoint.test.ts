/**
 * Resume point selection: the walk's start position must come from the
 * checkpoint being PRESENT, not from its truthiness.
 *
 * `startIndexingRange` resumed with
 *
 *   currentBlock = range.currentBlock ? range.currentBlock - 1n : BigInt(resolvedToBlock)
 *
 * and `0n` is falsy, so a range checkpointed at block 0 was treated as
 * "never started". The reported bug: an indexing run interrupted exactly at
 * its first block (pause, RPC error, server restart — a `currentBlock: 0n`
 * row is written by the very first batch checkpoint of a forward range
 * starting at block 0, which is the shape every "Index all" range on a dev
 * chain has) re-indexes the whole window from the top on resume, issuing
 * thousands of pointless getLogs calls and re-inserting rows the upsert
 * already dedupes. The backward branch has the identical expression and the
 * identical hole.
 *
 * The sibling engine (AddressScanService) already distinguishes "no cursor"
 * explicitly (`cursor < 0n`), which is the contract these two branches need.
 *
 * Both directions are covered, plus the null (genuinely never started) case
 * that must keep starting from the range's own end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  getContractCreationBlock: vi.fn(),
}));

const logMocks = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }));

vi.mock('@/server/logger', () => ({ createLogger: () => logMocks }));

vi.mock('@/services/RpcManager', () => ({ rpcManager: { getClient: mocks.getClient } }));

vi.mock('@/utils/events', () => ({ getContractCreationBlock: mocks.getContractCreationBlock }));

const dbState = vi.hoisted(() => ({
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  updates: [] as Array<{ table: unknown; set: Record<string, unknown> }>,
  rawRangeRows: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/database/drizzle', async () => {
  const { indexingRanges, contractCreationInfo } = await import('@/database/schema');
  const S = dbState;
  const rowsFor = (table: unknown, ordered: boolean): Array<Record<string, unknown>> => {
    if (table === indexingRanges) {
      return (ordered ? [] : S.rawRangeRows).map(row => ({ ...row }));
    }
    if (table === contractCreationInfo) return [];
    return [];
  };
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

import { startIndexingRange } from '@/services/EventIndexingService';
import type { Abi, Log } from 'viem';

const CHAIN_ID = 1;
const ADDRESS = '0x1234567890123456789012345678901234567890' as `0x${string}`;
const EMPTY_ABI = [] as Abi;

const makeClient = (tip: bigint) => ({
  getBlockNumber: vi.fn(async (): Promise<bigint> => tip),
  getBlock: vi.fn(async () => ({ number: tip, timestamp: 1_700_000_000n })),
  getLogs: vi.fn(async (): Promise<Log[]> => []),
});

const rangeRow = (overrides: Record<string, unknown> = {}) => ({
  chainId: CHAIN_ID,
  address: ADDRESS,
  rangeId: 1,
  fromBlock: 0n,
  toBlock: 5_000n,
  direction: 'forward',
  currentBlock: null,
  status: 'paused',
  totalEventsIndexed: 0,
  errorMessage: null,
  priority: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const getLogsArgs = (client: { getLogs: { mock: { calls: unknown[][] } } }) =>
  client.getLogs.mock.calls.map(([args]) => args as { fromBlock: bigint; toBlock: bigint });

beforeEach(() => {
  dbState.inserts.length = 0;
  dbState.updates.length = 0;
  dbState.rawRangeRows.length = 0;
  logMocks.warn.mockClear();
  logMocks.error.mockClear();
  logMocks.info.mockClear();
  logMocks.debug.mockClear();
  mocks.getContractCreationBlock.mockReset().mockRejectedValue(new Error('no bytecode'));
});

describe('resume point when the checkpoint is block 0', () => {
  it('continues a forward range from block 1 instead of re-walking the window', async () => {
    dbState.rawRangeRows.push(rangeRow({ fromBlock: 0n, toBlock: 5_000n, currentBlock: 0n }));
    const client = makeClient(20_000_000n);
    mocks.getClient.mockReset().mockResolvedValue(client);

    const result = await startIndexingRange(CHAIN_ID, ADDRESS, 1, EMPTY_ABI);

    expect(result.success).toBe(true);
    const reads = getLogsArgs(client);
    expect(reads.length).toBeGreaterThan(0);
    // Blocks 1..5000 are the only unindexed ones; block 0 was done.
    expect(reads[0].fromBlock).toBe(1n);
    expect(reads[0].toBlock).toBeGreaterThan(0n);
    expect(reads.every(read => read.fromBlock > 0n)).toBe(true);
  });

  it('continues a backward range from block -1 side instead of re-walking to the tip', async () => {
    dbState.rawRangeRows.push(
      rangeRow({ fromBlock: 0n, toBlock: 5_000n, direction: 'backward', currentBlock: 0n }),
    );
    const client = makeClient(20_000_000n);
    mocks.getClient.mockReset().mockResolvedValue(client);

    const result = await startIndexingRange(CHAIN_ID, ADDRESS, 1, EMPTY_ABI);

    expect(result.success).toBe(true);
    // A backward range checkpointed at 0 has nothing left below it, so the
    // walk must not restart at the tip and read thousands of blocks.
    const reads = getLogsArgs(client);
    expect(reads.every(read => read.toBlock === 0n && read.fromBlock === 0n)).toBe(true);
  });

  it('still starts from the range end when no checkpoint exists at all', async () => {
    dbState.rawRangeRows.push(rangeRow({ fromBlock: 0n, toBlock: 5_000n, currentBlock: null }));
    const client = makeClient(20_000_000n);
    mocks.getClient.mockReset().mockResolvedValue(client);

    const result = await startIndexingRange(CHAIN_ID, ADDRESS, 1, EMPTY_ABI);

    expect(result.success).toBe(true);
    const reads = getLogsArgs(client);
    // Forward from fromBlock: 0 is genuinely unindexed here.
    expect(reads[0].fromBlock).toBe(0n);
  });
});
