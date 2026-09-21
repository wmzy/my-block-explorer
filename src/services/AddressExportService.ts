// CSV export of an address's discovered transaction history.
//
// The rows come from the SAME heuristic-discovery channel the transactions
// list endpoint serves (AddressService.getAddressTransactions), so the
// export shows exactly what the list paginates through — including its
// coverage semantics. Two honesty rules are load-bearing here:
// - `status` is empty for heuristic-discovered rows: discovery reads block
//   data without receipts, and an invented success/failure would fabricate
//   a fact the scan never observed. (The column exists so a future
//   receipt-bearing channel can fill it without a format break.)
// - The builder is pure: no database, no RPC, trivially unit-testable.

// Export refuses (HTTP 400 in the route) rather than truncates when the
// discovered set is larger: a silently capped CSV would masquerade as
// complete. The heuristic's discovery budget keeps real result sets far
// below this; the cap is a backstop.
export const ADDRESS_EXPORT_MAX_ROWS = 50_000;

/** Minimal row shape buildAddressTransactionsCsv understands. */
export type CsvAddressTxRow = {
  hash: string;
  blockNumber: bigint | number;
  fromAddress: string;
  toAddress: string;
  value: string;
  timestamp: string | null;
  status?: number | string | null;
};

// RFC 4180: quote a field containing a comma, quote, CR or LF, and double
// any embedded quotes. Applied uniformly to every cell (same rule as
// EventExportService).
const escapeCsvField = (field: string): string => {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
};

// Discovery timestamps are ISO strings; numbers are unix seconds. An empty
// or unparseable value renders as an empty cell (never a fabricated date).
const csvTimestamp = (value: CsvAddressTxRow['timestamp']): string => {
  if (value === null || value === '') return '';
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

const csvStatus = (status: CsvAddressTxRow['status']): string => {
  if (status === undefined || status === null) return '';
  return String(status);
};

// Fixed column order: hash,block_number,from,to,value_wei,timestamp,status.
const CSV_HEADER = 'hash,block_number,from,to,value_wei,timestamp,status';

/**
 * Render discovered transaction rows as CSV (CRLF line endings, RFC 4180
 * quoting). An empty row set still yields the header line — a valid
 * download that honestly says "nothing discovered", not an error.
 */
export function buildAddressTransactionsCsv(rows: readonly CsvAddressTxRow[]): string {
  const lines = [CSV_HEADER];
  for (const row of rows) {
    const cells = [
      row.hash,
      row.blockNumber.toString(),
      row.fromAddress,
      row.toAddress,
      row.value,
      csvTimestamp(row.timestamp),
      csvStatus(row.status),
    ].map(cell => escapeCsvField(cell));
    lines.push(cells.join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
