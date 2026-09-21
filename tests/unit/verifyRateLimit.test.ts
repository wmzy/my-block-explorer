// The verify route's real rate limiter (not mocked here, unlike
// verifyRoutes.test.ts): one external Sourcify POST per submission with a
// 30s upstream budget, so the endpoint gets 3/min with a burst of 1 —
// the first request passes, an immediate second 429s, and a fresh token
// arrives only after a full 20s refill period.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@/services/ContractSourceService', () => ({
  contractSourceService: {
    clearCache: vi.fn(async () => undefined),
    getContractSource: vi.fn(async () => null),
  },
}));

import verifyRoutes from '@/routes/verify';
import { resetRateLimiterState } from '@/middleware/rate-limit';
import { contractVerifyService } from '@/services/ContractVerifyService';

const app = new Hono();
app.route('/', verifyRoutes);

const PATH = '/chains/1/contracts/0x1111111111111111111111111111111111111111/verify';
const BODY = JSON.stringify({ files: { 'metadata.json': '{}' } });

const submitSpy = vi.spyOn(contractVerifyService, 'submitVerification');

const post = () =>
  app.request(PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: BODY,
  });

beforeEach(() => {
  resetRateLimiterState();
  delete process.env.ADMIN_TOKEN;
  submitSpy.mockReset();
  // A domain refusal keeps each probe request cheap (no source refresh).
  submitSpy.mockResolvedValue({ ok: false, kind: 'rejected', message: 'x' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST .../verify - rate limiting', () => {
  it('allows the first request and 429s an immediate second (burst 1)', async () => {
    expect((await post()).status).toBe(200);

    const second = await post();

    expect(second.status).toBe(429);
    const body = await second.json();
    expect(body.error).toBe('rate_limited');
    expect(Number(second.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('refills at 3/min: a new request passes only after a full 20s period', async () => {
    // Only Date is faked — the bucket math is pure Date.now() arithmetic
    // and the request path needs no timers.
    vi.useFakeTimers({ toFake: ['Date'] });

    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(429);

    // One token shy: 19s into the minute the bucket has not refilled.
    vi.setSystemTime(Date.now() + 19_000);
    expect((await post()).status).toBe(429);

    // At 20s the third-of-a-minute token lands.
    vi.setSystemTime(Date.now() + 1_000);
    expect((await post()).status).toBe(200);
  });
});
