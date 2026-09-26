// Route-level contract of the address transactions endpoint's optional
// narrowing filters: param validation (400 invalid_address /
// invalid_value), forwarding to the service as BigInt-exact bounds, the
// as-received filtersApplied echo, the filtered total driving pagination
// honestly — and the byte-identical pin: an unfiltered request must
// neither carry filters into the service call nor add a filtersApplied
// key to the response.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { getAddress } from 'viem';

vi.mock('@/services/AddressService', () => ({
  addressService: {
    getAddressInfo: vi.fn(),
    getPersistentAddressData: vi.fn(),
    getAddressTransactions: vi.fn(),
    clearTransactionsCache: vi.fn(),
  },
}));

// The route is rate-limited per client; the limiter has its own dedicated
// coverage in rateLimit.test.ts — here it is a pass-through.
vi.mock('@/middleware/rate-limit', () => ({
  createRateLimiter: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

import addressesRoutes from '@/routes/addresses';
import { addressService } from '@/services/AddressService';
import type { AddressTransactionsResult, DiscoveredTransaction } from '@/services/AddressService';

// All-digit address: viem's checksum leaves it byte-identical, so the
// service receives exactly the string in the URL.
const ROUTE_ADDRESS = '0x1111111111111111111111111111111111111111';
// All-digit filter targets — checksum-stable like the route address.
const FROM_FILTER = '0x3333333333333333333333333333333333333333';
const TO_FILTER = '0x4444444444444444444444444444444444444444';
// A real checksum form, used to build a checksum mismatch by uppercasing
// one letter the checksum says stays lowercase (the EIP-55 example
// address; same construction as addressValidity.test.ts).
const CHECKSUMMED = getAddress('0x5aaeb6053f3e94c9b9a09f33669495e3474963fe');
const BAD_CHECKSUM = (() => {
  for (let i = 2; i < CHECKSUMMED.length; i++) {
    if (/[a-f]/.test(CHECKSUMMED[i])) {
      return (
        CHECKSUMMED.slice(0, i)
        + CHECKSUMMED[i].toUpperCase()
        + CHECKSUMMED.slice(i + 1)
      );
    }
  }
  return CHECKSUMMED;
})();

const app = new Hono();
app.route('/', addressesRoutes);

const discoveredRow = (
  blockNumber: number,
  value: string,
): DiscoveredTransaction => ({
  hash: `0xrow${blockNumber}`,
  blockNumber: BigInt(blockNumber),
  fromAddress: FROM_FILTER,
  toAddress: ROUTE_ADDRESS,
  value,
  timestamp: '2026-01-01T00:00:00.000Z',
});

const mockTxResult = (rows: DiscoveredTransaction[]): AddressTransactionsResult => ({
  transactions: rows,
  total: rows.length,
  method: 'binary-search',
  coverage: 'partial',
  searchWindowBlocks: 10_000_000,
});

const serviceCalls = () => vi.mocked(addressService.getAddressTransactions).mock.calls;

const requestTx = (query: string) =>
  app.request(`/chains/1/addresses/${ROUTE_ADDRESS}/transactions${query}`);

describe('GET /chains/:chainId/addresses/:address/transactions — filters', () => {
  beforeEach(() => {
    vi.mocked(addressService.getAddressTransactions).mockReset();
    vi.mocked(addressService.getAddressTransactions).mockResolvedValue(
      mockTxResult([discoveredRow(100, '1000')]),
    );
  });

  it('forwards validated filters as BigInt-exact bounds', async () => {
    const res = await requestTx(
      `?fromAddress=${FROM_FILTER}&toAddress=${TO_FILTER}`
      + '&minValue=10000000000000000000&maxValue=0',
    );

    expect(res.status).toBe(200);
    expect(serviceCalls()).toEqual([[
      1,
      ROUTE_ADDRESS,
      20,
      0,
      undefined,
      {
        includeBalancePoints: false,
        filters: {
          fromAddress: FROM_FILTER,
          toAddress: TO_FILTER,
          minValue: 10_000_000_000_000_000_000n,
          maxValue: 0n,
        },
      },
    ]]);
  });

  it('echoes filtersApplied exactly as received (case preserved)', async () => {
    const res = await requestTx(
      `?fromAddress=${FROM_FILTER.toLowerCase()}&minValue=7`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // As-received echo: the lowercase input comes back lowercase even
    // though the comparison (and the forwarded filter) is case-insensitive.
    expect(body.filtersApplied).toEqual({
      fromAddress: FROM_FILTER.toLowerCase(),
      minValue: '7',
    });
  });

  it('rejects a shape-invalid fromAddress with 400 invalid_address (no service call)', async () => {
    const res = await requestTx('?fromAddress=0x123');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_address');
    expect(serviceCalls()).toHaveLength(0);
  });

  it('rejects a checksum-mismatched toAddress with 400 invalid_address', async () => {
    const res = await requestTx(`?toAddress=${BAD_CHECKSUM}`);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_address');
    expect(serviceCalls()).toHaveLength(0);
  });

  it('rejects a negative minValue with 400 invalid_value', async () => {
    const res = await requestTx('?minValue=-5');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_value');
    expect(serviceCalls()).toHaveLength(0);
  });

  it('rejects NaN / fractional / scientific maxValue with 400 invalid_value', async () => {
    for (const bad of ['NaN', '1.5', '1e18']) {
      const res = await requestTx(`?maxValue=${bad}`);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_value');
    }
    expect(serviceCalls()).toHaveLength(0);
  });

  it('treats empty-string filter params as absent (no filters, no echo)', async () => {
    const res = await requestTx('?fromAddress=&toAddress=&minValue=&maxValue=');

    expect(res.status).toBe(200);
    expect(serviceCalls()).toEqual([[
      1,
      ROUTE_ADDRESS,
      20,
      0,
      undefined,
      { includeBalancePoints: false },
    ]]);
    const body = await res.json();
    expect('filtersApplied' in body).toBe(false);
  });

  it('keeps the UNFILTERED request byte-identical: no filters, no filtersApplied key', async () => {
    const res = await requestTx('');

    expect(res.status).toBe(200);
    // The service call shape is exactly the pre-filter one.
    expect(serviceCalls()).toEqual([[
      1,
      ROUTE_ADDRESS,
      20,
      0,
      undefined,
      { includeBalancePoints: false },
    ]]);
    const body = await res.json();
    expect('filtersApplied' in body).toBe(false);
    // Coverage semantics ride along untouched for unfiltered consumers.
    expect(body.coverage).toBe('partial');
    expect(body.searchWindowBlocks).toBe(10_000_000);
  });

  it('the filtered total drives pagination honestly', async () => {
    // 5 matching rows, limit 2, page 2 → totalPages 3, pagination.total 5.
    vi.mocked(addressService.getAddressTransactions).mockResolvedValue({
      transactions: [discoveredRow(60, '5')],
      total: 5,
      method: 'binary-search',
      coverage: 'partial',
      searchWindowBlocks: 10_000_000,
    });
    const res = await requestTx('?minValue=1&limit=2&page=2');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(5);
    expect(body.pagination).toEqual({
      page: 2,
      limit: 2,
      totalPages: 3,
      total: 5,
    });
    // The coverage verdict is the scan's, not the filter's: filtering
    // never claims completeness and never invents a failure.
    expect(body.coverage).toBe('partial');
    expect(body.reason).toBeUndefined();
  });
});
