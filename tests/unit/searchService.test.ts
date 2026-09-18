// SearchService behavioral contract: ENS queries are answered locally (no
// upstream calls), failed sub-lookups surface as degraded:true with machine
// readable reasons (never a plain not-found), and the service no longer
// records anything server-side (search history is browser-local now — the
// DuckDB search_history table stays untouched and empty).
import { describe, it, expect, vi } from 'vitest';

const { okBlock, failingBlock, okTx, failingAddress } = vi.hoisted(() => {
  return {
    failingBlock: { getBlockByNumber: vi.fn(() => Promise.reject(new Error('rpc down'))) },
    okBlock: {
      getBlockByNumber: vi.fn(() => Promise.resolve(null)),
      getBlockByHash: vi.fn(() => Promise.resolve(null)),
      getLatestBlock: vi.fn(() => Promise.resolve({ number: 42n, hash: `0x${'a'.repeat(64)}` })),
    },
    okTx: {
      getTransactionByHash: vi.fn(() => Promise.resolve(null)),
      getLatestTransactions: vi.fn(() => Promise.resolve([])),
    },
    failingAddress: { getAddressInfo: vi.fn(() => Promise.reject(new Error('rpc down'))) },
  };
});
vi.mock('../../src/services/BlockService', () => ({
  blockService: okBlock,
}));
vi.mock('../../src/services/TransactionService', () => ({
  transactionService: okTx,
}));
vi.mock('../../src/services/AddressService', () => ({
  addressService: failingAddress,
}));

import { createSearchService } from '../../src/services/SearchService';

const makeService = (block: unknown) =>
  createSearchService({
    blockService: block as never,
    transactionService: okTx as never,
    addressService: failingAddress as never,
  });

describe('SearchService smoke', () => {
  it('answers ens queries without upstream calls', async () => {
    const svc = makeService(okBlock);
    const r = await svc.search(1, 'vitalik.eth');
    expect(r.type).toBe('ens');
    expect(r.found).toBe(false);
    expect(r.message).toBe('ENS names are resolved in the browser');
    expect(r.degraded).toBeUndefined();
    expect(okBlock.getLatestBlock).not.toHaveBeenCalled();
  });

  it('flags a failed block lookup as degraded, not plain not-found', async () => {
    const svc = makeService(failingBlock);
    const r = await svc.search(1, '123');
    expect(r.found).toBe(false);
    expect(r.degraded).toBe(true);
    expect(r.degradedReasons).toEqual(['block-lookup-failed']);
  });

  it('aggregates degraded reasons for free-text (searchAll) misses', async () => {
    // Free text only reaches upstream through the transaction sub-search
    // (the address sub-search short-circuits on format, the block sub-search
    // on non-digit/non-hash input).
    const failingTxSvc = createSearchService({
      blockService: okBlock as never,
      transactionService: {
        getTransactionByHash: vi.fn(() => Promise.reject(new Error('rpc down'))),
        getLatestTransactions: vi.fn(() => Promise.resolve([])),
      } as never,
      addressService: failingAddress as never,
    });
    const degraded = await failingTxSvc.search(1, 'hello world');
    expect(degraded.type).toBe('unknown');
    expect(degraded.found).toBe(false);
    expect(degraded.degraded).toBe(true);
    expect(degraded.degradedReasons).toEqual(['transaction-lookup-failed']);
  });

  it('does not flag a clean free-text miss as degraded', async () => {
    const svc = createSearchService({
      blockService: okBlock as never,
      transactionService: okTx as never,
      addressService: { getAddressInfo: vi.fn(() => Promise.resolve(null)) } as never,
    });
    const r = await svc.search(1, 'hello world');
    expect(r.found).toBe(false);
    expect(r.degraded).toBeUndefined();
    expect(r.suggestions?.length).toBeGreaterThan(0);
  });
});
