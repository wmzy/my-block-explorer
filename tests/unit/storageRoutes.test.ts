// Route-level contract for GET /chains/:chainId/contracts/:address/storage/:slot
// slot-param handling. The 0x-hex branch always 400'd malformed input; the
// decimal branch previously called BigInt() outside any try, so junk like
// 'abc' or '1.5' escaped as a generic 500. Now both shapes answer the same
// 400 family, and valid input keeps the byte-identical success shape
// (decimal slots converted to their 0x-hex form). RpcManager and
// StorageLayoutService are stubbed at the module boundary — no RPC access.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  getStorageLayout: vi.fn(),
  clearCache: vi.fn(),
}));

vi.mock('@/middleware/admin-token', () => ({
  requireAdminTokenIfConfigured: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

vi.mock('@/services/RpcManager', () => ({
  rpcManager: { getClient: mocks.getClient },
}));

vi.mock('@/services/StorageLayoutService', () => ({
  storageLayoutService: {
    getStorageLayout: mocks.getStorageLayout,
    clearCache: mocks.clearCache,
  },
}));

import app from '@/routes/storage';

const CHAIN_ID = 1;
const ADDRESS = '0x1234567890123456789012345678901234567890';
const BASE = `/chains/${CHAIN_ID}/contracts/${ADDRESS}/storage`;

const SLOT_ZERO = `0x${'00'.repeat(31)}00`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockResolvedValue({
    getStorageAt: vi.fn().mockResolvedValue(SLOT_ZERO),
  });
});

describe('GET .../storage/:slot decimal-slot validation', () => {
  it('answers 400 for a non-numeric slot instead of a generic 500', async () => {
    const res = await app.request(`${BASE}/abc`);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Invalid slot: must be a decimal integer',
    });
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it('answers 400 for a fractional slot', async () => {
    const res = await app.request(`${BASE}/1.5`);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Invalid slot: must be a decimal integer',
    });
  });

  it('answers 400 for a negative slot', async () => {
    const res = await app.request(`${BASE}/-5`);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Invalid slot: must be non-negative',
    });
  });

  it('keeps converting a valid decimal slot to its 0x-hex form and answering 200', async () => {
    const res = await app.request(`${BASE}/12`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.slot).toBe('0xc');
    expect(body.value).toBe(SLOT_ZERO);
    expect(mocks.getClient).toHaveBeenCalledTimes(1);
  });

  it('keeps the 0x-hex branch behavior: valid hex passes through untouched', async () => {
    const res = await app.request(`${BASE}/0x000000000000000000000000000000000000000000000000000000000000000c`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.slot).toBe(
      '0x000000000000000000000000000000000000000000000000000000000000000c',
    );
  });

  it('keeps the 0x-hex branch 400 for non-hex characters', async () => {
    const res = await app.request(`${BASE}/0xzz`);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Invalid slot: must be valid hex string',
    });
  });
});
