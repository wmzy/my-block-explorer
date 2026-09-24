// SQL console routes: an admin-only, read-only window onto the explorer's
// own DuckDB — "query your own indexer" as a power tool no hosted explorer
// offers. Two endpoints, both STRICT admin-gated (requireAdminToken, the
// tier that fails closed when ADMIN_TOKEN is unset): a raw-SQL guard would
// be theater behind the opt-in tier, because a zero-config local session
// passes it — raw SQL execution must never be reachable without an
// explicit operator decision.
//
// Honesty rules: results are capped at 500 rows with an explicit
// `truncated` flag (a silent cap would present a subset as the whole);
// duplicate output column names are deduplicated DuckDB-style (`a`, `a:1`)
// instead of silently collapsing; and a failed query returns the real
// DuckDB error message — the audience is the operator who typed the SQL.
import { Hono } from 'hono';
import type { DuckDBConnection, DuckDBResultReader } from '@duckdb/node-api';
import { db } from '../database/init';
import { createLogger } from '../server/logger';
import { requireAdminToken } from '../middleware/admin-token';
import { createRateLimiter } from '../middleware/rate-limit';
import { respondError } from '../utils/api-error';

const logger = createLogger('sql-routes');

const app = new Hono();

// STRICT tier for the whole sub-app (see file header): every SQL-console
// endpoint fails closed without ADMIN_TOKEN.
app.use('*', requireAdminToken);

// Raw DuckDB access reuses the single shared instance (db.$client is the
// adapter's postgres-style `sql`, whose getDuckDB() returns the one
// DuckDBInstance the whole app runs on — the same path migrate.ts uses).
// A second instance would fight the single-writer file lock.

// Words that have no business in a read-only console, checked as
// case-insensitive word tokens ANYWHERE in the text — conservative on
// purpose: a string literal or comment containing one of these rejects the
// query rather than risking a write slipping through a quoting trick.
// The list covers DuckDB's write/DDL/extension/session surface: DML
// (INSERT/UPDATE/DELETE), DDL (CREATE/DROP/ALTER/TRUNCATE/INTO),
// file-level side effects (COPY/EXPORT/IMPORT/ATTACH/DETACH/INSTALL/LOAD),
// session mutations (PRAGMA/SET/RESET/USE), and statement-indirection
// escapes (CALL/PREPARE/EXECUTE).
const FORBIDDEN_WORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'INTO', 'CREATE', 'DROP', 'ALTER',
  'TRUNCATE', 'COPY', 'ATTACH', 'DETACH', 'PRAGMA', 'INSTALL', 'LOAD',
  'EXPORT', 'IMPORT', 'CALL', 'EXECUTE', 'PREPARE', 'SET', 'RESET', 'USE',
] as const;

const forbiddenWordPatterns = FORBIDDEN_WORDS.map(word => ({
  word,
  pattern: new RegExp(`\\b${word}\\b`, 'i'),
}));

// The first token must be SELECT or WITH. Leading parentheses are allowed
// (DuckDB accepts parenthesized query expressions) but nothing else — not
// comments, not whitespace-padded keywords, so nothing can hide a prefix.
const LEADING_QUERY_KEYWORD = /^\(*\s*(select|with)\b/i;

/**
 * Why a read-only console rejected the query (null = acceptable).
 * Pure string function — no DB, no env, no clock.
 */
export function readOnlyQueryRejection(query: string): string | null {
  const trimmed = query.trim();
  if (trimmed === '') return 'Query is empty.';

  // Single statement only: at most one optional trailing ';' after trim.
  const body = trimmed.endsWith(';') ? trimmed.slice(0, -1) : trimmed;
  if (body.includes(';')) {
    return 'Only a single statement is allowed (one optional trailing ";" is fine).';
  }

  if (!LEADING_QUERY_KEYWORD.test(body)) {
    return 'Queries must start with SELECT or WITH.';
  }

  for (const { word, pattern } of forbiddenWordPatterns) {
    if (pattern.test(body)) {
      return `"${word}" is not allowed — the SQL console is read-only.`;
    }
  }
  return null;
}

/**
 * Pure read-only guard for SQL console input: true when the query is a
 * single statement starting with SELECT/WITH and free of every forbidden
 * write/DDL keyword. Exported for direct testing.
 */
export function isReadOnlyQuery(query: string): boolean {
  return readOnlyQueryRejection(query) === null;
}

// Cap + truncation semantics: one row past the cap is read on purpose —
// `truncated` then reports a fact about the result set, not a guess.
export const MAX_RESULT_ROWS = 500;

// JSON-safe cell value: what the API returns after normalization.
export type SqlJsonValue =
  | null
  | boolean
  | number
  | string
  | SqlJsonValue[]
  | { [key: string]: SqlJsonValue };

const bytesToHex = (bytes: Uint8Array): string => {
  let out = '0x';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
};

/**
 * Normalize one DuckDB JS value for JSON. bigint → string (JSON has no
 * bigint), Date → ISO UTC string, binary → 0x-hex, nested lists/structs
 * recurse; null/bool/number/string pass through unchanged. Non-finite
 * numbers (DuckDB 'nan'/'inf' doubles) become strings — JSON.stringify
 * would silently null them, which reads as SQL NULL and lies.
 * Pure: no DB, no env.
 */
export function normalizeSqlCell(value: unknown): SqlJsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return bytesToHex(value);
  if (Array.isArray(value)) return value.map(normalizeSqlCell);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([key, cell]): [string, SqlJsonValue] => [key, normalizeSqlCell(cell)],
      ),
    );
  }
  return String(value);
}

// The query endpoint scans whatever the operator points it at, so it is
// the tightest loop in the API besides the CSV exports: 6/min sustained,
// burst 3 (enough to iterate on a query, not enough to loop a script).
const sqlQueryRateLimiter = createRateLimiter({
  name: 'sql-query',
  requestsPerMinute: 6,
  burst: 3,
});

/**
 * POST /api/sql/query { sql } — run one read-only statement against the
 * explorer's DuckDB. Response:
 * { columns: string[], rows: SqlJsonValue[][], rowCount: number, truncated: boolean }
 */
app.post('/sql/query', sqlQueryRateLimiter, async c => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return respondError(c, 400, 'invalid_query', 'Request body must be JSON: { "sql": "..." }.');
  }
  const query = (body as { sql?: unknown } | null)?.sql;
  if (typeof query !== 'string' || query.trim() === '') {
    return respondError(c, 400, 'invalid_query', 'Missing or empty "sql" string.');
  }

  const rejection = readOnlyQueryRejection(query);
  if (rejection !== null) {
    return respondError(c, 400, 'invalid_query', rejection);
  }

  try {
    const instance = await db.$client.getDuckDB();
    const conn: DuckDBConnection = await instance.connect();
    try {
      // Session TZ pinned to UTC for the same reason as every adapter
      // session (mixed-semantics timestamps are unreadable); this internal
      // SET is the session helper's, not user input — the guard above
      // rejects SET in submitted queries.
      await conn.run('SET TimeZone=\'UTC\'');
      // Read one row past the cap so `truncated` is a measured fact.
      // runAndReadUntil stops after the chunk covering row 501 — it never
      // materializes a whole giant result just to cap it.
      const result: DuckDBResultReader = await conn.runAndReadUntil(
        query,
        MAX_RESULT_ROWS + 1,
      );
      const columns = result.deduplicatedColumnNames();
      const allRows = result.getRowsJS();
      const truncated = allRows.length > MAX_RESULT_ROWS;
      const rows = allRows
        .slice(0, MAX_RESULT_ROWS)
        .map(row => row.map(normalizeSqlCell));
      return c.json({ columns, rows, rowCount: rows.length, truncated });
    } finally {
      conn.disconnectSync();
    }
  } catch (error) {
    // Admin-only audience: surface the real DuckDB error verbatim — it is
    // the most useful thing on this page. Logged at warn because a typo'd
    // query is routine operator behavior, not a server fault.
    const message = error instanceof Error ? error.message : 'Query execution failed.';
    logger.warn({ err: error }, 'SQL console query failed');
    return respondError(c, 400, 'invalid_query', message);
  }
});

/**
 * GET /api/sql/tables — the main schema's tables and column names (the
 * sidebar's lazy table browser). Response: { tables: [{ table, columns }] }.
 */
app.get('/sql/tables', async c => {
  try {
    const instance = await db.$client.getDuckDB();
    const conn: DuckDBConnection = await instance.connect();
    try {
      await conn.run('SET TimeZone=\'UTC\'');
      const result: DuckDBResultReader = await conn.runAndReadAll(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = 'main'
         ORDER BY table_name, ordinal_position`,
      );
      const tables: { table: string; columns: string[] }[] = [];
      for (const row of result.getRowObjects()) {
        const table = String(row.table_name);
        const column = String(row.column_name);
        const existing = tables.find(t => t.table === table);
        if (existing) {
          existing.columns.push(column);
        } else {
          tables.push({ table, columns: [column] });
        }
      }
      return c.json({ tables });
    } finally {
      conn.disconnectSync();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Schema listing failed.';
    logger.error({ err: error }, 'SQL console schema listing failed');
    return respondError(c, 500, 'Schema Listing Failed', message);
  }
});

export default app;
