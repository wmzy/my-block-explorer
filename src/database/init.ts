export { db } from './drizzle';
export { DuckDBPostgresAdapter as DatabaseManager } from './duckdb-postgres-adapter';

export * from './schema';

/**
 * Total from a drizzle `db.select({ value: count() })` single-row result:
 * the row's count, or 0 for an empty result set. drizzle's count() maps
 * DuckDB's BIGINT/HUGEINT count to a JS number already, so this is a
 * plain unwrap of the standard `{ value }` row — no string/bigint
 * handling belongs at the call sites.
 */
export function sqlCountTotal(rows: ReadonlyArray<{ value: number }>): number {
  return rows[0]?.value || 0;
}
