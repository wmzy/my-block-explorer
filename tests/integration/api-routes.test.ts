import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '@/api-app';

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
        version: '1.0.0',
        description: 'A modern blockchain explorer API',
      });
      expect(data).toHaveProperty('endpoints');
      expect(data).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/health', () => {
    it('returns healthy status', async () => {
      const response = await app.request('/api/health', { method: 'GET' });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toMatchObject({
        status: 'healthy',
        message: 'My Block Explorer API is running',
        version: '1.0.0',
      });
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
    // Fail-closed wiring: the mutating rpc-config endpoints and the whole
    // performance subtree reject without ADMIN_TOKEN, and the debug routes
    // stay unmounted when ENABLE_DEBUG_API is not opted in.
    beforeEach(() => {
      vi.stubEnv('ADMIN_TOKEN', '');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('keeps GET /api/rpc-configs public (frontend RPC resolution)', async () => {
      const response = await app.request('/api/rpc-configs', { method: 'GET' });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(Array.isArray(data.configs)).toBe(true);
    });

    it('rejects POST /api/rpc-configs with the disabled message', async () => {
      const response = await app.request('/api/rpc-configs', { method: 'POST' });

      expect(response.status).toBe(403);

      const data = await response.json();
      expect(data.error).toBe('Forbidden');
      expect(data.message).toBe(
        'Admin operations are disabled. Set ADMIN_TOKEN on the server to enable them.',
      );
    });

    it('rejects DELETE /api/rpc-configs/:chainId', async () => {
      const response = await app.request('/api/rpc-configs/1', {
        method: 'DELETE',
      });

      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe('Forbidden');
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
