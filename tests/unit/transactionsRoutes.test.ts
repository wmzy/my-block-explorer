/**
 * Route-level behavior of the transaction list endpoint: the `offset` query
 * param is parsed, clamped, and pushed into the service call (LIMIT/OFFSET
 * happens in the service's SQL), malformed values fail loudly with 400
 * instead of silently paging from 0, and the response carries `total`
 * alongside the page — mirroring the blocks list response.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLatestTransactions: vi.fn(),
  getTransactionByHash: vi.fn(),
}));

vi.mock('@/services/TransactionService', () => ({
  transactionService: {
    getLatestTransactions: mocks.getLatestTransactions,
    getTransactionByHash: mocks.getTransactionByHash,
  },
}));

import app from '@/routes/transactions';

const request = (path: string) => app.request(path);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLatestTransactions.mockResolvedValue({ transactions: [], total: 7 });
});

describe('GET /chains/:chainId/transactions offset', () => {
  it('pushes the requested offset into the service call and returns total', async () => {
    const res = await request('/chains/1/transactions?limit=5&offset=2');

    expect(res.status).toBe(200);
    // Before the fix, offset was parsed nowhere: every page returned the
    // same leading rows. The service must receive the offset explicitly.
    expect(mocks.getLatestTransactions).toHaveBeenCalledWith(1, 5, 2);
    const body = await res.json();
    expect(body.total).toBe(7);
    expect(body.transactions).toEqual([]);
    expect(body.chainName).toBe('Ethereum');
  });

  it('defaults offset to 0 when absent or empty', async () => {
    await request('/chains/1/transactions');
    expect(mocks.getLatestTransactions).toHaveBeenLastCalledWith(1, 20, 0);

    await request('/chains/1/transactions?offset=');
    expect(mocks.getLatestTransactions).toHaveBeenLastCalledWith(1, 20, 0);
  });

  it('clamps negative offsets to 0', async () => {
    const res = await request('/chains/1/transactions?offset=-5');

    expect(res.status).toBe(200);
    expect(mocks.getLatestTransactions).toHaveBeenLastCalledWith(1, 20, 0);
  });

  it('caps runaway offsets at 100_000 so DuckDB is not scanned arbitrarily deep', async () => {
    const res = await request('/chains/1/transactions?offset=999999999');

    expect(res.status).toBe(200);
    expect(mocks.getLatestTransactions).toHaveBeenLastCalledWith(1, 20, 100_000);
  });

  it('rejects a non-numeric offset with 400 instead of silently paging from 0', async () => {
    const res = await request('/chains/1/transactions?offset=abc');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid offset');
    expect(mocks.getLatestTransactions).not.toHaveBeenCalled();
  });
});
