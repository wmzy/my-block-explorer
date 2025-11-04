/**
 * Unit tests for EventQueryService filtering logic
 * Tests: T027 - Event filtering logic unit tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventQueryService } from '../../../src/services/EventQueryService';
import { ChainDatabaseManager } from '../../../src/database/chain-database-manager';
import { EventFilters, PaginationParams } from '../../../src/types/events';

// Mock ChainDatabaseManager
vi.mock('../../../src/database/chain-database-manager');

describe('EventQueryService Filtering Logic', () => {
  let chainDbManager: ChainDatabaseManager;
  let eventQueryService: EventQueryService;
  const mockChainId = 1;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock ChainDatabaseManager instance
    chainDbManager = {
      getChainId: vi.fn().mockReturnValue(mockChainId),
      query: vi.fn().mockResolvedValue([]),
    } as any;

    eventQueryService = new EventQueryService(mockChainId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('filterQueryBuilder', () => {
    it('should build basic WHERE clause for event name filter', () => {
      const filters: EventFilters = {
        eventName: 'Transfer',
      };

      const result = eventQueryService.buildFilterQuery('events_test', filters);

      expect(result.sql).toContain('WHERE event_name = ?');
      expect(result.params).toContain('Transfer');
    });

    it('should build WHERE clause for block range filter', () => {
      const filters: EventFilters = {
        fromBlock: '18000000',
        toBlock: '18000100',
      };

      const result = eventQueryService.buildFilterQuery('events_test', filters);

      expect(result.sql).toContain('block_number >= ?');
      expect(result.sql).toContain('block_number <= ?');
      expect(result.params).toContain('18000000');
      expect(result.params).toContain('18000100');
    });

    it('should build WHERE clause for timestamp range filter', () => {
      const fromTimestamp = new Date('2024-01-01T00:00:00Z');
      const toTimestamp = new Date('2024-01-02T00:00:00Z');

      const filters: EventFilters = {
        fromTimestamp,
        toTimestamp,
      };

      const result = eventQueryService.buildFilterQuery('events_test', filters);

      expect(result.sql).toContain('block_timestamp >= ?');
      expect(result.sql).toContain('block_timestamp <= ?');
      expect(result.params).toContain(fromTimestamp);
      expect(result.params).toContain(toTimestamp);
    });

    it('should build WHERE clause for address filter', () => {
      const filters: EventFilters = {
        from: '0x1234567890abcdef1234567890abcdef12345678',
      };

      const result = eventQueryService.buildFilterQuery('events_test', filters);

      expect(result.sql).toContain('from = ?');
      expect(result.params).toContain('0x1234567890abcdef1234567890abcdef12345678');
    });

    it('should build WHERE clause for numeric value filter', () => {
      const filters: EventFilters = {
        value: '1000000000000000000', // 1 ETH in wei
      };

      const result = eventQueryService.buildFilterQuery('events_test', filters);

      expect(result.sql).toContain('value = ?');
      expect(result.params).toContain('1000000000000000000');
    });

    it('should build WHERE clause for multiple filters with AND logic', () => {
      const filters: EventFilters = {
        eventName: 'Transfer',
        from: '0x1234567890abcdef1234567890abcdef12345678',
        fromBlock: '18000000',
      };

      const result = eventQueryService.buildFilterQuery('events_test', filters);

      expect(result.sql).toContain('WHERE event_name = ?');
      expect(result.sql).toContain('AND from = ?');
      expect(result.sql).toContain('AND block_number >= ?');
      expect(result.params).toContain('Transfer');
      expect(result.params).toContain('0x1234567890abcdef1234567890abcdef12345678');
      expect(result.params).toContain('18000000');
    });

    it('should handle array value filters (IN clause)', () => {
      const filters: EventFilters = {
        eventName: ['Transfer', 'Approval', 'TransferFrom'],
      };

      const result = eventQueryService.buildFilterQuery('events_test', filters);

      expect(result.sql).toContain('WHERE event_name IN (?, ?, ?)');
      expect(result.params).toContain('Transfer');
      expect(result.params).toContain('Approval');
      expect(result.params).toContain('TransferFrom');
    });

    it('should handle LIKE filters for string searches', () => {
      const filters: EventFilters = {
        transactionHash: '0x1234',
      };

      const result = eventQueryService.buildFilterQuery('events_test', filters);

      expect(result.sql).toContain('WHERE transaction_hash LIKE ?');
      expect(result.params).toContain('%0x1234%');
    });
  });

  describe('validateFilters', () => {
    it('should validate valid filters without errors', () => {
      const filters: EventFilters = {
        eventName: 'Transfer',
        fromBlock: '18000000',
        toBlock: '18000100',
        from: '0x1234567890abcdef1234567890abcdef12345678',
      };

      const result = eventQueryService.validateFilters(filters);

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should detect invalid block range', () => {
      const filters: EventFilters = {
        fromBlock: '18000100',
        toBlock: '18000000', // Invalid: from > to
      };

      const result = eventQueryService.validateFilters(filters);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('fromBlock must be less than or equal to toBlock');
    });

    it('should detect invalid address format', () => {
      const filters: EventFilters = {
        from: '0xinvalid',
      };

      const result = eventQueryService.validateFilters(filters);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid address format for from');
    });

    it('should detect invalid timestamp range', () => {
      const filters: EventFilters = {
        fromTimestamp: new Date('2024-01-02T00:00:00Z'),
        toTimestamp: new Date('2024-01-01T00:00:00Z'), // Invalid: from > to
      };

      const result = eventQueryService.validateFilters(filters);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('fromTimestamp must be less than or equal to toTimestamp');
    });

    it('should detect invalid pagination parameters', () => {
      const pagination: PaginationParams = {
        limit: -1, // Invalid: negative limit
        offset: -5, // Invalid: negative offset
      };

      const result = eventQueryService.validatePagination(pagination);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Limit must be positive');
      expect(result.errors).toContain('Offset must be non-negative');
    });

    it('should detect excessive limit value', () => {
      const pagination: PaginationParams = {
        limit: 5000, // Invalid: exceeds maximum
      };

      const result = eventQueryService.validatePagination(pagination);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Limit cannot exceed 1000');
    });
  });

  describe('optimizeFilterQuery', () => {
    it('should select appropriate indexes for address filters', () => {
      const filters: EventFilters = {
        from: '0x1234567890abcdef1234567890abcdef12345678',
      };

      const optimization = eventQueryService.optimizeFilterQuery(filters);

      expect(optimization.recommendedIndexes).toContain('idx_from');
      expect(optimization.queryHints).toContain('USE INDEX (idx_from)');
    });

    it('should select composite indexes for multiple filters', () => {
      const filters: EventFilters = {
        eventName: 'Transfer',
        from: '0x1234567890abcdef1234567890abcdef12345678',
        fromBlock: '18000000',
      };

      const optimization = eventQueryService.optimizeFilterQuery(filters);

      expect(optimization.recommendedIndexes).toContain('idx_event_name_from');
      expect(optimization.queryHints).toContain('USE INDEX (idx_event_name_from)');
    });

    it('should suggest timestamp indexes for date range queries', () => {
      const fromTimestamp = new Date('2024-01-01T00:00:00Z');
      const toTimestamp = new Date('2024-01-02T00:00:00Z');

      const filters: EventFilters = {
        fromTimestamp,
        toTimestamp,
      };

      const optimization = eventQueryService.optimizeFilterQuery(filters);

      expect(optimization.recommendedIndexes).toContain('idx_block_timestamp');
      expect(optimization.queryHints).toContain('USE INDEX (idx_block_timestamp)');
    });

    it('should provide query optimization suggestions', () => {
      const filters: EventFilters = {
        eventName: 'Transfer',
        value: '1000000000000000000',
      };

      const optimization = eventQueryService.optimizeFilterQuery(filters);

      expect(optimization.suggestions).toContain('Consider adding index on value column');
      expect(optimization.estimatedPerformance).toBeDefined();
    });
  });

  describe('filterQueryCache', () => {
    it('should cache filter query results', async () => {
      const filters: EventFilters = {
        eventName: 'Transfer',
      };

      const mockResults = [
        { eventName: 'Transfer', blockNumber: 18000000 },
        { eventName: 'Transfer', blockNumber: 18000001 },
      ];

      // Mock database query
      vi.spyOn(eventQueryService, 'executeFilterQuery').mockResolvedValue(mockResults);

      // First call should hit database
      const result1 = await eventQueryService.queryEventsWithFilters(filters);
      expect(eventQueryService.executeFilterQuery).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const result2 = await eventQueryService.queryEventsWithFilters(filters);
      expect(eventQueryService.executeFilterQuery).toHaveBeenCalledTimes(1);

      expect(result1).toEqual(result2);
    });

    it('should respect cache TTL for filter queries', async () => {
      const filters: EventFilters = {
        eventName: 'Transfer',
      };

      // Mock cache with short TTL for testing
      vi.spyOn(eventQueryService, 'isCacheValid').mockReturnValue(false);

      const mockResults = [{ eventName: 'Transfer', blockNumber: 18000000 }];
      vi.spyOn(eventQueryService, 'executeFilterQuery').mockResolvedValue(mockResults);

      // Should bypass expired cache
      await eventQueryService.queryEventsWithFilters(filters);
      expect(eventQueryService.executeFilterQuery).toHaveBeenCalled();
    });

    it('should invalidate cache when new events are indexed', async () => {
      const filters: EventFilters = {
        eventName: 'Transfer',
        fromBlock: '18000000',
      };

      // Simulate new block indexed
      eventQueryService.invalidateCacheForNewEvents(18000050);

      const mockResults = [{ eventName: 'Transfer', blockNumber: 18000050 }];
      vi.spyOn(eventQueryService, 'executeFilterQuery').mockResolvedValue(mockResults);

      await eventQueryService.queryEventsWithFilters(filters);
      expect(eventQueryService.executeFilterQuery).toHaveBeenCalled();
    });
  });

  describe('complexFilterOperations', () => {
    it('should handle OR logic between multiple values', () => {
      const filters: EventFilters = {
        eventName: ['Transfer', 'Approval'],
        from: '0x1234567890abcdef1234567890abcdef12345678',
      };

      const result = eventQueryService.buildFilterQuery('events_test', filters);

      expect(result.sql).toContain('WHERE (event_name IN (?, ?) AND from = ?)');
    });

    it('should handle NOT IN operations', () => {
      const filters: EventFilters = {
        eventName: { notIn: ['Failed', 'Error'] },
      };

      const result = eventQueryService.buildFilterQuery('events_test', filters);

      expect(result.sql).toContain('WHERE event_name NOT IN (?, ?)');
    });

    it('should handle range comparisons for numeric values', () => {
      const filters: EventFilters = {
        value: { gte: '1000000000000000000', lte: '5000000000000000000' },
      };

      const result = eventQueryService.buildFilterQuery('events_test', filters);

      expect(result.sql).toContain('WHERE value >= ? AND value <= ?');
      expect(result.params).toContain('1000000000000000000');
      expect(result.params).toContain('5000000000000000000');
    });

    it('should handle text search with case-insensitive matching', () => {
      const filters: EventFilters = {
        eventName: { like: 'transfer', caseInsensitive: true },
      };

      const result = eventQueryService.buildFilterQuery('events_test', filters);

      expect(result.sql).toContain('WHERE LOWER(event_name) LIKE LOWER(?)');
      expect(result.params).toContain('%transfer%');
    });
  });

  describe('errorHandling', () => {
    it('should handle database errors gracefully', async () => {
      const filters: EventFilters = {
        eventName: 'Transfer',
      };

      const dbError = new Error('Database connection failed');
      vi.spyOn(eventQueryService, 'executeFilterQuery').mockRejectedValue(dbError);

      await expect(eventQueryService.queryEventsWithFilters(filters))
        .rejects.toThrow('Database connection failed');
    });

    it('should validate and sanitize filter inputs', () => {
      const maliciousFilters: EventFilters = {
        eventName: "'; DROP TABLE events_test; --",
      };

      expect(() => {
        eventQueryService.buildFilterQuery('events_test', maliciousFilters);
      }).not.toThrow();
    });

    it('should handle empty filter results gracefully', async () => {
      const filters: EventFilters = {
        eventName: 'NonExistentEvent',
      };

      vi.spyOn(eventQueryService, 'executeFilterQuery').mockResolvedValue([]);

      const result = await eventQueryService.queryEventsWithFilters(filters);

      expect(result.events).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });
  });
});