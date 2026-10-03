// Search admitted RAW address casing into storage keyed by the
// CHECKSUMMED form.
//
// Two key conventions coexist in this repo, each internally documented:
// CHECKSUMMED (viem getAddress) for indexed_addresses, contract_sources
// and storage_layouts; LOWERCASE for address_labels, watch_subscriptions,
// address_scan_* and the events/indexing routes.
//
// Every :address route param is normalized by getValidatedAddress
// (server/validation.ts) before it reaches a service, so the checksummed
// convention holds there. SearchService.searchAddress validated only the
// SHAPE (`/^0x[a-fA-F0-9]{40}$/`, case-insensitive) and passed the raw
// query straight to addressService.getAddressInfo — the one entry point
// that lets user-typed casing choose a storage key.
//
// indexed_addresses is keyed (chain_id, address) as a varchar, so the key
// is case-SENSITIVE. Searching an address in lowercase therefore:
//
//  - MISSES the row the address page already wrote under the checksummed
//    key, re-running the RPC + Sourcify/Blockscan work, and
//  - then INSERTS a second row for the same address under the lowercase
//    key — a duplicate that the address page will never read.
//
// So one address reached by two spellings becomes two rows, and the
// cache is permanently half-effective: the page and the search disagree
// about what is cached.
//
// Search also skipped the checksum VALIDATION the route enforces, so a
// mixed-case address with a wrong checksum answered "found: true" from
// search and then rendered "Invalid address checksum" on the page it
// links to. The two surfaces disagreed about the same string.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAddress } from 'viem';
import { createSearchService } from '@/services/SearchService';

const { okBlock, okTx, addressInfoMock } = vi.hoisted(() => ({
  okBlock: {
    getBlockByNumber: vi.fn(() => Promise.resolve(null)),
    getBlockByHash: vi.fn(() => Promise.resolve(null)),
    getLatestBlock: vi.fn(() => Promise.resolve({ number: 42n, hash: `0x${'a'.repeat(64)}` })),
  },
  okTx: {
    getTransactionByHash: vi.fn(() => Promise.resolve(null)),
    getLatestTransactions: vi.fn(() => Promise.resolve({ transactions: [], total: 0 })),
  },
  addressInfoMock: vi.fn((_chainId: number, _address: string) =>
    Promise.resolve({ isContract: false }),
  ),
}));

vi.mock('@/services/BlockService', () => ({ blockService: okBlock }));
vi.mock('@/services/TransactionService', () => ({ transactionService: okTx }));
vi.mock('@/services/AddressService', () => ({ addressService: { getAddressInfo: addressInfoMock } }));

const service = () =>
  createSearchService({
    blockService: okBlock as never,
    transactionService: okTx as never,
    addressService: { getAddressInfo: addressInfoMock } as never,
  });

const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const LOWER_VITALIK = VITALIK.toLowerCase();
const BAD_CHECKSUM = '0xD8da6BF26964af9d7eEd9E03E53415D37aA96045';

describe('searchService address keying', () => {
  beforeEach(() => {
    addressInfoMock.mockClear();
  });

  it('resolves every casing to the same checksummed storage key', async () => {
    const svc = service();

    await svc.search(1, LOWER_VITALIK);
    await svc.search(1, VITALIK.toUpperCase().replace('0X', '0x'));

    const keys = addressInfoMock.mock.calls.map(([, address]) => address);
    expect(keys).toHaveLength(2);
    // Both spellings must name ONE row in indexed_addresses.
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBe(getAddress(VITALIK));
  });

  it('still resolves the already-checksummed spelling unchanged', async () => {
    const svc = service();
    const result = await svc.search(1, VITALIK);
    expect(result.found).toBe(true);
    expect(addressInfoMock).toHaveBeenCalledWith(1, VITALIK);
  });

  it('agrees with the address route on a bad checksum', async () => {
    // getValidatedAddress 400s this string, so the page shows an
    // "invalid checksum" card. Search answered "found: true" and linked
    // straight to it — the two surfaces disagreed about one string.
    const svc = service();
    const result = await svc.search(1, BAD_CHECKSUM);
    expect(result.found).toBe(false);
    expect(addressInfoMock).not.toHaveBeenCalled();
  });
});
