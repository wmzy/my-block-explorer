import { describe, it, expect, afterAll, vi } from 'vitest';
import { createRequire } from 'node:module';

// /api/health reports the package.json version (src/version.ts) — pin the
// contract, not the literal.
const packageVersion: string = createRequire(import.meta.url)('../../package.json').version;

// Same DuckDB isolation pattern as tests/integration/api-routes.test.ts:
// the db client is mocked (schema exports stay real) so this file never
// contends for the single-writer data/blockchain.db lock while the suite
// runs in parallel forks.
vi.mock('@/database/init', async importOriginal => {
  const actual = await importOriginal<typeof import('@/database/init')>();
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({ from: vi.fn().mockResolvedValue([]) })),
      execute: vi.fn().mockResolvedValue([]),
    },
  };
});

// Both flags are read at module load: ENABLE_DEBUG_API decides the /debug
// mount, so it must be stubbed before api-app is first imported.
vi.stubEnv('ENABLE_DEBUG_API', '1');
vi.stubEnv('ADMIN_TOKEN', 'test-admin-token');

const { default: app } = await import('@/api-app');

// Probe route that escapes every route-level handler so the request lands
// in app.onError — the exact path the 500-body convergence changed.
app.get('/__test/boom', () => {
  throw new Error('secret internal detail: SELECT * FROM private_table');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('500-body convergence (app.onError)', () => {
  it('returns a fixed body without the error message', async () => {
    const response = await app.request('/__test/boom');

    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toBe('internal_error');
    expect(body.message).toBe('Internal Server Error');
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });
});

describe('GET /api/health', () => {
  it('reports the deployment security posture without gating', async () => {
    const response = await app.request('/api/health');

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      status: 'ok',
      adminTokenConfigured: true,
      debugApiEnabled: true,
    });
    expect(body.version).toBe(packageVersion);
    expect(typeof body.timestamp).toBe('string');
  });
});

describe('request body limit (hono/body-limit, 8 MB, all routes)', () => {
  // POST /api/sql/query is the strictest gated route in the app — if the
  // ceiling answers 413 before the gate's own 403, the middleware provably
  // runs ahead of every route mount.
  const oversized = () => app.request('/api/sql/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql: `SELECT '${'x'.repeat(9 * 1024 * 1024)}'` }),
  });

  it('answers 413 with the createApiError envelope on an oversized body', async () => {
    const response = await oversized();

    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body).toMatchObject({
      error: 'payload_too_large',
      statusCode: 413,
    });
    expect(body.message).toMatch(/8 MB/);
    expect(typeof body.timestamp).toBe('string');
  });

  it('precedes the admin gate and every route handler (413, not 403)', async () => {
    // ADMIN_TOKEN is stubbed set at module load; the request carries no
    // x-admin-token — the gate alone would answer 403.
    const response = await oversized();
    expect(response.status).toBe(413);
  });

  it('passes normal-sized bodies through untouched', async () => {
    const response = await app.request('/api/sql/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT 1' }),
    });

    // Under the ceiling the request reaches the strict gate, which (no
    // token header) answers its usual 403 envelope — proof of pass-through
    // without depending on any handler's success shape.
    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe('Invalid admin token.');
  });
});

describe('ops uninstall strict gate (composed app)', () => {
  // ADMIN_TOKEN is stubbed set at module load; these requests carry no
  // x-admin-token, so the strict tier answers 403 before any handler —
  // proving the pair is gated inside the FULL mount (cors/logger/timing/
  // bodyLimit in front), not just in sub-app isolation.
  it('gates both uninstall routes ahead of every route handler', async () => {
    for (const path of ['/api/ops/uninstall/preview', '/api/ops/uninstall']) {
      const response = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(403);
      expect((await response.json()).message).toBe('Invalid admin token.');
    }
  });
});

describe('debug SQL endpoint gating', () => {
  it('rejects a request without the x-admin-token header once ADMIN_TOKEN is set', async () => {
    const response = await app.request('/debug/db/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT 1' }),
    });

    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe('Invalid admin token.');
  });

  it('rejects a wrong token', async () => {
    const response = await app.request('/debug/db/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'not-the-token' },
      body: JSON.stringify({ sql: 'SELECT 1' }),
    });

    expect(response.status).toBe(403);
  });

  it('executes the query with the matching token', async () => {
    const response = await app.request('/debug/db/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
      body: JSON.stringify({ sql: 'SELECT 1' }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
  });

  it('stays usable in a zero-config local session (no ADMIN_TOKEN configured)', async () => {
    vi.stubEnv('ADMIN_TOKEN', '');

    const response = await app.request('/debug/db/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT 1' }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
  });
});
