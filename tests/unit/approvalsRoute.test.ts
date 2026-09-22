// Approvals route contract: address/chain validation shapes (400s), the
// ?window= clamp-and-degrade and ?refresh=1 literal semantics, the
// honesty-field response envelope, and the REAL per-client rate limiter
// (10/min burst 3 — a fourth immediate request 429s with Retry-After).
// The service is mocked — these tests pin the route wiring, not scan
// semantics (mirroring transfersRouteMode.test.ts / verifyRateLimit.test.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { getAddress } from 'viem';

const mocks = vi.hoisted(() => ({
  getApprovals: vi.fn(),
}));

vi.mock('@/services/ApprovalScanService', () => ({
  approvalScanService: { getApprovals: mocks.getApprovals },
}));

// NOTE: the rate limiter is deliberately NOT mocked — the limiter tests
// below exercise the real bucket. Each test therefore stays within the
// burst (3 requests) and resetRateLimiterState() restores a full bucket.
import approvalsRoutes from '@/routes/approvals';
import { resetRateLimiterState } from '@/middleware/rate-limit';

const app = new Hono();
app.route('/', approvalsRoutes);

// All-lowercase on purpose: it passes shape validation without carrying
// checksum information, and the route forwards the CHECKSUMMED form to
// the service — the assertion uses viem's getAddress mirror of that.
const ADDRESS = '0xaabbccddeeff00112233445566778899aabbccdd';
const CHECKSUMMED = getAddress(ADDRESS);

const resultOf = (overrides: Partial<{
  coverage: 'complete' | 'partial' | 'scan-failed';
  pairCount: number;
  truncated: boolean;
  reason: 'allowance-read-failed';
}> = {}) => ({
  approvals: [
    {
      token: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      spender: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      allowance: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
      isMax: true,
    },
  ],
  scannedAt: '2026-09-22T00:00:00.000Z',
  windowBlocks: 100_000,
  coverage: 'complete' as const,
  pairCount: 1,
  truncated: false,
  ...overrides,
});

const request = (path: string) => app.request(path);

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimiterState();
  mocks.getApprovals.mockResolvedValue(resultOf());
});

describe('GET approvals - validation', () => {
  it('rejects a malformed address with 400 and never reaches the scan', async () => {
    const res = await request('/chains/1/addresses/not-an-address/approvals');

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Invalid address');
    expect(mocks.getApprovals).not.toHaveBeenCalled();
  });

  it('rejects a checksum-mismatched address with 400', async () => {
    // Mixed case that is NOT the EIP-55 checksum of the body.
    const bad = `0xAaBbCcDdEeFf00112233445566778899aAbBcCdE`;
    const res = await request(`/chains/1/addresses/${bad}/approvals`);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Invalid address');
    expect(mocks.getApprovals).not.toHaveBeenCalled();
  });

  it('rejects an unsupported chain with 400', async () => {
    const res = await request(`/chains/999999/addresses/${ADDRESS}/approvals`);

    expect(res.status).toBe(400);
    expect(mocks.getApprovals).not.toHaveBeenCalled();
  });
});

describe('GET approvals - query params', () => {
  it('defaults window to undefined and refresh to false', async () => {
    const res = await request(`/chains/1/addresses/${ADDRESS}/approvals`);

    expect(res.status).toBe(200);
    expect(mocks.getApprovals).toHaveBeenCalledWith(1, CHECKSUMMED, undefined, false);
  });

  it('passes a valid window through and honors the exact refresh literal', async () => {
    const res = await request(`/chains/1/addresses/${ADDRESS}/approvals?window=250000&refresh=1`);

    expect(res.status).toBe(200);
    expect(mocks.getApprovals).toHaveBeenCalledWith(1, CHECKSUMMED, 250_000, true);
  });

  it('degrades junk and out-of-range windows to the default instead of 400ing', async () => {
    const junk = await request(`/chains/1/addresses/${ADDRESS}/approvals?window=abc`);
    expect(junk.status).toBe(200);
    expect(mocks.getApprovals).toHaveBeenLastCalledWith(1, CHECKSUMMED, undefined, false);

    // min(1): a zero window falls back to the default, not a 400.
    const zero = await request(`/chains/1/addresses/${ADDRESS}/approvals?window=0`);
    expect(zero.status).toBe(200);
    expect(mocks.getApprovals).toHaveBeenLastCalledWith(1, CHECKSUMMED, undefined, false);

    // max(50M): an over-clamp window also falls back (schema-level catch,
    // transfers-route philosophy — the service clamps numeric in-range
    // overrides).
    const huge = await request(`/chains/1/addresses/${ADDRESS}/approvals?window=999999999`);
    expect(huge.status).toBe(200);
    expect(mocks.getApprovals).toHaveBeenLastCalledWith(1, CHECKSUMMED, undefined, false);
  });

  it('treats non-literal refresh values as absent', async () => {
    const res = await request(`/chains/1/addresses/${ADDRESS}/approvals?refresh=true`);

    expect(res.status).toBe(200);
    expect(mocks.getApprovals).toHaveBeenCalledWith(1, CHECKSUMMED, undefined, false);
  });
});

describe('GET approvals - response envelope', () => {
  it('echoes the honesty fields, the checksummed address and the chain', async () => {
    const res = await request(`/chains/1/addresses/${ADDRESS}/approvals`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chainId).toBe(1);
    expect(body.address).toBe(CHECKSUMMED);
    expect(body.approvals).toEqual(resultOf().approvals);
    expect(body.scannedAt).toBe('2026-09-22T00:00:00.000Z');
    expect(body.windowBlocks).toBe(100_000);
    expect(body.coverage).toBe('complete');
    expect(body.pairCount).toBe(1);
    expect(body.truncated).toBe(false);
    expect(body.reason).toBeUndefined();
  });

  it('passes the degraded reason through when allowance reads failed', async () => {
    mocks.getApprovals.mockResolvedValue(
      resultOf({
        coverage: 'complete',
        pairCount: 7,
        truncated: false,
        reason: 'allowance-read-failed',
      }),
    );

    const res = await request(`/chains/1/addresses/${ADDRESS}/approvals`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reason).toBe('allowance-read-failed');
    expect(body.pairCount).toBe(7);
  });

  it('maps service failures to a 500 error body', async () => {
    mocks.getApprovals.mockRejectedValue(new Error('rpc exploded'));

    const res = await request(`/chains/1/addresses/${ADDRESS}/approvals`);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to get approvals');
  });
});

describe('GET approvals - rate limiting (real limiter)', () => {
  it('allows the burst of 3 and 429s the fourth with Retry-After', async () => {
    expect((await request(`/chains/1/addresses/${ADDRESS}/approvals`)).status).toBe(200);
    expect((await request(`/chains/1/addresses/${ADDRESS}/approvals`)).status).toBe(200);
    expect((await request(`/chains/1/addresses/${ADDRESS}/approvals`)).status).toBe(200);

    const fourth = await request(`/chains/1/addresses/${ADDRESS}/approvals`);

    expect(fourth.status).toBe(429);
    const body = await fourth.json();
    expect(body.error).toBe('rate_limited');
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(Number(fourth.headers.get('Retry-After'))).toBeGreaterThan(0);
    // The 429 fired before the handler: no scan ran for the rejected hit.
    expect(mocks.getApprovals).toHaveBeenCalledTimes(3);
  });
});
