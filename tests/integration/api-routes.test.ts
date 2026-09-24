import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import app from '@/api-app';

// The version reported by /api and /api/health is the package.json field
// (src/version.ts) — pin the contract, not the literal, so releases don't
// break this test.
const packageVersion: string = createRequire(import.meta.url)('../../package.json').version;

// The rpc-configs GET is the only db-backed route this file exercises.
// DuckDB files are single-writer and other suite files may legitimately
// hold data/blockchain.db while this file runs in a parallel fork, so the
// db client is mocked (schema table exports stay real) to keep these
// tests deterministic and isolated from on-disk state.
vi.mock('@/database/init', async importOriginal => {
  const actual = await importOriginal<typeof import('@/database/init')>();
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({ from: vi.fn().mockResolvedValue([]) })),
    },
  };
});

describe('API routes', () => {
  describe('GET /api', () => {
    it('returns API info', async () => {
      const response = await app.request('/api', { method: 'GET' });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toMatchObject({
        name: 'My Block Explorer API',
        version: packageVersion,
        description: 'A modern blockchain explorer API',
      });
      expect(data).toHaveProperty('endpoints');
      expect(data).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/health', () => {
    it('returns healthy status with deployment posture flags', async () => {
      const response = await app.request('/api/health', { method: 'GET' });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toMatchObject({
        status: 'ok',
        version: packageVersion,
      });
      expect(typeof data.adminTokenConfigured).toBe('boolean');
      expect(typeof data.debugApiEnabled).toBe('boolean');
      expect(data).toHaveProperty('timestamp');
    });
  });

  describe('GET /nonexistent', () => {
    it('returns 404 with unified error format', async () => {
      const response = await app.request('/nonexistent', { method: 'GET' });

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data).toHaveProperty('message');
      expect(data).toHaveProperty('statusCode', 404);
      expect(data).toHaveProperty('timestamp');
    });
  });

  describe('admin gating (no env vars)', () => {
    // Gating model: rpc-config READS are open (endpoint URLs, no secrets).
    // rpc-config WRITES use the opt-in gate (requireAdminTokenIfConfigured):
    // without ADMIN_TOKEN a local zero-config session can save; with one
    // configured they reject. The performance subtree stays strictly
    // fail-closed, and the debug routes stay unmounted when
    // ENABLE_DEBUG_API is not opted in.
    beforeEach(() => {
      vi.stubEnv('ADMIN_TOKEN', '');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('serves GET /api/rpc-configs without a token (open read)', async () => {
      const response = await app.request('/api/rpc-configs', { method: 'GET' });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(Array.isArray(data.configs)).toBe(true);
    });

    it('lets GET /api/rpc-configs through with a matching x-admin-token', async () => {
      vi.stubEnv('ADMIN_TOKEN', 'test-admin-token');

      const response = await app.request('/api/rpc-configs', {
        method: 'GET',
        headers: { 'x-admin-token': 'test-admin-token' },
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(Array.isArray(data.configs)).toBe(true);
    });

    it('passes POST /api/rpc-configs through the open gate to validation (zero-config saves work)', async () => {
      const response = await app.request('/api/rpc-configs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('Missing required fields');
    });

    it('rejects POST /api/rpc-configs without the token once ADMIN_TOKEN is set', async () => {
      vi.stubEnv('ADMIN_TOKEN', 'test-admin-token');

      const response = await app.request('/api/rpc-configs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chainId: 1, name: 'n', url: 'https://rpc' }),
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('Forbidden');
      expect(body.message).toBe('Invalid admin token.');
    });

    it('rejects DELETE /api/rpc-configs/:chainId with a wrong token once ADMIN_TOKEN is set', async () => {
      vi.stubEnv('ADMIN_TOKEN', 'test-admin-token');

      const response = await app.request('/api/rpc-configs/1', {
        method: 'DELETE',
        headers: { 'x-admin-token': 'not-the-token' },
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('Forbidden');
      expect(body.message).toBe('Invalid admin token.');
    });

    it('rejects GET /api/performance/events (whole subtree gated)', async () => {
      const response = await app.request('/api/performance/events');

      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe('Forbidden');
    });

    (process.env.ENABLE_DEBUG_API === '1' ? it.skip : it)(
      'returns 404 for /debug/db/query (routes unmounted)',
      async () => {
        const response = await app.request('/debug/db/query', { method: 'POST' });

        expect(response.status).toBe(404);
      },
    );

    it('lets a matching x-admin-token through', async () => {
      vi.stubEnv('ADMIN_TOKEN', 'test-admin-token');

      // clear-cache runs on the in-memory optimizer manager (no DB), so it
      // is a safe probe for the authorized pass-through path.
      const response = await app.request('/api/performance/clear-cache', {
        method: 'POST',
        headers: { 'x-admin-token': 'test-admin-token' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });
});
