import { describe, it, expect } from 'vitest';
import { createBlockService, blockService } from '@/services/BlockService';
import { createTransactionService, transactionService } from '@/services/TransactionService';
import { createSearchService, searchService } from '@/services/SearchService';
import { RpcManager } from '@/services/RpcManager';
import { ContractInteractionService } from '@/services/ContractInteractionService';

describe('Services - Basic Structure Tests', () => {
  describe('BlockService', () => {
    it('should create BlockService instance via factory', () => {
      const service = createBlockService({
        db: {} as any,
        blocks: {} as any,
        rpcManager: {} as any,
        blockCache: {} as any,
        createRetryableRpcCall: (fn: any) => fn,
        createRetryableDbCall: (fn: any) => fn,
        logError: () => {},
      });
      expect(service).toBeDefined();
      expect(typeof service.getLatestBlock).toBe('function');
    });

    it('should have required methods', () => {
      expect(typeof blockService.getLatestBlock).toBe('function');
      expect(typeof blockService.getBlockByNumber).toBe('function');
      expect(typeof blockService.getBlockByHash).toBe('function');
      expect(typeof blockService.getBlocks).toBe('function');
    });
  });

  describe('TransactionService', () => {
    it('should create TransactionService instance via factory', () => {
      const service = createTransactionService({
        db: {} as any,
        transactions: {} as any,
        blocks: {} as any,
        rpcManager: {} as any,
      });
      expect(service).toBeDefined();
      expect(typeof service.getTransactionByHash).toBe('function');
    });

    it('should have required methods', () => {
      expect(typeof transactionService.getTransactionByHash).toBe('function');
      expect(typeof transactionService.getTransactionsByBlockNumber).toBe('function');
      expect(typeof transactionService.getTransactionsByAddress).toBe('function');
    });
  });

  describe('SearchService', () => {
    it('should create SearchService instance via factory', () => {
      const service = createSearchService({
        db: {} as any,
        searchHistory: {} as any,
        blockService: {} as any,
        transactionService: {} as any,
        addressService: {} as any,
      });
      expect(service).toBeDefined();
      expect(typeof service.search).toBe('function');
    });

    it('should have required methods', () => {
      expect(typeof searchService.search).toBe('function');
    });

    it('should handle search method parameters correctly', () => {
      expect(() => searchService.search(1, 'test-query')).not.toThrow();
      expect(() => searchService.search(1, '12345')).not.toThrow();
      expect(() => searchService.search(1, '0x1234567890123456789012345678901234567890')).not.toThrow();
    });

    it('should detect search types correctly', () => {
      const mockBlockService = {
        getBlockByNumber: async () => null,
        getBlockByHash: async () => null,
        getLatestBlock: async () => null,
      };
      const mockTransactionService = {
        getTransactionByHash: async () => null,
        getLatestTransactions: async () => [],
      };
      const mockAddressService = {
        getAddressInfo: async () => ({}),
      };
      const service = createSearchService({
        db: {} as any,
        searchHistory: {} as any,
        blockService: mockBlockService as any,
        transactionService: mockTransactionService as any,
        addressService: mockAddressService as any,
      });

      const resultBlock = service.search(1, '12345');
      const resultTx = service.search(1, '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
      const resultAddr = service.search(1, '0x1234567890123456789012345678901234567890');

      expect(resultBlock).resolves.toMatchObject({ type: 'block' });
      expect(resultTx).resolves.toMatchObject({ type: 'transaction' });
      expect(resultAddr).resolves.toMatchObject({ type: 'address' });
    });
  });

  describe('RpcManager', () => {
    it('should create RpcManager instance', () => {
      const manager = new RpcManager();
      expect(manager).toBeInstanceOf(RpcManager);
    });

    it('should have required methods', () => {
      const manager = new RpcManager();

      expect(typeof manager.getClient).toBe('function');
      expect(typeof manager.getChainName).toBe('function');
      expect(typeof manager.testRpcConnection).toBe('function');
    });

    it('should return correct chain names', () => {
      const manager = new RpcManager();

      expect(manager.getChainName(1)).toBe('Ethereum');
      expect(manager.getChainName(137)).toBe('Polygon');
      expect(manager.getChainName(42161)).toBe('Arbitrum One');
      expect(manager.getChainName(10)).toBe('OP Mainnet');
      expect(manager.getChainName(5000)).toBe('Mantle');
      expect(manager.getChainName(99999)).toBe('Chain 99999');
    });

    it('should handle method parameters correctly', () => {
      const manager = new RpcManager();

      expect(() => manager.getClient(1)).not.toThrow();
      expect(() => manager.testRpcConnection(1)).not.toThrow();
    });
  });

  describe('ContractInteractionService', () => {
    it('should create ContractInteractionService instance', () => {
      const service = new ContractInteractionService();
      expect(service).toBeInstanceOf(ContractInteractionService);
    });

    it('should be a class with constructor', () => {
      expect(ContractInteractionService).toBeDefined();
      expect(typeof ContractInteractionService).toBe('function');
    });
  });

  describe('Service Integration', () => {
    it('should create all services without conflicts', () => {
      expect(blockService).toBeDefined();
      expect(transactionService).toBeDefined();
      expect(searchService).toBeDefined();
      const rpcManager = new RpcManager();
      const contractService = new ContractInteractionService();

      expect(typeof blockService.getLatestBlock).toBe('function');
      expect(typeof transactionService.getTransactionByHash).toBe('function');
      expect(typeof searchService.search).toBe('function');
      expect(rpcManager).toBeInstanceOf(RpcManager);
      expect(contractService).toBeInstanceOf(ContractInteractionService);
    });

    it('should handle invalid parameters gracefully', async () => {
      const result = await searchService.search(1, '');
      expect(result).toHaveProperty('found', false);
      expect(result).toHaveProperty('error');
    });
  });
});
