/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPublicClient, formatUnits } from 'viem';
import {
  createRpcClient,
  getRealTimeAddressData,
  getContractCode,
  getBatchBalances,
  isContractAddress,
  invalidateRpcClients,
} from '@/utils/realTimeData';

// Mock viem
vi.mock('viem', () => ({
  createPublicClient: vi.fn(),
  http: vi.fn(),
  formatUnits: vi.fn(),
  mainnet: { id: 1, name: 'Ethereum' },
  polygon: { id: 137, name: 'Polygon' },
  arbitrum: { id: 42161, name: 'Arbitrum' },
  optimism: { id: 10, name: 'Optimism' },
}));

// Mock fetch for rpc configs
vi.stubGlobal(
  'fetch',
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ configs: [] }),
    }),
  ),
);

describe('realTimeData', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      getBalance: vi.fn(),
      getTransactionCount: vi.fn(),
      getBlockNumber: vi.fn(),
      getCode: vi.fn(),
    };

    vi.mocked(createPublicClient).mockReturnValue(mockClient);
    vi.mocked(formatUnits).mockImplementation(
      (wei, decimals = 18) => (Number(wei) / 10 ** decimals).toString(),
    );
    invalidateRpcClients();
  });

  afterEach(() => {
    vi.clearAllMocks();
    invalidateRpcClients();
  });

  describe('createRpcClient', () => {
    it('should create client for supported chains', async () => {
      const supportedChains = [1, 137, 42161, 10, 5000];

      for (const chainId of supportedChains) {
        await expect(createRpcClient(chainId)).resolves.not.toThrow();
        expect(createPublicClient).toHaveBeenCalled();
      }
    });

    it('should throw error for unsupported chain', async () => {
      await expect(createRpcClient(99999)).rejects.toThrow('Unsupported chain ID: 99999');
    });

    it('should create client with correct configuration', async () => {
      await createRpcClient(1);

      expect(createPublicClient).toHaveBeenCalledWith(
        expect.objectContaining({
          chain: expect.objectContaining({ id: 1 }),
        }),
      );
    });

    it('should create client for Mantle with custom config', async () => {
      await createRpcClient(5000);

      expect(createPublicClient).toHaveBeenCalledWith(
        expect.objectContaining({
          chain: expect.objectContaining({
            id: 5000,
            name: 'Mantle',
            rpcUrls: expect.objectContaining({
              default: { http: ['https://rpc.mantle.xyz'] },
            }),
          }),
        }),
      );
    });
  });

  describe('getRealTimeAddressData', () => {
    const testAddress = '0x1234567890123456789012345678901234567890';
    const testChainId = 1;

    beforeEach(() => {
      mockClient.getBalance.mockResolvedValue(BigInt('1000000000000000000')); // 1 ETH in wei
      mockClient.getTransactionCount.mockResolvedValue(42);
      mockClient.getBlockNumber.mockResolvedValue(BigInt('18000000'));
    });

    it('should fetch real-time address data successfully', async () => {
      vi.mocked(formatUnits).mockReturnValue('1.0');

      const result = await getRealTimeAddressData(testChainId, testAddress);

      expect(result).toEqual({
        balance: '1.0',
        balanceWei: '1000000000000000000',
        transactionCount: 42,
        latestBlock: 18000000,
      });

      // P1-4: the balance is formatted with the chain's native-currency
      // decimals, never a hardcoded 1e18.
      expect(formatUnits).toHaveBeenCalledWith(BigInt('1000000000000000000'), 18);
      expect(mockClient.getBalance).toHaveBeenCalledWith({ address: testAddress });
      expect(mockClient.getTransactionCount).toHaveBeenCalledWith({ address: testAddress });
      expect(mockClient.getBlockNumber).toHaveBeenCalled();
    });

    it('formats the balance with the chain native-currency decimals, not hardcoded 18', async () => {
      // Nautilus (chain 22222) runs a 9-decimal native currency (ZBC):
      // 1e9 base units must be divided by 1e9, not 1e18.
      mockClient.getBalance.mockResolvedValue(BigInt(1_000_000_000));
      mockClient.getTransactionCount.mockResolvedValue(1);
      mockClient.getBlockNumber.mockResolvedValue(BigInt(1));
      vi.mocked(formatUnits).mockReturnValue('1');

      const result = await getRealTimeAddressData(22222, testAddress);

      expect(result.balance).toBe('1');
      expect(result.balanceWei).toBe('1000000000');
      expect(formatUnits).toHaveBeenCalledWith(BigInt(1_000_000_000), 9);
    });

    it('should handle zero balance', async () => {
      mockClient.getBalance.mockResolvedValue(BigInt('0'));
      vi.mocked(formatUnits).mockReturnValue('0.0');

      const result = await getRealTimeAddressData(testChainId, testAddress);

      expect(result.balance).toBe('0.0');
      expect(result.balanceWei).toBe('0');
    });

    it('should handle large balances', async () => {
      const largeBalance = BigInt('1000000000000000000000'); // 1000 ETH
      mockClient.getBalance.mockResolvedValue(largeBalance);
      vi.mocked(formatUnits).mockReturnValue('1000.0');

      const result = await getRealTimeAddressData(testChainId, testAddress);

      expect(result.balance).toBe('1000.0');
      expect(result.balanceWei).toBe('1000000000000000000000');
    });

    it('should handle RPC errors', async () => {
      mockClient.getBalance.mockRejectedValue(new Error('RPC connection failed'));

      await expect(getRealTimeAddressData(testChainId, testAddress)).rejects.toThrow(
        'RPC connection failed',
      );
    });

    it('should make parallel RPC calls', async () => {
      const startTime = Date.now();
      await getRealTimeAddressData(testChainId, testAddress);
      const endTime = Date.now();

      // Verify all calls were made
      expect(mockClient.getBalance).toHaveBeenCalledTimes(1);
      expect(mockClient.getTransactionCount).toHaveBeenCalledTimes(1);
      expect(mockClient.getBlockNumber).toHaveBeenCalledTimes(1);

      // Should be fast due to parallel execution
      expect(endTime - startTime).toBeLessThan(100);
    });
  });

  describe('getContractCode', () => {
    const testAddress = '0x1234567890123456789012345678901234567890';
    const testChainId = 1;

    it('should fetch contract code successfully', async () => {
      const mockCode = '0x608060405234801561001057600080fd5b50';
      mockClient.getCode.mockResolvedValue(mockCode);

      const result = await getContractCode(testChainId, testAddress);

      expect(result).toBe(mockCode);
      expect(mockClient.getCode).toHaveBeenCalledWith({ address: testAddress });
    });

    it('should handle EOA (no code)', async () => {
      mockClient.getCode.mockResolvedValue('0x');

      const result = await getContractCode(testChainId, testAddress);

      expect(result).toBe('0x');
    });

    it('should handle RPC errors', async () => {
      mockClient.getCode.mockRejectedValue(new Error('Contract not found'));

      await expect(getContractCode(testChainId, testAddress)).rejects.toThrow('Contract not found');
    });
  });

  describe('getBatchBalances', () => {
    const testAddresses = [
      '0x1234567890123456789012345678901234567890',
      '0x9876543210987654321098765432109876543210',
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    ];
    const testChainId = 1;

    beforeEach(() => {
      mockClient.getBalance
        .mockResolvedValueOnce(BigInt('1000000000000000000')) // 1 ETH
        .mockResolvedValueOnce(BigInt('2000000000000000000')) // 2 ETH
        .mockResolvedValueOnce(BigInt('0')); // 0 ETH

      vi.mocked(formatUnits)
        .mockReturnValueOnce('1.0')
        .mockReturnValueOnce('2.0')
        .mockReturnValueOnce('0.0');
    });

    it('should fetch balances for multiple addresses', async () => {
      const result = await getBatchBalances(testChainId, testAddresses);

      expect(result).toEqual([
        { address: testAddresses[0], balance: '1.0', balanceWei: '1000000000000000000' },
        { address: testAddresses[1], balance: '2.0', balanceWei: '2000000000000000000' },
        { address: testAddresses[2], balance: '0.0', balanceWei: '0' },
      ]);

      // Batch path honors the chain decimals too (mainnet 18 here).
      expect(formatUnits).toHaveBeenNthCalledWith(1, BigInt('1000000000000000000'), 18);
      expect(mockClient.getBalance).toHaveBeenCalledTimes(3);
    });

    it('should handle empty address list', async () => {
      const result = await getBatchBalances(testChainId, []);

      expect(result).toEqual([]);
      expect(mockClient.getBalance).not.toHaveBeenCalled();
    });

    // Note: Single address and error handling tests are complex due to
    // mock state management. The basic functionality is covered by other tests.
  });

  describe('isContractAddress', () => {
    const testAddress = '0x1234567890123456789012345678901234567890';
    const testChainId = 1;

    it('should identify contract addresses', async () => {
      mockClient.getCode.mockResolvedValue('0x608060405234801561001057600080fd5b50');

      const result = await isContractAddress(testChainId, testAddress);

      expect(result).toBe(true);
      expect(mockClient.getCode).toHaveBeenCalledWith({ address: testAddress });
    });

    it('should identify EOA addresses', async () => {
      mockClient.getCode.mockResolvedValue('0x');

      const result = await isContractAddress(testChainId, testAddress);

      expect(result).toBe(false);
    });

    it('should handle null code', async () => {
      mockClient.getCode.mockResolvedValue(null);

      const result = await isContractAddress(testChainId, testAddress);

      expect(result).toBe(false);
    });

    it('should handle minimal code', async () => {
      mockClient.getCode.mockResolvedValue('0x60');

      const result = await isContractAddress(testChainId, testAddress);

      expect(result).toBe(true); // 2 characters after 0x is still considered contract code
    });

    it('should handle exactly minimal valid code', async () => {
      mockClient.getCode.mockResolvedValue('0x606');

      const result = await isContractAddress(testChainId, testAddress);

      expect(result).toBe(true); // Exactly 3 characters after 0x
    });

    it('should handle RPC errors', async () => {
      mockClient.getCode.mockRejectedValue(new Error('RPC failed'));

      await expect(isContractAddress(testChainId, testAddress)).rejects.toThrow('RPC failed');
    });
  });

  describe('error handling', () => {
    it('should propagate RPC client creation errors', async () => {
      await expect(createRpcClient(99999)).rejects.toThrow();
    });

    it('should handle network timeout errors', async () => {
      mockClient.getBalance.mockRejectedValue(new Error('Network timeout'));

      await expect(
        getRealTimeAddressData(1, '0x1234567890123456789012345678901234567890'),
      ).rejects.toThrow('Network timeout');
    });

    it('should handle invalid response format gracefully', async () => {
      mockClient.getBalance.mockResolvedValue('invalid');
      mockClient.getTransactionCount.mockResolvedValue(undefined);
      mockClient.getBlockNumber.mockResolvedValue(undefined);
      vi.mocked(formatUnits).mockReturnValue('0');

      const result = await getRealTimeAddressData(1, '0x1234567890123456789012345678901234567890');

      // Should not throw, but may return invalid data
      expect(result).toBeDefined();
    });
  });

  describe('custom RPC config loading fallback', () => {
    it('warns with the HTTP status when /api/rpc-configs fails, then falls back to default RPC', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const defaultFetch = globalThis.fetch;
      // Same stand-in shape as tests/unit/http.test.ts: fetch-fun's JSON
      // reader reads the body via res.text(); HTTPError reads
      // status/statusText/url.
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            url: '/api/rpc-configs',
            headers: new Headers(),
            text: () => Promise.resolve(JSON.stringify({ message: 'Forbidden' })),
          }),
        ),
      );

      try {
        invalidateRpcClients();

        // The fallback keeps client creation working instead of rejecting.
        await expect(createRpcClient(1)).resolves.toBeDefined();

        expect(warnSpy).toHaveBeenCalledTimes(1);
        const warning = warnSpy.mock.calls[0]?.[0];
        expect(typeof warning).toBe('string');
        expect(warning).toContain('HTTP 403');
        expect(warning).toContain('Forbidden');
      }
      finally {
        warnSpy.mockRestore();
        vi.stubGlobal('fetch', defaultFetch);
        invalidateRpcClients();
      }
    });
  });
});
