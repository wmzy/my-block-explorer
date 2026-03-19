/**
 * Unit tests for AbiParsingService
 * Tests ABI parsing, event signature extraction, and schema generation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AbiParsingService } from '../../../src/services/AbiParsingService';
import { ChainDatabaseManager } from '../../../src/database/chain-database-manager';
import { initializeMultiChainEnvironment } from '../../../src/database/multi-chain-setup';
import { Abi, AbiEvent, Address } from 'viem';
import { EventIndexingError } from '../../../src/types/events';

describe('AbiParsingService', () => {
  const chainId = 1;
  const contractAddress = '0x1234567890123456789012345678901234567890';
  let abiService: AbiParsingService;
  let chainDb: ChainDatabaseManager;

  // Sample ABI with various event types
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
    {
      type: 'event',
      name: 'ComplexEvent',
      inputs: [
        { name: 'user', type: 'address', indexed: true },
        { name: 'data', type: 'string', indexed: false },
        { name: 'numbers', type: 'uint256[3]', indexed: false },
        { name: 'flag', type: 'bool', indexed: false },
        { name: 'bytes', type: 'bytes32', indexed: false },
      ],
    },
    {
      type: 'event',
      name: 'AnonymousEvent',
      anonymous: true,
      inputs: [
        { name: 'value', type: 'uint256', indexed: false },
      ],
    },
  ];

  // Complex ABI with tuples
  const complexAbi: Abi = [
    {
      type: 'event',
      name: 'StructuredEvent',
      inputs: [
        { name: 'user', type: 'address', indexed: true },
        {
          name: 'profile',
          type: 'tuple',
          indexed: false,
          components: [
            { name: 'name', type: 'string' },
            { name: 'age', type: 'uint8' },
            { name: 'active', type: 'bool' },
          ],
        },
        { name: 'metadata', type: 'bytes', indexed: false },
      ],
    },
  ];

  beforeEach(async () => {
    // Initialize test environment
    await initializeMultiChainEnvironment({
      environment: 'test',
      chains: [chainId],
      createDataDirectories: true,
    });

    // Setup service
    chainDb = await ChainDatabaseManager.getInstance().getChainDatabase(chainId);
    abiService = new AbiParsingService(chainId);
  });

  describe('ABI parsing', () => {
    it('should parse ABI and extract events successfully', async () => {
      const result = await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
        generateTableSchemas: true,
        calculateComplexity: true,
      });

      expect(result.contractAddress).toBe(contractAddress);
      expect(result.totalEvents).toBe(5);
      expect(result.events).toHaveLength(5);
      expect(result.signatures).toHaveLength(5);
    });

    it('should parse string ABI correctly', async () => {
      const abiString = JSON.stringify(sampleAbi);
      const result = await abiService.parseAbi(abiString, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      expect(result.totalEvents).toBe(5);
      expect(result.events).toHaveLength(5);
    });

    it('should handle empty ABI', async () => {
      const emptyAbi: Abi = [];
      const result = await abiService.parseAbi(emptyAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      expect(result.totalEvents).toBe(0);
      expect(result.events).toHaveLength(0);
      expect(result.signatures).toHaveLength(0);
    });

    it('should handle ABI with no events', async () => {
      const functionOnlyAbi: Abi = [
        {
          type: 'function',
          name: 'balanceOf',
          inputs: [{ name: 'owner', type: 'address' }],
          outputs: [{ name: 'balance', type: 'uint256' }],
          stateMutability: 'view',
        },
      ];

      const result = await abiService.parseAbi(functionOnlyAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      expect(result.totalEvents).toBe(0);
      expect(result.events).toHaveLength(0);
    });
  });

  describe('Event signature extraction', () => {
    it('should extract correct event signatures', async () => {
      const signatures = abiService.extractEventSignatures(sampleAbi);

      expect(signatures).toHaveLength(5);

      const transferSig = signatures.find(s => s.name === 'Transfer');
      expect(transferSig).toBeDefined();
      expect(transferSig!.signature).toBe('Transfer(address,address,uint256)');
      expect(transferSig!.parameterTypes).toEqual(['address', 'address', 'uint256']);
      expect(transferSig!.parameterNames).toEqual(['from', 'to', 'value']);
      expect(transferSig!.indexedParams).toEqual([0, 1]);
      expect(transferSig!.anonymous).toBe(false);
    });

    it('should generate correct topics for events', async () => {
      const signatures = abiService.extractEventSignatures(sampleAbi);

      const transferSig = signatures.find(s => s.name === 'Transfer');
      expect(transferSig!.topic).toMatch(/^0x[a-f0-9]{64}$/);

      // Should match known Transfer event topic
      const expectedTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      expect(transferSig!.topic).toBe(expectedTopic);
    });

    it('should handle anonymous events', async () => {
      const signatures = abiService.extractEventSignatures(sampleAbi);

      const anonymousSig = signatures.find(s => s.name === 'AnonymousEvent');
      expect(anonymousSig!.anonymous).toBe(true);
      expect(anonymousSig!.signature).toBe('AnonymousEvent(uint256)');
    });

    it('should cache signatures for fast lookup', async () => {
      const signature = 'Transfer(address,address,uint256)';

      // First call should parse
      const found1 = abiService.findEventBySignature(signature);
      expect(found1).toBeNull(); // Not cached yet

      // Parse to cache
      await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      // Second call should find in cache
      const found2 = abiService.findEventBySignature(signature);
      expect(found2).toBeDefined();
      expect(found2!.name).toBe('Transfer');
    });
  });

  describe('Table schema generation', () => {
    it('should generate correct table schemas', async () => {
      const result = await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
        tableNamePrefix: 'contract_events',
      });

      const transferEvent = result.events.find(e => e.name === 'Transfer');
      expect(transferEvent).toBeDefined();
      expect(transferEvent!.tableName).toBe('contract_events_transfer');
      expect(transferEvent!.tableSchema.columns.length).toBeGreaterThan(10); // Standard columns + event parameters

      // Check standard columns
      const standardColumns = ['block_hash', 'log_index', 'transaction_hash', 'block_number', 'block_timestamp'];
      for (const col of standardColumns) {
        expect(transferEvent!.tableSchema.columns.find(c => c.name === col)).toBeDefined();
      }

      // Check event parameter columns
      expect(transferEvent!.tableSchema.columns.find(c => c.name === 'from')).toBeDefined();
      expect(transferEvent!.tableSchema.columns.find(c => c.name === 'to')).toBeDefined();
      expect(transferEvent!.tableSchema.columns.find(c => c.name === 'value')).toBeDefined();
    });

    it('should create appropriate indexes', async () => {
      const result = await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      const transferEvent = result.events.find(e => e.name === 'Transfer');
      const indexes = transferEvent!.tableSchema.indexes;

      // Should have standard indexes
      const expectedIndexes = [
        'events_transfer_block_hash_idx',
        'events_transfer_tx_hash_idx',
        'events_transfer_block_number_idx',
        'events_transfer_timestamp_idx',
        'events_transfer_contract_address_idx',
        'events_transfer_event_name_idx',
      ];

      for (const expectedIndex of expectedIndexes) {
        expect(indexes.find(i => i.name === expectedIndex)).toBeDefined();
      }

      // Should have indexes for indexed parameters
      expect(indexes.find(i => i.name === 'events_transfer_from_idx')).toBeDefined();
      expect(indexes.find(i => i.name === 'events_transfer_to_idx')).toBeDefined();
    });

    it('should handle complex parameter types', async () => {
      const result = await abiService.parseAbi(complexAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      const structuredEvent = result.events.find(e => e.name === 'StructuredEvent');
      expect(structuredEvent).toBeDefined();

      // Tuple should be stored as TEXT (JSON)
      const profileColumn = structuredEvent!.tableSchema.columns.find(c => c.name === 'profile');
      expect(profileColumn!.type).toBe('TEXT');

      // Bytes should be stored as HEX_DATA
      const metadataColumn = structuredEvent!.tableSchema.columns.find(c => c.name === 'metadata');
      expect(metadataColumn!.type).toBe('HEX_DATA');
    });

    it('should truncate long table names', async () => {
      const longNameAbi: Abi = [
        {
          type: 'event',
          name: 'VeryLongEventNameThatExceedsMaximumTableNameLengthAndShouldBeTruncated',
          inputs: [{ name: 'value', type: 'uint256', indexed: false }],
        },
      ];

      const result = await abiService.parseAbi(longNameAbi, {
        chainId,
        contractAddress: contractAddress as Address,
        maxTableNameLength: 63,
      });

      const longNameEvent = result.events[0];
      expect(longNameEvent.tableName.length).toBeLessThanOrEqual(63);
      expect(longNameEvent.tableName).toMatch(/_[a-f0-9]{8}$/); // Should end with hash
    });
  });

  describe('Complexity analysis', () => {
    it('should calculate complexity scores correctly', async () => {
      const result = await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
        calculateComplexity: true,
      });

      // ComplexEvent should have higher complexity than Transfer
      const complexEvent = result.events.find(e => e.name === 'ComplexEvent');
      const transferEvent = result.events.find(e => e.name === 'Transfer');

      expect(complexEvent!.metadata.complexityScore).toBeGreaterThan(transferEvent!.metadata.complexityScore);
    });

    it('should identify complex events', async () => {
      const result = await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      // ComplexEvent should be identified as complex due to multiple parameter types
      expect(result.complexityMetrics.complexEvents).toContain('ComplexEvent');
    });

    it('should provide complexity metrics', async () => {
      const result = await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      expect(result.complexityMetrics.averageComplexity).toBeGreaterThan(0);
      expect(result.complexityMetrics.maxComplexity).toBeGreaterThanOrEqual(result.complexityMetrics.minComplexity);
      expect(Array.isArray(result.complexityMetrics.complexEvents)).toBe(true);
    });

    it('should estimate storage requirements', async () => {
      const result = await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      expect(result.estimatedStorageRequirements.totalStorage).toBeGreaterThan(0);
      expect(result.estimatedStorageRequirements.averageRowSize).toBeGreaterThan(0);
      expect(result.estimatedStorageRequirements.recommendedIndexes).toBeGreaterThan(0);
    });
  });

  describe('ABI validation', () => {
    it('should validate correct ABI', () => {
      const validation = abiService.validateAbi(sampleAbi);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect invalid ABI format', () => {
      const invalidAbi = { invalid: 'format' } as any;
      const validation = abiService.validateAbi(invalidAbi);
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('should detect missing event fields', () => {
      const invalidEventAbi = [
        {
          type: 'event',
          // Missing name
          inputs: [{ name: 'value', type: 'uint256' }],
        },
      ] as any;

      const validation = abiService.validateAbi(invalidEventAbi);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Missing name field'))).toBe(true);
    });

    it('should detect invalid input types', () => {
      const invalidInputAbi = [
        {
          type: 'event',
          name: 'TestEvent',
          inputs: [
            { name: 'value' }, // Missing type
          ],
        },
      ] as any;

      const validation = abiService.validateAbi(invalidInputAbi);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Missing type field'))).toBe(true);
    });
  });

  describe('ABI hashing and comparison', () => {
    it('should generate consistent ABI hashes', () => {
      const hash1 = abiService.getAbiHash(sampleAbi);
      const hash2 = abiService.getAbiHash(sampleAbi);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('should detect ABI changes', async () => {
      const modifiedAbi = [...sampleAbi];
      (modifiedAbi[0] as AbiEvent).name = 'TransferModified';

      const hasChanged = await abiService.hasAbiChanged(contractAddress as Address, modifiedAbi);
      expect(hasChanged).toBe(true);
    });

    it('should generate different hashes for different ABIs', () => {
      const hash1 = abiService.getAbiHash(sampleAbi);
      const hash2 = abiService.getAbiHash(complexAbi);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Event metadata generation', () => {
    it('should generate comprehensive metadata', async () => {
      const result = await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      const transferEvent = result.events.find(e => e.name === 'Transfer');
      expect(transferEvent!.metadata.contractAddress).toBe(contractAddress);
      expect(transferEvent!.metadata.parameterCount).toBe(3);
      expect(transferEvent!.metadata.indexedParameterCount).toBe(2);
      expect(transferEvent!.metadata.estimatedRowSize).toBeGreaterThan(0);
      expect(Array.isArray(transferEvent!.metadata.indexingRecommendations)).toBe(true);
    });

    it('should provide indexing recommendations', async () => {
      const result = await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      const transferEvent = result.events.find(e => e.name === 'Transfer');
      expect(transferEvent!.metadata.indexingRecommendations.length).toBeGreaterThan(0);
    });
  });

  describe('Error handling', () => {
    it('should handle malformed ABI strings', async () => {
      const malformedAbi = '{ invalid json }';

      await expect(
        abiService.parseAbi(malformedAbi, {
          chainId,
          contractAddress: contractAddress as Address,
        }),
      ).rejects.toThrow(EventIndexingError);
    });

    it('should provide detailed error information', async () => {
      const invalidAbi = { invalid: 'format' } as any;

      try {
        await abiService.parseAbi(invalidAbi, {
          chainId,
          contractAddress: contractAddress as Address,
        });
      }
      catch (error) {
        expect(error).toBeInstanceOf(EventIndexingError);
        if (error instanceof EventIndexingError) {
          expect(error.chainId).toBe(chainId);
          expect(error.contractAddress).toBe(contractAddress);
        }
      }
    });
  });

  describe('Performance monitoring', () => {
    it('should record performance metrics for successful parsing', async () => {
      const monitor = abiService.getPerformanceMonitor();
      const recordQuerySpy = vi.spyOn(monitor, 'recordQuery');

      await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      expect(recordQuerySpy).toHaveBeenCalledWith('abi_parse', expect.any(Number), true);
    });

    it('should record performance metrics for failed parsing', async () => {
      const monitor = abiService.getPerformanceMonitor();
      const recordQuerySpy = vi.spyOn(monitor, 'recordQuery');

      try {
        await abiService.parseAbi({ invalid: 'format' } as any, {
          chainId,
          contractAddress: contractAddress as Address,
        });
      }
      catch {
        // Expected to fail
      }

      expect(recordQuerySpy).toHaveBeenCalledWith('abi_parse', expect.any(Number), false);
    });
  });

  describe('Caching', () => {
    it('should cache parsed ABIs', async () => {
      await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      // Second parse should be faster due to caching
      const startTime = performance.now();
      await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(100); // Should be very fast
    });

    it('should clear cache for specific contract', async () => {
      await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      abiService.clearCache(contractAddress as Address);

      // Should be able to parse again without issues
      const result = await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      expect(result.totalEvents).toBe(5);
    });

    it('should clear all caches', async () => {
      const anotherAddress = '0x9876543210987654321098765432109876543210' as Address;

      await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      await abiService.parseAbi(complexAbi, {
        chainId,
        contractAddress: anotherAddress,
      });

      abiService.clearAllCaches();

      // Both should be parseable again
      const result1 = await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      const result2 = await abiService.parseAbi(complexAbi, {
        chainId,
        contractAddress: anotherAddress,
      });

      expect(result1.totalEvents).toBe(5);
      expect(result2.totalEvents).toBe(1);
    });
  });

  describe('Utility methods', () => {
    it('should return correct chain ID', () => {
      expect(abiService.getChainId()).toBe(chainId);
    });

    it('should provide performance monitor instance', () => {
      const monitor = abiService.getPerformanceMonitor();
      expect(monitor).toBeDefined();
      expect(typeof monitor.recordQuery).toBe('function');
    });

    it('should find events by topic', async () => {
      await abiService.parseAbi(sampleAbi, {
        chainId,
        contractAddress: contractAddress as Address,
      });

      const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      const found = abiService.findEventBySignature(transferTopic);

      expect(found).toBeDefined();
      expect(found!.name).toBe('Transfer');
      expect(found!.topic).toBe(transferTopic);
    });
  });
});
