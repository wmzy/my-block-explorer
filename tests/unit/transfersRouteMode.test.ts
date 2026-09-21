// Transfers route contract for the ?mode= scan-filter parameter: default
// participant, exact-match validation (an unknown mode is a 400
// invalid_mode, never a silent fallback — it would answer a different
// question than the client asked), and the additive `mode` echo on the
// response. The service is mocked — these tests pin the route wiring,
// not scan semantics (mirroring signaturesRoutes.test.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAddress } from 'viem';

const mocks = vi.hoisted(() => ({
  getTokenTransfers: vi.fn(),
}));

vi.mock('@/services/TokenTransferService', () => ({
  tokenTransferService: { getTokenTransfers: mocks.getTokenTransfers },
}));

// The per-IP token bucket (10/min, burst 3) is not under test here — a
// pass-through keeps the fourth request of the file from 429ing.
vi.mock('@/middleware/rate-limit', () => ({
  createRateLimiter: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import app from '@/routes/transfers';

// All-lowercase on purpose: it passes shape validation without carrying
// checksum information, and the route forwards the CHECKSUMMED form to
// the service — the assertion uses viem's getAddress mirror of that.
const ADDRESS = '0xaabbccddeeff00112233445566778899aabbccdd';
const CHECKSUMMED = getAddress(ADDRESS);

const resultOf = (mode: 'token' | 'participant') => ({
  transfers: [],
  nextCursor: null,
  coverage: 'complete' as const,
  windowBlocks: 100_000,
  scannedAt: '2026-09-21T00:00:00.000Z',
  mode,
});

const request = (path: string) => app.request(path);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTokenTransfers.mockResolvedValue(resultOf('participant'));
});

describe('GET transfers - mode param', () => {
  it('rejects an unknown mode with 400 invalid_mode and never reaches the scan', async () => {
    const res = await request(`/chains/1/addresses/${ADDRESS}/transfers?mode=everything`);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('invalid_mode');
    expect(body.message).toContain('token');
    expect(mocks.getTokenTransfers).not.toHaveBeenCalled();
  });

  it('defaults to participant mode when the param is absent', async () => {
    const res = await request(`/chains/1/addresses/${ADDRESS}/transfers`);

    expect(res.status).toBe(200);
    expect(mocks.getTokenTransfers).toHaveBeenCalledWith(
      1, CHECKSUMMED, 0, 25, undefined, false, 'participant',
    );
    expect(((await res.json()) as { mode: string }).mode).toBe('participant');
  });

  it('passes token mode through and echoes it on the response', async () => {
    mocks.getTokenTransfers.mockResolvedValue(resultOf('token'));

    const res = await request(`/chains/1/addresses/${ADDRESS}/transfers?mode=token`);

    expect(res.status).toBe(200);
    expect(mocks.getTokenTransfers).toHaveBeenCalledWith(
      1, CHECKSUMMED, 0, 25, undefined, false, 'token',
    );
    expect(((await res.json()) as { mode: string }).mode).toBe('token');
  });

  it('accepts an explicit participant mode', async () => {
    const res = await request(`/chains/1/addresses/${ADDRESS}/transfers?mode=participant`);

    expect(res.status).toBe(200);
    expect(mocks.getTokenTransfers).toHaveBeenCalledWith(
      1, CHECKSUMMED, 0, 25, undefined, false, 'participant',
    );
  });
});
