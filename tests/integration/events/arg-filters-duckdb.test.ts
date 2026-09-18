/**
 * Service-level integration tests: server-side event arg filtering and CSV
 * export run against a real in-memory DuckDB (drizzle + custom adapter), so
 * the actual JSON-extraction SQL semantics are exercised end to end.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Swap the shared db for a fresh in-memory DuckDB so the real SQL filter
// semantics run without touching the developer database file.
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

// RpcManager (imported transitively by EventIndexingService) reads its config
// through this module; point it at the mocked db so no real file is opened.
vi.mock('@/database/init', async () => await import('@/database/drizzle'));

import { eq } from 'drizzle-orm';
import { db } from '@/database/drizzle';
import { contractEvents } from '@/database/schema';
import { getContractEvents } from '@/services/EventIndexingService';
import {
  buildEventsCsv,
  fetchFilteredEventsForExport,
  getFilteredEventCount,
} from '@/services/EventExportService';

const CHAIN_ID = 1;
const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_ADDRESS = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

let txCounter = 0;
const nextTxHash = (): `0x${string}` => `0x${txCounter.toString(16).padStart(64, '0')}`;
const insertEvent = async (overrides: Partial<typeof contractEvents.$inferInsert> = {}) => {
  txCounter += 1;
  await db.insert(contractEvents).values({
    chainId: CHAIN_ID,
    contractAddress: ADDRESS,
    blockNumber: 1000n,
    transactionHash: nextTxHash(),
    logIndex: 0,
    eventName: 'Transfer',
    eventSignature: '0x1111',
    decodedArgs: '{}',
    topic0: '0x1111',
    ...overrides,
  });
};

beforeEach(async () => {
  await db.delete(contractEvents).where(eq(contractEvents.chainId, CHAIN_ID));
  txCounter = 0;
});

describe('getContractEvents server-side arg filtering (DuckDB)', () => {
  it('filters by string arg case-insensitively and reports the filtered total', async () => {
    await insertEvent({ decodedArgs: '{"owner":"0xabc"}' });
    await insertEvent({ decodedArgs: '{"owner":"0xABC"}' });
    await insertEvent({ decodedArgs: '{"owner":"0xdef"}' });

    const result = await getContractEvents(CHAIN_ID, ADDRESS, {
      argFilters: { owner: '0xabc' },
    });

    expect(result.total).toBe(2);
    expect(result.events).toHaveLength(2);
    for (const event of result.events) {
      // Stored values may be upper- or lowercase; the match is case-insensitive.
      expect(event.decodedArgs?.toLowerCase()).toContain('"0xabc"');
      expect(event.decodedArgs?.toLowerCase()).not.toContain('0xdef');
    }
  });

  it('matches numeric args stored as strings and as JSON numbers', async () => {
    await insertEvent({ decodedArgs: '{"value":"1000"}' }); // indexer form
    await insertEvent({ decodedArgs: '{"value":1000}' }); // JSON-number storage
    await insertEvent({ decodedArgs: '{"value":"1000.0"}' }); // numeric variant
    await insertEvent({ decodedArgs: '{"value":"999"}' });

    const asNumber = await getContractEvents(CHAIN_ID, ADDRESS, {
      argFilters: { value: 1000 },
    });
    expect(asNumber.total).toBe(3);

    const asString = await getContractEvents(CHAIN_ID, ADDRESS, {
      argFilters: { value: '1000' },
    });
    expect(asString.total).toBe(3);
  });

  it('matches boolean args via their string form', async () => {
    await insertEvent({ decodedArgs: '{"flag":"true"}' });
    await insertEvent({ decodedArgs: '{"flag":"false"}' });

    const result = await getContractEvents(CHAIN_ID, ADDRESS, { argFilters: { flag: true } });
    expect(result.total).toBe(1);
    expect(JSON.parse(result.events[0].decodedArgs ?? '{}')).toEqual({ flag: 'true' });
  });

  it('AND-combines multiple arg filters', async () => {
    await insertEvent({ decodedArgs: '{"owner":"0xabc","value":"7"}' });
    await insertEvent({ decodedArgs: '{"owner":"0xabc","value":"8"}' });
    await insertEvent({ decodedArgs: '{"owner":"0xdef","value":"7"}' });

    const result = await getContractEvents(CHAIN_ID, ADDRESS, {
      argFilters: { owner: '0xabc', value: '7' },
    });

    expect(result.total).toBe(1);
    expect(result.events[0].decodedArgs).toContain('0xabc');
    expect(result.events[0].decodedArgs).toContain('"7"');
  });

  it('returns an empty result with total 0 when nothing matches', async () => {
    await insertEvent({ decodedArgs: '{"owner":"0xabc"}' });

    const result = await getContractEvents(CHAIN_ID, ADDRESS, {
      argFilters: { owner: '0xnope' },
    });

    expect(result.total).toBe(0);
    expect(result.events).toEqual([]);
    expect(result.totalPages).toBe(0);
  });

  it('paginates over the filtered set', async () => {
    for (let i = 0; i < 3; i++) {
      await insertEvent({ blockNumber: BigInt(1000 + i), decodedArgs: '{"owner":"0xabc"}' });
    }
    await insertEvent({ blockNumber: 2000n, decodedArgs: '{"owner":"0xdef"}' });

    const page1 = await getContractEvents(CHAIN_ID, ADDRESS, {
      page: 1,
      pageSize: 2,
      argFilters: { owner: '0xabc' },
    });
    const page2 = await getContractEvents(CHAIN_ID, ADDRESS, {
      page: 2,
      pageSize: 2,
      argFilters: { owner: '0xabc' },
    });

    expect(page1.total).toBe(3);
    expect(page1.totalPages).toBe(2);
    expect(page1.events).toHaveLength(2);
    expect(page2.events).toHaveLength(1);
  });

  it('filters by topic0 case-insensitively', async () => {
    await insertEvent({ topic0: '0xfeed' });
    await insertEvent({ topic0: '0xbeef' });

    const result = await getContractEvents(CHAIN_ID, ADDRESS, { topics: { topic0: '0xFEED' } });
    expect(result.total).toBe(1);
    expect(result.events[0].topic0).toBe('0xfeed');
  });

  it('combines eventName with argFilters', async () => {
    await insertEvent({
      eventName: 'Transfer',
      decodedArgs: '{"owner":"0xabc"}',
    });
    await insertEvent({
      eventName: 'Approval',
      decodedArgs: '{"owner":"0xabc"}',
    });

    const result = await getContractEvents(CHAIN_ID, ADDRESS, {
      eventName: 'Transfer',
      argFilters: { owner: '0xabc' },
    });
    expect(result.total).toBe(1);
    expect(result.events[0].eventName).toBe('Transfer');
  });

  it('ignores arg names that are not JSON-path-safe', async () => {
    await insertEvent({ decodedArgs: '{"owner":"0xabc"}' });
    await insertEvent({ decodedArgs: '{"owner":"0xdef"}' });

    // A dotted name would alter JSON path semantics, so the filter is skipped
    // rather than applied or crashed on.
    const result = await getContractEvents(CHAIN_ID, ADDRESS, {
      argFilters: { 'ow.ner': '0xabc' },
    });
    expect(result.total).toBe(2);
  });

  it('never matches rows with NULL or invalid JSON decoded_args', async () => {
    await insertEvent({ decodedArgs: null });
    await insertEvent({ decodedArgs: 'not json' });
    await insertEvent({ decodedArgs: '{"owner":"0xabc"}' });

    const result = await getContractEvents(CHAIN_ID, ADDRESS, {
      argFilters: { owner: '0xabc' },
    });
    expect(result.total).toBe(1);
  });
});

describe('CSV export queries (DuckDB)', () => {
  it('getFilteredEventCount agrees with the list total under the same filters', async () => {
    await insertEvent({ decodedArgs: '{"owner":"0xabc"}' });
    await insertEvent({ decodedArgs: '{"owner":"0xabc"}' });
    await insertEvent({ decodedArgs: '{"owner":"0xdef"}' });

    const filters = { argFilters: { owner: '0xabc' } };
    const list = await getContractEvents(CHAIN_ID, ADDRESS, filters);
    const count = await getFilteredEventCount(CHAIN_ID, ADDRESS, filters);

    expect(count).toBe(list.total);
    expect(count).toBe(2);
  });

  it('is scoped to the chain and contract', async () => {
    await insertEvent({ decodedArgs: '{"owner":"0xabc"}' });
    await insertEvent({
      contractAddress: OTHER_ADDRESS,
      decodedArgs: '{"owner":"0xabc"}',
    });

    const count = await getFilteredEventCount(CHAIN_ID, ADDRESS, {
      argFilters: { owner: '0xabc' },
    });
    expect(count).toBe(1);
  });

  it('orders rows newest-first and round-trips escaped CSV fields', async () => {
    const nasty = '{"note":"a,b","quote":"say ""hi""","text":"l1\nl2"}';
    await insertEvent({ blockNumber: 1000n, decodedArgs: nasty });
    await insertEvent({ blockNumber: 1002n, decodedArgs: '{"owner":"0xabc"}' });
    await insertEvent({ blockNumber: 1001n, decodedArgs: '{"owner":"0xdef"}' });
    await insertEvent({
      contractAddress: OTHER_ADDRESS,
      decodedArgs: '{"owner":"0xabc"}',
    });

    const rows = await fetchFilteredEventsForExport(CHAIN_ID, ADDRESS, {});
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.blockNumber)).toEqual([1002n, 1001n, 1000n]);

    const csv = buildEventsCsv(rows);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      'block_number,block_timestamp,tx_hash,log_index,event_name,decoded_args,address,is_finalized',
    );
    // The nasty decoded_args field is fully quoted with doubled quotes and the
    // embedded newline kept inside the quoted field.
    expect(csv).toContain(`"${nasty.replace(/"/g, '""')}"`);
    expect(csv.endsWith('\r\n')).toBe(true);

    // Plain hex cells (address) stay unquoted; the seeded rows are unfinalized
    // so is_finalized lands as the trailing false cell.
    expect(csv).toContain(`${ADDRESS},false\r\n`);
  });
});
