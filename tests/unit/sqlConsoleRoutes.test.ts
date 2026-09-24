// SQL console route contract: the STRICT admin gate (fails closed with no
// ADMIN_TOKEN, 403 on a wrong token), the read-only guard wired into
// 400 'invalid_query' bodies, the 500-row cap with an honest `truncated`
// flag, cell normalization for JSON (bigint → string, Date → ISO UTC,
// binary → 0x-hex), deduplicated column names reaching the response, the
// information_schema sidebar feed, and the 6/min-burst-3 rate limiter.
// The DuckDB layer is faked at the db.$client boundary (the single shared
// instance contract): the fake connection models runAndReadUntil's
// "stop at target rows" semantics so the cap tests measure real slicing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { resetRateLimiterState } from '@/middleware/rate-limit';

const duckdbState = vi.hoisted(() => ({
  // What runAndReadUntil serves for the next query: raw (un-normalized)
  // column names + JS cell values.
  queryResult: { columns: [] as string[], rows: [] as unknown[][] },
  // What runAndReadAll serves for GET /sql/tables.
  tableRows: [] as Array<Record<string, unknown>>,
  // When set, the next query execution rejects with this message — the
  // DuckDB failure path (parser errors, missing tables, …).
  executeError: null as string | null,
  // Every statement the fake session ran, in order (asserts session TZ pin).
  statements: [] as string[],
}));

vi.mock('@/database/init', () => ({
  db: {
    $client: {
      getDuckDB: async () => ({
        connect: async () => ({
          run: (sqlText: string) => {
            duckdbState.statements.push(sqlText);
            return Promise.resolve(undefined);
          },
          // Models the real semantics: reads stop once `target` rows are
          // available (chunks may overshoot, but never the whole set).
          runAndReadUntil: (sqlText: string, target: number) => {
            duckdbState.statements.push(sqlText);
            if (duckdbState.executeError !== null) {
              return Promise.reject(new Error(duckdbState.executeError));
            }
            return Promise.resolve({
              deduplicatedColumnNames: () => duckdbState.queryResult.columns,
              getRowsJS: () => duckdbState.queryResult.rows.slice(0, target),
            });
          },
          runAndReadAll: (sqlText: string) => {
            duckdbState.statements.push(sqlText);
            return Promise.resolve({
              getRowObjects: () => duckdbState.tableRows,
            });
          },
          disconnectSync: () => undefined,
        }),
      }),
    },
  },
}));

import sqlRoutes from '@/routes/sql';

const app = new Hono();
app.route('/api', sqlRoutes);

const request = (path: string, init?: RequestInit) => app.request(path, init);

const postQuery = (sql: string, token?: string) =>
  request('/api/sql/query', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token !== undefined ? { 'x-admin-token': token } : {}),
    },
    body: JSON.stringify({ sql }),
  });

const getTables = (token?: string) =>
  request('/api/sql/tables', {
    headers: token !== undefined ? { 'x-admin-token': token } : {},
  });

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimiterState();
  process.env.ADMIN_TOKEN = 'test-token';
  duckdbState.queryResult = { columns: [], rows: [] };
  duckdbState.tableRows = [];
  duckdbState.executeError = null;
  duckdbState.statements = [];
});

afterEach(() => {
  delete process.env.ADMIN_TOKEN;
});

describe('STRICT admin gate — fails closed without ADMIN_TOKEN', () => {
  it('rejects the query endpoint with no token configured', async () => {
    delete process.env.ADMIN_TOKEN;
    const res = await postQuery('SELECT 1');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
    expect(body.message).toMatch(/Set ADMIN_TOKEN on the server/);
  });

  it('rejects the tables endpoint with no token configured', async () => {
    delete process.env.ADMIN_TOKEN;
    const res = await getTables();
    expect(res.status).toBe(403);
  });

  it('rejects a wrong token on both endpoints', async () => {
    expect((await postQuery('SELECT 1', 'wrong')).status).toBe(403);
    expect((await getTables('wrong')).status).toBe(403);
  });

  it('accepts the matching token', async () => {
    const res = await postQuery('SELECT 1', 'test-token');
    expect(res.status).toBe(200);
    expect((await getTables('test-token')).status).toBe(200);
  });

  it('never reaches the database while ungated', async () => {
    delete process.env.ADMIN_TOKEN;
    await postQuery('SELECT 1');
    await getTables();
    expect(duckdbState.statements).toEqual([]);
  });
});

describe('POST /api/sql/query — validation', () => {
  it('rejects a non-read-only statement with 400 invalid_query', async () => {
    const res = await postQuery('DROP TABLE blocks', 'test-token');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_query');
    expect(body.message).toMatch(/must start with SELECT or WITH/);
    expect(duckdbState.statements).toEqual([]);
  });

  it('rejects a multi-statement body', async () => {
    const res = await postQuery('SELECT 1; SELECT 2', 'test-token');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_query');
  });

  it('rejects a missing/empty sql string and a non-JSON body', async () => {
    expect((await postQuery('', 'test-token')).status).toBe(400);
    expect((await postQuery('   ', 'test-token')).status).toBe(400);
    const res = await request('/api/sql/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'test-token' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_query');
  });

  it('surfaces the real DuckDB error message on execution failure', async () => {
    duckdbState.executeError = 'Parser Error: syntax error at or near "FROMM"';
    const res = await postQuery('SELECT 1 FROMM t', 'test-token');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_query');
    expect(body.message).toMatch(/Parser Error/);
  });
});

describe('POST /api/sql/query — result shaping', () => {
  it('caps at 500 rows and reports truncated: true for 501+ row results', async () => {
    duckdbState.queryResult = {
      columns: ['n'],
      rows: Array.from({ length: 501 }, (_, i) => [i]),
    };
    const res = await postQuery('SELECT n FROM big', 'test-token');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rowCount).toBe(500);
    expect(body.rows).toHaveLength(500);
    expect(body.truncated).toBe(true);
    expect(body.rows[499]).toEqual([499]);
  });

  it('reports truncated: false for a result at or under the cap', async () => {
    duckdbState.queryResult = {
      columns: ['n'],
      rows: Array.from({ length: 500 }, (_, i) => [i]),
    };
    const body = await (await postQuery('SELECT n FROM exact', 'test-token')).json();
    expect(body.rowCount).toBe(500);
    expect(body.truncated).toBe(false);
  });

  it('normalizes bigint, Date and binary cells for JSON', async () => {
    duckdbState.queryResult = {
      columns: ['block_number', 'mined_at', 'extra_data'],
      rows: [
        [
          18_000_001n,
          new Date('2026-09-24T12:00:00.000Z'),
          Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
        ],
      ],
    };
    const res = await postQuery('SELECT * FROM blocks LIMIT 1', 'test-token');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows[0][0]).toBe('18000001');
    expect(body.rows[0][1]).toBe('2026-09-24T12:00:00.000Z');
    expect(body.rows[0][2]).toBe('0xdeadbeef');
  });

  it('passes null/bool/number/string cells through untouched', async () => {
    duckdbState.queryResult = {
      columns: ['a', 'b', 'c', 'd'],
      rows: [[null, true, 3.5, 'text']],
    };
    const body = await (await postQuery('SELECT * FROM t', 'test-token')).json();
    expect(body.rows[0]).toEqual([null, true, 3.5, 'text']);
  });

  it('returns deduplicated column names (duplicate outputs survive)', async () => {
    // DuckDB's reader deduplicates `a`, `a` → `a`, `a:1`; the route must
    // serve those names, not object-key rows that would collapse the pair.
    duckdbState.queryResult = { columns: ['a', 'a:1'], rows: [[1, 2]] };
    const body = await (await postQuery('SELECT 1 AS a, 2 AS a', 'test-token')).json();
    expect(body.columns).toEqual(['a', 'a:1']);
    expect(body.rows[0]).toEqual([1, 2]);
  });

  it('pins the session timezone to UTC before running the query', async () => {
    await postQuery('SELECT 1', 'test-token');
    expect(duckdbState.statements[0]).toBe('SET TimeZone=\'UTC\'');
    expect(duckdbState.statements[1]).toBe('SELECT 1');
  });
});

describe('GET /api/sql/tables', () => {
  it('groups columns by table in ordinal order', async () => {
    duckdbState.tableRows = [
      { table_name: 'blocks', column_name: 'number' },
      { table_name: 'blocks', column_name: 'hash' },
      { table_name: 'transactions', column_name: 'hash' },
      { table_name: 'transactions', column_name: 'block_number' },
    ];
    const res = await getTables('test-token');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tables).toEqual([
      { table: 'blocks', columns: ['number', 'hash'] },
      { table: 'transactions', columns: ['hash', 'block_number'] },
    ]);
  });

  it('returns an empty table list (not an error) on a fresh database', async () => {
    const body = await (await getTables('test-token')).json();
    expect(body.tables).toEqual([]);
  });
});

describe('rate limiting — 6/min, burst 3', () => {
  it('allows the burst then answers 429 with Retry-After', async () => {
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => postQuery('SELECT 1', 'test-token')),
    );
    expect(responses.slice(0, 3).map(r => r.status)).toEqual([200, 200, 200]);
    expect(responses[3].status).toBe(429);
    expect(responses[3].headers.get('Retry-After')).toMatch(/^\d+$/);
    const body = await responses[3].json();
    expect(body.error).toBe('rate_limited');
  });

  it('does not let ungated requests consume the budget', async () => {
    delete process.env.ADMIN_TOKEN;
    // 403s from the gate run before the limiter — none of these consume
    // tokens, so a later authorized burst still has its full allowance.
    for (let i = 0; i < 5; i++) await postQuery('SELECT 1');
    process.env.ADMIN_TOKEN = 'test-token';
    const responses = await Promise.all(
      Array.from({ length: 3 }, () => postQuery('SELECT 1', 'test-token')),
    );
    expect(responses.map(r => r.status)).toEqual([200, 200, 200]);
  });
});
