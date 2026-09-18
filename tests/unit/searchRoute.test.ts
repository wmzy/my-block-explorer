// Global /api/search behavioral contract: an explicit ?chainId= declares
// the chain, so chain-relative queries (transaction/block hashes, block
// numbers) resolve on exactly that chain with the same semantics as the
// per-chain endpoint — including BigInt-safe payload serialization. Only
// without a usable chain hint do they come back as needsChain (with the
// supported-chain list); address/free-text queries keep their pre-existing
// mainnet fallback. The service layer is mocked so these tests pin the
// route's dispatching, not the upstream lookups.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TX_HASH = '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060';

const { mockGetBlockByNumber, mockGetBlockByHash, mockGetLatestBlock,
  mockGetTransactionByHash, mockGetLatestTransactions, mockGetAddressInfo } = vi.hoisted(() => ({
  mockGetBlockByNumber: vi.fn(),
  mockGetBlockByHash: vi.fn(),
  mockGetLatestBlock: vi.fn(),
  mockGetTransactionByHash: vi.fn(),
  mockGetLatestTransactions: vi.fn(),
  mockGetAddressInfo: vi.fn(),
}));

vi.mock('../../src/services/BlockService', () => ({
  blockService: {
    getBlockByNumber: mockGetBlockByNumber,
    getBlockByHash: mockGetBlockByHash,
    getLatestBlock: mockGetLatestBlock,
  },
}));
vi.mock('../../src/services/TransactionService', () => ({
  transactionService: {
    getTransactionByHash: mockGetTransactionByHash,
    getLatestTransactions: mockGetLatestTransactions,
  },
}));
vi.mock('../../src/services/AddressService', () => ({
  addressService: { getAddressInfo: mockGetAddressInfo },
}));

import searchRoutes from '../../src/routes/search';

const makeBlock = (chainId: number) => ({
  chainId,
  number: 18_000_000n,
  hash: `0x${'b'.repeat(64)}`,
  timestamp: 1_700_000_000n,
  transactions: [],
  transactionCount: 0,
  network: 'test',
});

describe('GET /search (global)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLatestBlock.mockResolvedValue(null);
    mockGetLatestTransactions.mockResolvedValue([]);
  });

  it('resolves a hash on the chain named by ?chainId= instead of needsChain', async () => {
    mockGetTransactionByHash.mockResolvedValue({
      chainId: 137,
      hash: TX_HASH,
      timestamp: 1_700_000_000n,
      network: 'test',
    });

    const res = await searchRoutes.request(`/search?q=${TX_HASH}&chainId=137`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.needsChain).toBeUndefined();
    expect(body.found).toBe(true);
    expect(body.type).toBe('transaction');
    expect(body.searchedChainId).toBe(137);
    expect(body.chainId).toBe(137);
    expect(body.data.hash).toBe(TX_HASH);
    // BigInt fields survive as strings, not a 500 from JSON.stringify.
    expect(body.data.timestamp).toBe('1700000000');
    expect(mockGetTransactionByHash).toHaveBeenCalledWith(137, TX_HASH);
  });

  it('resolves a block number on the hinted chain with BigInt-safe data', async () => {
    mockGetBlockByNumber.mockResolvedValue(makeBlock(137));

    const res = await searchRoutes.request('/search?q=18000000&chainId=137');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.needsChain).toBeUndefined();
    expect(body.found).toBe(true);
    expect(body.type).toBe('block');
    expect(body.searchedChainId).toBe(137);
    expect(body.data.number).toBe('18000000');
    expect(mockGetBlockByNumber).toHaveBeenCalledWith(137, 18_000_000n);
  });

  it('keeps needsChain (with the supported-chain list) when no chainId is given', async () => {
    const res = await searchRoutes.request(`/search?q=${TX_HASH}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.found).toBe(false);
    expect(body.needsChain).toBe(true);
    expect(body.type).toBe('transaction');
    expect(body.query).toBe(TX_HASH);
    expect(Array.isArray(body.supportedChains)).toBe(true);
    expect(body.supportedChains.length).toBeGreaterThan(0);
    // Ambiguity is answered without burning any upstream lookup.
    expect(mockGetTransactionByHash).not.toHaveBeenCalled();
    expect(mockGetBlockByHash).not.toHaveBeenCalled();
  });

  it('answers needsChain for an unsupported chainId hint instead of silently searching mainnet', async () => {
    // 1234567890 is not in the viem chain registry the config derives its
    // supported set from.
    const res = await searchRoutes.request(`/search?q=${TX_HASH}&chainId=1234567890`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.needsChain).toBe(true);
    expect(mockGetTransactionByHash).not.toHaveBeenCalled();
  });

  it('reports a hinted-chain miss as degraded when the upstream lookup errors', async () => {
    mockGetTransactionByHash.mockRejectedValue(new Error('rpc down'));
    mockGetBlockByHash.mockResolvedValue(null);

    const res = await searchRoutes.request(`/search?q=${TX_HASH}&chainId=137`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.found).toBe(false);
    expect(body.needsChain).toBeUndefined();
    expect(body.searchedChainId).toBe(137);
    expect(body.degraded).toBe(true);
    expect(body.degradedReasons).toEqual(['transaction-lookup-failed']);
  });

  it('keeps the mainnet fallback for address queries without a chainId', async () => {
    const address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
    mockGetAddressInfo.mockResolvedValue({
      chainId: 1,
      address,
      balance: '0',
      transactionCount: 0,
      isContract: false,
      network: 'test',
    });

    const res = await searchRoutes.request(`/search?q=${address}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.type).toBe('address');
    expect(body.searchedChainId).toBe(1);
    expect(mockGetAddressInfo).toHaveBeenCalledWith(1, address);
  });
});
