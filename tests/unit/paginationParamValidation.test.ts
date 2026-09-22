import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@/services/TransactionService', () => ({
  transactionService: {
    getLatestTransactions: vi.fn(),
    getTransactionByHash: vi.fn(),
  },
}));

vi.mock('@/services/AddressService', () => ({
  addressService: {
    getAddressInfo: vi.fn(),
    getPersistentAddressData: vi.fn(),
    getAddressTransactions: vi.fn(),
    clearTransactionsCache: vi.fn(),
  },
}));

// Pagination validation is the behavior under test; the per-client rate
// limiter wired onto the addresses route has dedicated coverage in
// rateLimit.test.ts and would collapse these bursts into its shared
// fallback bucket.
vi.mock('@/middleware/rate-limit', () => ({
  createRateLimiter: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

import transactionsRoutes from '@/routes/transactions';
import addressesRoutes from '@/routes/addresses';
import { transactionService } from '@/services/TransactionService';
import { addressService } from '@/services/AddressService';

const transactionsApp = new Hono();
transactionsApp.route('/', transactionsRoutes);

const addressesApp = new Hono();
addressesApp.route('/', addressesRoutes);

// All-digit address: viem's checksum leaves it byte-identical.
const ADDRESS = '0x1111111111111111111111111111111111111111';

beforeEach(() => {
  vi.mocked(transactionService.getLatestTransactions).mockReset();
  vi.mocked(transactionService.getLatestTransactions).mockResolvedValue({
    transactions: [],
    total: 0,
  });
  vi.mocked(addressService.getAddressTransactions).mockReset();
  vi.mocked(addressService.getAddressTransactions).mockResolvedValue({
    transactions: [],
    total: 0,
    method: 'binary-search',
    coverage: 'partial',
    searchWindowBlocks: 10_000_000,
  });
});

describe('GET /chains/:chainId/transactions — limit param', () => {
  it('keeps the default of 20 when limit is absent', async () => {
    const res = await transactionsApp.request('/chains/1/transactions');
    expect(res.status).toBe(200);
    expect(transactionService.getLatestTransactions).toHaveBeenCalledWith(1, 20, 0);
  });

  it('rejects non-numeric limits with 400 invalid_limit', async () => {
    const res = await transactionsApp.request('/chains/1/transactions?limit=abc');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_limit' });
    expect(transactionService.getLatestTransactions).not.toHaveBeenCalled();
  });

  it('rejects non-positive limits with 400 invalid_limit', async () => {
    for (const limit of ['0', '-5']) {
      const res = await transactionsApp.request(`/chains/1/transactions?limit=${limit}`);
      expect(res.status, `limit=${limit}`).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_limit' });
    }
  });

  it('clamps oversized limits to 100 instead of erroring', async () => {
    const res = await transactionsApp.request('/chains/1/transactions?limit=999999');
    expect(res.status).toBe(200);
    expect(transactionService.getLatestTransactions).toHaveBeenCalledWith(1, 100, 0);
  });

  it('passes a sane limit through untouched', async () => {
    const res = await transactionsApp.request('/chains/1/transactions?limit=5&offset=10');
    expect(res.status).toBe(200);
    expect(transactionService.getLatestTransactions).toHaveBeenCalledWith(1, 5, 10);
  });
});

describe('GET /chains/:chainId/addresses/:address/transactions — page/limit params', () => {
  const requestTx = (query: string) =>
    addressesApp.request(`/chains/1/addresses/${ADDRESS}/transactions${query}`);

  it('keeps the defaults (limit 20, page 1) when params are absent', async () => {
    const res = await requestTx('');
    expect(res.status).toBe(200);
    expect(addressService.getAddressTransactions).toHaveBeenCalledWith(
      1,
      ADDRESS,
      20,
      0,
      undefined,
      // Additive balance-history option (off without ?balanceHistory=1).
      { includeBalancePoints: false },
    );
  });

  it('rejects non-numeric limit with 400 invalid_limit', async () => {
    const res = await requestTx('?limit=abc');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_limit' });
    expect(addressService.getAddressTransactions).not.toHaveBeenCalled();
  });

  it('rejects non-numeric page with 400 invalid_page', async () => {
    const res = await requestTx('?page=abc');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_page' });
    expect(addressService.getAddressTransactions).not.toHaveBeenCalled();
  });

  it('rejects a non-positive limit with 400 invalid_limit', async () => {
    const res = await requestTx('?limit=0');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_limit' });
  });

  it('clamps oversized limits to the existing cap of 50', async () => {
    const res = await requestTx('?limit=9999&page=2');
    expect(res.status).toBe(200);
    expect(addressService.getAddressTransactions).toHaveBeenCalledWith(
      1,
      ADDRESS,
      50,
      50,
      undefined,
      { includeBalancePoints: false },
    );
  });

  it('keeps the existing clamp of pages below 1 to page 1', async () => {
    const res = await requestTx('?page=0&limit=10');
    expect(res.status).toBe(200);
    expect(addressService.getAddressTransactions).toHaveBeenCalledWith(
      1,
      ADDRESS,
      10,
      0,
      undefined,
      { includeBalancePoints: false },
    );
  });
});
