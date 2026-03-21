import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock RpcManager
vi.mock('../../services/RpcManager', () => ({
  rpcManager: {
    getClient: vi.fn(),
  },
}));

// Mock database
vi.mock('../../database/init', () => ({
  db: {
    query: vi.fn(),
  },
}));

// Import after mocking
import { ContractSourceService } from '@/services/ContractSourceService';
import { rpcManager } from '@/services/RpcManager';

describe('ContractSourceService - Proxy Detection', () => {
  let contractSourceService: ContractSourceService;
  let mockClient: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock client
    mockClient = {
      getStorageAt: vi.fn(),
      getBytecode: vi.fn(),
      getCode: vi.fn(),
    };

    // Mock rpcManager.getClient to return our mock client
    (rpcManager.getClient as any).mockResolvedValue(mockClient);

    contractSourceService = new ContractSourceService();
  });

  describe('detectProxy', () => {
    it('should detect EIP-1967 transparent proxy correctly', async () => {
      const proxyAddress = '0x83358A7241A8EEBaF488F7560f2c2eb5EE05f4ca';
      const implementationAddress
        = '0xef6958d7067013251100ce96a1181f7398ad52b5';
      const chainId = 5000;

      // Mock storage slot responses
      const implementationSlotData
        = '0x000000000000000000000000ef6958d7067013251100ce96a1181f7398ad52b5';
      const emptySlotData
        = '0x0000000000000000000000000000000000000000000000000000000000000000';

      // First call: implementation slot (has data), second call: beacon slot (empty)
      mockClient.getStorageAt
        .mockResolvedValueOnce(implementationSlotData)
        .mockResolvedValueOnce(emptySlotData);

      // Mock implementation contract bytecode check
      mockClient.getBytecode.mockResolvedValue(
        '0x608060405234801561001057600080fd5b50...',
      );
      mockClient.getCode.mockResolvedValue(
        '0x608060405234801561001057600080fd5b50...',
      );

      // Call the private method through reflection
      const result = await (contractSourceService as any).detectProxy(
        chainId,
        proxyAddress,
      );

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
        .mockResolvedValueOnce(
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ) // implementation slot
        .mockResolvedValueOnce(
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ); // beacon slot

      const result = await (contractSourceService as any).detectProxy(
        chainId,
        contractAddress,
      );

      expect(result).toEqual({
        isProxy: false,
      });
    });

    it('should detect beacon proxy correctly', async () => {
      const proxyAddress = '0x1234567890123456789012345678901234567890';
      const beaconAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const chainId = 1;

      // Mock isContractAddress to return true
      vi.spyOn(
        contractSourceService as any,
        'isContractAddress',
      ).mockResolvedValue(true);

      // Mock empty implementation slot but valid beacon slot
      mockClient.getStorageAt
        .mockResolvedValueOnce(
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ) // implementation slot
        .mockResolvedValueOnce(
          '0x000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcd',
        ); // beacon slot

      const result = await (contractSourceService as any).detectProxy(
        chainId,
        proxyAddress,
      );

      // The code extracts the address from the last 40 characters of the beacon slot data
      const expectedAddress
        = `0x${
          '000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcd'.slice(
            -40,
          )}`;

      expect(result).toEqual({
        isProxy: true,
        proxyType: 'beacon',
        implementationAddress: '0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD', // EIP-55 checksum format
      });
    });

    it('should handle invalid implementation address', async () => {
      const proxyAddress = '0x83358A7241A8EEBaF488F7560f2c2eb5EE05f4ca';
      const chainId = 5000;

      // Mock storage slot with invalid implementation (no bytecode)
      const implementationSlotData
        = '0x000000000000000000000000ef6958d7067013251100ce96a1181f7398ad52b5';
      const emptySlotData
        = '0x0000000000000000000000000000000000000000000000000000000000000000';

      // First call: implementation slot (has data), second call: beacon slot (empty)
      mockClient.getStorageAt
        .mockResolvedValueOnce(implementationSlotData)
        .mockResolvedValueOnce(emptySlotData);
      mockClient.getBytecode.mockResolvedValue('0x'); // No bytecode
      mockClient.getCode.mockResolvedValue('0x'); // No code

      const result = await (contractSourceService as any).detectProxy(
        chainId,
        proxyAddress,
      );

      expect(result).toEqual({
        isProxy: false,
      });
    });

    it('should handle RPC errors gracefully', async () => {
      const proxyAddress = '0x83358A7241A8EEBaF488F7560f2c2eb5EE05f4ca';
      const chainId = 5000;

      // Mock RPC error
      mockClient.getStorageAt.mockRejectedValue(new Error('RPC Error'));

      const result = await (contractSourceService as any).detectProxy(
        chainId,
        proxyAddress,
      );

      expect(result).toEqual({
        isProxy: false,
      });
    });
  });

  describe('Real-world test case', () => {
    it('should correctly identify Mantle proxy contract', async () => {
      const proxyAddress = '0x83358A7241A8EEBaF488F7560f2c2eb5EE05f4ca';
      const implementationAddress
        = '0xef6958d7067013251100ce96a1181f7398ad52b5';
      const chainId = 5000;

      // Real data from Mantle network
      const implementationSlotData
        = '0x000000000000000000000000ef6958d7067013251100ce96a1181f7398ad52b5';
      const emptySlotData
        = '0x0000000000000000000000000000000000000000000000000000000000000000';

      // First call: implementation slot (has data), second call: beacon slot (empty)
      mockClient.getStorageAt
        .mockResolvedValueOnce(implementationSlotData)
        .mockResolvedValueOnce(emptySlotData);
      mockClient.getBytecode.mockResolvedValue(
        '0x608060405234801561001057600080fd5b50...',
      );
      mockClient.getCode.mockResolvedValue(
        '0x608060405234801561001057600080fd5b50...',
      );

      const result = await (contractSourceService as any).detectProxy(
        chainId,
        proxyAddress,
      );

      expect(result.isProxy).toBe(true);
      expect(result.proxyType).toBe('transparent');
      expect(result.implementationAddress).toBe(
        implementationAddress.toLowerCase(),
      );
    });
  });
});
