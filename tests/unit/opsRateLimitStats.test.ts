// getRateLimitStats additive contract: per-NAME totals only (capacity and
// rate from the limiter's config, hits/rejected from in-process counters),
// zero-traffic limiters still listed, the disabled path records nothing,
// resetRateLimiterState clears counters without orphaning configs — and
// the allow/deny decisions are byte-for-byte what they were without the
// counters (burst then 429, refill unchanged).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
  createRateLimiter,
  getRateLimitStats,
  resetRateLimiterState,
} from '@/middleware/rate-limit';

type ConnInfoBindings = { incoming: { socket: { remoteAddress?: string } } };
type TestApp = Hono<{ Bindings: ConnInfoBindings }>;

const makeApp = (name: string): TestApp => {
  const app: TestApp = new Hono();
  app.get(
    '/limited',
    createRateLimiter({ name, requestsPerMinute: 5, burst: 2 }),
    c => c.json({ ok: true }),
  );
  return app;
};

const get = (app: TestApp, ip?: string) =>
  app.request(
    '/limited',
    undefined,
    ip === undefined ? undefined : { incoming: { socket: { remoteAddress: ip } } },
  );

beforeEach(() => {
  resetRateLimiterState();
  vi.useFakeTimers();
  delete process.env.RATE_LIMIT_DISABLED;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getRateLimitStats — additive read-only snapshot', () => {
  it('reports the limiter shape with zero counters before any traffic', () => {
    makeApp('quiet-bucket');
    expect(getRateLimitStats().find(b => b.name === 'quiet-bucket')).toEqual({
      name: 'quiet-bucket',
      capacity: 2,
      requestsPerMinute: 5,
      hits: 0,
      rejected: 0,
    });
  });

  it('counts hits and rejections aggregated by name, never by client', async () => {
    const app = makeApp('busy-bucket');
    // Two different clients: each burns its own burst of 2, each gets one
    // 429. The snapshot may only report per-name totals.
    for (const ip of ['203.0.113.1', '198.51.100.7']) {
      expect((await get(app, ip)).status).toBe(200);
      expect((await get(app, ip)).status).toBe(200);
      expect((await get(app, ip)).status).toBe(429);
    }
    const own = getRateLimitStats().find(bucket => bucket.name === 'busy-bucket');
    expect(own).toMatchObject({ capacity: 2, requestsPerMinute: 5, hits: 6, rejected: 2 });
    // No per-IP data can leave the module through this export: every row
    // is a bare limiter name (no client key, no address shape).
    for (const bucket of getRateLimitStats()) {
      expect(bucket.name).not.toMatch(/[|]/);
      expect(bucket.name).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    }
  });

  it('sorts multiple limiters by name for a stable response', async () => {
    makeApp('zeta-limiter');
    makeApp('alpha-limiter');
    const names = getRateLimitStats().map(bucket => bucket.name);
    expect(names.indexOf('alpha-limiter')).toBeLessThan(names.indexOf('zeta-limiter'));
    expect([...names]).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('records nothing while RATE_LIMIT_DISABLED=1 (requests bypass evaluation)', async () => {
    process.env.RATE_LIMIT_DISABLED = '1';
    const app = makeApp('disabled-bucket');
    for (let i = 0; i < 5; i++) expect((await get(app, '203.0.113.1')).status).toBe(200);
    const own = getRateLimitStats().find(bucket => bucket.name === 'disabled-bucket');
    expect(own).toMatchObject({ hits: 0, rejected: 0 });
  });

  it('resetRateLimiterState clears counters but keeps the config registry', async () => {
    const app = makeApp('reset-bucket');
    await get(app, '203.0.113.1');
    expect(getRateLimitStats().find(b => b.name === 'reset-bucket')?.hits).toBe(1);

    resetRateLimiterState();

    // Counters zero out; the limiter's shape survives (a zero-traffic
    // limiter is still a listed row — route modules register once at
    // module scope and must not be orphaned by a runtime reset).
    expect(getRateLimitStats().find(b => b.name === 'reset-bucket')).toMatchObject({
      capacity: 2,
      requestsPerMinute: 5,
      hits: 0,
      rejected: 0,
    });
  });
});

describe('limiting behavior is unchanged by the counters', () => {
  it('still allows the burst, rejects with 429, and refills identically', async () => {
    const app = makeApp('behavior-bucket');

    expect((await get(app, '203.0.113.1')).status).toBe(200);
    expect((await get(app, '203.0.113.1')).status).toBe(200);
    const rejected = await get(app, '203.0.113.1');
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get('Retry-After')).toBe('12');

    // One refill period (5/min → one token per 12s) re-admits exactly one.
    vi.advanceTimersByTime(12_000);
    expect((await get(app, '203.0.113.1')).status).toBe(200);

    // The decisions above were identical to the pre-stats module; the
    // counters only observed them.
    expect(getRateLimitStats().find(b => b.name === 'behavior-bucket')).toMatchObject({
      capacity: 2,
      requestsPerMinute: 5,
      hits: 4,
      rejected: 1,
    });
  });
});
