/**
 * Unit tests for the pure CSV row formatter in EventExportService.
 */

import { describe, it, expect, vi } from 'vitest';

// buildEventsCsv never touches the db; stub it so importing the module does
// not pull RpcManager's import-time config query against a real database.
vi.mock('@/database/drizzle', () => ({
  db: {
    select: () => ({ from: () => Promise.resolve([]) }),
  },
}));

import { buildEventsCsv, type CsvEventRow } from '@/services/EventExportService';

const row = (overrides: Partial<CsvEventRow> = {}): CsvEventRow => ({
  blockNumber: 100n,
  blockTimestamp: 1700000000,
  transactionHash: '0xabc',
  logIndex: 3,
  eventName: 'Transfer',
  decodedArgs: '{"owner":"0xabc"}',
  address: '0xdef',
  isFinalized: true,
  ...overrides,
});

describe('buildEventsCsv', () => {
  it('emits the header row even with no data', () => {
    expect(buildEventsCsv([])).toBe(
      'block_number,block_timestamp,tx_hash,log_index,event_name,decoded_args,address,is_finalized\r\n',
    );
  });

  it('renders plain fields unquoted', () => {
    const csv = buildEventsCsv([row()]);
    const dataLine = csv.split('\r\n')[1];
    // decodedArgs contains quotes, so RFC 4180 requires quoting + doubling.
    expect(dataLine).toBe(
      '100,2023-11-14T22:13:20.000Z,0xabc,3,Transfer,"{""owner"":""0xabc""}",0xdef,true',
    );
  });

  it('quotes fields containing commas, quotes, or newlines and doubles embedded quotes', () => {
    const csv = buildEventsCsv([
      row({ eventName: 'A,B', decodedArgs: '{"q":"say ""hi""","nl":"l1\nl2"}' }),
    ]);
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine).toBe(
      '100,2023-11-14T22:13:20.000Z,0xabc,3,"A,B","{""q"":""say """"hi"""""",""nl"":""l1\nl2""}",0xdef,true',
    );
    // Round-trip through a naive RFC 4180 consumer keeps the original values.
    const quoted = dataLine.match(/"([^"]*(?:""[^"]*)*)"/g) ?? [];
    expect(quoted).toContain('"A,B"');
  });

  it('renders null timestamps/eventName/decodedArgs as empty cells', () => {
    const csv = buildEventsCsv([row({ blockTimestamp: null, eventName: null, decodedArgs: null })]);
    expect(csv.split('\r\n')[1]).toBe('100,,0xabc,3,,,0xdef,true');
  });

  it('renders is_finalized as true/false, empty when unknown', () => {
    const finalized = buildEventsCsv([row({ isFinalized: true })]);
    expect(finalized.split('\r\n')[1].endsWith(',true')).toBe(true);

    const unfinalized = buildEventsCsv([row({ isFinalized: false })]);
    expect(unfinalized.split('\r\n')[1].endsWith(',false')).toBe(true);

    const unknown = buildEventsCsv([row({ isFinalized: null })]);
    expect(unknown.split('\r\n')[1].endsWith(',')).toBe(true);
  });

  it('accepts string and Date timestamps besides unix seconds', () => {
    const fromString = buildEventsCsv([row({ blockTimestamp: '2024-01-02T03:04:05.000Z' })]);
    expect(fromString.split('\r\n')[1]).toContain('2024-01-02T03:04:05.000Z');

    const fromDate = buildEventsCsv([row({ blockTimestamp: new Date(1700000000 * 1000) })]);
    expect(fromDate.split('\r\n')[1]).toContain('2023-11-14T22:13:20.000Z');

    const invalid = buildEventsCsv([row({ blockTimestamp: 'not a date' })]);
    expect(invalid.split('\r\n')[1].split(',')[1]).toBe('');
  });

  it('renders numeric block numbers and log indexes verbatim', () => {
    const csv = buildEventsCsv([row({ blockNumber: 18000001, logIndex: 0 })]);
    expect(csv.split('\r\n')[1].startsWith('18000001,')).toBe(true);
    expect(csv.split('\r\n')[1]).toContain(',0xabc,0,');
  });
});
