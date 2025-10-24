/**
 * Unit tests for EventValidationService
 * Tests comprehensive validation and error handling for event operations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventValidationService } from '../../../src/services/EventValidationService';
import { EventDecodingError } from '../../../src/types/events';

describe('EventValidationService', () => {
  const chainId = 1;
  let validationService: EventValidationService;

  beforeEach(() => {
    validationService = new EventValidationService(chainId, 'querying');
  });

  describe('Event filters validation', () => {
    it('should validate correct event filters', () => {
      const filters = {
        contractAddress: '0x1234567890123456789012345678901234567890',
        fromBlock: 18000000,
        toBlock: 18000100,
        fromTimestamp: Date.now() - 86400000, // 1 day ago
        toTimestamp: Date.now(),
        eventName: 'Transfer',
        from: '0xabcdef1234567890abcdef1234567890abcdef12',
      };

      const result = validationService.validateEventFilters(filters);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid contract address', () => {
      const filters = {
        contractAddress: '0xinvalid',
      };

      const result = validationService.validateEventFilters(filters);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].code).toBe('INVALID_ADDRESS_FORMAT');
    });

    it('should detect invalid block numbers', () => {
      const filters = {
        fromBlock: -1,
        toBlock: 'invalid',
      };

      const result = validationService.validateEventFilters(filters);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'NEGATIVE_BLOCK_NUMBER')).toBe(true);
      expect(result.errors.some(e => e.code === 'INVALID_BLOCK_NUMBER_STRING')).toBe(true);
    });

    it('should detect invalid block range', () => {
      const filters = {
        fromBlock: 18000100,
        toBlock: 18000000, // from > to
      };

      const result = validationService.validateEventFilters(filters);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_BLOCK_RANGE')).toBe(true);
    });

    it('should warn about large block ranges', () => {
      const filters = {
        fromBlock: 1000000,
        toBlock: 2000000, // 1M block range
      };

      const result = validationService.validateEventFilters(filters);

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.code === 'LARGE_BLOCK_RANGE')).toBe(true);
    });

    it('should validate timestamps correctly', () => {
      const filters = {
        fromTimestamp: '2024-01-01T00:00:00Z',
        toTimestamp: 'invalid-date',
      };

      const result = validationService.validateEventFilters(filters);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_TIMESTAMP_STRING')).toBe(true);
    });

    it('should validate topics array', () => {
      const filters = {
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          null, // Wildcard
          '0x0000000000000000000000001234567890abcdef1234567890abcdef12345678',
        ],
      };

      const result = validationService.validateEventFilters(filters);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid topics', () => {
      const filters = {
        topics: [
          '0xinvalid', // Invalid hex
          '0x123', // Too short
          'toolong', // Not hex
          '0x' + '1'.repeat(66), // Too long
          '0x' + '2'.repeat(66), // Too many topics
          '0x' + '3'.repeat(66),
          '0x' + '4'.repeat(66),
          '0x' + '5'.repeat(66),
        ],
      };

      const result = validationService.validateEventFilters(filters);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'TOO_MANY_TOPICS')).toBe(true);
      expect(result.errors.some(e => e.code === 'INVALID_TOPIC_FORMAT')).toBe(true);
    });

    it('should sanitize invalid data when requested', () => {
      const filters = {
        contractAddress: '0x1234567890123456789012345678901234567890', // Valid
        limit: 2000, // Too high, should be capped
      };

      const result = validationService.validateEventFilters(filters, { sanitize: true });

      expect(result.sanitizedData).toBeDefined();
      expect(result.sanitizedData.limit).toBe(1000); // Should be capped
    });
  });

  describe('Pagination validation', () => {
    it('should validate correct pagination parameters', () => {
      const params = {
        limit: 50,
        offset: 0,
        cursor: '0x123456',
        direction: 'asc' as const,
      };

      const result = validationService.validatePaginationParams(params);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid limit values', () => {
      const params = {
        limit: -1, // Negative
      };

      const result = validationService.validatePaginationParams(params);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_LIMIT_RANGE')).toBe(true);
    });

    it('should warn about high limit values', () => {
      const params = {
        limit: 2000, // Very high
      };

      const result = validationService.validatePaginationParams(params);

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.code === 'HIGH_LIMIT_VALUE')).toBe(true);
    });

    it('should detect invalid offset values', () => {
      const params = {
        offset: -10, // Negative
        offset2: 1.5, // Not integer
      };

      const result = validationService.validatePaginationParams(params);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'NEGATIVE_OFFSET')).toBe(true);
    });

    it('should validate cursor format', () => {
      const params = {
        cursor: '', // Empty
      };

      const result = validationService.validatePaginationParams(params);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'EMPTY_CURSOR')).toBe(true);
    });

    it('should validate direction values', () => {
      const params = {
        direction: 'invalid', // Not asc or desc
      };

      const result = validationService.validatePaginationParams(params);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_DIRECTION')).toBe(true);
    });
  });

  describe('Decoded event validation', () => {
    it('should validate correct decoded event', () => {
      const event = {
        chainId: 1,
        contractAddress: '0x1234567890123456789012345678901234567890',
        eventName: 'Transfer',
        txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        blockNumber: 18000000,
        logIndex: 0,
        transactionIndex: 1,
        blockTimestamp: 1704067200, // 2024-01-01
        eventSignature: 'Transfer(address,address,uint256)',
        args: {
          from: '0xabcdef1234567890abcdef1234567890abcdef12',
          to: '0x1234567890abcdef1234567890abcdef12345678',
          value: 1000000000000000000n,
        },
        indexedAt: new Date(),
      };

      const result = validationService.validateDecodedEvent(event);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const event = {
        // Missing required fields
        eventName: 'Transfer',
      };

      const result = validationService.validateDecodedEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'MISSING_REQUIRED_FIELD')).toBe(true);
    });

    it('should validate chain ID', () => {
      const event = {
        chainId: 'invalid', // Not a number
        contractAddress: '0x1234567890123456789012345678901234567890',
        eventName: 'Transfer',
        txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 18000000,
        logIndex: 0,
      };

      const result = validationService.validateDecodedEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_CHAIN_ID_TYPE')).toBe(true);
    });

    it('should validate transaction hash format', () => {
      const event = {
        chainId: 1,
        contractAddress: '0x1234567890123456789012345678901234567890',
        eventName: 'Transfer',
        txHash: '0xinvalid', // Invalid hash
        blockNumber: 18000000,
        logIndex: 0,
      };

      const result = validationService.validateDecodedEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_HASH_FORMAT')).toBe(true);
    });

    it('should validate block numbers in events', () => {
      const event = {
        chainId: 1,
        contractAddress: '0x1234567890123456789012345678901234567890',
        eventName: 'Transfer',
        txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: -1000, // Negative
        logIndex: 0,
      };

      const result = validationService.validateDecodedEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'NEGATIVE_BLOCK_NUMBER')).toBe(true);
    });

    it('should validate event names', () => {
      const event = {
        chainId: 1,
        contractAddress: '0x1234567890123456789012345678901234567890',
        eventName: 'invalidEventName', // Not PascalCase
        txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 18000000,
        logIndex: 0,
      };

      const result = validationService.validateDecodedEvent(event);

      expect(result.valid).toBe(true); // Should be valid but with warning
      expect(result.warnings.some(w => w.code === 'NON_STANDARD_EVENT_NAME')).toBe(true);
    });

    it('should validate event signatures', () => {
      const event = {
        chainId: 1,
        contractAddress: '0x1234567890123456789012345678901234567890',
        eventName: 'Transfer',
        eventSignature: 'invalid_signature', // Wrong format
        txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 18000000,
        logIndex: 0,
      };

      const result = validationService.validateDecodedEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_EVENT_SIGNATURE_FORMAT')).toBe(true);
    });
  });

  describe('Event parameters validation', () => {
    it('should validate correct event parameters', () => {
      const parameters = [
        {
          name: 'from',
          type: 'address',
          value: '0x1234567890123456789012345678901234567890',
          rawValue: '0x1234567890123456789012345678901234567890',
          indexed: true,
        },
        {
          name: 'to',
          type: 'address',
          value: '0xabcdef1234567890abcdef1234567890abcdef12',
          rawValue: '0xabcdef1234567890abcdef1234567890abcdef12',
          indexed: true,
        },
        {
          name: 'value',
          type: 'uint256',
          value: 1000000000000000000n,
          rawValue: 1000000000000000000n,
          indexed: false,
        },
      ];

      const result = validationService.validateEventParameters(parameters);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid parameter names', () => {
      const parameters = [
        {
          name: '', // Empty name
          type: 'address',
          value: '0x1234567890123456789012345678901234567890',
          rawValue: '0x1234567890123456789012345678901234567890',
          indexed: false,
        },
      ];

      const result = validationService.validateEventParameters(parameters);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_PARAMETER_NAME')).toBe(true);
    });

    it('should detect invalid parameter types', () => {
      const parameters = [
        {
          name: 'value',
          type: '', // Empty type
          value: 1000,
          rawValue: 1000,
          indexed: false,
        },
      ];

      const result = validationService.validateEventParameters(parameters);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_PARAMETER_TYPE')).toBe(true);
    });

    it('should detect duplicate parameter names', () => {
      const parameters = [
        {
          name: 'value',
          type: 'uint256',
          value: 1000,
          rawValue: 1000,
          indexed: false,
        },
        {
          name: 'value', // Duplicate name
          type: 'uint256',
          value: 2000,
          rawValue: 2000,
          indexed: false,
        },
      ];

      const result = validationService.validateEventParameters(parameters);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'DUPLICATE_PARAMETER_NAME')).toBe(true);
    });

    it('should validate parameter values by type', () => {
      const parameters = [
        {
          name: 'invalidAddress',
          type: 'address',
          value: '0xinvalid', // Invalid address
          rawValue: '0xinvalid',
          indexed: false,
        },
        {
          name: 'negativeUint',
          type: 'uint256',
          value: -1000n, // Negative unsigned int
          rawValue: -1000n,
          indexed: false,
        },
        {
          name: 'invalidBoolean',
          type: 'bool',
          value: 'true', // String instead of boolean
          rawValue: 'true',
          indexed: false,
        },
      ];

      const result = validationService.validateEventParameters(parameters);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_ADDRESS_VALUE')).toBe(true);
      expect(result.errors.some(e => e.code === 'NEGATIVE_UINT_VALUE')).toBe(true);
      expect(result.errors.some(e => e.code === 'INVALID_BOOLEAN_VALUE')).toBe(true);
    });

    it('should validate bytes parameters', () => {
      const parameters = [
        {
          name: 'shortBytes',
          type: 'bytes32',
          value: '0x1234', // Too short
          rawValue: '0x1234',
          indexed: false,
        },
        {
          name: 'longBytes',
          type: 'bytes32',
          value: '0x' + '1'.repeat(70), // Too long
          rawValue: '0x' + '1'.repeat(70),
          indexed: false,
        },
      ];

      const result = validationService.validateEventParameters(parameters);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_BYTES_VALUE')).toBe(true);
    });

    it('should validate array parameters', () => {
      const parameters = [
        {
          name: 'invalidArray',
          type: 'uint256[]',
          value: 'not an array', // Not an array
          rawValue: 'not an array',
          indexed: false,
        },
      ];

      const result = validationService.validateEventParameters(parameters);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_ARRAY_VALUE')).toBe(true);
    });
  });

  describe('Address validation', () => {
    it('should validate correct addresses', () => {
      const address = '0x1234567890123456789012345678901234567890';
      const result = (validationService as any).validateAddress(address, 'testAddress');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid addresses', () => {
      const invalidAddresses = [
        '0xinvalid',
        '0x123',
        'invalid',
        12345,
        null,
        undefined,
      ];

      for (const address of invalidAddresses) {
        const result = (validationService as any).validateAddress(address, 'testAddress');
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('should warn about address checksum', () => {
      const lowerCaseAddress = '0x1234567890123456789012345678901234567890';
      const result = (validationService as any).validateAddress(lowerCaseAddress, 'testAddress');

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.code === 'ADDRESS_CHECKSUM_MISMATCH')).toBe(true);
    });
  });

  describe('Hash validation', () => {
    it('should validate correct hashes', () => {
      const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const result = (validationService as any).validateHash(hash, 'testHash', 32);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid hashes', () => {
      const invalidHashes = [
        '0xinvalid',
        '0x123',
        'invalid',
        12345,
        '0x' + '1'.repeat(65), // Wrong length
      ];

      for (const hash of invalidHashes) {
        const result = (validationService as any).validateHash(hash, 'testHash', 32);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Error handling', () => {
    it('should throw errors in strict mode', () => {
      const invalidFilters = {
        contractAddress: '0xinvalid',
      };

      expect(() => {
        validationService.validateEventFilters(invalidFilters, { strict: true });
      }).toThrow(EventDecodingError);
    });

    it('should not throw errors in non-strict mode', () => {
      const invalidFilters = {
        contractAddress: '0xinvalid',
      };

      expect(() => {
        const result = validationService.validateEventFilters(invalidFilters, { strict: false });
        expect(result.valid).toBe(false);
      }).not.toThrow();
    });

    it('should handle validation with warnings enabled', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const filters = {
        contractAddress: '0x1234567890abcdef1234567890abcdef12345678', // Valid but wrong checksum
        fromBlock: 1000000,
        toBlock: 2000000, // Large range
      };

      const result = validationService.validateEventFilters(filters, { enableWarnings: true });

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Data sanitization', () => {
    it('should sanitize pagination limits', () => {
      const params = {
        limit: 5000, // Too high
      };

      const result = validationService.validatePaginationParams(params, { sanitize: true });

      expect(result.sanitizedData.limit).toBe(1000); // Should be capped
    });

    it('should sanitize block numbers', () => {
      const filters = {
        fromBlock: '18000000', // String number
      };

      const result = validationService.validateEventFilters(filters, { sanitize: true });

      expect(result.sanitizedData.fromBlock).toBe(18000000n); // Should be bigint
    });

    it('should sanitize timestamps', () => {
      const filters = {
        fromTimestamp: '2024-01-01T00:00:00Z', // ISO string
      };

      const result = validationService.validateEventFilters(filters, { sanitize: true });

      expect(typeof result.sanitizedData.fromTimestamp).toBe('number'); // Should be timestamp
    });
  });

  describe('Validation context and analytics', () => {
    it('should provide validation context', () => {
      const context = validationService.getValidationContext();

      expect(context.chainId).toBe(chainId);
      expect(context.operation).toBe('querying');
      expect(context.timestamp).toBeInstanceOf(Date);
    });

    it('should track validation errors for analytics', () => {
      // Generate some validation errors
      validationService.validateEventFilters({
        contractAddress: '0xinvalid',
        fromBlock: -1,
      });

      validationService.validatePaginationParams({
        limit: -10,
      });

      const summary = validationService.getValidationErrorsSummary();

      expect(summary.length).toBeGreaterThan(0);
      expect(summary[0].code).toBeDefined();
      expect(summary[0].count).toBeGreaterThan(0);
      expect(summary[0].lastSeen).toBeInstanceOf(Date);
    });

    it('should clear error cache', () => {
      // Generate validation errors
      validationService.validateEventFilters({ contractAddress: '0xinvalid' });

      expect(validationService.getValidationErrorsSummary().length).toBeGreaterThan(0);

      validationService.clearErrorCache();

      expect(validationService.getValidationErrorsSummary().length).toBe(0);
    });

    it('should provide chain ID', () => {
      expect(validationService.getChainId()).toBe(chainId);
    });
  });

  describe('Edge cases and boundary conditions', () => {
    it('should handle empty objects', () => {
      const result = validationService.validateEventFilters({});
      expect(result.valid).toBe(true);
    });

    it('should handle null and undefined values', () => {
      const result1 = validationService.validateEventFilters(null as any);
      const result2 = validationService.validateEventFilters(undefined as any);

      expect(result1.valid).toBe(true); // Empty filters are valid
      expect(result2.valid).toBe(true);
    });

    it('should handle very large numbers', () => {
      const largeNumber = BigInt(Number.MAX_SAFE_INTEGER) + 1000n;
      const result = validationService.validateEventFilters({
        fromBlock: largeNumber,
      });

      expect(result.valid).toBe(true);
    });

    it('should handle very long strings', () => {
      const longString = 'a'.repeat(10000);
      const result = validationService.validateEventFilters({
        eventName: longString,
      });

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.code === 'LONG_STRING_VALUE')).toBe(true);
    });

    it('should handle circular objects safely', () => {
      const circular: any = { name: 'test' };
      circular.self = circular;

      // Should not throw errors
      expect(() => {
        validationService.validateEventFilters(circular);
      }).not.toThrow();
    });
  });

  describe('Performance considerations', () => {
    it('should handle large validation loads efficiently', () => {
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        validationService.validateEventFilters({
          contractAddress: '0x1234567890123456789012345678901234567890',
          fromBlock: 18000000 + i,
          eventName: 'Transfer',
        });
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete 1000 validations in reasonable time
      expect(duration).toBeLessThan(1000); // Less than 1 second
    });

    it('should not create memory leaks during repeated validations', () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Perform many validations
      for (let i = 0; i < 10000; i++) {
        validationService.validateEventFilters({
          contractAddress: '0x1234567890123456789012345678901234567890',
          fromBlock: 18000000 + i,
          eventName: 'Transfer',
        });
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // Less than 50MB
    });
  });
});