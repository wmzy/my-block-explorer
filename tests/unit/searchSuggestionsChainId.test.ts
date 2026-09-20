// Suggestions chain attribution: every miss response that carries
// actionable suggestion lines (latest block number/hash, recent tx hashes)
// also names the chain those lines were resolved on (suggestionsChainId),
// so clients never guess a chain to link them to — the exact chain the
// service searched, even when a caller picked it implicitly. Chain-less
// suggestion sets (the static ENS note) must stay unattributed: linking
// them anywhere would be fabrication.
import { describe, it, expect, vi } from 'vitest';

const { okBlock, okTx, okAddress } = vi.hoisted(() => ({
  okBlock: {
    getBlockByNumber: vi.fn(() => Promise.resolve(null)),
    getBlockByHash: vi.fn(() => Promise.resolve(null)),
    getLatestBlock: vi.fn(() =>
      Promise.resolve({ number: 42n, hash: `0x${'a'.repeat(64)}` })),
  },
  okTx: {
    getTransactionByHash: vi.fn(() => Promise.resolve(null)),
    getLatestTransactions: vi.fn(() =>
      Promise.resolve({
        transactions: [{ hash: `0x${'1'.repeat(64)}` }],
        total: 1,
      })),
  },
  okAddress: { getAddressInfo: vi.fn(() => Promise.resolve(null)) },
}));

vi.mock('@/services/BlockService', () => ({ blockService: okBlock }));
vi.mock('@/services/TransactionService', () => ({ transactionService: okTx }));
vi.mock('@/services/AddressService', () => ({ addressService: okAddress }));

import { createSearchService } from '@/services/SearchService';

const svc = createSearchService({
  blockService: okBlock as never,
  transactionService: okTx as never,
  addressService: okAddress as never,
});

describe('suggestionsChainId', () => {
  it('attributes free-text (searchAll) suggestions to the chain actually searched', async () => {
    const r = await svc.search(137, 'hello world');

    expect(r.found).toBe(false);
    expect(r.suggestions?.length).toBeGreaterThan(0);
    expect(r.suggestionsChainId).toBe(137);
  });

  it('attributes a block-number miss to the chain actually searched', async () => {
    const r = await svc.search(8453, '999999999');

    expect(r.found).toBe(false);
    // The suggestion data (latest block) is data OF that chain.
    expect(r.suggestions).toContain('Latest block number: 42');
    expect(r.suggestionsChainId).toBe(8453);
  });

  it('attributes a transaction-hash miss to the chain actually searched', async () => {
    const r = await svc.search(10, `0x${'ab'.repeat(32)}`);

    expect(r.found).toBe(false);
    expect(r.suggestions).toContain(`0x${'1'.repeat(64)}`);
    expect(r.suggestionsChainId).toBe(10);
  });

  it('leaves the chain-less ENS note unattributed', async () => {
    const r = await svc.search(1, 'vitalik.eth');

    expect(r.type).toBe('ens');
    expect(r.suggestions).toBeDefined();
    expect(r.suggestionsChainId).toBeUndefined();
  });
});
