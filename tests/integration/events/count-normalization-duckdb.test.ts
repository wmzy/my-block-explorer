/**
 * The explorer's own contract is that numeric counts leave the service as
 * real numbers; the OpenAPI schema types them `int()` and consumers do
 * arithmetic on them (e.g. EventStatistics compares totalEventsIndexed to
 * the previous poll to decide whether to refresh the events list).
 *
 * DuckDB surfaces raw `count(*)` through the custom adapter as a
 * string/bigint; the services now select through drizzle's count() helper
 * and unwrap with sqlCountTotal, which is where that normalization lives.
 * This test drives the REAL adapter against an in-memory DuckDB so the
 * driver's actual type is what the assertions see — a mocked db could not
 * catch this class.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

vi.mock('@/database/init', async importOriginal => {
  const actual = await importOriginal<typeof import('@/database/init')>();
  const mocked = await import('@/database/drizzle');
  return { ...actual, ...mocked };
});

// getIndexingStatus touches the chain head; stub the gateway so the test
// never dials a real RPC (and stays deterministic offline).
vi.mock('@/services/RpcManager', () => ({
  rpcManager: {
    getClient: async () => ({ getBlockNumber: async () => 5000n }),
  },
}));

import { eq } from 'drizzle-orm';
import { db } from '@/database/drizzle';
import { contractEvents } from '@/database/schema';
import { getEventStatistics, getIndexingStatus } from '@/services/EventIndexingService';

const CHAIN_ID = 1;
const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

let txCounter = 0;
const nextTxHash = (): `0x${string}` => `0x${txCounter.toString(16).padStart(64, '0')}`;

const insertEvent = async (eventName: string): Promise<void> => {
  txCounter += 1;
  await db.insert(contractEvents).values({
    chainId: CHAIN_ID,
    contractAddress: ADDRESS,
    blockNumber: 1000n,
    transactionHash: nextTxHash(),
    logIndex: 0,
    eventName,
    eventSignature: '0x1111',
    decodedArgs: '{}',
    topic0: '0x1111',
  });
};

beforeEach(async () => {
  await db.delete(contractEvents).where(eq(contractEvents.chainId, CHAIN_ID));
  txCounter = 0;
});

describe('event statistics counts are numbers (real DuckDB driver)', () => {
  it('getEventStatistics returns numeric totalEvents and eventsByType counts', async () => {
    await insertEvent('Transfer');
    await insertEvent('Transfer');
    await insertEvent('Approval');

    const stats = await getEventStatistics(CHAIN_ID, ADDRESS);

    expect(stats.totalEvents).toBe(3);
    expect(typeof stats.totalEvents).toBe('number');
    expect(stats.eventsByType).toEqual({ Transfer: 2, Approval: 1 });
    expect(typeof stats.eventsByType.Transfer).toBe('number');
    expect(typeof stats.eventsByType.Approval).toBe('number');
  });

  it('getIndexingStatus returns a numeric totalEventsIndexed', async () => {
    await insertEvent('Transfer');
    await insertEvent('Transfer');

    const status = await getIndexingStatus(CHAIN_ID, ADDRESS);

    expect(status.totalEventsIndexed).toBe(2);
    expect(typeof status.totalEventsIndexed).toBe('number');
  });
});

describe('transaction counts are numbers (real DuckDB driver)', () => {
  // TransactionService feeds /api/stats/overview, whose cross-chain reduce
  // string-concatenated when a count leaked as a string — the same wire
  // contract as the events family above.
  it('getTransactionStats returns a numeric totalTransactions', async () => {
    const { createTransactionService } = await import('@/services/TransactionService');
    const { transactions, blocks } = await import('@/database/schema');
    const service = createTransactionService({
      db,
      transactions,
      blocks,
      rpcManager: {} as never,
    });

    // transactions PK is (chain_id, block_number, transaction_index).
    for (const [hash, transactionIndex] of [
      ['0x1', 0],
      ['0x2', 1],
    ] as const) {
      await db.insert(transactions).values({
        chainId: CHAIN_ID,
        hash: hash as `0x${string}`,
        blockNumber: 1000n,
        transactionIndex,
        gasPrice: 1n,
        gasUsed: 21000n,
        status: 1,
      });
    }

    const stats = await service.getTransactionStats(CHAIN_ID);

    expect(stats.totalTransactions).toBe(2);
    expect(typeof stats.totalTransactions).toBe('number');
    expect(stats.totalTransactions + 1).toBe(3);

    await db.delete(transactions).where(eq(transactions.chainId, CHAIN_ID));
  });
});
