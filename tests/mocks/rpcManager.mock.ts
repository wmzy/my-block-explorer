import { vi } from 'vitest';

// Mock RPC Manager to avoid database connections in tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mockRpcManager: any = {
  getClient: vi.fn().mockImplementation((chainId: number) => {
    if (chainId === 999999) {
      return Promise.reject(new Error('Unsupported chain ID'));
    }

    return Promise.resolve({
      getBlockNumber: vi.fn().mockResolvedValue(18500000n),
      getBlock: vi
        .fn()
        .mockImplementation(
          ({ blockNumber, blockTag }: { blockNumber?: bigint; blockTag?: string }) => {
            if (blockTag === 'latest') {
              return Promise.resolve({
                number: 18500000n,
                hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
                timestamp: 1697356800n,
                transactions: ['0xabc123', '0xdef456'],
              });
            }
            if (blockNumber === 18000000n) {
              return Promise.resolve({
                number: 18000000n, // Return the requested block number
                hash: '0x95b198e154acbfc64109dfd22d8224fe927fd8dfdedfae01587674482ba4baf3',
              });
            }
            return Promise.resolve({
              number: blockNumber,
              hash: `0x${blockNumber?.toString(16).padStart(64, '0') ?? ''}`,
            });
          },
        ),
      getBalance: vi.fn().mockResolvedValue(1000000000000000000n),
      getTransactionCount: vi.fn().mockResolvedValue(42),
      getCode: vi.fn().mockImplementation(({ address }: { address: string }) => {
        // EOA addresses return 0x
        if (address === '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045') {
          return Promise.resolve('0x');
        }
        // Contract addresses return some code
        return Promise.resolve('0x608060405234801561001057600080fd5b50');
      }),
    });
  }),
  getChainName: vi.fn().mockReturnValue('Ethereum'),
  testRpcConnection: vi.fn().mockImplementation((_chainId: number, customUrl?: string) => {
    if (customUrl === 'http://invalid-rpc-url.com') {
      return Promise.resolve({
        success: false,
        error: 'Connection failed',
      });
    }
    return Promise.resolve({
      success: true,
      latency: 100,
    });
  }),
  loadUserConfigs: vi.fn().mockResolvedValue([]),
};

// Mock the RPC Manager module
vi.mock('@/services/RpcManager', () => ({
  rpcManager: mockRpcManager,
}));
