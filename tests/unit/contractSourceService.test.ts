/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetClient = vi.hoisted(() => vi.fn());

vi.mock('@/services/RpcManager', () => ({
  rpcManager: {
    getClient: mockGetClient,
  },
}));

// Partial mock: the real schema table exports stay intact so drizzle
// operators (eq/and) receive real columns; only the db client is faked.
const mockDb = vi.hoisted(() => ({
  query: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/database/init', async importOriginal => {
  const actual = await importOriginal<typeof import('@/database/init')>();
  return {
    ...actual,
    db: mockDb,
  };
});

import { ContractSourceService } from '@/services/ContractSourceService';
import {
  PROXY_CACHE_TTL_HOURS,
  UNVERIFIED_CACHE_TTL_HOURS,
  VERIFIED_CACHE_TTL_HOURS,
  CREATION_FAILURE_CACHE_TTL_HOURS,
  type ContractSource,
  type ContractCreationInfo,
} from '@/services/ContractSourceService';
import { formatAddress } from '@/utils/address';
import type { Address } from 'viem';

describe('ContractSourceService - Proxy Detection', () => {
  let contractSourceService: ContractSourceService;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      getStorageAt: vi.fn(),
      getBytecode: vi.fn(),
      getCode: vi.fn(),
      readContract: vi.fn(),
    };

    mockGetClient.mockResolvedValue(mockClient);

    contractSourceService = new ContractSourceService();
  });

  describe('detectProxy', () => {
    it('should detect EIP-1967 transparent proxy correctly', async () => {
      const proxyAddress = '0x83358A7241A8EEBaF488F7560f2c2eb5EE05f4ca';
      const implementationAddress = '0xef6958d7067013251100ce96a1181f7398ad52b5';
      const chainId = 5000;

      // Mock storage slot responses
      const implementationSlotData =
        '0x000000000000000000000000ef6958d7067013251100ce96a1181f7398ad52b5';
      const emptySlotData = '0x0000000000000000000000000000000000000000000000000000000000000000';

      // First call: implementation slot (has data), second call: beacon slot (empty)
      mockClient.getStorageAt
        .mockResolvedValueOnce(implementationSlotData)
        .mockResolvedValueOnce(emptySlotData);

      // Mock implementation contract bytecode check
      mockClient.getBytecode.mockResolvedValue('0x608060405234801561001057600080fd5b50...');
      mockClient.getCode.mockResolvedValue('0x608060405234801561001057600080fd5b50...');

      // Call the private method through reflection
      const result = await (contractSourceService as any).detectProxy(chainId, proxyAddress);

      expect(result).toEqual({
        isProxy: true,
        proxyType: 'transparent',
        implementationAddress: implementationAddress.toLowerCase(),
      });

      // Verify the correct storage slot was checked
      expect(mockClient.getStorageAt).toHaveBeenCalledWith({
        address: proxyAddress,
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      });

      // Verify implementation contract was validated
      expect(mockClient.getCode).toHaveBeenCalledWith({
        address: implementationAddress,
      });
    });

    it('should return false for non-proxy contracts', async () => {
      const contractAddress = '0x1234567890123456789012345678901234567890';
      const chainId = 1;

      // Mock empty storage slot (no proxy)
      mockClient.getStorageAt
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000000') // implementation slot
        .mockResolvedValueOnce(
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ); // beacon slot

      const result = await (contractSourceService as any).detectProxy(chainId, contractAddress);

      expect(result).toEqual({
        isProxy: false,
      });
    });

    it('should detect beacon proxy correctly', async () => {
      const proxyAddress = '0x1234567890123456789012345678901234567890';
      const beaconAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const beaconImplAddress = '0xef6958d7067013251100ce96a1181f7398ad52b5';
      const chainId = 1;

      // Mock isContractAddress to return true
      vi.spyOn(contractSourceService as any, 'isContractAddress').mockResolvedValue(true);

      // Mock empty implementation slot but valid beacon slot
      mockClient.getStorageAt
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000000') // implementation slot
        .mockResolvedValueOnce(
          '0x000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcd',
        ); // beacon slot

      // The beacon contract's implementation() resolves to the real implementation
      mockClient.readContract.mockResolvedValue(beaconImplAddress);

      const result = await (contractSourceService as any).detectProxy(chainId, proxyAddress);

      expect(result).toEqual({
        isProxy: true,
        proxyType: 'beacon',
        implementationAddress: formatAddress(beaconImplAddress), // the implementation() result, not the beacon address
      });

      // implementation() must be called on the beacon contract itself
      expect(mockClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: beaconAddress,
          functionName: 'implementation',
        }),
      );
    });

    it('should fall back to the beacon address when implementation() fails', async () => {
      const proxyAddress = '0x1234567890123456789012345678901234567890';
      const beaconAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const chainId = 1;

      vi.spyOn(contractSourceService as any, 'isContractAddress').mockResolvedValue(true);

      mockClient.getStorageAt
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000000000000000000000000000') // implementation slot
        .mockResolvedValueOnce(
          '0x000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcd',
        ); // beacon slot

      // Beacon's implementation() reverts — keep the legacy behavior
      mockClient.readContract.mockRejectedValue(new Error('execution reverted'));

      const result = await (contractSourceService as any).detectProxy(chainId, proxyAddress);

      expect(result).toEqual({
        isProxy: true,
        proxyType: 'beacon',
        implementationAddress: formatAddress(beaconAddress), // EIP-55 checksum format
      });
    });

    it('should handle invalid implementation address', async () => {
      const proxyAddress = '0x83358A7241A8EEBaF488F7560f2c2eb5EE05f4ca';
      const chainId = 5000;

      // Mock storage slot with invalid implementation (no bytecode)
      const implementationSlotData =
        '0x000000000000000000000000ef6958d7067013251100ce96a1181f7398ad52b5';
      const emptySlotData = '0x0000000000000000000000000000000000000000000000000000000000000000';

      // First call: implementation slot (has data), second call: beacon slot (empty)
      mockClient.getStorageAt
        .mockResolvedValueOnce(implementationSlotData)
        .mockResolvedValueOnce(emptySlotData);
      mockClient.getBytecode.mockResolvedValue('0x'); // No bytecode
      mockClient.getCode.mockResolvedValue('0x'); // No code

      const result = await (contractSourceService as any).detectProxy(chainId, proxyAddress);

      expect(result).toEqual({
        isProxy: false,
      });
    });

    it('should handle RPC errors gracefully', async () => {
      const proxyAddress = '0x83358A7241A8EEBaF488F7560f2c2eb5EE05f4ca';
      const chainId = 5000;

      // Mock RPC error
      mockClient.getStorageAt.mockRejectedValue(new Error('RPC Error'));

      const result = await (contractSourceService as any).detectProxy(chainId, proxyAddress);

      expect(result).toEqual({
        isProxy: false,
      });
    });

    it('should detect slotless proxies via implementation() ABI fallback', async () => {
      const proxyAddress = '0x1234567890123456789012345678901234567890';
      const implementationAddress = '0xef6958d7067013251100ce96a1181f7398ad52b5';
      const chainId = 1;

      // All well-known storage slots are empty (not EIP-1967/ZeppelinOS)
      mockClient.getStorageAt.mockResolvedValue(
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      );
      // Regular bytecode — not an EIP-1167 minimal proxy
      mockClient.getCode.mockResolvedValue('0x608060405234801561001057600080fd5b50');

      // Gnosis-Safe-style proxy exposing implementation() with no known slot
      mockClient.readContract.mockResolvedValue(implementationAddress);

      const isContractSpy = vi
        .spyOn(contractSourceService as any, 'isContractAddress')
        .mockResolvedValue(true);

      const result = await (contractSourceService as any).detectProxy(chainId, proxyAddress);

      expect(result).toEqual({
        isProxy: true,
        proxyType: 'unknown',
        implementationAddress: formatAddress(implementationAddress),
      });
      // The resolved address is validated as a real contract
      expect(isContractSpy).toHaveBeenCalledWith(chainId, formatAddress(implementationAddress));
    });

    it('should detect Gnosis Safe proxies via masterCopy() ABI fallback', async () => {
      const proxyAddress = '0x1234567890123456789012345678901234567890';
      const masterCopyAddress = '0xd9db270c1b5e3bd161e8c8503c55ceabee709552';
      const chainId = 1;

      mockClient.getStorageAt.mockResolvedValue(
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      );
      mockClient.getCode.mockResolvedValue('0x608060405234801561001057600080fd5b50');

      // implementation() reverts, masterCopy() resolves the singleton address
      mockClient.readContract
        .mockRejectedValueOnce(new Error('execution reverted'))
        .mockResolvedValueOnce(masterCopyAddress);

      vi.spyOn(contractSourceService as any, 'isContractAddress').mockResolvedValue(true);

      const result = await (contractSourceService as any).detectProxy(chainId, proxyAddress);

      expect(result).toEqual({
        isProxy: true,
        proxyType: 'unknown',
        implementationAddress: formatAddress(masterCopyAddress),
      });
      expect(mockClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({ address: proxyAddress, functionName: 'masterCopy' }),
      );
    });

    it('should return false when ABI fallback yields no valid address', async () => {
      const proxyAddress = '0x1234567890123456789012345678901234567890';
      const chainId = 1;

      mockClient.getStorageAt.mockResolvedValue(
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      );
      mockClient.getCode.mockResolvedValue('0x608060405234801561001057600080fd5b50');

      // implementation() returns garbage, masterCopy() returns nothing
      mockClient.readContract.mockResolvedValueOnce('0xdeadbeef').mockResolvedValueOnce(undefined);

      vi.spyOn(contractSourceService as any, 'isContractAddress').mockResolvedValue(true);

      const result = await (contractSourceService as any).detectProxy(chainId, proxyAddress);

      expect(result).toEqual({
        isProxy: false,
      });
    });
  });

  describe('Real-world test case', () => {
    it('should correctly identify Mantle proxy contract', async () => {
      const proxyAddress = '0x83358A7241A8EEBaF488F7560f2c2eb5EE05f4ca';
      const implementationAddress = '0xef6958d7067013251100ce96a1181f7398ad52b5';
      const chainId = 5000;

      // Real data from Mantle network
      const implementationSlotData =
        '0x000000000000000000000000ef6958d7067013251100ce96a1181f7398ad52b5';
      const emptySlotData = '0x0000000000000000000000000000000000000000000000000000000000000000';

      // First call: implementation slot (has data), second call: beacon slot (empty)
      mockClient.getStorageAt
        .mockResolvedValueOnce(implementationSlotData)
        .mockResolvedValueOnce(emptySlotData);
      mockClient.getBytecode.mockResolvedValue('0x608060405234801561001057600080fd5b50...');
      mockClient.getCode.mockResolvedValue('0x608060405234801561001057600080fd5b50...');

      const result = await (contractSourceService as any).detectProxy(chainId, proxyAddress);

      expect(result.isProxy).toBe(true);
      expect(result.proxyType).toBe('transparent');
      expect(result.implementationAddress).toBe(implementationAddress.toLowerCase());
    });
  });

  describe('fetchFromSourcify proxy facets', () => {
    const chainId = 1;
    const diamondAddress = '0xabc1111111111111111111111111111111111111';
    const F0 = '0xfac0000000000000000000000000000000000000';
    const F1 = '0xfac1111111111111111111111111111111111111';
    const F2 = '0xfac2222222222222222222222222222222222222';

    const jsonResponse = (payload: unknown) => ({
      ok: true,
      status: 200,
      json: async () => payload,
    });

    // Plain verified payload for the facet lookups (fetchFromSourcify
    // recurses into getContractSource on facet[0]): without it the proxy
    // branch would recurse forever.
    const verifiedFacetPayload = {
      match: 'match',
      abi: [],
      compilation: { name: 'DiamondLoupeFacet', compilerVersion: 'v0.8.20' },
      sources: {},
    };

    const stubSourcifyFetch = (diamondPayload: unknown) =>
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: unknown) =>
          String(url).includes(diamondAddress)
            ? jsonResponse(diamondPayload)
            : jsonResponse(verifiedFacetPayload),
        ),
      );

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('keeps every facet of a diamond proxy, facet[0] as implementationAddress', async () => {
      // Facet[0] recursion goes through detectProxy (fresh, non-proxy
      // payload): all storage slots empty and no ABI fallback keeps it a
      // plain contract.
      mockClient.getStorageAt.mockResolvedValue(
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      );
      mockClient.getCode.mockResolvedValue('0x608060405234801561001057600080fd5b50');
      mockClient.readContract.mockRejectedValue(new Error('execution reverted'));

      stubSourcifyFetch({
        match: 'match',
        abi: [],
        compilation: { name: 'Diamond', compilerVersion: 'v0.8.0' },
        sources: {},
        proxyResolution: {
          isProxy: true,
          proxyType: 'DiamondProxy',
          implementations: [{ address: F0 }, { address: F1 }, { address: F2 }],
        },
      });

      const result = await (contractSourceService as any).fetchFromSourcify(
        chainId,
        diamondAddress,
      );

      expect(result.isProxy).toBe(true);
      expect(result.proxyType).toBe('diamond');
      // facet[0] stays the compatibility implementationAddress…
      expect(result.implementationAddress).toBe(F0);
      // …but the full facet list is preserved instead of collapsing to [0].
      expect(result.implementationAddresses).toEqual([F0, F1, F2]);
    });

    it('exposes a single implementation as a one-entry facet list', async () => {
      mockClient.getStorageAt.mockResolvedValue(
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      );
      mockClient.getCode.mockResolvedValue('0x608060405234801561001057600080fd5b50');
      mockClient.readContract.mockRejectedValue(new Error('execution reverted'));

      stubSourcifyFetch({
        match: 'match',
        abi: [],
        compilation: { name: 'Proxy', compilerVersion: 'v0.8.0' },
        sources: {},
        proxyResolution: {
          isProxy: true,
          proxyType: 'EIP1967Proxy',
          implementations: [{ address: F0 }],
        },
      });

      const result = await (contractSourceService as any).fetchFromSourcify(
        chainId,
        diamondAddress,
      );

      expect(result.implementationAddress).toBe(F0);
      expect(result.implementationAddresses).toEqual([F0]);
    });
  });
});

describe('ContractSourceService - cache TTL policy', () => {
  const MS_PER_HOUR = 1000 * 60 * 60;
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * MS_PER_HOUR);

  const makeSource = (overrides: Partial<ContractSource> = {}): ContractSource => ({
    chainId: 1,
    address: '0x1234567890123456789012345678901234567890',
    sourceCode: '// source',
    abi: '[]',
    verificationStatus: 'verified',
    verificationSource: 'sourcify',
    lastChecked: new Date(),
    ...overrides,
  });

  // Typed access to the private cache methods without `any`.
  type ServiceInternals = {
    isCacheValid: (source: ContractSource) => boolean;
    getCachedCreationInfo: (
      chainId: number,
      address: Address,
    ) => Promise<ContractCreationInfo | null>;
    isContractAddress: (chainId: number, address: Address) => Promise<boolean>;
  };
  const internals = (service: ContractSourceService) => service as unknown as ServiceInternals;

  describe('isCacheValid tiers', () => {
    let service: ContractSourceService;

    beforeEach(() => {
      service = new ContractSourceService();
    });

    it('keeps a verified non-proxy source valid for 30 days', () => {
      const { isCacheValid } = internals(service);

      expect(
        isCacheValid(
          makeSource({ lastChecked: hoursAgo(VERIFIED_CACHE_TTL_HOURS - 1) }),
        ),
      ).toBe(true);
      expect(isCacheValid(makeSource({ lastChecked: hoursAgo(VERIFIED_CACHE_TTL_HOURS + 1) }))).toBe(
        false,
      );
    });

    it('expires a proxy source after 24 hours even when verified', () => {
      // Regression: proxies previously shared the verified 30-day tier, but
      // an upgrade can swap the implementation at any time.
      const { isCacheValid } = internals(service);

      const proxySource = makeSource({
        isProxy: true,
        proxyType: 'transparent',
        lastChecked: hoursAgo(PROXY_CACHE_TTL_HOURS - 1),
      });
      expect(isCacheValid(proxySource)).toBe(true);

      expect(
        isCacheValid(
          makeSource({
            isProxy: true,
            proxyType: 'transparent',
            lastChecked: hoursAgo(PROXY_CACHE_TTL_HOURS + 1),
          }),
        ),
      ).toBe(false);
    });

    it('expires an unverified source after 1 hour', () => {
      const { isCacheValid } = internals(service);

      expect(
        isCacheValid(
          makeSource({
            verificationStatus: 'unverified',
            lastChecked: hoursAgo(UNVERIFIED_CACHE_TTL_HOURS - 1),
          }),
        ),
      ).toBe(true);
      expect(
        isCacheValid(
          makeSource({
            verificationStatus: 'unverified',
            lastChecked: hoursAgo(UNVERIFIED_CACHE_TTL_HOURS + 1),
          }),
        ),
      ).toBe(false);
    });

    it('keeps unverified proxies on the 1-hour unverified tier', () => {
      const { isCacheValid } = internals(service);

      // 2h old: well inside the 24h proxy window a verified proxy enjoys,
      // but the unverified re-check motive dominates — an unverified
      // proxy has no cached source an upgrade could stale.
      expect(
        isCacheValid(
          makeSource({
            isProxy: true,
            verificationStatus: 'unverified',
            lastChecked: hoursAgo(2),
          }),
        ),
      ).toBe(false);

      // The verified proxy tier is untouched: same age, verified source.
      expect(
        isCacheValid(
          makeSource({
            isProxy: true,
            verificationStatus: 'verified',
            lastChecked: hoursAgo(2),
          }),
        ),
      ).toBe(true);
    });
  });

  describe('contract creation failure cache expiry', () => {
    const address = '0x1234567890123456789012345678901234567890' as Address;

    const failureRow = (lastUpdated: Date) => ({
      chainId: 1,
      address,
      creationTxHash: null,
      creationBlockNumber: null,
      creatorAddress: null,
      factoryAddress: null,
      creationMethod: 'not_a_contract',
      lastUpdated,
    });

    let service: ContractSourceService;
    let selectQueue: Array<Array<unknown>>;

    beforeEach(() => {
      vi.clearAllMocks();
      service = new ContractSourceService();
      selectQueue = [];

      mockDb.select.mockImplementation(() => ({
        from: () => ({
          where: () => ({
            limit: async () => (selectQueue.length > 0 ? selectQueue.shift() : []),
          }),
        }),
      }));
      mockDb.delete.mockImplementation(() => ({ where: async () => undefined }));
      mockDb.insert.mockImplementation(() => ({ values: async () => undefined }));
    });

    it('signals a fresh failure row as CACHED_FAILURE', async () => {
      selectQueue.push([failureRow(hoursAgo(CREATION_FAILURE_CACHE_TTL_HOURS - 1))]);

      await expect(internals(service).getCachedCreationInfo(1, address)).rejects.toThrow(
        'CACHED_FAILURE:not_a_contract',
      );
    });

    it('short-circuits the search for a fresh failure row', async () => {
      selectQueue.push([failureRow(hoursAgo(CREATION_FAILURE_CACHE_TTL_HOURS - 1))]);
      const isContractSpy = vi
        .spyOn(internals(service), 'isContractAddress')
        .mockResolvedValue(false);

      const result = await service.getContractCreationInfo(1, address);

      expect(result).toBeNull();
      expect(isContractSpy).not.toHaveBeenCalled();
    });

    it('deletes an expired failure row and reruns the search', async () => {
      // First select: expired failure row. Second: cacheFailedSearch's
      // existing-row check finds nothing, so a new row is inserted.
      selectQueue.push([failureRow(hoursAgo(CREATION_FAILURE_CACHE_TTL_HOURS + 1))], []);
      const isContractSpy = vi
        .spyOn(internals(service), 'isContractAddress')
        .mockResolvedValue(false);

      const result = await service.getContractCreationInfo(1, address);

      expect(result).toBeNull();
      expect(mockDb.delete).toHaveBeenCalledTimes(1);
      expect(isContractSpy).toHaveBeenCalledTimes(1);
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });
  });
});
