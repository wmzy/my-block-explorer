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
  it('reports complete/no-transactions when the RPC nonce is zero', async () => {
    const service = makeServiceWithClient({
      getTransactionCount: vi.fn().mockResolvedValue(0),
      getBlockNumber: vi.fn().mockResolvedValue(18_500_000n),
      getBalance: vi.fn().mockResolvedValue(0n),
    });

    const result = await service.getAddressTransactions(1, TEST_ADDRESS);

    expect(result).toMatchObject({
      transactions: [],
      total: 0,
      method: 'binary-search',
      coverage: 'complete',
      reason: 'no-transactions',
    });
    expect(result.searchWindowBlocks).toBeUndefined();
  });

  it('reports none/zero-balance when the address holds no native tokens', async () => {
    const service = makeServiceWithClient({
      getTransactionCount: vi.fn().mockResolvedValue(7),
      getBlockNumber: vi.fn().mockResolvedValue(18_500_000n),
      getBalance: vi.fn().mockResolvedValue(0n),
    });

    const result = await service.getAddressTransactions(1, TEST_ADDRESS);

    expect(result).toMatchObject({
      transactions: [],
      total: 7,
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

  it('reports partial with the search window after a successful search', async () => {
    // Constant balance across the whole range: the first binary-search
    // probe level sees no changes and terminates — a successful (empty)
    // heuristic search. txCount 3 -> window 2_500_000 blocks.
    const getBalance = vi.fn().mockResolvedValue(1_000_000_000_000_000_000n);
    const service = makeServiceWithClient({
      getTransactionCount: vi.fn().mockResolvedValue(3),
      getBlockNumber: vi.fn().mockResolvedValue(18_500_000n),
      getBalance,
    });

    const result = await service.getAddressTransactions(1, TEST_ADDRESS);

    expect(result).toMatchObject({
      transactions: [],
      total: 3,
      method: 'binary-search',
      coverage: 'partial',
    });
    expect(result.searchWindowBlocks).toBe(2_500_000);
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
