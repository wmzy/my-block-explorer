/**
 * CSV export of filtered contract events.
 *
 * Filter semantics live in EventIndexingService.buildEventFilterConditions so
 * the list, count, and export queries all agree on what a filter matches.
 */

import { and, desc, sql } from 'drizzle-orm';
import { db } from '../database/drizzle';
import { contractEvents } from '../database/schema';
import { buildEventFilterConditions, type EventQueryFilters } from './EventIndexingService';

// Export refuses (HTTP 400 in the route) rather than truncates when the
// filtered set is larger: a silently capped CSV would masquerade as complete.
export const EXPORT_MAX_ROWS = 100_000;

export const getFilteredEventCount = async (
  chainId: number,
  address: `0x${string}`,
  filters: EventQueryFilters,
): Promise<number> => {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(contractEvents)
    .where(and(...buildEventFilterConditions(chainId, address, filters)));
  // DuckDB count(*) can surface as bigint; normalize for arithmetic/response use.
  return Number(rows[0]?.count ?? 0);
};

export const fetchFilteredEventsForExport = async (
  chainId: number,
  address: `0x${string}`,
  filters: EventQueryFilters,
) =>
  db
    .select({
      blockNumber: contractEvents.blockNumber,
      blockTimestamp: contractEvents.blockTimestamp,
      transactionHash: contractEvents.transactionHash,
      logIndex: contractEvents.logIndex,
      eventName: contractEvents.eventName,
      decodedArgs: contractEvents.decodedArgs,
      address: contractEvents.contractAddress,
    })
    .from(contractEvents)
    .where(and(...buildEventFilterConditions(chainId, address, filters)))
    .orderBy(desc(contractEvents.blockNumber), desc(contractEvents.logIndex))
    .limit(EXPORT_MAX_ROWS);

/** Minimal row shape buildEventsCsv understands (DB rows or test fixtures). */
export type CsvEventRow = {
  blockNumber: bigint | number;
  blockTimestamp: number | string | Date | null;
  transactionHash: string;
  logIndex: number;
  eventName: string | null;
  decodedArgs: string | null;
  address: string;
};

// RFC 4180: quote a field containing a comma, quote, CR or LF, and double any
// embedded quotes. Applied uniformly to every cell.
const escapeCsvField = (field: string): string => {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
};

const csvTimestamp = (value: CsvEventRow['blockTimestamp']): string => {
  if (value === null || value === '') return '';
  // Numbers are unix seconds (the timestamp column's driver mapping); other
  // forms are string/Date timestamps.
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? '' : date.toISOString();
};

/** Render filtered event rows as CSV with a fixed column order. */
export const buildEventsCsv = (rows: readonly CsvEventRow[]): string => {
  const lines = ['block_number,block_timestamp,tx_hash,log_index,event_name,decoded_args,address'];
  for (const row of rows) {
    lines.push(
      [
        row.blockNumber.toString(),
        csvTimestamp(row.blockTimestamp),
        row.transactionHash,
        row.logIndex.toString(),
        row.eventName ?? '',
        row.decodedArgs ?? '',
        row.address,
      ]
        .map(escapeCsvField)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
};
