/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { createAddressService, addressService } from '@/services/AddressService';

describe('AddressService - Basic Tests', () => {
  describe('factory', () => {
    it('should create AddressService instance via factory', () => {
      const service = createAddressService({
        db: {} as any,
        indexedAddresses: {} as any,
        rpcManager: {} as any,
        contractSourceService: {} as any,
      });
      expect(service).toBeDefined();
      expect(typeof service.getPersistentAddressData).toBe('function');
    });
  });

  describe('type definitions', () => {
    it('should have proper method signatures', () => {
      expect(typeof addressService.getPersistentAddressData).toBe('function');
      expect(typeof addressService.getAddressInfo).toBe('function');
    });
  });

  // Note: Full integration tests would require database and RPC mocking
  // which is complex. These basic tests ensure the class structure is correct.
});

const TEST_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678' as const;

// Builds a service whose rpcManager resolves to the given client stub;
// getAddressTransactions never touches db/indexedAddresses/contract source.
const makeServiceWithClient = (client: Record<string, unknown>) =>
  createAddressService({
    db: {} as any,
    indexedAddresses: {} as any,
    rpcManager: { getClient: vi.fn().mockResolvedValue(client) } as any,
    contractSourceService: {} as any,
  });

describe('AddressService - getAddressTransactions coverage mapping', () => {
  it('reports partial/no-outgoing-transactions when the RPC nonce is zero', async () => {
    // The nonce counts outgoing txs only: incoming activity is
    // undetectable, so the service must never claim complete coverage.
    const getTransactionCount = vi.fn().mockResolvedValue(0);
    const service = makeServiceWithClient({
      getTransactionCount,
      getBlockNumber: vi.fn().mockResolvedValue(18_500_000n),
      getBalance: vi.fn().mockResolvedValue(1n),
    });

    const result = await service.getAddressTransactions(1, TEST_ADDRESS);

    expect(result).toMatchObject({
      transactions: [],
      total: 0,
      method: 'binary-search',
      coverage: 'partial',
      reason: 'no-outgoing-transactions',
    });
    expect(result.searchWindowBlocks).toBeUndefined();
  });

  it('reports none/zero-balance with total 0 — no search ran, nothing was discovered', async () => {
    // total is the discovered count; the nonce (7) must not leak into it.
    const service = makeServiceWithClient({
      getTransactionCount: vi.fn().mockResolvedValue(7),
      getBlockNumber: vi.fn().mockResolvedValue(18_500_000n),
      getBalance: vi.fn().mockResolvedValue(0n),
    });

    const result = await service.getAddressTransactions(1, TEST_ADDRESS);

    expect(result).toMatchObject({
      transactions: [],
      total: 0,
      method: 'binary-search-skipped',
      coverage: 'none',
      reason: 'zero-balance',
    });
  });

  it('reports none/search-failed when the RPC probes reject', async () => {
    const service = makeServiceWithClient({
      getTransactionCount: vi.fn().mockRejectedValue(new Error('rpc down')),
      getBlockNumber: vi.fn().mockRejectedValue(new Error('rpc down')),
      getBalance: vi.fn().mockRejectedValue(new Error('rpc down')),
    });

    const result = await service.getAddressTransactions(1, TEST_ADDRESS);

    expect(result).toMatchObject({
      transactions: [],
      total: 0,
      method: 'fallback',
      coverage: 'none',
      reason: 'search-failed',
    });
  });

  it('reports partial with the default search window; total is the discovered count', async () => {
    // Constant balance across the whole range: the first binary-search
    // probe level sees no changes and terminates — a successful (empty)
    // heuristic search. txCount 3 -> default window 2_500_000 blocks.
    const service = makeServiceWithClient({
      getTransactionCount: vi.fn().mockResolvedValue(3),
      getBlockNumber: vi.fn().mockResolvedValue(18_500_000n),
      getBalance: vi.fn().mockResolvedValue(1_000_000_000_000_000_000n),
    });

    const result = await service.getAddressTransactions(1, TEST_ADDRESS);

    expect(result).toMatchObject({
      transactions: [],
      // Discovery found nothing, so total is 0 — NOT the nonce (3).
      total: 0,
      method: 'binary-search',
      coverage: 'partial',
    });
    expect(result.searchWindowBlocks).toBe(2_500_000);
  });
});

describe('AddressService - getAddressTransactions result cache', () => {
  // Balance steps at blocks 20/60/100 force the binary search to linearly
  // scan both halves of [0..128] and discover one tx per step block.
  const latestBlock = 128n;
  const txBlocks = [100n, 60n, 20n];
  const hashAt = (block: bigint) => `0xtx-${block.toString()}`;

  const makeDiscoveryService = () => {
    const getTransactionCount = vi.fn().mockResolvedValue(5);
    const getBlockNumber = vi.fn().mockResolvedValue(latestBlock);
    // The initial probe passes no blockNumber (latest, balance 3n);
    // binary-search probes pass one and get the step function.
    const getBalance = vi.fn(async ({ blockNumber }: { blockNumber?: bigint }) => {
      if (blockNumber === undefined || blockNumber >= 100n) return 3n;
      if (blockNumber >= 60n) return 2n;
      if (blockNumber >= 20n) return 1n;
      return 0n;
    });
    const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      timestamp: 1_700_000_000n,
      transactions: txBlocks.includes(blockNumber)
        ? [
            {
              hash: hashAt(blockNumber),
              from: TEST_ADDRESS,
              to: '0x9999999999999999999999999999999999999999',
              value: blockNumber * 1_000n,
            },
          ]
        : [],
    }));
    const service = makeServiceWithClient({
      getTransactionCount,
      getBlockNumber,
      getBalance,
      getBlock,
    });
    return { service, getTransactionCount, getBlockNumber, getBalance, getBlock };
  };

  const rpcCallTotals = (mocks: {
    getTransactionCount: ReturnType<typeof vi.fn>;
    getBlockNumber: ReturnType<typeof vi.fn>;
    getBalance: ReturnType<typeof vi.fn>;
    getBlock: ReturnType<typeof vi.fn>;
  }) => ({
    nonce: mocks.getTransactionCount.mock.calls.length,
    head: mocks.getBlockNumber.mock.calls.length,
    balance: mocks.getBalance.mock.calls.length,
    block: mocks.getBlock.mock.calls.length,
  });

  it('serves consecutive pages from one cached canonical list — no second search', async () => {
    const mocks = makeDiscoveryService();

    const page1 = await mocks.service.getAddressTransactions(1, TEST_ADDRESS, 2, 0);
    expect(page1.total).toBe(3);
    expect(page1.transactions.map(tx => tx.hash)).toEqual([hashAt(100n), hashAt(60n)]);

    const afterFirst = rpcCallTotals(mocks);

    const page2 = await mocks.service.getAddressTransactions(1, TEST_ADDRESS, 2, 2);
    expect(page2.total).toBe(3);
    expect(page2.transactions.map(tx => tx.hash)).toEqual([hashAt(20n)]);

    const page3 = await mocks.service.getAddressTransactions(1, TEST_ADDRESS, 2, 4);
    expect(page3.transactions).toEqual([]);
    expect(page3.total).toBe(3);

    // Cache hit: not a single additional RPC call for pages 2 and 3.
    expect(rpcCallTotals(mocks)).toEqual(afterFirst);
    expect(mocks.getTransactionCount).toHaveBeenCalledTimes(1);
    expect(mocks.getBlockNumber).toHaveBeenCalledTimes(1);
  });

  it('re-runs the search once the TTL expires', async () => {
    vi.useFakeTimers();
    try {
      const mocks = makeDiscoveryService();

      await mocks.service.getAddressTransactions(1, TEST_ADDRESS, 2, 0);
      expect(mocks.getTransactionCount).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(61_000);

      await mocks.service.getAddressTransactions(1, TEST_ADDRESS, 2, 0);
      expect(mocks.getTransactionCount).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts the least recently used entry beyond 20 cached searches', async () => {
    // Nonce 0 short-circuits every address into the cached empty result,
    // so the test only exercises cache residency.
    const getTransactionCount = vi.fn().mockResolvedValue(0);
    const service = makeServiceWithClient({
      getTransactionCount,
      getBlockNumber: vi.fn().mockResolvedValue(128n),
      getBalance: vi.fn().mockResolvedValue(1n),
    });

    const addressN = (i: number) =>
      `0x${(i + 1).toString(16).padStart(40, '0')}` as typeof TEST_ADDRESS;

    for (let i = 0; i < 21; i++) {
      await service.getAddressTransactions(1, addressN(i));
    }
    expect(getTransactionCount).toHaveBeenCalledTimes(21);

    // Entry 0 was evicted (bound is 20): re-requesting it re-searches
    // (22nd call), and its re-insertion evicts entry 1 — the new oldest.
    await service.getAddressTransactions(1, addressN(0));
    expect(getTransactionCount).toHaveBeenCalledTimes(22);

    // Entry 0 is now cached: served without another search.
    await service.getAddressTransactions(1, addressN(0));
    expect(getTransactionCount).toHaveBeenCalledTimes(22);

    // Entry 1 fell out on entry 0's re-insertion: it re-searches.
    await service.getAddressTransactions(1, addressN(1));
    expect(getTransactionCount).toHaveBeenCalledTimes(23);
  });
});

describe('AddressService - getAddressTransactions window override', () => {
  it('widens the search range and echoes the effective window', async () => {
    const getBalance = vi.fn().mockResolvedValue(1n);
    const service = makeServiceWithClient({
      getTransactionCount: vi.fn().mockResolvedValue(3),
      getBlockNumber: vi.fn().mockResolvedValue(18_500_000n),
      getBalance,
    });

    const result = await service.getAddressTransactions(1, TEST_ADDRESS, 20, 0, 10_000_000);

    expect(result.searchWindowBlocks).toBe(10_000_000);
    // The window actually widened the search: the low probe sits at
    // 18_500_000 - 10_000_000 instead of the 2.5M default offset.
    const probedBlocks = getBalance.mock.calls.map(([arg]) => (arg as { blockNumber: bigint }).blockNumber);
    expect(probedBlocks).toContain(8_500_000n);
  });

  it('clamps an oversized window to 50_000_000 blocks', async () => {
    const service = makeServiceWithClient({
      getTransactionCount: vi.fn().mockResolvedValue(3),
      getBlockNumber: vi.fn().mockResolvedValue(18_500_000n),
      getBalance: vi.fn().mockResolvedValue(1n),
    });

    const result = await service.getAddressTransactions(1, TEST_ADDRESS, 20, 0, 99_999_999);

    expect(result.searchWindowBlocks).toBe(50_000_000);
  });

  it('clamps a sub-unit window up to 1 block', async () => {
    const service = makeServiceWithClient({
      getTransactionCount: vi.fn().mockResolvedValue(3),
      getBlockNumber: vi.fn().mockResolvedValue(18_500_000n),
      getBalance: vi.fn().mockResolvedValue(1n),
      getBlock: vi.fn().mockResolvedValue({ number: 18_499_999n, timestamp: 1n, transactions: [] }),
    });

    const result = await service.getAddressTransactions(1, TEST_ADDRESS, 20, 0, 0);

    expect(result.searchWindowBlocks).toBe(1);
    expect(result.total).toBe(0);
  });

  it('keys the cache per window: a different window re-searches', async () => {
    const getTransactionCount = vi.fn().mockResolvedValue(3);
    const service = makeServiceWithClient({
      getTransactionCount,
      getBlockNumber: vi.fn().mockResolvedValue(18_500_000n),
      getBalance: vi.fn().mockResolvedValue(1n),
    });

    await service.getAddressTransactions(1, TEST_ADDRESS);
    await service.getAddressTransactions(1, TEST_ADDRESS);
    expect(getTransactionCount).toHaveBeenCalledTimes(1);

    await service.getAddressTransactions(1, TEST_ADDRESS, 20, 0, 10_000_000);
    expect(getTransactionCount).toHaveBeenCalledTimes(2);
  });
});

describe('AddressService - getAddressInfo payload contract', () => {
  it('carries persistent fields only — no fake balance/transactionCount', async () => {
    // EOA path: getCode '0x' -> isContract false, so the stub never
    // reaches contractSourceService. The db stub keeps both the cache
    // read and the cache write on their swallowed-error paths.
    const service = makeServiceWithClient({
      getCode: vi.fn().mockResolvedValue('0x'),
    });

    const result = await service.getAddressInfo(1, TEST_ADDRESS);

    expect(result).toMatchObject({
      chainId: 1,
      address: TEST_ADDRESS,
      isContract: false,
    });
    // Balance/transactionCount used to be hard-coded '0'/0 here — always
    // wrong and never trustworthy. They now belong to the realtime RPC
    // channel alone.
    expect('balance' in result).toBe(false);
    expect('transactionCount' in result).toBe(false);
  });
});
