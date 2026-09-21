// The /transactions/export endpoint on the addresses routes: param
// pass-through to the SAME service call the list uses, the 50k
// too_many_rows refusal, offset validation, and the header-only CSV for an
// empty discovered set. The service is mocked (the existing
// addressesRoute.test.ts style); the CSV escaping itself has its own
// focused test (addressTransactionsCsv.test.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  getAddressTransactions: vi.fn(),
}));

vi.mock('@/services/AddressService', () => ({
  addressService: { getAddressTransactions: mocks.getAddressTransactions },
}));

// Pass-through: the limiter has its own dedicated coverage
// (rateLimit.test.ts); these tests fire several requests per second.
vi.mock('@/middleware/rate-limit', () => ({
  createRateLimiter: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

import addressesRoutes from '@/routes/addresses';
import { ADDRESS_EXPORT_MAX_ROWS } from '@/services/AddressExportService';
import type { AddressTransactionsResult } from '@/services/AddressService';

// All-digit address: checksum-neutral, so the service receives exactly the
// string in the URL.
const ROUTE_ADDRESS = '0x1111111111111111111111111111111111111111';

const app = new Hono();
app.route('/', addressesRoutes);

const EXPORT_PATH = `/chains/1/addresses/${ROUTE_ADDRESS}/transactions/export`;

const page = (
  overrides: Partial<AddressTransactionsResult> = {},
): AddressTransactionsResult => ({
  transactions: [],
  total: 0,
  method: 'binary-search',
  coverage: 'partial',
  searchWindowBlocks: 10_000_000,
  ...overrides,
});

const discoveredTx = {
  hash: '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1',
  blockNumber: 18_000_001n,
  fromAddress: '0x1111111111111111111111111111111111111111',
  toAddress: '0x2222222222222222222222222222222222222222',
  value: '1000000000000000000',
  timestamp: '2024-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAddressTransactions.mockResolvedValue(page());
});

describe('GET .../transactions/export', () => {
  it('calls the same service with the export cap as the limit and offset 0', async () => {
    const res = await app.request(`${EXPORT_PATH}?window=12345&offset=7`);
    expect(res.status).toBe(200);
    expect(mocks.getAddressTransactions).toHaveBeenCalledWith(
      1,
      ROUTE_ADDRESS,
      ADDRESS_EXPORT_MAX_ROWS,
      7,
      12345,
    );
  });

  it('treats absent window/offset as undefined/0 (list-endpoint semantics)', async () => {
    await app.request(EXPORT_PATH);
    expect(mocks.getAddressTransactions).toHaveBeenCalledWith(
      1,
      ROUTE_ADDRESS,
      ADDRESS_EXPORT_MAX_ROWS,
      0,
      undefined,
    );
  });

  it('ignores a non-numeric window (service gets undefined) like the list', async () => {
    await app.request(`${EXPORT_PATH}?window=abc`);
    expect(mocks.getAddressTransactions).toHaveBeenLastCalledWith(
      1,
      ROUTE_ADDRESS,
      ADDRESS_EXPORT_MAX_ROWS,
      0,
      undefined,
    );
  });

  it.each(['abc', '-5', '12abc', '1.5'])('rejects offset %s with 400 invalid_offset', async raw => {
    const res = await app.request(`${EXPORT_PATH}?offset=${raw}`);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_offset' });
    expect(mocks.getAddressTransactions).not.toHaveBeenCalled();
  });

  it('refuses instead of truncating above the cap: 400 too_many_rows', async () => {
    mocks.getAddressTransactions.mockResolvedValue(
      page({ total: ADDRESS_EXPORT_MAX_ROWS + 1 }),
    );
    const res = await app.request(EXPORT_PATH);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'too_many_rows' });
  });

  it('streams a header-only CSV (a valid download) for an empty set', async () => {
    const res = await app.request(EXPORT_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="address-transactions-1-0x1111.*\.csv"$/,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expect(res.text()).resolves.toBe(
      'hash,block_number,from,to,value_wei,timestamp,status\r\n',
    );
  });

  it('serializes the discovered rows with empty status cells', async () => {
    mocks.getAddressTransactions.mockResolvedValue(
      page({ transactions: [discoveredTx], total: 1 }),
    );
    const res = await app.request(EXPORT_PATH);
    expect(res.status).toBe(200);
    const body = await res.text();
    const dataLine = body.split('\r\n')[1];
    expect(dataLine).toBe(
      '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1,'
      + '18000001,'
      + '0x1111111111111111111111111111111111111111,'
      + '0x2222222222222222222222222222222222222222,'
      + '1000000000000000000,'
      + '2024-01-01T00:00:00.000Z,'
      + '',
    );
  });
});
