// SearchService behavioral contract: ENS queries are answered locally (no
// upstream calls), failed sub-lookups surface as degraded:true with machine
// readable reasons (never a plain not-found), and recorded history ids fit
// the int32 pk column. DB-backed modules are mocked so the DuckDB
// single-writer lock is never touched.
import { describe, it, expect, vi } from 'vitest';

const { mockExecute, okBlock, failingBlock, okTx, failingAddress } = vi.hoisted(() => {
  const mockExecute = vi.fn((..._args: unknown[]) => Promise.resolve());
  return {
    mockExecute,
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
vi.mock('../../src/database/init', () => ({
  db: { execute: mockExecute },
  searchHistory: {},
}));
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
    db: { execute: mockExecute } as never,
    searchHistory: {} as never,
    blockService: block as never,
    transactionService: okTx as never,
    addressService: failingAddress as never,
  });

describe('SearchService smoke', () => {
  // drizzle sql`` produces a SQL object; dump its chunks (incl. bound Param
  // values) so assertions can inspect the statement text and args.
  const lastInsertDump = () => {
    const call = mockExecute.mock.calls.at(-1);
    const chunks = (call?.[0] as { queryChunks?: unknown[] })?.queryChunks ?? [];
    return JSON.stringify(chunks, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
  };

  it('answers ens queries without upstream calls', async () => {
    const svc = makeService(okBlock);
    const r = await svc.search(1, 'vitalik.eth');
    expect(r.type).toBe('ens');
    expect(r.found).toBe(false);
    expect(r.message).toBe('ENS names are resolved in the browser');
    expect(r.degraded).toBeUndefined();
    expect(okBlock.getLatestBlock).not.toHaveBeenCalled();
    // history still recorded with type 'ens'
    const dump = lastInsertDump();
    expect(dump).toContain('search_history');
    expect(dump).toContain('ens');
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
      db: { execute: mockExecute } as never,
      searchHistory: {} as never,
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
      db: { execute: mockExecute } as never,
      searchHistory: {} as never,
      blockService: okBlock as never,
      transactionService: okTx as never,
      addressService: { getAddressInfo: vi.fn(() => Promise.resolve(null)) } as never,
    });
    const r = await svc.search(1, 'hello world');
    expect(r.found).toBe(false);
    expect(r.degraded).toBeUndefined();
    expect(r.suggestions?.length).toBeGreaterThan(0);
  });

  it('records history ids that fit the int32 pk column', async () => {
    makeService(okBlock);
    for (const call of mockExecute.mock.calls) {
      const dump = JSON.stringify(
        (call[0] as { queryChunks?: unknown[] }).queryChunks ?? [],
        (_k, v) => (typeof v === 'bigint' ? String(v) : v),
      );
      const m = dump.match(/VALUES \((\d+)/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeLessThanOrEqual(2147483647);
      expect(Number(m![1])).toBeGreaterThan(1_700_000_000);
    }
  });
});
