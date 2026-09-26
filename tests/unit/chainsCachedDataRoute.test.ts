// DELETE /api/chains/:chainId/cached-data route contract (dev-chain
// reset recovery): honest counted response with an explicit scope note,
// 400s for invalid/unsupported ids, the opt-in admin gate (open in a
// zero-config session, enforced when ADMIN_TOKEN is set), a tight rate
// limit bucket, and 500 mapping when the database layer fails. The
// drizzle layer is faked (customChainsRoutes.test.ts pattern) so the
// REAL service runs behind the real route.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import { resetRateLimiterState } from '@/middleware/rate-limit';
import { contractSources, storageLayouts } from '@/database/schema';

const dbState = vi.hoisted(() => {
  const counts: Record<string, number> = { contract_sources: 2, storage_layouts: 1 };
  return {
    counts,
    deleted: [] as Array<string>,
    deleteError: null as Error | null,
  };
});

vi.mock('@/database/drizzle', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          then: (resolve: unknown, reject: unknown) => {
            const name = table === contractSources
              ? 'contract_sources'
              : table === storageLayouts
                ? 'storage_layouts'
                : String(table);
            return Promise.resolve([{ count: dbState.counts[name] ?? 0 }]).then(
              resolve as never,
              reject as never,
            );
          },
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        const name = table === contractSources
          ? 'contract_sources'
          : table === storageLayouts
            ? 'storage_layouts'
            : String(table);
        dbState.deleted.push(name);
        if (dbState.deleteError) return Promise.reject(dbState.deleteError);
        return Promise.resolve([]);
      },
    }),
  },
}));

vi.mock('@/services/RpcManager', () => ({
  rpcManager: { reloadConfigs: vi.fn() },
}));

import chainsRoutes from '@/routes/chains';

const app = new Hono();
app.route('/', chainsRoutes);

const clear = (chainId: string, headers: Record<string, string> = {}) =>
  app.request(`/chains/${chainId}/cached-data`, { method: 'DELETE', headers });

const envBefore = vi.hoisted(() => ({ ADMIN_TOKEN: '', RATE_LIMIT_DISABLED: '' }));

beforeAll(() => {
  envBefore.ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
  envBefore.RATE_LIMIT_DISABLED = process.env.RATE_LIMIT_DISABLED ?? '';
});

afterAll(() => {
  process.env.ADMIN_TOKEN = envBefore.ADMIN_TOKEN;
  process.env.RATE_LIMIT_DISABLED = envBefore.RATE_LIMIT_DISABLED;
});

beforeEach(() => {
  vi.clearAllMocks();
  dbState.counts = { contract_sources: 2, storage_layouts: 1 };
  dbState.deleted.length = 0;
  dbState.deleteError = null;
  resetRateLimiterState();
  delete process.env.ADMIN_TOKEN;
  // The limiter would 429 repeat assertions inside one test.
  process.env.RATE_LIMIT_DISABLED = '1';
});

afterEach(() => {
  delete process.env.ADMIN_TOKEN;
});

describe('DELETE /chains/:chainId/cached-data', () => {
  it('clears both immutable caches for the chain and reports honest counted numbers', async () => {
    const res = await clear('31337');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cleared).toEqual({ contractSources: 2, storageLayouts: 1 });
    expect(dbState.deleted).toEqual(['contract_sources', 'storage_layouts']);
  });

  it('documents the scope honestly: event DB files are untouched', async () => {
    const res = await clear('1');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.scope.cleared).toEqual(['contract sources', 'storage layouts']);
    expect(String(body.scope.untouched)).toContain('event index database files');
  });

  it('reports honest zeros when the chain has no cached rows', async () => {
    dbState.counts = { contract_sources: 0, storage_layouts: 0 };

    const res = await clear('31337');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cleared).toEqual({ contractSources: 0, storageLayouts: 0 });
  });

  it('answers 400 for a non-numeric chain id', async () => {
    const res = await clear('abc');

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Invalid chain ID');
    expect(dbState.deleted).toEqual([]);
  });

  it('answers 400 for an unsupported chain id', async () => {
    const res = await clear('999999');

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Unsupported chain');
    expect(dbState.deleted).toEqual([]);
  });

  it('answers 500 when the database layer fails', async () => {
    dbState.deleteError = new Error('duckdb: database is locked');

    const res = await clear('31337');

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to clear chain cached data');
  });
});

describe('admin gate (opt-in tier)', () => {
  it('works without a token in a zero-config session', async () => {
    const res = await clear('31337');

    expect(res.status).toBe(200);
  });

  it('enforces ADMIN_TOKEN when configured: 403 without/with a wrong token, 200 with the right one', async () => {
    process.env.ADMIN_TOKEN = 'sekret';

    const noToken = await clear('31337');
    expect(noToken.status).toBe(403);

    const wrongToken = await clear('31337', { 'x-admin-token': 'nope' });
    expect(wrongToken.status).toBe(403);
    expect(dbState.deleted).toEqual([]);

    const rightToken = await clear('31337', { 'x-admin-token': 'sekret' });
    expect(rightToken.status).toBe(200);
    expect(dbState.deleted).toEqual(['contract_sources', 'storage_layouts']);
  });
});

describe('rate limit', () => {
  beforeEach(() => {
    delete process.env.RATE_LIMIT_DISABLED;
  });

  it('admits the burst allowance then answers 429', async () => {
    const first = await clear('31337');
    const second = await clear('31337');
    const third = await clear('31337');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
  });
});
