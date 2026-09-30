/**
 * Range write concurrency contract:
 * - the indexing loop's own writes (checkpoint, completion, error) are
 *   compare-and-set on status = 'indexing': a loop whose row was flipped
 *   out of the live state underneath it (foreign pause / status write)
 *   must not resurrect 'indexing' over the new status, nor mark
 *   'completed' a range someone else moved — its writes silently no-op,
 * - the happy path is unaffected: a normally-walked range still ends
 *   'completed' with its checkpoint advanced,
 * - updateRangeStatus refuses flips on rows in the live 'indexing' state
 *   (the loop's CAS writes own the row until it settles).
 *
 * Runs against a real in-memory DuckDB (the adapter auto-applies drizzle/*)
 * so the guarded UPDATEs are exercised as SQL, with a gated getLogs client
 * that parks the loop mid-batch for the concurrent-flip scenario.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/database/drizzle', async () => {
  const { createDuckDBAdapter } = await import('@/database/duckdb-postgres-adapter');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const schema = await import('@/database/schema');
  const db = drizzle(createDuckDBAdapter('duckdb://:memory:'), {
    schema,
    casing: 'snake_case',
  });
  return { db, ...schema };
});

vi.mock('@/database/init', async () => await import('@/database/drizzle'));

const mocks = vi.hoisted(() => ({
  client: {},
}));

vi.mock('@/services/RpcManager', () => ({
  rpcManager: { getClient: async () => mocks.client },
}));

import { and, eq } from 'drizzle-orm';
import { db } from '@/database/drizzle';
import { indexingRanges } from '@/database/schema';
import {
  startIndexingRange,
  updateRangeStatus,
} from '@/services/EventIndexingService';
import type { Abi, PublicClient } from 'viem';

const CHAIN_ID = 1;
const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EMPTY_ABI = [] as Abi;

// Unique per test: tests share one in-memory database (PK includes
// range_id), so every inserted range needs its own id.
let rangeCounter = 0;
const uniqueRangeId = (): number => {
  rangeCounter += 1;
  return rangeCounter;
};

const insertRange = async (overrides: Record<string, unknown> = {}) => {
  const rows = await db
    .insert(indexingRanges)
    .values({
      chainId: CHAIN_ID,
      address: ADDRESS,
      rangeId: uniqueRangeId(),
      fromBlock: 0n,
      toBlock: 100n,
      direction: 'forward',
      currentBlock: null,
      status: 'pending',
      totalEventsIndexed: 0,
      errorMessage: null,
      priority: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    })
    .returning({ rangeId: indexingRanges.rangeId });
  return rows[0].rangeId;
};

const getRange = async (rangeId: number) => {
  const rows = await db
    .select()
    .from(indexingRanges)
    .where(
      and(
        eq(indexingRanges.chainId, CHAIN_ID),
        eq(indexingRanges.address, ADDRESS),
        eq(indexingRanges.rangeId, rangeId),
      ),
    );
  return rows[0] ?? null;
};

// Client whose getLogs parks on a test-controlled gate; every call logs
// its span so tests can assert the walk actually tiled the range.
const gatedClient = (gate: Promise<void>) =>
  ({
    getLogs: vi.fn(async () => {
      await gate;
      return [];
    }),
    getBlock: vi.fn(async ({ blockNumber }: { blockTag?: string; blockNumber?: bigint }) => ({
      number: blockNumber ?? 0n,
      timestamp: 0n,
    })),
    getBlockNumber: vi.fn(async () => 100n),
  }) as unknown as PublicClient;

describe('startIndexingRange compare-and-set writes', () => {
  it('refuses checkpoint and completion writes on a row flipped out of indexing', async () => {
    let releaseLogs!: () => void;
    const gate = new Promise<void>(resolve => {
      releaseLogs = resolve;
    });
    const client = gatedClient(gate);
    mocks.client = client;

    const rangeId = await insertRange({ fromBlock: 0n, toBlock: 3999n });

    const startDone = startIndexingRange(CHAIN_ID, ADDRESS, rangeId, EMPTY_ABI);

    // Park point: the claim write landed and the loop is inside getLogs.
    await vi.waitFor(async () => {
      expect((await getRange(rangeId))?.status).toBe('indexing');
      expect(client.getLogs).toHaveBeenCalled();
    });

    // Foreign writer (another process sharing the DB, or any writer that
    // moved the row out of the live state): pause the range mid-walk.
    await db
      .update(indexingRanges)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(
        and(
          eq(indexingRanges.chainId, CHAIN_ID),
          eq(indexingRanges.address, ADDRESS),
          eq(indexingRanges.rangeId, rangeId),
        ),
      );

    releaseLogs();
    const result = await startDone;

    // The loop finished its walk (draining) but every CAS-guarded write
    // no-opped: the foreign 'paused' verdict, checkpoint and counts all
    // survive untouched.
    expect(result.success).toBe(true);
    const row = await getRange(rangeId);
    expect(row?.status).toBe('paused');
    expect(row?.currentBlock).toBeNull();
    expect(row?.errorMessage).toBeNull();
    expect(row?.totalEventsIndexed ?? 0).toBe(0);
    // The walk really covered both batches before the final write was
    // refused — the CAS refused the write, not the walk.
    expect(client.getLogs).toHaveBeenCalledTimes(2);
  });

  it('still completes a normally-walked range (claim and final writes land)', async () => {
    let releaseLogs!: () => void;
    const gate = new Promise<void>(resolve => {
      releaseLogs = resolve;
    });
    releaseLogs();
    mocks.client = gatedClient(gate);

    const rangeId = await insertRange({ fromBlock: 0n, toBlock: 100n });

    const result = await startIndexingRange(CHAIN_ID, ADDRESS, rangeId, EMPTY_ABI);

    expect(result.success).toBe(true);
    const row = await getRange(rangeId);
    expect(row?.status).toBe('completed');
    expect(row?.currentBlock).toBe(100n);
    expect(row?.errorMessage).toBeNull();
  });
});

describe('updateRangeStatus live-state guard', () => {
  it('refuses to flip a range that is currently indexing', async () => {
    const rangeId = await insertRange({ status: 'indexing' });

    const result = await updateRangeStatus(CHAIN_ID, ADDRESS, rangeId, 'completed');

    expect(result.success).toBe(false);
    expect(result.error).toContain('currently indexing');
    expect((await getRange(rangeId))?.status).toBe('indexing');
  });

  it('still flips settled rows', async () => {
    const rangeId = await insertRange({ status: 'error' });

    const result = await updateRangeStatus(CHAIN_ID, ADDRESS, rangeId, 'completed');

    expect(result.success).toBe(true);
    expect((await getRange(rangeId))?.status).toBe('completed');
  });
});
