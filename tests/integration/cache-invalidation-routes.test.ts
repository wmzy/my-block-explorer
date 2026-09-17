import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '@/api-app';

// Partial mock: real schema table exports stay intact; the db client is
// faked so no DuckDB file is opened. The clear-cache routes only issue
// deletes, which resolve to no-ops.
vi.mock('@/database/init', async importOriginal => {
  const actual = await importOriginal<typeof import('@/database/init')>();
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({ from: vi.fn().mockResolvedValue([]) })),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    },
  };
});

const chainId = 1;
const contractAddress = '0x1234567890123456789012345678901234567890';

describe('Cache invalidation routes (admin-gated)', () => {
  describe('POST /api/chains/:chainId/contracts/:address/clear-cache', () => {
    beforeEach(() => {
      vi.stubEnv('ADMIN_TOKEN', '');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('rejects without a token (fail-closed)', async () => {
      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/clear-cache`,
        { method: 'POST' },
      );

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe('Forbidden');
      expect(data.message).toBe(
        'Admin operations are disabled. Set ADMIN_TOKEN on the server to enable them.',
      );
    });

    it('rejects a wrong token', async () => {
      vi.stubEnv('ADMIN_TOKEN', 'test-admin-token');

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/clear-cache`,
        { method: 'POST', headers: { 'x-admin-token': 'wrong-token' } },
      );

      expect(response.status).toBe(403);
    });

    it('clears the contract source cache with a matching token', async () => {
      vi.stubEnv('ADMIN_TOKEN', 'test-admin-token');

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/clear-cache`,
        { method: 'POST', headers: { 'x-admin-token': 'test-admin-token' } },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe('Cache cleared');
    });
  });

  describe('DELETE /api/chains/:chainId/contracts/:address/storage-layout/cache', () => {
    beforeEach(() => {
      vi.stubEnv('ADMIN_TOKEN', '');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('rejects without a token (fail-closed)', async () => {
      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/storage-layout/cache`,
        { method: 'DELETE' },
      );

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe('Forbidden');
    });

    it('rejects a wrong token', async () => {
      vi.stubEnv('ADMIN_TOKEN', 'test-admin-token');

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/storage-layout/cache`,
        { method: 'DELETE', headers: { 'x-admin-token': 'nope' } },
      );

      expect(response.status).toBe(403);
    });

    it('returns success with a matching token even when nothing was cached', async () => {
      vi.stubEnv('ADMIN_TOKEN', 'test-admin-token');

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/storage-layout/cache`,
        { method: 'DELETE', headers: { 'x-admin-token': 'test-admin-token' } },
      );

      // clearCache treats a missing entry as a no-op delete, so absent
      // cache rows still surface as a successful clear.
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ success: true, message: 'Storage layout cache cleared' });
    });
  });
});
