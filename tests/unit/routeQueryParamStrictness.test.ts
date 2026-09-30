// Junk query params must be rejected, not prefix-parsed, on every list
// route. The route parsers all used parseInt(), which accepts a valid
// prefix and ignores the rest: `?limit=20abc` was served as limit 20,
// `?offset=5abc` as offset 5, `?pageSize=2e1` as 2.
//
// The routes' own comments pin the intended contract:
//   routes/transactions.ts — "Malformed pagination params fail loudly with
//   400 instead of being silently treated as 0 — a wrong page is worse
//   than an error."
//   routes/contracts.ts — "junk fails loudly with 400 instead of silently
//   paging from 0".
// A prefix-parsed junk param instead produced a plausible-looking page
// from a request that should never have succeeded — the exact "silently
// wrong page" failure the comments were written to prevent.
//
// Same bug class as tests/unit/validationStrictness.test.ts (parseInt
// prefix acceptance); these are the sibling call sites on the HTTP surface.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBlocks: vi.fn(),
  getBlockByNumber: vi.fn(),
  getLatestBlock: vi.fn(),
}));

vi.mock('@/services/BlockService', () => ({
  blockService: {
    getBlocks: mocks.getBlocks,
    getBlockByNumber: mocks.getBlockByNumber,
    getLatestBlock: mocks.getLatestBlock,
  },
}));

import blocksApp from '@/routes/blocks';

// Every one of these is a valid number to parseInt followed by junk.
const JUNK_NUMERIC = ['20abc', '2e1', '0x14', ' 5', '5; DROP', '1.5', '+3', '5 '];

describe('GET .../blocks rejects junk that parseInt would prefix-parse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBlocks.mockResolvedValue({ blocks: [], total: 0 });
  });

  for (const junk of JUNK_NUMERIC) {
    it(`answers 400 for ?limit=${encodeURIComponent(junk)} (parseInt would read ${parseInt(junk, 10)})`, async () => {
      const res = await blocksApp.request(
        `/chains/1/blocks?limit=${encodeURIComponent(junk)}`,
      );

      expect(res.status).toBe(400);
      expect(mocks.getBlocks).not.toHaveBeenCalled();
    });

    it(`answers 400 for ?offset=${encodeURIComponent(junk)} (parseInt would read ${parseInt(junk, 10)})`, async () => {
      const res = await blocksApp.request(
        `/chains/1/blocks?offset=${encodeURIComponent(junk)}`,
      );

      expect(res.status).toBe(400);
      expect(mocks.getBlocks).not.toHaveBeenCalled();
    });
  }

  it('still clamps a genuinely negative offset to 0 (documented policy)', async () => {
    // Strict parsing must not swallow the deliberate "negative → 0" clamp
    // that the route's contract states alongside the junk-400 rule.
    const res = await blocksApp.request('/chains/1/blocks?offset=-5');

    expect(res.status).toBe(200);
    expect(mocks.getBlocks).toHaveBeenCalledWith(1, 20, 0);
  });

  it('still accepts well-formed values and keeps the default page', async () => {
    await expect(blocksApp.request('/chains/1/blocks?limit=10&offset=0')).resolves.toMatchObject({
      status: 200,
    });
    // getBlocks(chainId, limit, offset) — the junk cases above must still
    // reach the service with the exact requested values.
    expect(mocks.getBlocks).toHaveBeenCalledWith(1, 10, 0);

    mocks.getBlocks.mockClear();
    await expect(blocksApp.request('/chains/1/blocks')).resolves.toMatchObject({ status: 200 });
    expect(mocks.getBlocks).toHaveBeenCalledWith(1, 20, 0);
  });
});
