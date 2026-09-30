// Route-level contract for GET /chains/:chainId/blocks pagination.
// Previously limit/offset were parseInt'd without NaN checks or caps:
// '?limit=abc' fed NaN into DuckDB, whose error the service catch swallowed
// into an honest-looking EMPTY page, and '?limit=999999999' was accepted
// verbatim. Now the endpoint mirrors transactions.ts: junk or non-positive
// limit → 400 invalid_limit, junk offset → 400 invalid_offset, oversized
// values clamp (limit 100, offset 100_000) and valid requests keep the
// exact success shape. BlockService is stubbed at the module boundary.
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

import app from '@/routes/blocks';

const BASE = '/chains/1/blocks';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getBlocks.mockResolvedValue({ blocks: [], total: 0 });
});

describe('GET .../blocks pagination validation', () => {
  it('answers 400 invalid_limit for a non-numeric limit instead of an empty 200 page', async () => {
    const res = await app.request(`${BASE}?limit=abc`);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_limit' });
    expect(mocks.getBlocks).not.toHaveBeenCalled();
  });

  it('answers 400 for a non-positive limit', async () => {
    const res = await app.request(`${BASE}?limit=0`);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_limit' });
    expect(mocks.getBlocks).not.toHaveBeenCalled();
  });

  it('answers 400 invalid_offset for a non-numeric offset', async () => {
    const res = await app.request(`${BASE}?offset=abc`);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_offset' });
    expect(mocks.getBlocks).not.toHaveBeenCalled();
  });

  it('clamps a runaway limit to 100 (transactions.ts cap policy)', async () => {
    const res = await app.request(`${BASE}?limit=999999999`);

    expect(res.status).toBe(200);
    expect(mocks.getBlocks).toHaveBeenCalledWith(1, 100, 0);
  });

  it('clamps a negative offset to 0', async () => {
    const res = await app.request(`${BASE}?offset=-5`);

    expect(res.status).toBe(200);
    expect(mocks.getBlocks).toHaveBeenCalledWith(1, 20, 0);
  });

  it('keeps defaults (limit 20, offset 0) for absent or empty params', async () => {
    const res = await app.request(`${BASE}?limit=&offset=`);

    expect(res.status).toBe(200);
    expect(mocks.getBlocks).toHaveBeenCalledWith(1, 20, 0);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.chainId).toBe(1);
    expect(body.blocks).toEqual([]);
    expect(body.total).toBe(0);
    expect(res.headers.get('X-Data-Source')).toBe('database');
  });
});
