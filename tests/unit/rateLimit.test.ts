import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
  createRateLimiter,
  resetRateLimiterState,
  sweepStaleBuckets,
} from '@/middleware/rate-limit';

// The env shape @hono/node-server's serve() installs on every request;
// passing it as app.request()'s third argument simulates a remote address.
// Omitting it (undefined env) reproduces the Vite dev bridge, which serves
// api-app via app.fetch() with no conninfo binding at all.
type ConnInfoBindings = { incoming: { socket: { remoteAddress?: string } } };
type TestApp = Hono<{ Bindings: ConnInfoBindings }>;

// 5 tokens/min, burst 2: one token every 12s — small numbers keep every
// refill expectation exact.
const makeApp = (): TestApp => {
  const app: TestApp = new Hono();
  app.get(
    '/limited',
    createRateLimiter({ name: 'test-bucket', requestsPerMinute: 5, burst: 2 }),
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

describe('token bucket arithmetic', () => {
  it('allows the burst, then rejects with 429 and Retry-After', async () => {
    const app = makeApp();

    expect((await get(app, '203.0.113.1')).status).toBe(200);
    expect((await get(app, '203.0.113.1')).status).toBe(200);

    const res = await get(app, '203.0.113.1');
    expect(res.status).toBe(429);
    // 5/min means one token per 12s — the exact refill wait for 1 token.
    expect(res.headers.get('Retry-After')).toBe('12');
    expect(await res.json()).toMatchObject({
      error: 'rate_limited',
      retryAfterSeconds: 12,
    });
  });

  it('refills over time and allows again after the wait', async () => {
    const app = makeApp();
    await get(app, '203.0.113.1');
    await get(app, '203.0.113.1');
    expect((await get(app, '203.0.113.1')).status).toBe(429);

    vi.advanceTimersByTime(12_000);
    expect((await get(app, '203.0.113.1')).status).toBe(200);
    // That was the single refilled token — the next is rejected again.
    expect((await get(app, '203.0.113.1')).status).toBe(429);
  });

  it('keeps fractional refill progress across rejected polls', async () => {
    const app = makeApp();
    await get(app, '203.0.113.1');
    await get(app, '203.0.113.1');

    // Poll at 4s and 8s: each rejection must preserve its 1/3-token of
    // refill instead of resetting the clock, so 12s total still grants
    // one request.
    vi.advanceTimersByTime(4_000);
    expect((await get(app, '203.0.113.1')).status).toBe(429);
    vi.advanceTimersByTime(4_000);
    expect((await get(app, '203.0.113.1')).status).toBe(429);
    vi.advanceTimersByTime(4_000);
    expect((await get(app, '203.0.113.1')).status).toBe(200);
  });

  it('caps the bucket at the burst size after long idle', async () => {
    const app = makeApp();
    await get(app, '203.0.113.1');

    // 100s idle refills 8+ tokens worth at 5/min, and stays under the
    // 300s sweep TTL, so the burst cap is the only thing that can bound
    // the next burst at 2.
    vi.advanceTimersByTime(100_000);
    expect((await get(app, '203.0.113.1')).status).toBe(200);
    expect((await get(app, '203.0.113.1')).status).toBe(200);
    expect((await get(app, '203.0.113.1')).status).toBe(429);
  });
});

describe('bucket partitioning', () => {
  it('gives each client IP its own bucket', async () => {
    const app = makeApp();

    for (const ip of ['203.0.113.1', '203.0.113.2']) {
      expect((await get(app, ip)).status).toBe(200);
      expect((await get(app, ip)).status).toBe(200);
      expect((await get(app, ip)).status).toBe(429);
    }
  });

  it('merges IPv4-mapped IPv6 with the plain IPv4 form', async () => {
    const app = makeApp();

    expect((await get(app, '::ffff:203.0.113.7')).status).toBe(200);
    expect((await get(app, '::ffff:203.0.113.7')).status).toBe(200);
    // Same peer via the plain form — same bucket, so this is the 3rd hit.
    expect((await get(app, '203.0.113.7')).status).toBe(429);
  });

  it('keeps limiter names in separate buckets', async () => {
    const app = new Hono();
    // Burst 1 each: the second request must 429 within one name.
    app.get('/a', createRateLimiter({ name: 'limiter-a', requestsPerMinute: 60, burst: 1 }), c => c.json({ ok: true }));
    app.get('/b', createRateLimiter({ name: 'limiter-b', requestsPerMinute: 60, burst: 1 }), c => c.json({ ok: true }));

    expect((await app.request('/a')).status).toBe(200);
    expect((await app.request('/a')).status).toBe(429);
    // The other limiter's bucket is untouched.
    expect((await app.request('/b')).status).toBe(200);
  });

  it('falls back to one shared bucket when no conninfo is available', async () => {
    const app = makeApp();

    // No env binding at all — the Vite dev bridge path. Every request
    // collapses into the same fallback bucket instead of bypassing.
    expect((await get(app)).status).toBe(200);
    expect((await get(app)).status).toBe(200);
    expect((await get(app)).status).toBe(429);
  });
});

describe('stale bucket sweeping', () => {
  it('drops buckets idle past the TTL and grants a fresh burst', async () => {
    const app = makeApp();
    await get(app, '203.0.113.1');

    vi.advanceTimersByTime(300_001);
    expect(sweepStaleBuckets()).toBe(1);

    // The swept client starts over at full burst.
    expect((await get(app, '203.0.113.1')).status).toBe(200);
    expect((await get(app, '203.0.113.1')).status).toBe(200);
    expect((await get(app, '203.0.113.1')).status).toBe(429);
  });

  it('keeps recently active buckets', async () => {
    const app = makeApp();
    await get(app, '203.0.113.1');
    await get(app, '203.0.113.1'); // bucket 1 exhausted
    await get(app, '203.0.113.2'); // bucket 2 half spent

    vi.advanceTimersByTime(10_000);
    expect(sweepStaleBuckets()).toBe(0);
    // Bucket 1 has only 10s × 5/min = 0.83 tokens — not enough yet; bucket
    // 2 still holds its unspent token. Both survived the sweep.
    expect((await get(app, '203.0.113.1')).status).toBe(429);
    expect((await get(app, '203.0.113.2')).status).toBe(200);
  });
});

describe('RATE_LIMIT_DISABLED switch', () => {
  it('passes everything through while disabled, then re-enables', async () => {
    const app = makeApp();
    process.env.RATE_LIMIT_DISABLED = '1';

    for (let i = 0; i < 6; i++) {
      expect((await get(app, '203.0.113.1')).status).toBe(200);
    }

    // Disabled requests never touch the buckets, so re-enabling starts
    // from a fresh burst rather than a backlog of debt.
    delete process.env.RATE_LIMIT_DISABLED;
    expect((await get(app, '203.0.113.1')).status).toBe(200);
    expect((await get(app, '203.0.113.1')).status).toBe(200);
    expect((await get(app, '203.0.113.1')).status).toBe(429);
  });
});

describe('factory config validation', () => {
  it('rejects nonsensical quotas at construction time', () => {
    expect(() => createRateLimiter({ name: 'x', requestsPerMinute: 0, burst: 1 })).toThrow();
    expect(() => createRateLimiter({ name: 'x', requestsPerMinute: 60, burst: 0 })).toThrow();
  });
});
