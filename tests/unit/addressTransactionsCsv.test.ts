// Pure CSV serializer for the address-transactions export (header order,
// RFC 4180 escaping, empty-case honesty). AddressExportService imports
// nothing — no db mocks needed (unlike eventExportCsv.test.ts).
import { describe, it, expect } from 'vitest';
import { buildAddressTransactionsCsv, type CsvAddressTxRow } from '@/services/AddressExportService';

const row = (overrides: Partial<CsvAddressTxRow> = {}): CsvAddressTxRow => ({
  hash: '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1',
  blockNumber: 18_000_001n,
  fromAddress: '0x1111111111111111111111111111111111111111',
  toAddress: '0x2222222222222222222222222222222222222222',
  value: '1000000000000000000',
  timestamp: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

describe('buildAddressTransactionsCsv', () => {
  it('emits the fixed header even with no rows (a valid empty download)', () => {
    expect(buildAddressTransactionsCsv([])).toBe(
      'hash,block_number,from,to,value_wei,timestamp,status\r\n',
    );
  });

  it('renders plain fields unquoted with CRLF terminator', () => {
    const csv = buildAddressTransactionsCsv([row()]);
    const lines = csv.split('\r\n');
    // Trailing terminator → header + data + trailing empty element.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('hash,block_number,from,to,value_wei,timestamp,status');
    expect(lines[1]).toBe(
      '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1,'
      + '18000001,'
      + '0x1111111111111111111111111111111111111111,'
      + '0x2222222222222222222222222222222222222222,'
      + '1000000000000000000,'
      + '2024-01-01T00:00:00.000Z,'
      + '',
    );
    expect(lines[2]).toBe('');
  });

  it('leaves status empty when discovery carries none — never a fabricated verdict', () => {
    // Heuristic discovery reads block data without receipts, so the most
    // common export has no status. The column stays declared, cells empty.
    const csv = buildAddressTransactionsCsv([row({ status: undefined })]);
    expect(csv.split('\r\n')[1].endsWith(',')).toBe(true);
  });

  it('renders a status when the row carries one', () => {
    const csv = buildAddressTransactionsCsv([row({ status: 1 })]);
    expect(csv.split('\r\n')[1].endsWith(',1')).toBe(true);
    const failed = buildAddressTransactionsCsv([row({ status: 0 })]);
    expect(failed.split('\r\n')[1].endsWith(',0')).toBe(true);
  });

  it('quotes fields containing commas, quotes or newlines and doubles embedded quotes', () => {
    // Timestamps pass through Date parsing (unparseable → empty cell), so
    // escaping is pinned on the verbatim string fields: hash and value.
    const csv = buildAddressTransactionsCsv([
      row({ hash: 'we"ird,hash', toAddress: '', value: '1,000' }),
    ]);
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine).toBe(
      '"we""ird,hash",'
      + '18000001,'
      + '0x1111111111111111111111111111111111111111,'
      + ',"1,000",'
      + '2024-01-01T00:00:00.000Z,'
      + '',
    );
    // Round-trip through a naive RFC 4180 consumer keeps the original value.
    const quoted = dataLine.match(/"([^"]*(?:""[^"]*)*)"/g) ?? [];
    expect(quoted).toContain('"we""ird,hash"');
    expect(quoted).toContain('"1,000"');
  });

  it('renders an unparseable timestamp as an empty cell, not raw garbage', () => {
    const csv = buildAddressTransactionsCsv([row({ timestamp: 'not a date' })]);
    expect(csv.split('\r\n')[1].split(',')[5]).toBe('');
  });

  it('renders numeric block numbers as strings without quotes', () => {
    const csv = buildAddressTransactionsCsv([row({ blockNumber: 42 })]);
    expect(csv.split('\r\n')[1].split(',')[1]).toBe('42');
  });

  it('renders a null timestamp as an empty cell, not a fabricated date', () => {
    const csv = buildAddressTransactionsCsv([row({ timestamp: null })]);
    expect(csv.split('\r\n')[1].split(',')[5]).toBe('');
  });

  it('orders rows exactly as given (no implicit sorting)', () => {
    const csv = buildAddressTransactionsCsv([
      row({ blockNumber: 2n, hash: '0xsecond' }),
      row({ blockNumber: 1n, hash: '0xfirst' }),
    ]);
    const lines = csv.split('\r\n');
    expect(lines[1].startsWith('0xsecond,')).toBe(true);
    expect(lines[2].startsWith('0xfirst,')).toBe(true);
  });
});
