// The mounted face of the debug SQL endpoint. Existing coverage pins that
// /debug/db/query stays UNMOUNTED without ENABLE_DEBUG_API (api-routes)
// and its admin gating + mocked-db success shape (serverSecurityHardening);
// this file composes the real api-app with the flag set and a REAL temp
// DuckDB, pinning the actual execution semantics:
// - SELECT results come back as rows,
// - the endpoint is deliberately RAW SQL — a mutating statement EXECUTES
//   (there is no read-only guard here by design; that guard lives in the
//   /api/sql console route, and the non-loopback mount is refused by
//   startupChecks — this danger is exactly why the flag defaults off),
// - invalid input answers the createApiError envelope, not a crash.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// DATABASE_URL MUST carry the duckdb:// scheme: a bare path is silently
// ignored by the adapter's parseConnectionString, which then opens the
// DEFAULT data/blockchain.db — the single-writer file other suite forks
// may hold. The scheme-stripped temp path keeps this fork isolated.
// ENABLE_DEBUG_API is read at module load to decide the /debug mount, so
// both stubs precede the first api-app import.
const tempDir = mkdtempSync(join(tmpdir(), 'debug-route-handler-'));
vi.stubEnv('DATABASE_URL', `duckdb://${join(tempDir, 'blockchain.db')}`);
vi.stubEnv('ENABLE_DEBUG_API', '1');
// Pin the zero-config local session: no admin token → the debug sub-app's
// requireAdminTokenIfConfigured lets requests through (gating with a
// token set is covered by serverSecurityHardening).
vi.stubEnv('ADMIN_TOKEN', '');

const { default: app } = await import('@/api-app');
const { db } = await import('@/database/init');

const post = (body: unknown) =>
  app.request('/debug/db/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

afterAll(async () => {
  // end() checkpoints and closes the DuckDB instance (idempotent) so the
  // temp dir can be removed while nothing holds the file.
  await db.$client.end?.();
  rmSync(tempDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('POST /debug/db/query (mounted via ENABLE_DEBUG_API=1)', () => {
  it('executes a read query and returns the rows', async () => {
    const response = await post({ sql: 'SELECT 1 AS one' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      rowCount: 1,
      rows: [{ one: 1 }],
    });
  });

  it('executes a mutating statement — raw SQL by design, no read-only guard', async () => {
    // The guard the review asked about lives in the /api/sql console
    // (isReadOnlyQuery, tests/unit/sqlReadOnlyGuard.test.ts); the debug
    // endpoint is the explicit escape hatch, which is why mounting it is
    // opt-in and a non-loopback bind with the flag refuses to boot. Pin
    // the semantics honestly: DDL+DML execute and persist.
    const create = await post({ sql: 'CREATE TABLE debug_route_smoke (id INTEGER)' });
    expect(create.status).toBe(200);
    expect((await create.json()).success).toBe(true);

    const insert = await post({ sql: 'INSERT INTO debug_route_smoke VALUES (7)' });
    expect(insert.status).toBe(200);
    expect((await insert.json()).success).toBe(true);

    const select = await post({ sql: 'SELECT id FROM debug_route_smoke' });
    expect(select.status).toBe(200);
    expect(await select.json()).toEqual({
      success: true,
      rowCount: 1,
      rows: [{ id: 7 }],
    });
  });

  it('rejects a missing or non-string sql parameter with a 400 envelope', async () => {
    for (const body of [{}, { sql: 123 }, { sql: '' }]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      const parsed = await response.json();
      expect(parsed).toMatchObject({ statusCode: 400, error: 'Bad Request' });
      expect(parsed.message).toContain('sql');
    }
  });

  it('maps a failing statement onto the 500 createApiError envelope', async () => {
    const response = await post({ sql: 'SELECT * FROM table_that_does_not_exist' });

    expect(response.status).toBe(500);
    const parsed = await response.json();
    expect(parsed).toMatchObject({ statusCode: 500, error: 'Query Failed' });
    expect(typeof parsed.message).toBe('string');
    expect(parsed.message.length).toBeGreaterThan(0);
  });
});
