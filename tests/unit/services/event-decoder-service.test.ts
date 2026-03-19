/**
 * Unit tests for EventDecoderService
 * Tests event log decoding using Viem and parameter formatting
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventDecoderService } from '../../../src/services/EventDecoderService';
import { ChainDatabaseManager } from '../../../src/database/chain-database-manager';
import { initializeMultiChainEnvironment } from '../../../src/database/multi-chain-setup';
import { Abi, AbiEvent, Log, Address } from 'viem';
import { EventDecodingError } from '../../../src/types/events';

describe('EventDecoderService', () => {
  const chainId = 1;
  const contractAddress = '0x1234567890123456789012345678901234567890';
  let decoderService: EventDecoderService;
  let chainDb: ChainDatabaseManager;

  // Sample ABI with common events
  const sampleAbi: Abi = [
    {
      type: 'event',
      name: 'Transfer',
      inputs: [
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'value', type: 'uint256', indexed: false },
      ],
    },
    {
      type: 'event',
      name: 'Approval',
      inputs: [
        { name: 'owner', type: 'address', indexed: true },
        { name: 'spender', type: 'address', indexed: true },
        { name: 'value', type: 'uint256', indexed: false },
      ],
    },
    {
      type: 'event',
      name: 'MultiTokenTransfer',
      inputs: [
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'tokens', type: 'uint256[]', indexed: false },
        { name: 'amounts', type: 'uint256[]', indexed: false },
      ],
    },
  ];

  // Sample log data
  const sampleTransferLog: Log = {
    address: contractAddress as Address,
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer(address,address,uint256)
      '0x000000000000000000000000abcdef1234567890abcdef1234567890abcdef12',
      '0x0000000000000000000000001234567890abcdef1234567890abcdef12345678',
    ],
    data: '0x00000000000000000000000000000000000000000000000de0b6b3a7640000', // 1 ETH in wei
    blockNumber: 18000000n,
    blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  };

  const sampleApprovalLog: Log = {
    address: contractAddress as Address,
    topics: [
      '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925', // Approval(address,address,uint256)
      '0x0000000000000000000000001234567890abcdef1234567890abcdef12345678',
      '0x000000000000000000000000abcdef1234567890abcdef1234567890abcdef12',
    ],
    data: '0x0000000000000000000000000000000000000000000000004563918244f40000', // 5 ETH in wei
    blockNumber: 18000001n,
    blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    transactionIndex: 1,
    logIndex: 1,
    removed: false,
  };

  beforeEach(async () => {
    // Initialize test environment
    await initializeMultiChainEnvironment({
      environment: 'test',
      chains: [chainId],
      createDataDirectories: true,
    });

    // Setup service
    chainDb = await ChainDatabaseManager.getInstance().getChainDatabase(chainId);
    decoderService = new EventDecoderService(chainId);

    // Mock block timestamp
    vi.spyOn(decoderService as any, 'getBlockTimestamp').mockResolvedValue('2024-01-01T00:00:00Z');
  });

  describe('Single event decoding', () => {
    it('should decode a Transfer event successfully', async () => {
      const result = await decoderService.decodeEventLog(sampleTransferLog, {
        chainId,
        contractAddress: contractAddress as Address,
        abi: sampleAbi,
      });

      expect(result).not.toBeNull();
      expect(result!.eventName).toBe('Transfer');
      expect(result!.contractAddress).toBe(contractAddress);
      expect(result!.blockNumber).toBe(18000000n);
      expect(result!.transactionHash).toBe(sampleTransferLog.transactionHash);
      expect(result!.parameters.from).toBeDefined();
      expect(result!.parameters.to).toBeDefined();
      expect(result!.parameters.value).toBeDefined();
    });

    it('should decode an Approval event successfully', async () => {
      const result = await decoderService.decodeEventLog(sampleApprovalLog, {
        chainId,
        contractAddress: contractAddress as Address,
        abi: sampleAbi,
      });

      expect(result).not.toBeNull();
      expect(result!.eventName).toBe('Approval');
      expect(result!.parameters.owner).toBeDefined();
      expect(result!.parameters.spender).toBeDefined();
      expect(result!.parameters.value).toBeDefined();
    });

    it('should return null for unknown event signatures when not in strict mode', async () => {
      const unknownLog: Log = {
        ...sampleTransferLog,
        topics: ['0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'], // Unknown signature
      };

      const result = await decoderService.decodeEventLog(unknownLog, {
        chainId,
        contractAddress: contractAddress as Address,
        abi: sampleAbi,
        strict: false,
      });

      expect(result).toBeNull();
    });

    it('should throw error for unknown event signatures in strict mode', async () => {
      const unknownLog: Log = {
        ...sampleTransferLog,
        topics: ['0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'], // Unknown signature
      };

      await expect(
        decoderService.decodeEventLog(unknownLog, {
          chainId,
          contractAddress: contractAddress as Address,
          abi: sampleAbi,
          strict: true,
        }),
      ).rejects.toThrow(EventDecodingError);
    });
  });

  describe('Parameter formatting', () => {
    it('should format addresses correctly', async () => {
      const result = await decoderService.decodeEventLog(sampleTransferLog, {
        chainId,
        contractAddress: contractAddress as Address,
        abi: sampleAbi,
      });

      expect(result!.parameters.from).toMatch(/^0x[a-f0-9]{4}\.\.\.[a-f0-9]{4}$/);
      expect(result!.parameters.to).toMatch(/^0x[a-f0-9]{4}\.\.\.[a-f0-9]{4}$/);
    });

    it('should format uint256 values as ETH', async () => {
      const result = await decoderService.decodeEventLog(sampleTransferLog, {
        chainId,
        contractAddress: contractAddress as Address,
        abi: sampleAbi,
      });

      // 1 ETH should be formatted as "1.000000"
      expect(result!.parameters.value).toBe('1.000000');
    });

    it('should preserve raw parameters alongside formatted ones', async () => {
      const result = await decoderService.decodeEventLog(sampleTransferLog, {
        chainId,
        contractAddress: contractAddress as Address,
        abi: sampleAbi,
      });

      expect(result!.rawParameters.from).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
      expect(result!.rawParameters.to).toBe('0x1234567890abcdef1234567890abcdef12345678');
      expect(result!.rawParameters.value).toBe(1000000000000000000n);
    });

    it('should handle null and undefined values', async () => {
      const abiWithNullable: Abi = [
        {
          type: 'event',
          name: 'NullableEvent',
          inputs: [
            { name: 'value', type: 'uint256', indexed: false },
            { name: 'optional', type: 'address', indexed: false },
          ],
        },
      ];

      const logWithNulls: Log = {
        ...sampleTransferLog,
        topics: ['0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'],
        data: '0x00000000000000000000000000000000000000000000000de0b6b3a7640000',
      };

      // Mock decodeEventLog to return null values
      vi.doMock('viem', async () => ({
        decodeEventLog: vi.fn().mockReturnValue({
          eventName: 'NullableEvent',
          args: {
            value: 1000000000000000000n,
            optional: null,
          },
        }),
      }));

      const result = await decoderService.decodeEventLog(logWithNulls, {
        chainId,
        contractAddress: contractAddress as Address,
        abi: abiWithNullable,
      });

      expect(result!.parameters.value).toBeDefined();
      expect(result!.parameters.optional).toBeNull();
    });
  });

  describe('Batch decoding', () => {
    it('should decode multiple events in batch', async () => {
      const logs = [sampleTransferLog, sampleApprovalLog];

      const results = await decoderService.decodeEventLogsBatch(logs, {
        chainId,
        contractAddress: contractAddress as Address,
        abi: sampleAbi,
      });

      expect(results).toHaveLength(2);
      expect(results[0].eventName).toBe('Transfer');
      expect(results[1].eventName).toBe('Approval');
    });

    it('should handle partial failures in batch decoding', async () => {
      const logs = [
        sampleTransferLog,
        { ...sampleApprovalLog, topics: ['0xinvalid'] }, // Invalid log
      ];

      const results = await decoderService.decodeEventLogsBatch(logs, {
        chainId,
        contractAddress: contractAddress as Address,
        abi: sampleAbi,
      });

      // Should return only the successfully decoded events
      expect(results).toHaveLength(1);
      expect(results[0].eventName).toBe('Transfer');
    });

    it('should process large batches efficiently', async () => {
      const largeBatch = Array.from({ length: 100 }, (_, i) => ({
        ...sampleTransferLog,
        transactionHash: `0x${i.toString(16).padStart(64, '0')}`,
        logIndex: i,
      }));

      const startTime = performance.now();
      const results = await decoderService.decodeEventLogsBatch(largeBatch, {
        chainId,
        contractAddress: contractAddress as Address,
        abi: sampleAbi,
      });
      const endTime = performance.now();

      expect(results).toHaveLength(100);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe('Event parameter extraction', () => {
    it('should extract and decode individual parameters', async () => {
      const transferEvent = sampleAbi.find(item => item.name === 'Transfer') as AbiEvent;

      const parameters = await decoderService.decodeEventParameters(
        sampleTransferLog,
        transferEvent,
      );

      expect(parameters).toHaveLength(3);
      expect(parameters[0].name).toBe('from');
      expect(parameters[0].type).toBe('address');
      expect(parameters[0].indexed).toBe(true);
      expect(parameters[1].name).toBe('to');
      expect(parameters[1].type).toBe('address');
      expect(parameters[1].indexed).toBe(true);
      expect(parameters[2].name).toBe('value');
      expect(parameters[2].type).toBe('uint256');
      expect(parameters[2].indexed).toBe(false);
    });

    it('should handle formatted parameter values', async () => {
      const transferEvent = sampleAbi.find(item => item.name === 'Transfer') as AbiEvent;

      const parameters = await decoderService.decodeEventParameters(
        sampleTransferLog,
        transferEvent,
        { formatAddresses: true, formatUnits: true },
      );

      const valueParam = parameters.find(p => p.name === 'value');
      expect(valueParam!.value).toBe('1.000000');
      expect(valueParam!.rawValue).toBe(1000000000000000000n);
    });
  });

  describe('Error handling', () => {
    it('should handle malformed log data gracefully', async () => {
      const malformedLog: Log = {
        ...sampleTransferLog,
        data: '0xinvalid',
      };

      await expect(
        decoderService.decodeEventLog(malformedLog, {
          chainId,
          contractAddress: contractAddress as Address,
          abi: sampleAbi,
        }),
      ).rejects.toThrow(EventDecodingError);
    });

    it('should handle missing topics', async () => {
      const incompleteLog: Log = {
        ...sampleTransferLog,
        topics: [],
      };

      await expect(
        decoderService.decodeEventLog(incompleteLog, {
          chainId,
          contractAddress: contractAddress as Address,
          abi: sampleAbi,
        }),
      ).rejects.toThrow(EventDecodingError);
    });

    it('should provide detailed error information', async () => {
      const invalidLog: Log = {
        ...sampleTransferLog,
        data: '0xinvalid',
      };

      try {
        await decoderService.decodeEventLog(invalidLog, {
          chainId,
          contractAddress: contractAddress as Address,
          abi: sampleAbi,
        });
      }
      catch (error) {
        expect(error).toBeInstanceOf(EventDecodingError);
        if (error instanceof EventDecodingError) {
          expect(error.chainId).toBe(chainId);
          expect(error.blockHash).toBe(sampleTransferLog.blockHash);
          expect(error.logIndex).toBe(sampleTransferLog.logIndex);
        }
      }
    });
  });

  describe('Performance monitoring', () => {
    it('should record performance metrics for successful decodes', async () => {
      const monitor = decoderService.getPerformanceMonitor();
      const recordQuerySpy = vi.spyOn(monitor, 'recordQuery');

      await decoderService.decodeEventLog(sampleTransferLog, {
        chainId,
        contractAddress: contractAddress as Address,
        abi: sampleAbi,
      });

      expect(recordQuerySpy).toHaveBeenCalledWith('event_decode', expect.any(Number), true);
    });

    it('should record performance metrics for failed decodes', async () => {
      const monitor = decoderService.getPerformanceMonitor();
      const recordQuerySpy = vi.spyOn(monitor, 'recordQuery');

      const invalidLog: Log = {
        ...sampleTransferLog,
        data: '0xinvalid',
      };

      try {
        await decoderService.decodeEventLog(invalidLog, {
          chainId,
          contractAddress: contractAddress as Address,
          abi: sampleAbi,
        });
      }
      catch {
        // Expected to fail
      }

      expect(recordQuerySpy).toHaveBeenCalledWith('event_decode', expect.any(Number), false);
    });
  });

  describe('ABI caching', () => {
    it('should cache ABI events for faster lookups', () => {
      const events = sampleAbi.filter(item => item.type === 'event');

      // Access private method through type assertion
      (decoderService as any).cacheAbiEvents(contractAddress as Address, sampleAbi);

      const cachedEvents = (decoderService as any).getCachedAbiEvents(contractAddress as Address);
      expect(cachedEvents).toEqual(events);
    });

    it('should clear ABI cache for specific contract', () => {
      (decoderService as any).cacheAbiEvents(contractAddress as Address, sampleAbi);
      (decoderService as any).clearAbiCache(contractAddress as Address);

      const cachedEvents = (decoderService as any).getCachedAbiEvents(contractAddress as Address);
      expect(cachedEvents).toEqual([]);
    });

    it('should clear all ABI caches', () => {
      const anotherAddress = '0x9876543210987654321098765432109876543210' as Address;

      (decoderService as any).cacheAbiEvents(contractAddress as Address, sampleAbi);
      (decoderService as any).cacheAbiEvents(anotherAddress, sampleAbi);
      (decoderService as any).clearAllAbiCaches();

      expect((decoderService as any).getCachedAbiEvents(contractAddress as Address)).toEqual([]);
      expect((decoderService as any).getCachedAbiEvents(anotherAddress)).toEqual([]);
    });
  });

  describe('Event validation', () => {
    it('should validate event logs against ABI', () => {
      const isValid = decoderService.validateEventLog(sampleTransferLog, sampleAbi);
      expect(isValid).toBe(true);
    });

    it('should reject invalid event logs', () => {
      const invalidLog: Log = {
        ...sampleTransferLog,
        topics: ['0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'],
      };

      const isValid = decoderService.validateEventLog(invalidLog, sampleAbi);
      expect(isValid).toBe(false);
    });
  });

  describe('Utility methods', () => {
    it('should return correct chain ID', () => {
      expect(decoderService.getChainId()).toBe(chainId);
    });

    it('should provide performance monitor instance', () => {
      const monitor = decoderService.getPerformanceMonitor();
      expect(monitor).toBeDefined();
      expect(typeof monitor.recordQuery).toBe('function');
    });
  });
});
