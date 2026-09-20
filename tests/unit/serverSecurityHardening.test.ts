import { describe, it, expect, afterAll, vi } from 'vitest';

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
    expect(body.version).toBe('1.0.0');
    expect(typeof body.timestamp).toBe('string');
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
