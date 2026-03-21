/**
 * Integration tests for sorting and pagination API endpoints
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '@/api-app';

// Mock the performance optimizer
vi.mock('../../../services/EventPerformanceOptimizer', () => ({
  eventPerformanceOptimizerManager: {
    getOptimizer: vi.fn().mockReturnValue({
      executeOptimizedQuery: vi
        .fn()
        .mockImplementation(async (queryType, queryFn, _cacheKey, _options) => {
          // Simulate actual query execution with mock data
          return await queryFn();
        }),
      getPerformanceMetrics: vi.fn().mockReturnValue({
        avgResponseTime: 8,
        cacheHitRate: 0.75,
        totalQueries: 100,
      }),
      getCacheStatistics: vi.fn().mockReturnValue({
        size: 50,
        hitRate: 0.8,
        memoryUsage: 1024000,
      }),
    }),
  },
}));

describe('Sorting and Pagination API Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/chains/:chainId/contracts/:address/events', () => {
    const chainId = 1;
    const contractAddress = '0x1234567890123456789012345678901234567890';

    it('should return paginated events with default sorting', async () => {
      const res = await app.request(`/api/chains/${chainId}/contracts/${contractAddress}/events`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toMatchObject({
        chainId,
        chainName: expect.any(String),
        contractAddress: contractAddress.toLowerCase(),
        events: expect.any(Array),
        total: expect.any(Number),
        hasMore: expect.any(Boolean),
        pagination: expect.objectContaining({
          limit: 50,
          offset: 0,
          sort: 'desc',
          sortBy: 'block_timestamp',
          totalPages: expect.any(Number),
          currentPage: 1,
          multiSort: null,
        }),
        timestamp: expect.any(String),
      });
    });

    it('should support custom page size', async () => {
      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?limit=20`,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.events).toHaveLength(20);
      expect(data.pagination.limit).toBe(20);
    });

    it('should enforce maximum page size limit', async () => {
      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?limit=2000`,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.events.length).toBeLessThanOrEqual(1000); // Should be limited to 1000
      expect(data.pagination.limit).toBeLessThanOrEqual(1000);
    });

    it('should support cursor-based pagination', async () => {
      const cursor = new Date(Date.now() - 60000).toISOString();
      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?cursor=${encodeURIComponent(cursor)}`,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.pagination.cursor).toBe(cursor);
    });

    it('should support offset-based pagination', async () => {
      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?offset=10`,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.pagination.offset).toBe(10);
    });

    it('should support custom sorting', async () => {
      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?sortBy=block_number&sort=asc`,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.pagination.sortBy).toBe('block_number');
      expect(data.pagination.sort).toBe('asc');
    });

    it('should support multi-sort parameters', async () => {
      const multiSort = JSON.stringify([
        { field: 'event_name', direction: 'asc', type: 'text', priority: 0 },
        { field: 'value', direction: 'desc', type: 'numeric', priority: 1 },
      ]);

      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?multiSort=${encodeURIComponent(multiSort)}`,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.pagination.multiSort).toEqual(JSON.parse(multiSort));
    });

    it('should handle invalid multi-sort parameters gracefully', async () => {
      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?multiSort=invalid-json`,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.pagination.multiSort).toBeNull();
    });

    it('should support event name filtering', async () => {
      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?eventName=Transfer`,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.filters.eventName).toBe('Transfer');
    });

    it('should support block range filtering', async () => {
      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?fromBlock=18000000&toBlock=18000100`,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.filters.fromBlock).toBe('18000000');
      expect(data.filters.toBlock).toBe('18000100');
    });

    it('should support timestamp range filtering', async () => {
      const fromTimestamp = new Date(Date.now() - 3600000).toISOString();
      const toTimestamp = new Date().toISOString();

      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?fromTimestamp=${encodeURIComponent(fromTimestamp)}&toTimestamp=${encodeURIComponent(toTimestamp)}`,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.filters.fromTimestamp).toBe(fromTimestamp);
      expect(data.filters.toTimestamp).toBe(toTimestamp);
    });

    it('should return appropriate headers', async () => {
      const res = await app.request(`/api/chains/${chainId}/contracts/${contractAddress}/events`);
      expect(res.status).toBe(200);

      expect(res.headers.get('X-Data-Source')).toBe('database');
      expect(res.headers.get('X-Chain-Name')).toBe('Ethereum');
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=30');
    });

    it('should handle unsupported chain IDs', async () => {
      const res = await app.request(
        '/api/chains/99999/contracts/0x1234567890123456789012345678901234567890/events',
      );
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('Unsupported chain');
    });

    it('should handle invalid contract addresses', async () => {
      const res = await app.request(`/api/chains/${chainId}/contracts/invalid-address/events`);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('Invalid contract address');
    });

    it('should validate numeric parameters', async () => {
      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?limit=invalid`,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.pagination.limit).toBe(50); // Should default to 50
    });
  });

  describe('POST /api/chains/:chainId/contracts/:address/events/search', () => {
    const chainId = 1;
    const contractAddress = '0x1234567890123456789012345678901234567890';

    it('should handle advanced search with sorting and pagination', async () => {
      const searchBody = {
        filters: {
          eventName: ['Transfer', 'Approval'],
          from: '0xabc123',
          value: { gte: '1000000000000000000', lte: '10000000000000000000' },
        },
        pagination: { limit: 25, offset: 0 },
        sort: { field: 'block_timestamp', direction: 'desc' },
        multiSort: [
          { field: 'event_name', direction: 'asc', type: 'text', priority: 0 },
          { field: 'value', direction: 'desc', type: 'numeric', priority: 1 },
        ],
        includeSuggestions: true,
      };

      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(searchBody),
        },
      );

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toMatchObject({
        chainId,
        chainName: expect.any(String),
        contractAddress: contractAddress.toLowerCase(),
        events: expect.any(Array),
        total: expect.any(Number),
        hasMore: expect.any(Boolean),
        pagination: expect.objectContaining({
          limit: 25,
          offset: 0,
          currentPage: 1,
          totalPages: expect.any(Number),
        }),
        filters: searchBody.filters,
        sort: searchBody.sort,
        multiSort: searchBody.multiSort,
        executionTime: expect.any(Number),
        cacheHit: expect.any(Boolean),
        indexesUsed: expect.any(Array),
        optimizationSuggestions: expect.any(Array),
        suggestions: expect.any(Array),
        timestamp: expect.any(String),
      });
    });

    it('should validate pagination parameters', async () => {
      const searchBody = {
        filters: {},
        pagination: { limit: 2000, offset: -10 }, // Invalid values
        sort: { field: 'block_timestamp', direction: 'desc' },
      };

      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(searchBody),
        },
      );

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.pagination.limit).toBeLessThanOrEqual(1000); // Should be clamped to max
      expect(data.pagination.offset).toBeGreaterThanOrEqual(0); // Should be clamped to min
    });

    it('should validate sort parameters', async () => {
      const searchBody = {
        filters: {},
        pagination: { limit: 50, offset: 0 },
        sort: { field: 'invalid_field', direction: 'invalid_direction' },
      };

      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(searchBody),
        },
      );

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.sort.field).toBe('block_timestamp'); // Should default to valid field
      expect(data.sort.direction).toBe('desc'); // Should default to valid direction
    });

    it('should handle empty search results with suggestions', async () => {
      const searchBody = {
        filters: { eventName: 'NonExistentEvent' },
        pagination: { limit: 50, offset: 0 },
        sort: { field: 'block_timestamp', direction: 'desc' },
        includeSuggestions: true,
      };

      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(searchBody),
        },
      );

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.events).toHaveLength(0);
      expect(data.total).toBe(0);
      expect(data.suggestions).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Try removing some filters'),
          expect.stringContaining('Check if the contract has emitted any events'),
        ]),
      );
    });

    it('should handle complex multi-parameter filtering', async () => {
      const searchBody = {
        filters: {
          eventName: ['Transfer', 'Approval'],
          from: ['0xabc123', '0xdef456'],
          to: ['0x789abc'],
          fromBlock: { gte: 18000000, lte: 18000100 },
          value: { gte: '1000000000000000000' },
          transactionHash: '0x123456',
        },
        pagination: { limit: 50, offset: 0 },
        sort: { field: 'block_number', direction: 'desc' },
      };

      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(searchBody),
        },
      );

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.filters).toEqual(searchBody.filters);
      expect(data.indexesUsed).toEqual(
        expect.arrayContaining(['idx_from', 'idx_to', 'idx_block_number', 'idx_value']),
      );
    });

    it('should return performance metrics', async () => {
      const searchBody = {
        filters: {},
        pagination: { limit: 100, offset: 0 },
        sort: { field: 'block_timestamp', direction: 'desc' },
      };

      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(searchBody),
        },
      );

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.executionTime).toBeGreaterThanOrEqual(0);
      expect(typeof data.cacheHit).toBe('boolean');
      expect(res.headers.get('X-Execution-Time')).toBe(data.executionTime.toString());
    });

    it('should handle malformed JSON requests', async () => {
      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'invalid json',
        },
      );

      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('Invalid request body');
      expect(data.message).toBe('Request body must be valid JSON');
    });

    it('should provide optimization suggestions for slow queries', async () => {
      // Mock a slow query by overriding the performance optimizer
      vi.doMock('../../../services/EventPerformanceOptimizer', () => ({
        eventPerformanceOptimizerManager: {
          getOptimizer: vi.fn().mockReturnValue({
            executeOptimizedQuery: vi.fn().mockImplementation(async () => {
              // Simulate slow execution
              await new Promise(resolve => setTimeout(resolve, 600));
              return {
                events: [],
                total: 0,
                hasMore: false,
                pagination: { limit: 50, offset: 0, currentPage: 1, totalPages: 0 },
              };
            }),
          }),
        },
      }));

      const searchBody = {
        filters: {},
        pagination: { limit: 50, offset: 0 },
        sort: { field: 'block_timestamp', direction: 'desc' },
      };

      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(searchBody),
        },
      );

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.optimizationSuggestions).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Consider adding more specific filters'),
          expect.stringContaining('Use indexed parameters when possible'),
        ]),
      );
    });

    it('should return appropriate cache headers', async () => {
      const searchBody = {
        filters: {},
        pagination: { limit: 50, offset: 0 },
        sort: { field: 'block_timestamp', direction: 'desc' },
      };

      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(searchBody),
        },
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('X-Data-Source')).toBe('database');
      expect(res.headers.get('X-Chain-Name')).toBe('Ethereum');
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
    });
  });

  describe('Error Handling', () => {
    const chainId = 1;
    const invalidAddress = 'invalid-address';

    it('should handle invalid contract addresses gracefully', async () => {
      const res = await app.request(`/api/chains/${chainId}/contracts/${invalidAddress}/events`);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('Invalid contract address');
      expect(data.message).toContain('42-character hexadecimal string');
    });

    it('should handle unsupported chain IDs gracefully', async () => {
      const contractAddress = '0x1234567890123456789012345678901234567890';
      const res = await app.request(`/api/chains/99999/contracts/${contractAddress}/events`);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('Unsupported chain');
      expect(data.supportedChains).toBeInstanceOf(Array);
    });

    it('should handle malformed query parameters', async () => {
      const contractAddress = '0x1234567890123456789012345678901234567890';
      const res = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?limit=abc&sort=invalid`,
      );
      expect(res.status).toBe(200); // Should gracefully handle invalid params

      const data = await res.json();
      expect(data.pagination.limit).toBe(50); // Should default to valid value
      expect(data.pagination.sort).toBe('desc'); // Should default to valid value
    });

    it('should handle server errors gracefully', async () => {
      // Mock a server error
      vi.doMock('../../../services/EventPerformanceOptimizer', () => ({
        eventPerformanceOptimizerManager: {
          getOptimizer: vi.fn().mockReturnValue({
            executeOptimizedQuery: vi
              .fn()
              .mockRejectedValue(new Error('Database connection failed')),
          }),
        },
      }));

      const contractAddress = '0x1234567890123456789012345678901234567890';
      const res = await app.request(`/api/chains/${chainId}/contracts/${contractAddress}/events`);
      expect(res.status).toBe(200); // Should return safe default response

      const data = await res.json();
      expect(data.events).toEqual([]);
      expect(data.total).toBe(0);
      expect(data.hasMore).toBe(false);
    });
  });
});
