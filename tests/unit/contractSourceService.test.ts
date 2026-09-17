/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetClient = vi.hoisted(() => vi.fn());

vi.mock('@/services/RpcManager', () => ({
  rpcManager: {
    getClient: mockGetClient,
  },
}));

vi.mock('@/database/init', () => ({
  db: {
    query: vi.fn(),
  },
}));

import { ContractSourceService } from '@/services/ContractSourceService';
import { formatAddress } from '@/utils/address';

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
});
