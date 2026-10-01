/**
 * The explorer's own contract is that numeric counts leave the service as
 * real numbers; the OpenAPI schema types them `int()` and consumers do
 * arithmetic on them (e.g. EventStatistics compares totalEventsIndexed to
 * the previous poll to decide whether to refresh the events list).
 *
 * DuckDB surfaces `count(*)` through the custom adapter as a string/bigint,
 * which is why every sibling read normalizes with `Number()` (getContractEvents
 * carries an explicit note; countRangeEvents, EventExportService,
 * AddressScanService, ChainCacheService all normalize too). This test drives
 * the REAL adapter against an in-memory DuckDB so the driver's actual type
 * is what the assertions see — a mocked db could not catch this class.
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

vi.mock('@/database/init', async () => await import('@/database/drizzle'));

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

    const stats = await getEventStatistics(CHAIN_ID, ADDRESS as `0x${string}`);

    expect(stats.totalEvents).toBe(3);
    expect(typeof stats.totalEvents).toBe('number');
    expect(stats.eventsByType).toEqual({ Transfer: 2, Approval: 1 });
    expect(typeof stats.eventsByType.Transfer).toBe('number');
    expect(typeof stats.eventsByType.Approval).toBe('number');
  });

  it('getIndexingStatus returns a numeric totalEventsIndexed', async () => {
    await insertEvent('Transfer');
    await insertEvent('Transfer');

    const status = await getIndexingStatus(CHAIN_ID, ADDRESS as `0x${string}`);

    expect(status.totalEventsIndexed).toBe(2);
    expect(typeof status.totalEventsIndexed).toBe('number');
  });
});
