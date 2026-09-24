// Watch route contract: address/chain validation, PUT body validation
// (label ≤100, cleared by absence/null/empty), the honest 400s mapped
// from the service (rpc_unavailable / watch_full), the events limit
// (default 25, capped at 100, non-positive → 400), the admin gate and
// the 5/min write limiter, and DELETE 204/404. The WatchService is
// faked — these tests pin the route wiring, not the service (whose pure
// parts live in watchService.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

const serviceMocks = vi.hoisted(() => ({
  listSubscriptions: vi.fn(),
  upsertSubscription: vi.fn(),
  removeSubscription: vi.fn(),
  recentEvents: vi.fn(),
  subscribeChainEvents: vi.fn(),
  start: vi.fn(),
}));

vi.mock('@/services/WatchService', () => ({
  watchService: serviceMocks,
  WATCH_EVENTS_DEFAULT_LIMIT: 25,
  WATCH_EVENTS_MAX_LIMIT: 100,
  WATCH_GAP_BLOCK_CAP: 200,
  WATCH_RING_CAPACITY: 100,
  WATCH_MAX_SUBSCRIPTIONS_PER_CHAIN: 25,
  WATCH_TICK_INTERVAL_MS: 4_000,
  WATCH_GETLOGS_CONCURRENCY: 5,
}));

import watchRoutes from '@/routes/watch';
import { resetRateLimiterState } from '@/middleware/rate-limit';

const app = new Hono();
app.route('/', watchRoutes);

// All-digit address: checksum-neutral, so the exact (lowercased) string
// reaches the storage key.
const WATCH_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const SUBSCRIPTION_VIEW = {
  chainId: 1,
  address: WATCH_ADDRESS,
  label: null,
  lastProcessedBlock: null,
  createdAt: '2026-09-23T10:00:00.000Z',
  updatedAt: '2026-09-23T10:00:00.000Z',
};

const request = (path: string, init?: RequestInit) => app.request(path, init);

const put = (body?: unknown, headers: Record<string, string> = {}) =>
  request(`/chains/1/watch/${WATCH_ADDRESS}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimiterState();
  process.env.RATE_LIMIT_DISABLED = '1';
  delete process.env.ADMIN_TOKEN;
});

afterEach(() => {
  delete process.env.ADMIN_TOKEN;
  delete process.env.RATE_LIMIT_DISABLED;
});

describe('GET /chains/:chainId/watch', () => {
  it('lists the chain’s subscriptions', async () => {
    serviceMocks.listSubscriptions.mockResolvedValue([SUBSCRIPTION_VIEW]);
    const res = await request('/chains/1/watch');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ subscriptions: [SUBSCRIPTION_VIEW] });
    expect(serviceMocks.listSubscriptions).toHaveBeenCalledWith(1);
  });

  it('serves an empty list for a chain with none', async () => {
    serviceMocks.listSubscriptions.mockResolvedValue([]);
    const res = await request('/chains/137/watch');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ subscriptions: [] });
  });

  it('rejects an unsupported chain with 400', async () => {
    const res = await request('/chains/424242424242424/watch');
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_request' });
  });
});

describe('PUT /chains/:chainId/watch/:address — validation', () => {
  it('upserts with a null label for an empty body', async () => {
    serviceMocks.upsertSubscription.mockResolvedValue({
      ok: true,
      subscription: SUBSCRIPTION_VIEW,
    });
    const res = await request(`/chains/1/watch/${WATCH_ADDRESS}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ subscription: SUBSCRIPTION_VIEW });
    // Storage key is lowercased even for checksummed input.
    expect(serviceMocks.upsertSubscription).toHaveBeenCalledWith(1, WATCH_ADDRESS, null);
  });

  it('trims the label and clears it on empty/null', async () => {
    serviceMocks.upsertSubscription.mockResolvedValue({
      ok: true,
      subscription: { ...SUBSCRIPTION_VIEW, label: 'Hot wallet' },
    });
    const res = await put({ label: '  Hot wallet  ' });
    expect(res.status).toBe(200);
    expect(serviceMocks.upsertSubscription).toHaveBeenCalledWith(1, WATCH_ADDRESS, 'Hot wallet');

    await put({ label: null });
    expect(serviceMocks.upsertSubscription).toHaveBeenLastCalledWith(1, WATCH_ADDRESS, null);

    await put({});
    expect(serviceMocks.upsertSubscription).toHaveBeenLastCalledWith(1, WATCH_ADDRESS, null);
  });

  it.each([
    ['label over 100 chars', { label: 'x'.repeat(101) }],
    ['non-string label', { label: 7 }],
    ['array body', ['x']],
  ])('rejects %s with 400 invalid_label', async (_name, body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_label' });
    expect(serviceMocks.upsertSubscription).not.toHaveBeenCalled();
  });

  it('rejects a malformed address with 400 before touching the service', async () => {
    const res = await request('/chains/1/watch/notanaddress', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(serviceMocks.upsertSubscription).not.toHaveBeenCalled();
  });

  it('maps the service’s honest refusals to 400 with their messages', async () => {
    serviceMocks.upsertSubscription.mockResolvedValue({
      ok: false,
      error: 'rpc_unavailable',
      message: 'Chain 1 has no RPC URL configured — set one …',
    });
    const res = await put({});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('rpc_unavailable');
    expect(body.message).toContain('RPC');

    serviceMocks.upsertSubscription.mockResolvedValue({
      ok: false,
      error: 'watch_full',
      message: 'Watch limit reached for chain 1 (25 addresses)…',
    });
    const full = await put({});
    expect(full.status).toBe(400);
    await expect(full.json()).resolves.toMatchObject({ error: 'watch_full' });
  });
});

describe('DELETE /chains/:chainId/watch/:address', () => {
  it('removes an existing subscription with 204 and an empty body', async () => {
    serviceMocks.removeSubscription.mockResolvedValue(true);
    const res = await request(`/chains/1/watch/${WATCH_ADDRESS}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(serviceMocks.removeSubscription).toHaveBeenCalledWith(1, WATCH_ADDRESS);
  });

  it('returns 404 watch_not_found when absent', async () => {
    serviceMocks.removeSubscription.mockResolvedValue(false);
    const res = await request(`/chains/1/watch/${WATCH_ADDRESS}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'watch_not_found' });
  });
});

describe('GET /chains/:chainId/watch/events', () => {
  it('serves the ring buffer newest-first with the default limit 25', async () => {
    serviceMocks.recentEvents.mockReturnValue([]);
    const res = await request('/chains/1/watch/events');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ events: [] });
    expect(serviceMocks.recentEvents).toHaveBeenCalledWith(1, 25);
  });

  it('passes an explicit limit and clamps oversized asks to 100', async () => {
    serviceMocks.recentEvents.mockReturnValue([]);
    await request('/chains/1/watch/events?limit=5');
    expect(serviceMocks.recentEvents).toHaveBeenLastCalledWith(1, 5);

    await request('/chains/1/watch/events?limit=5000');
    expect(serviceMocks.recentEvents).toHaveBeenLastCalledWith(1, 100);
  });

  it.each([
    ['non-numeric limit', 'abc'],
    ['zero limit', '0'],
    ['negative limit', '-3'],
    ['float limit', '2.5'],
  ])('rejects a %s with 400 invalid_limit', async (_name, limit) => {
    const res = await request(`/chains/1/watch/events?limit=${limit}`);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_limit' });
  });
});

describe('admin gating and rate limiting on writes', () => {
  it('PUT with a wrong token is rejected 403 and the service is untouched', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const res = await put({}, { 'x-admin-token': 'wrong' });
    expect(res.status).toBe(403);
    expect(serviceMocks.upsertSubscription).not.toHaveBeenCalled();
  });

  it('PUT with the right token passes the gate', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    serviceMocks.upsertSubscription.mockResolvedValue({
      ok: true,
      subscription: SUBSCRIPTION_VIEW,
    });
    const res = await put({}, { 'x-admin-token': 'secret' });
    expect(res.status).toBe(200);
  });

  it('DELETE with a wrong token is rejected 403', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const res = await request(`/chains/1/watch/${WATCH_ADDRESS}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': 'wrong' },
    });
    expect(res.status).toBe(403);
    expect(serviceMocks.removeSubscription).not.toHaveBeenCalled();
  });

  it('rate-limits writes beyond the 5/min burst', async () => {
    delete process.env.RATE_LIMIT_DISABLED;
    resetRateLimiterState();
    serviceMocks.upsertSubscription.mockResolvedValue({
      ok: true,
      subscription: SUBSCRIPTION_VIEW,
    });

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await put({});
      statuses.push(res.status);
    }
    // Burst of 5 writes, then the 6th within the window is a 429.
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
    expect(serviceMocks.upsertSubscription).toHaveBeenCalledTimes(5);
  });
});
