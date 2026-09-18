/**
 * Reorg reconciliation (real in-memory DuckDB + stubbed RPC client):
 * - unfinalized rows at or below the finalized head are receipt-verified:
 *   vanished logs (missing receipt, or receipt without that logIndex) are
 *   deleted, verified rows promoted, transient fetch failures left for a
 *   later pass — RPC noise must never delete good rows;
 * - verification is capped per pass, oldest first;
 * - the startup hook (reconcileInterruptedRanges) sweeps every contract with
 *   unfinalized rows;
 * - range completion stores a distinct COUNT as totalEventsIndexed instead of
 *   tallying insert attempts (overlap re-walks would double-count).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ getClient: vi.fn() }));

vi.mock('@/services/RpcManager', () => ({
  rpcManager: { getClient: mocks.getClient },
}));

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

import { and, eq, sql } from 'drizzle-orm';
import { TransactionReceiptNotFoundError, type Abi } from 'viem';
import { db } from '@/database/drizzle';
import { contractEvents, indexingRanges } from '@/database/schema';
import {
  REORG_RECONCILE_ROW_CAP,
  reconcileReorgedEvents,
  reconcileAllReorgedEvents,
  reconcileInterruptedRanges,
  startIndexingRange,
} from '@/services/EventIndexingService';

const CHAIN_ID = 1;
const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_ADDRESS = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const txHashOf = (n: number): `0x${string}` => `0x${n.toString(16).padStart(64, '0')}`;

// Finalized head served for the 'finalized' block tag.
let finalizedHead = 500n;

// Per-tx receipt behavior: log indexes present in the receipt, or a failure.
const receipts = new Map<`0x${string}`, number[] | 'missing' | 'transport-error'>();

type GetLogsArgs = { address: `0x${string}`; fromBlock: bigint; toBlock: bigint };

const stubClient = {
  getBlock: vi.fn(async (args: { blockTag?: string; blockNumber?: bigint }) =>
    args.blockNumber !== undefined
      ? { number: args.blockNumber, timestamp: 1_700_000_000n }
      : { number: finalizedHead },
  ),
  getBlockNumber: vi.fn(async () => finalizedHead),
  getTransactionReceipt: vi.fn(async ({ hash }: { hash: `0x${string}` }) => {
    const behavior = receipts.get(hash);
    if (behavior === undefined) throw new Error(`unexpected receipt request for ${hash}`);
    if (behavior === 'missing') throw new TransactionReceiptNotFoundError({ hash });
    if (behavior === 'transport-error') throw new Error('node unreachable');
    return { logs: behavior.map(logIndex => ({ logIndex })) };
  }),
  getLogs: vi.fn(async (_args: GetLogsArgs) => [] as unknown[]),
};

const insertEvent = async (overrides: Partial<typeof contractEvents.$inferInsert> = {}) => {
  await db.insert(contractEvents).values({
    chainId: CHAIN_ID,
    contractAddress: ADDRESS,
    blockNumber: 100n,
    transactionHash: txHashOf(900_000_000 + Math.floor(Math.random() * 1_000_000)),
    logIndex: 0,
    ...overrides,
  });
};

const insertRange = async (overrides: Partial<typeof indexingRanges.$inferInsert> = {}) => {
  await db.insert(indexingRanges).values({
    chainId: CHAIN_ID,
    address: ADDRESS,
    rangeId: 1,
    fromBlock: 0n,
    toBlock: 100n,
    direction: 'forward',
    currentBlock: null,
    status: 'pending',
    totalEventsIndexed: 0,
    errorMessage: null,
    priority: 0,
    ...overrides,
  });
};

const fetchRow = async (txHash: `0x${string}`, logIndex: number) => {
  const rows = await db
    .select()
    .from(contractEvents)
    .where(
      and(
        eq(contractEvents.chainId, CHAIN_ID),
        eq(contractEvents.transactionHash, txHash),
        eq(contractEvents.logIndex, logIndex),
      ),
    );
  return rows[0] ?? null;
};

beforeEach(async () => {
  await db.delete(contractEvents);
  await db.delete(indexingRanges);
  receipts.clear();
  finalizedHead = 500n;
  stubClient.getBlock.mockClear();
  stubClient.getBlockNumber.mockClear();
  stubClient.getTransactionReceipt.mockClear();
  stubClient.getLogs = vi.fn(async (_args: GetLogsArgs) => [] as unknown[]);
  mocks.getClient.mockReset().mockResolvedValue(stubClient);
});

describe('reconcileReorgedEvents', () => {
  it('deletes reorged-out rows, promotes verified rows, leaves everything else', async () => {
    const present = txHashOf(1);
    const gone = txHashOf(2);
    const logMoved = txHashOf(3);
    const flaky = txHashOf(4);
    const aboveHead = txHashOf(5);
    const alreadyFinal = txHashOf(6);
    receipts.set(present, [0]);
    receipts.set(gone, 'missing');
    // Receipt exists but no longer carries logIndex 5: the log was reorged out.
    receipts.set(logMoved, [1, 2]);
    receipts.set(flaky, 'transport-error');

    await insertEvent({ transactionHash: present, logIndex: 0, blockNumber: 100n });
    await insertEvent({ transactionHash: gone, logIndex: 0, blockNumber: 110n });
    await insertEvent({ transactionHash: logMoved, logIndex: 5, blockNumber: 120n });
    await insertEvent({ transactionHash: flaky, logIndex: 0, blockNumber: 130n });
    await insertEvent({ transactionHash: aboveHead, logIndex: 0, blockNumber: 900n });
    await insertEvent({
      transactionHash: alreadyFinal,
      logIndex: 0,
      blockNumber: 105n,
      isFinalized: true,
    });

    const result = await reconcileReorgedEvents(CHAIN_ID, ADDRESS);

    expect(result).toEqual({ inspected: 4, deleted: 2, promoted: 1 });
    expect((await fetchRow(present, 0))?.isFinalized).toBe(true);
    expect(await fetchRow(gone, 0)).toBeNull();
    expect(await fetchRow(logMoved, 5)).toBeNull();
    // Inconclusive receipt fetch: row survives untouched (NULL stays NULL —
    // the adapter maps omitted defaults to NULL), retried on a later pass.
    expect((await fetchRow(flaky, 0))?.isFinalized).toBeNull();
    // Above the finalized head: not this pass's business.
    expect((await fetchRow(aboveHead, 0))?.isFinalized).toBeNull();
    // Already finalized: untouched.
    expect((await fetchRow(alreadyFinal, 0))?.isFinalized).toBe(true);
  });

  it('caps verification per pass, oldest first; later passes drain the rest', async () => {
    finalizedHead = 1_000n;
    const total = REORG_RECONCILE_ROW_CAP + 100;
    // One tx carrying every log index: every inspected row verifies.
    const tx = txHashOf(1);
    receipts.set(tx, Array.from({ length: total }, (_, i) => i));

    for (let i = 0; i < total; i++) {
      await insertEvent({ transactionHash: tx, logIndex: i, blockNumber: BigInt(i + 1) });
    }

    const first = await reconcileReorgedEvents(CHAIN_ID, ADDRESS);
    expect(first.inspected).toBe(REORG_RECONCILE_ROW_CAP);
    expect(first.promoted).toBe(REORG_RECONCILE_ROW_CAP);

    const unfinalized = await db
      .select()
      .from(contractEvents)
      .where(
        and(
          eq(contractEvents.chainId, CHAIN_ID),
          sql`coalesce(${contractEvents.isFinalized}, false) = false`,
        ),
      );
    expect(unfinalized).toHaveLength(100);
    // The promoted rows were the oldest ones.
    expect(unfinalized.every(r => r.blockNumber > BigInt(REORG_RECONCILE_ROW_CAP))).toBe(true);

    const second = await reconcileReorgedEvents(CHAIN_ID, ADDRESS);
    expect(second).toEqual({ inspected: 100, deleted: 0, promoted: 100 });
  });
});

describe('reconcileAllReorgedEvents', () => {
  it('sweeps every contract that has unfinalized rows', async () => {
    const ok = txHashOf(1);
    const reorged = txHashOf(2);
    receipts.set(ok, [0]);
    receipts.set(reorged, 'missing');
    await insertEvent({ transactionHash: ok, blockNumber: 100n });
    await insertEvent({
      transactionHash: reorged,
      blockNumber: 110n,
      contractAddress: OTHER_ADDRESS,
    });

    await reconcileAllReorgedEvents();

    expect((await fetchRow(ok, 0))?.isFinalized).toBe(true);
    expect(await fetchRow(reorged, 0)).toBeNull();
  });

  it('runs on startup through reconcileInterruptedRanges', async () => {
    const ok = txHashOf(1);
    receipts.set(ok, [0]);
    await insertEvent({ transactionHash: ok, blockNumber: 100n });
    await insertRange({ status: 'indexing' });

    await reconcileInterruptedRanges();

    // Both startup duties ran: the stranded range flipped to error...
    const ranges = await db.select().from(indexingRanges);
    expect(ranges[0].status).toBe('error');
    // ...and the unfinalized row below the finalized head was promoted.
    expect((await fetchRow(ok, 0))?.isFinalized).toBe(true);
  });
});

describe('startIndexingRange completion', () => {
  it('stores the distinct count as totalEventsIndexed, not attempted inserts', async () => {
    finalizedHead = 10_000n;

    const transferAbi = [
      {
        type: 'event',
        name: 'Transfer',
        inputs: [
          { name: 'from', type: 'address', indexed: true },
          { name: 'to', type: 'address', indexed: true },
          { name: 'value', type: 'uint256', indexed: false },
        ],
      },
    ] as unknown as Abi;

    const topic0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const topicFor = (addr: string) => `0x${'00'.repeat(12)}${addr.slice(2)}` as `0x${string}`;
    const makeLog = (blockNumber: number, txNum: number) => ({
      blockNumber: BigInt(blockNumber),
      transactionHash: txHashOf(txNum),
      transactionIndex: 0,
      logIndex: 0,
      address: ADDRESS,
      topics: [topic0, topicFor(ADDRESS), topicFor(OTHER_ADDRESS)],
      data: `0x${'64'.repeat(32)}`,
    });

    // The chain already holds 3 events in 100..200 from an earlier run. The
    // range resumes from a stale checkpoint at block 100 with that run's
    // total still persisted, so the re-walk re-attempts all 3 (conflicts)
    // plus one new event at block 200.
    await insertEvent({ transactionHash: txHashOf(11), blockNumber: 120n });
    await insertEvent({ transactionHash: txHashOf(12), blockNumber: 150n });
    await insertEvent({ transactionHash: txHashOf(13), blockNumber: 180n });
    receipts.set(txHashOf(11), [0]);
    receipts.set(txHashOf(12), [0]);
    receipts.set(txHashOf(13), [0]);

    stubClient.getLogs = vi.fn(async ({ fromBlock, toBlock }: GetLogsArgs) =>
      [makeLog(120, 11), makeLog(150, 12), makeLog(180, 13), makeLog(200, 14)].filter(
        l => l.blockNumber >= fromBlock && l.blockNumber <= toBlock,
      ),
    );

    await insertRange({
      rangeId: 1,
      fromBlock: 100n,
      toBlock: 200n,
      currentBlock: 100n,
      status: 'error',
      totalEventsIndexed: 3,
    });

    const result = await startIndexingRange(CHAIN_ID, ADDRESS, 1, transferAbi);
    expect(result.success).toBe(true);

    const ranges = await db.select().from(indexingRanges);
    expect(ranges[0].status).toBe('completed');
    // 4 distinct stored events in 100..200 — not 3 persisted + 4 attempted.
    expect(ranges[0].totalEventsIndexed).toBe(4);
    expect(
      await db.select().from(contractEvents).where(eq(contractEvents.chainId, CHAIN_ID)),
    ).toHaveLength(4);

    // The post-completion reconciliation pass ran against the same contract:
    // the pre-seeded unfinalized rows below the head were promoted.
    expect((await fetchRow(txHashOf(11), 0))?.isFinalized).toBe(true);
  });
});
