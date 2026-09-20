import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@/services/AddressService', () => ({
  addressService: {
    getAddressInfo: vi.fn(),
    getPersistentAddressData: vi.fn(),
    getAddressTransactions: vi.fn(),
    clearTransactionsCache: vi.fn(),
  },
}));

// The route is rate-limited per client, and test requests share the single
// no-conninfo fallback bucket (burst 3) — this file fires 8 requests in
// well under a second. The limiter has its own dedicated coverage in
// rateLimit.test.ts; here it is a pass-through.
vi.mock('@/middleware/rate-limit', () => ({
  createRateLimiter: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

import addressesRoutes from '@/routes/addresses';
import { addressService } from '@/services/AddressService';
import type { AddressTransactionsResult } from '@/services/AddressService';

// All-digit address: viem's checksum leaves it byte-identical, so the
// service receives exactly the string in the URL.
const ROUTE_ADDRESS = '0x1111111111111111111111111111111111111111';

const app = new Hono();
app.route('/', addressesRoutes);

const mockTxResult = (): AddressTransactionsResult => ({
  transactions: [],
  total: 0,
  method: 'binary-search',
  coverage: 'partial',
  searchWindowBlocks: 10_000_000,
});

const requestTx = (query: string) =>
  app.request(`/chains/1/addresses/${ROUTE_ADDRESS}/transactions${query}`);

describe('GET /chains/:chainId/addresses/:address/transactions — window param', () => {
  beforeEach(() => {
    vi.mocked(addressService.getAddressTransactions).mockReset();
    vi.mocked(addressService.getAddressTransactions).mockResolvedValue(mockTxResult());
  });

  it('passes a numeric window through to the service and echoes it', async () => {
    const res = await requestTx('?window=10000000');

    expect(res.status).toBe(200);
    expect(addressService.getAddressTransactions).toHaveBeenCalledWith(
      1,
      ROUTE_ADDRESS,
      20,
      0,
      10_000_000,
    );
    const body = await res.json();
    expect(body.searchWindowBlocks).toBe(10_000_000);
    expect(body.coverage).toBe('partial');
  });

  it('ignores a non-numeric window (service gets undefined)', async () => {
    await requestTx('?window=abc');

    expect(addressService.getAddressTransactions).toHaveBeenCalledWith(
      1,
      ROUTE_ADDRESS,
      20,
      0,
      undefined,
    );
  });

  it('ignores partially numeric and empty window values', async () => {
    await requestTx('?window=12abc');
    expect(addressService.getAddressTransactions).toHaveBeenLastCalledWith(
      1,
      ROUTE_ADDRESS,
      20,
      0,
      undefined,
    );

    await requestTx('?window=');
    expect(addressService.getAddressTransactions).toHaveBeenLastCalledWith(
      1,
      ROUTE_ADDRESS,
      20,
      0,
      undefined,
    );
  });

  it('forwards window together with page/limit pagination', async () => {
    await requestTx('?page=2&limit=10&window=5000000');

    expect(addressService.getAddressTransactions).toHaveBeenCalledWith(
      1,
      ROUTE_ADDRESS,
      10,
      10,
      5_000_000,
    );
  });

  it('omits window from the response payload when the service has none', async () => {
    vi.mocked(addressService.getAddressTransactions).mockResolvedValue({
      transactions: [],
      total: 0,
      method: 'binary-search',
      coverage: 'partial',
      reason: 'no-outgoing-transactions',
    });

    const res = await requestTx('');
    const body = await res.json();

    expect(body.searchWindowBlocks).toBeUndefined();
    expect(body.reason).toBe('no-outgoing-transactions');
    expect(body.total).toBe(0);
  });
});
