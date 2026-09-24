// SQL console service: the admin-gated read-only DuckDB surface
// (POST /api/sql/query, GET /api/sql/tables). The tables sidebar is a
// cacheable query (createQueryCache pattern, same as addresses.ts); the
// query runner is deliberately an imperative POST — re-running SQL must
// always hit the server (the database may have changed), and POSTs are
// never replayed or cached by the transport (util/http's no-retry write
// philosophy), which is exactly the semantics a console wants.
import { get, post, withSignal, api, longRunningApi } from '@/util/http';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';

// A cell after the backend's JSON normalization (see normalizeSqlCell in
// src/routes/sql.ts): bigint already stringified, Dates already ISO UTC,
// binary already 0x-hex.
export type SqlCellValue =
  | null
  | boolean
  | number
  | string
  | SqlCellValue[]
  | { [key: string]: SqlCellValue };

// POST /api/sql/query response. `truncated` is a fact, not a guess: the
// backend reads one row past the cap before reporting it.
export type SqlQueryResult = {
  columns: string[];
  rows: SqlCellValue[][];
  rowCount: number;
  truncated: boolean;
};

// One main-schema table with its columns in ordinal order (the sidebar's
// lazy schema browser).
export type SqlTableSchema = { table: string; columns: string[] };

export async function fetchSqlTables(
  signal?: AbortSignal,
): Promise<SqlTableSchema[] | undefined> {
  const body = await get<{ tables: SqlTableSchema[] }>(
    '/api/sql/tables',
    undefined,
    withSignal(api, signal),
  );
  return body.tables;
}

// Runs under the server's own execution budget — a console query scanning
// the event tables can legitimately outrun the default 10s per-attempt
// timeout, so this rides the long-running chain (35s, same as the address
// history scans).
export async function runSqlQuery(sql: string, signal?: AbortSignal): Promise<SqlQueryResult> {
  return post<SqlQueryResult>('/api/sql/query', { sql }, withSignal(longRunningApi, signal));
}

export const sqlTablesCache = createQueryCache<SqlTableSchema[] | undefined, []>('sql-tables');

const querySqlTables = bindQueryFn(fetchSqlTables, sqlTablesCache);

const useSqlTablesQuery = createQueryHook({ queryFn: querySqlTables });

export function useSqlTables() {
  return useSqlTablesQuery([]);
}
