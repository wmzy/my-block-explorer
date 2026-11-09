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
import { csvTimestamp, escapeCsvField } from '../utils/csv';

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
      // NULL (adapter maps omitted defaults to NULL) means not-yet-finalized,
      // the same rule reorg reconciliation applies.
      isFinalized: sql<boolean>`coalesce(${contractEvents.isFinalized}, false)`,
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
  // null only for hand-built rows that predate the column
  isFinalized: boolean | null;
};

// Field quoting and timestamp rendering are the shared CSV primitives
// from utils/csv.ts (one definition for both exporters; blockTimestamp
// arrives as number | string | Date depending on the read path).

/** Render filtered event rows as CSV with a fixed column order. */
export const buildEventsCsv = (rows: readonly CsvEventRow[]): string => {
  const lines = [
    'block_number,block_timestamp,tx_hash,log_index,event_name,decoded_args,address,is_finalized',
  ];
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
        row.isFinalized === null ? '' : row.isFinalized ? 'true' : 'false',
      ]
        .map(escapeCsvField)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
};
