// Ops summary route contract: the OPT-IN admin gate (open with no
// ADMIN_TOKEN — the zero-config local world; 403 once a token is
// configured and the header is missing or wrong), the independent
// per-section degradation ({error:'unavailable'} for a failing section
// while every other section and the 200 stay intact), the always-present
// meta + rateLimit sections, and the 6/min-burst-3 rate bucket. The
// OpsService collectors are faked at the module boundary so this file
// exercises the route's own assembly logic only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { getRateLimitStats, resetRateLimiterState } from '@/middleware/rate-limit';

const collectors = vi.hoisted(() => ({
  meta: {
    version: '0.0.0-test',
    uptimeSeconds: 42,
    timestamp: '2026-09-25T00:00:00.000Z',
  },
  storage: {
    mainDbBytes: 1234,
    perChainDbFiles: [
      { chainType: 'mainnet', name: 'ethereum', chainId: 1, bytes: 99, mtime: '2026-09-25T00:00:00.000Z' },
    ],
    solcCache: { files: 0, bytes: 0 },
  },
  indexing: {
    total: 2,
    chains: [{ chainId: 1, statuses: { completed: 1, error: 1 }, total: 2 }],
  },
  watch: {
    total: 1,
    subscriptions: [{ chainId: 1, address: '0xabc', webhookConfigured: false }],
  },
  deepScan: { total: 0, byStatus: {} },
  collectStorageSummary: vi.fn(),
  collectIndexingSummary: vi.fn(),
  collectWatchSummary: vi.fn(),
  collectDeepScanSummary: vi.fn(),
  collectMetaSummary: vi.fn(),
}));

vi.mock('@/services/OpsService', () => ({
  collectStorageSummary: collectors.collectStorageSummary,
  collectIndexingSummary: collectors.collectIndexingSummary,
  collectWatchSummary: collectors.collectWatchSummary,
  collectDeepScanSummary: collectors.collectDeepScanSummary,
  collectMetaSummary: collectors.collectMetaSummary,
}));

import opsRoutes from '@/routes/ops';

const app = new Hono();
app.route('/api', opsRoutes);

const getSummary = (token?: string) =>
  app.request('/api/ops/summary', {
    headers: token !== undefined ? { 'x-admin-token': token } : {},
  });

const primeHappyCollectors = () => {
  collectors.collectStorageSummary.mockResolvedValue(collectors.storage);
  collectors.collectIndexingSummary.mockResolvedValue(collectors.indexing);
  collectors.collectWatchSummary.mockResolvedValue(collectors.watch);
  collectors.collectDeepScanSummary.mockResolvedValue(collectors.deepScan);
  collectors.collectMetaSummary.mockReturnValue(collectors.meta);
};

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimiterState();
  primeHappyCollectors();
});

afterEach(() => {
  delete process.env.ADMIN_TOKEN;
});

describe('OPT-IN admin gate — open in zero-config local, enforced once configured', () => {
  it('answers 200 with no ADMIN_TOKEN configured and no header sent', async () => {
    delete process.env.ADMIN_TOKEN;
    const res = await getSummary();
    expect(res.status).toBe(200);
    expect((await res.json()).meta).toEqual(collectors.meta);
  });

  it('rejects with 403 once ADMIN_TOKEN is set and the header is missing', async () => {
    process.env.ADMIN_TOKEN = 'test-token';
    const res = await getSummary();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
    expect(body.message).toBe('Invalid admin token.');
  });

  it('rejects a wrong token and accepts the matching one', async () => {
    process.env.ADMIN_TOKEN = 'test-token';
    expect((await getSummary('wrong')).status).toBe(403);
    const ok = await getSummary('test-token');
    expect(ok.status).toBe(200);
    expect((await ok.json()).meta).toEqual(collectors.meta);
  });

  it('never reaches the collectors while rejected by the gate', async () => {
    process.env.ADMIN_TOKEN = 'test-token';
    await getSummary('wrong');
    expect(collectors.collectStorageSummary).not.toHaveBeenCalled();
    expect(collectors.collectMetaSummary).not.toHaveBeenCalled();
  });
});

describe('GET /api/ops/summary — section assembly', () => {
  it('returns every section and a no-store cache header', async () => {
    delete process.env.ADMIN_TOKEN;
    const res = await getSummary();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({
      meta: collectors.meta,
      storage: collectors.storage,
      indexing: collectors.indexing,
      watch: collectors.watch,
      rateLimit: { buckets: expect.any(Array) },
      deepScan: collectors.deepScan,
    });
  });

  it('degrades ONLY the failing section to {error:"unavailable"}', async () => {
    delete process.env.ADMIN_TOKEN;
    // The documented pre-migration case: watch_subscriptions lacks the
    // webhook column and the select throws.
    collectors.collectWatchSummary.mockRejectedValue(
      new Error('Binder Error: Refer to column "webhook_url"'),
    );

    const res = await getSummary();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.watch).toEqual({ error: 'unavailable' });
    expect(body.storage).toEqual(collectors.storage);
    expect(body.indexing).toEqual(collectors.indexing);
    expect(body.deepScan).toEqual(collectors.deepScan);
    expect(body.meta).toEqual(collectors.meta);
    expect(body.rateLimit.buckets).toEqual(expect.any(Array));
  });

  it('stays a 200 with every section degraded when all collectors fail', async () => {
    delete process.env.ADMIN_TOKEN;
    collectors.collectStorageSummary.mockRejectedValue(new Error('EACCES'));
    collectors.collectIndexingSummary.mockRejectedValue(new Error('db locked'));
    collectors.collectWatchSummary.mockRejectedValue(new Error('no such column'));
    collectors.collectDeepScanSummary.mockRejectedValue(new Error('db locked'));

    const res = await getSummary();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.storage).toEqual({ error: 'unavailable' });
    expect(body.indexing).toEqual({ error: 'unavailable' });
    expect(body.watch).toEqual({ error: 'unavailable' });
    expect(body.deepScan).toEqual({ error: 'unavailable' });
    // Process-local facts survive every collector failure.
    expect(body.meta).toEqual(collectors.meta);
    expect(body.rateLimit.buckets).toEqual(expect.any(Array));
  });

  it('lists its own limiter in the rateLimit snapshot with its shape', async () => {
    delete process.env.ADMIN_TOKEN;
    const body = await (await getSummary()).json();
    const own = body.rateLimit.buckets.find(
      (bucket: { name: string }) => bucket.name === 'ops-summary',
    );
    expect(own).toMatchObject({ capacity: 3, requestsPerMinute: 6, hits: 1, rejected: 0 });
  });
});

describe('rate limiting — 6/min, burst 3', () => {
  it('allows the burst then answers 429 with Retry-After', async () => {
    delete process.env.ADMIN_TOKEN;
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => getSummary()),
    );
    expect(responses.slice(0, 3).map(r => r.status)).toEqual([200, 200, 200]);
    expect(responses[3].status).toBe(429);
    expect(responses[3].headers.get('Retry-After')).toMatch(/^\d+$/);
    const body = await responses[3].json();
    expect(body.error).toBe('rate_limited');
  });

  it('counts hits and rejections in the stats snapshot', async () => {
    delete process.env.ADMIN_TOKEN;
    await Promise.all(Array.from({ length: 4 }, () => getSummary()));
    // 4 evaluated requests: the burst of 3 admitted, the 4th rejected —
    // the snapshot totals are facts the dashboard renders.
    const own = getRateLimitStats().find(bucket => bucket.name === 'ops-summary');
    expect(own).toMatchObject({ capacity: 3, requestsPerMinute: 6, hits: 4, rejected: 1 });
  });
});
