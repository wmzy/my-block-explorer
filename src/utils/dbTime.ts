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

// Datetime columns reach this layer as a drizzle Date, but raw-read
// adapter paths still hand back strings — accept both, and never guess a
// date the row does not carry. DuckDB's string form is the NAIVE stored
// value ('2026-09-21 12:07:19.183', space-separated, no offset) and the
// stored convention is UTC wall time (now() default), so a string
// without an explicit offset/Z designator must parse as UTC: JS would
// read it as machine-local and skew the value by the server's timezone
// (8 hours on a UTC+8 host).

/** Normalize a datetime column value (Date or naive-UTC string) to an ISO string. */
export const toIsoTimestamp = (value: Date | string | null | undefined): string | null => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) {
    const hasOffset = value.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(value);
    const normalized = hasOffset ? value : `${value.replace(' ', 'T')}Z`;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
};
