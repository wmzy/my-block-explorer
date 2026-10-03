// DB row timestamp normalization, shared by every service that
// formats a drizzle row for the API (BlockService,
// TransactionService).
//
// The `timestamp` columns are the repo's unix-SECONDS customType
// (database/db-types.ts: TIMESTAMP_S, data: number). drizzle hands
// formatters a plain number of seconds, and `new Date(number)`
// reads a number as MILLIseconds — so a bare `new Date(row.timestamp)`
// reported January 1970 for every DB-served row (~56 years off).
// Seconds are scaled to ms here, once, for both numbers and any
// legacy string form; a Date passes through, and anything unparseable
// reads as absent rather than as "Invalid Date".

/** Normalize a DB timestamp value (unix seconds) to a Date. */
export const secondsToDate = (value: unknown): Date | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'number') return Number.isNaN(value) ? undefined : new Date(value * 1000);
  const text = String(value);
  // A bare decimal string is seconds (the column's own fromDriver form);
  // anything with a date part parses as written.
  if (/^\d+$/.test(text)) return new Date(Number(text) * 1000);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};
