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

describe('ContractSourceService - not-a-contract gate & facet persistence', () => {
  const chainId = 1;
  const eoaAddress = '0x00000000000000000000000000000000000dead' as Address;
  const D0 = '0xfac0000000000000000000000000000000000000' as Address;
  const D1 = '0xfac1111111111111111111111111111111111111' as Address;
  const D2 = '0xfac2222222222222222222222222222222222222' as Address;
  const diamondAddress = '0xabc1111111111111111111111111111111111111' as Address;

  let service: ContractSourceService;
  let mockClient: { getCode: ReturnType<typeof vi.fn> };
  let selectQueue: Array<Array<unknown>>;
  let insertValues: Array<Record<string, unknown>>;

  const notFoundFetch = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })),
    );

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = { getCode: vi.fn() };
    mockGetClient.mockResolvedValue(mockClient);

    selectQueue = [];
    insertValues = [];

    mockDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => (selectQueue.length > 0 ? selectQueue.shift() : []),
        }),
      }),
    }));
    mockDb.insert.mockImplementation(() => ({
      values: (v: Record<string, unknown>) => {
        insertValues.push(v);
        return { onConflictDoUpdate: async () => undefined };
      },
    }));
    mockDb.delete.mockImplementation(() => ({ where: async () => undefined }));
    // saveProxyInfo runs on every proxy cache hit.
    (mockDb as Record<string, unknown>).update = vi.fn(() => ({
      set: () => ({ where: async () => undefined }),
    }));

    service = new ContractSourceService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getContractSource not-a-contract gate (P1-2)', () => {
    it('returns null without caching when the address has no deployed code', async () => {
      selectQueue.push([]); // source cache miss
      notFoundFetch(); // Sourcify + Blockscan both miss
      mockClient.getCode.mockResolvedValue('0x');

      const result = await service.getContractSource(chainId, eoaAddress);

      expect(result).toBeNull();
      expect(mockClient.getCode).toHaveBeenCalledWith({ address: eoaAddress });
      // No unverified row may be written for an EOA…
      expect(mockDb.insert).not.toHaveBeenCalled();
      // …and a stale pre-fix row gets purged instead of served.
      expect(mockDb.delete).toHaveBeenCalledTimes(1);
    });

    it('self-heals a stale unverified row written before the fix', async () => {
      selectQueue.push([
        {
          chainId,
          address: eoaAddress,
          sourceCode: '',
          sourceFiles: null,
          abi: '[]',
          contractName: null,
          compilerVersion: null,
          optimizationUsed: null,
          runs: null,
          constructorArguments: null,
          evmVersion: null,
          library: null,
          licenseType: null,
          proxy: null,
          implementation: null,
          implementationAddresses: null,
          swarmSource: null,
          isVerified: false,
          verificationSource: 'unknown',
          verificationDate: null,
          lastUpdated: new Date(),
        },
      ]);
      notFoundFetch();
      mockClient.getCode.mockResolvedValue('0x');

      const result = await service.getContractSource(chainId, eoaAddress);

      expect(result).toBeNull();
      expect(mockDb.delete).toHaveBeenCalledTimes(1);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('keeps the unverified fallback when the code check itself fails', async () => {
      selectQueue.push([]);
      notFoundFetch();
      // RPC error must not be conflated with "not a contract".
      mockClient.getCode.mockRejectedValue(new Error('node unreachable'));

      const result = await service.getContractSource(chainId, eoaAddress);

      expect(result).not.toBeNull();
      expect(result?.verificationStatus).toBe('unverified');
      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(insertValues).toHaveLength(1);
      expect(insertValues[0]?.isVerified).toBe(false);
    });
  });

  describe('diamond facet persistence (B4)', () => {
    const diamondRow = {
      chainId,
      address: diamondAddress,
      sourceCode: '// diamond proxy',
      sourceFiles: null,
      abi: '[]',
      contractName: 'Diamond',
      compilerVersion: 'v0.8.0',
      optimizationUsed: null,
      runs: null,
      constructorArguments: null,
      evmVersion: null,
      library: null,
      licenseType: null,
      proxy: 'diamond',
      implementation: D0,
      implementationAddresses: JSON.stringify([D0, D1, D2]),
      swarmSource: null,
      isVerified: true,
      verificationSource: 'sourcify',
      verificationDate: new Date(),
      lastUpdated: new Date(),
    };

    it('serves the full facet list from a cache hit', async () => {
      selectQueue.push([diamondRow], []); // diamond hit, then facet[0] lookup misses
      notFoundFetch(); // facet[0] is not on the verifiers either
      mockClient.getCode.mockResolvedValue('0x'); // facet[0] has no code → null impl

      const result = await service.getContractSource(chainId, diamondAddress);

      // Regression: pre-fix cache hits read implementationAddresses back as
      // undefined, degrading the diamond to a single implementation.
      expect(result?.isProxy).toBe(true);
      expect(result?.proxyType).toBe('diamond');
      expect(result?.implementationAddresses).toEqual([D0, D1, D2]);
    });

    it('persists the facet list into the cache row', async () => {
      await (service as unknown as {
        saveToDatabase: (s: ContractSource) => Promise<void>;
      }).saveToDatabase({
        chainId,
        address: diamondAddress,
        sourceCode: '// diamond proxy',
        abi: '[]',
        verificationStatus: 'verified',
        verificationSource: 'sourcify',
        lastChecked: new Date(),
        isProxy: true,
        proxyType: 'diamond',
        implementationAddress: D0,
        implementationAddresses: [D0, D1, D2],
      });

      expect(insertValues).toHaveLength(1);
      expect(insertValues[0]?.implementationAddresses).toBe(
        JSON.stringify([D0, D1, D2]),
      );
      expect(insertValues[0]?.proxy).toBe('diamond');
    });

    it('reads pre-column rows (NULL facets) back as undefined, not an error', async () => {
      const legacyRow = { ...diamondRow, implementationAddresses: null };
      selectQueue.push([legacyRow], []);
      notFoundFetch();
      mockClient.getCode.mockResolvedValue('0x');

      const result = await service.getContractSource(chainId, diamondAddress);

      expect(result?.implementationAddresses).toBeUndefined();
    });

    it('ignores malformed facet JSON instead of failing the cache hit', async () => {
      const brokenRow = { ...diamondRow, implementationAddresses: '{not json' };
      selectQueue.push([brokenRow], []);
      notFoundFetch();
      mockClient.getCode.mockResolvedValue('0x');

      const result = await service.getContractSource(chainId, diamondAddress);

      expect(result).not.toBeNull();
      expect(result?.implementationAddresses).toBeUndefined();
    });
  });
});

describe('ContractSourceService - manual (local-trust) verification', () => {
  const chainId = 1;
  const contractAddress = '0x9991111111111111111111111111111111111111' as Address;
  const ABI = '[{"type":"function","name":"get","inputs":[],"outputs":[{"type":"uint256"}]}]';

  let service: ContractSourceService;
  let selectQueue: Array<Array<unknown>>;
  let insertValues: Array<Record<string, unknown>>;
  let updateSets: Array<Record<string, unknown>>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  // Both helpers return the installed stub so tests can assert on the
  // exact fetch instance their scenario ran with.
  const notFoundFetch = () => {
    const stub = vi.fn(async () => ({ ok: false, status: 404 }));
    vi.stubGlobal('fetch', stub);
    return stub;
  };

  // A contract_sources row as saveToDatabase would have written it for a
  // manual mark. lastUpdated drives the TTL re-probe decision.
  const manualRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    chainId,
    address: contractAddress,
    contractName: 'C',
    compilerVersion: null,
    optimizationUsed: null,
    runs: null,
    sourceCode: '',
    sourceFiles: null,
    abi: ABI,
    constructorArguments: null,
    evmVersion: null,
    library: null,
    licenseType: null,
    proxy: null,
    implementation: null,
    implementationAddresses: null,
    isVerified: true,
    verificationSource: 'manual',
    verificationDate: new Date(),
    lastUpdated: new Date(),
    ...overrides,
  });

  const sourcifyHitFetch = () => {
    const stub = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        match: 'match',
        abi: [{ type: 'function', name: 'get', inputs: [], outputs: [] }],
        compilation: { name: 'Remote', compilerVersion: '0.8.20' },
        sources: { 'Remote.sol': { content: 'contract Remote {}' } },
      }),
    }));
    vi.stubGlobal('fetch', stub);
    return stub;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    selectQueue = [];
    insertValues = [];
    updateSets = [];

    mockDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => (selectQueue.length > 0 ? selectQueue.shift() : []),
        }),
      }),
    }));
    mockDb.insert.mockImplementation(() => ({
      values: (v: Record<string, unknown>) => {
        insertValues.push(v);
        return { onConflictDoUpdate: async () => undefined };
      },
    }));
    mockDb.delete.mockImplementation(() => ({ where: async () => undefined }));
    (mockDb as Record<string, unknown>).update = vi.fn(() => ({
      set: (v: Record<string, unknown>) => {
        updateSets.push(v);
        return { where: async () => undefined };
      },
    }));

    // Default: every remote hop misses; tests that expect a hit install
    // their own stub.
    fetchSpy = notFoundFetch();

    service = new ContractSourceService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('saveManualVerification', () => {
    it('upserts a verified manual row with the pasted payload and null proxy fields', async () => {
      const result = await service.saveManualVerification(chainId, contractAddress, {
        abi: ABI,
        sourceCode: 'contract C {}',
        name: 'C',
      });

      expect(result.verificationStatus).toBe('verified');
      expect(result.verificationSource).toBe('manual');
      expect(result.abi).toBe(ABI);
      expect(result.name).toBe('C');

      expect(insertValues).toHaveLength(1);
      const row = insertValues[0];
      expect(row.chainId).toBe(chainId);
      expect(row.address).toBe(contractAddress);
      expect(row.isVerified).toBe(true);
      expect(row.verificationSource).toBe('manual');
      expect(row.contractName).toBe('C');
      expect(row.sourceCode).toBe('contract C {}');
      expect(row.abi).toBe(ABI);
      expect(row.proxy).toBeNull();
      expect(row.implementation).toBeNull();
      expect(row.implementationAddresses).toBeNull();
      expect(row.lastUpdated).toBeInstanceOf(Date);
    });

    it('round-trips: a saved manual row reads back as the served source', async () => {
      await service.saveManualVerification(chainId, contractAddress, { abi: ABI, name: 'C' });
      // Shape the DB row exactly as the captured insert wrote it.
      const written = { ...insertValues[0] };
      selectQueue.push([written]);

      const read = await service.getContractSource(chainId, contractAddress);

      expect(read).not.toBeNull();
      expect(read?.verificationStatus).toBe('verified');
      expect(read?.verificationSource).toBe('manual');
      expect(read?.abi).toBe(ABI);
      expect(read?.name).toBe('C');
      // Served from the DB shortcut — no remote probe for a fresh mark.
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('serves an ABI-only mark (empty sourceCode) from the DB shortcut', async () => {
      // The generic verified shortcut requires sourceCode; the manual
      // branch must not let an ABI-only mark fall through to the remote
      // pipeline (which would overwrite it with an unverified row).
      selectQueue.push([manualRow({ sourceCode: null })]);

      const read = await service.getContractSource(chainId, contractAddress);

      expect(read?.verificationSource).toBe('manual');
      expect(read?.verificationStatus).toBe('verified');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(insertValues).toHaveLength(0);
    });
  });

  describe('manual-vs-remote precedence', () => {
    it('re-probes Sourcify once a manual mark exceeds the unverified TTL; a hit supersedes it', async () => {
      fetchSpy = sourcifyHitFetch();
      // detectProxy would hit the RPC manager; the remote result is a
      // plain non-proxy contract, so stub the probe to not-proxy.
      vi.spyOn(service as any, 'detectProxy').mockResolvedValue({ isProxy: false });
      selectQueue.push([
        manualRow({ lastUpdated: new Date(Date.now() - 2 * 60 * 60 * 1000) }),
      ]);

      const result = await service.getContractSource(chainId, contractAddress);

      // Cryptographic verification beats local trust.
      expect(result?.verificationSource).toBe('sourcify');
      expect(result?.verificationStatus).toBe('verified');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(insertValues).toHaveLength(1);
      expect(insertValues[0]?.verificationSource).toBe('sourcify');
      expect(insertValues[0]?.isVerified).toBe(true);
    });

    it('keeps the manual mark on a remote miss and refreshes its TTL window', async () => {
      selectQueue.push([
        manualRow({ lastUpdated: new Date(Date.now() - 2 * 60 * 60 * 1000) }),
      ]);

      const result = await service.getContractSource(chainId, contractAddress);

      expect(result?.verificationSource).toBe('manual');
      expect(result?.verificationStatus).toBe('verified');
      // The miss path must not rewrite the row as unverified…
      expect(insertValues).toHaveLength(0);
      // …nor run the not-a-contract gate (that belongs to the no-cache
      // path, not the manual-mark path).
      expect(mockGetClient).not.toHaveBeenCalled();
      // The re-probe cadence window is pushed forward instead.
      expect(updateSets).toHaveLength(1);
      expect(updateSets[0]?.lastUpdated).toBeInstanceOf(Date);
      // And the returned payload reflects the refreshed timestamp.
      expect(result?.lastChecked.getTime()).toBeGreaterThan(Date.now() - 60 * 1000);
    });
  });

  describe('deleteManualVerification', () => {
    it('deletes a manual row via the cache clear and reports true', async () => {
      selectQueue.push([manualRow()]);

      const removed = await service.deleteManualVerification(chainId, contractAddress);

      expect(removed).toBe(true);
      expect(mockDb.delete).toHaveBeenCalledTimes(1);
    });

    it('refuses to delete a sourcify-verified row (reports false, row intact)', async () => {
      selectQueue.push([manualRow({ verificationSource: 'sourcify' })]);

      const removed = await service.deleteManualVerification(chainId, contractAddress);

      expect(removed).toBe(false);
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('reports false when no row exists', async () => {
      selectQueue.push([]);

      const removed = await service.deleteManualVerification(chainId, contractAddress);

      expect(removed).toBe(false);
      expect(mockDb.delete).not.toHaveBeenCalled();
    });
  });
});
