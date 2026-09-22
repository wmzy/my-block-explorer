// Route-level tests for the additive ?balanceHistory=1 payload of
// GET /chains/:chainId/addresses/:address/transactions: the opt-in
// attaches balancePoints/balancePointsCount, any other param value (or
// none) keeps the response byte-identical for existing consumers, and
// the service receives the option explicitly.
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

// Pass-through: the limiter has its own coverage in rateLimit.test.ts.
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

// One discovered tx (incoming 1 wei at block 100) — the pure computation
// under test runs in the mocked service's return value, so the fixture
// mirrors what the real service would attach.
const mockTxResult = (): AddressTransactionsResult => ({
  transactions: [
    {
      hash: '0xtx100',
      blockNumber: 100n,
      fromAddress: '0x9999999999999999999999999999999999999999',
      toAddress: ROUTE_ADDRESS,
      value: '1',
      timestamp: '2026-01-01T00:00:00.000Z',
    },
  ],
  total: 1,
  method: 'binary-search',
  coverage: 'partial',
  searchWindowBlocks: 10_000_000,
  balancePoints: [
    { blockNumber: '100', timestamp: '2026-01-01T00:00:00.000Z', cumulativeValue: '0' },
    { blockNumber: '100', timestamp: '2026-01-01T00:00:00.000Z', cumulativeValue: '1' },
  ],
});

const requestTx = (query: string) =>
  app.request(`/chains/1/addresses/${ROUTE_ADDRESS}/transactions${query}`);

beforeEach(() => {
  vi.mocked(addressService.getAddressTransactions).mockReset();
  vi.mocked(addressService.getAddressTransactions).mockResolvedValue(mockTxResult());
});

describe('GET .../transactions — ?balanceHistory=1 opt-in', () => {
  it('attaches balancePoints and balancePointsCount on the literal opt-in', async () => {
    const res = await requestTx('?balanceHistory=1');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balancePoints).toEqual([
      { blockNumber: '100', timestamp: '2026-01-01T00:00:00.000Z', cumulativeValue: '0' },
      { blockNumber: '100', timestamp: '2026-01-01T00:00:00.000Z', cumulativeValue: '1' },
    ]);
    // Count includes the leading 0 anchor.
    expect(body.balancePointsCount).toBe(2);
  });

  it('forwards the option to the service alongside the usual params', async () => {
    await requestTx('?balanceHistory=1&page=2&limit=10&window=5000000');

    expect(addressService.getAddressTransactions).toHaveBeenCalledWith(
      1,
      ROUTE_ADDRESS,
      10,
      10,
      5_000_000,
      { includeBalancePoints: true },
    );
  });

  it('keeps every existing response field byte-identical when opted out', async () => {
    const res = await requestTx('');

    expect(res.status).toBe(200);
    const body = await res.json();
    // The additive fields are absent, not null/empty.
    expect('balancePoints' in body).toBe(false);
    expect('balancePointsCount' in body).toBe(false);
    // The pre-existing contract is untouched. (tx rows carry no
    // timestamp: formatTransactionForApi only converts Date instances,
    // and the discovered set stores ISO strings — pre-existing behavior
    // this additive change deliberately does not alter.)
    expect(body.chainId).toBe(1);
    expect(body.address).toBe(ROUTE_ADDRESS);
    expect(body.total).toBe(1);
    expect(body.method).toBe('binary-search');
    expect(body.coverage).toBe('partial');
    expect(body.searchWindowBlocks).toBe(10_000_000);
    expect(body.pagination).toEqual({ page: 1, limit: 20, totalPages: 1, total: 1 });
    expect(body.transactions).toEqual([
      {
        hash: '0xtx100',
        blockNumber: '100',
        fromAddress: '0x9999999999999999999999999999999999999999',
        toAddress: ROUTE_ADDRESS,
        value: '1',
      },
    ]);
    expect(addressService.getAddressTransactions).toHaveBeenCalledWith(
      1,
      ROUTE_ADDRESS,
      20,
      0,
      undefined,
      { includeBalancePoints: false },
    );
  });

  it('treats any non-\'1\' value as opted out', async () => {
    for (const value of ['true', '0', 'yes', '']) {
      await requestTx(`?balanceHistory=${value}`);
      const call = vi.mocked(addressService.getAddressTransactions).mock.lastCall;
      expect(call?.[5]).toEqual({ includeBalancePoints: false });
    }

    const res = await requestTx('?balanceHistory=true');
    const body = await res.json();
    expect('balancePoints' in body).toBe(false);
  });

  it('serves an explicitly empty series when the service found nothing', async () => {
    vi.mocked(addressService.getAddressTransactions).mockResolvedValue({
      transactions: [],
      total: 0,
      method: 'binary-search',
      coverage: 'none',
      reason: 'zero-balance',
      balancePoints: [],
    });

    const res = await requestTx('?balanceHistory=1');
    const body = await res.json();

    expect(body.balancePoints).toEqual([]);
    expect(body.balancePointsCount).toBe(0);
    expect(body.reason).toBe('zero-balance');
  });
});
