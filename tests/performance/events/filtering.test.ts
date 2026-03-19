/**
 * Performance tests for filtering queries response times
 * Tests: T029 - Filtered query performance requirements (sub-500ms for filtering)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import app from '../../../src/api-app';
import { ChainDatabaseManager } from '../../../src/database/chain-database-manager';
import { ChainEventTableManager } from '../../../src/database/chain-event-table-manager';
import { initializeMultiChainEnvironment } from '../../../src/database/multi-chain-setup';
import { EventParameter } from '../../../src/types/events';

describe('Event Filtering Performance Tests', () => {
  const chainId = 1; // Ethereum mainnet
  const contractAddress = '0x1234567890123456789012345678901234567890';
  const tableName = 'events_filtering_performance_test';
  let chainDb: ChainDatabaseManager;
  let eventTableManager: ChainEventTableManager;

  // Performance thresholds (in milliseconds)
  const PERFORMANCE_THRESHOLDS = {
    FILTERED_QUERY_MAX: 500, // 500ms requirement for filtering operations
    COMPLEX_FILTER_MAX: 1000, // 1000ms for complex multi-parameter filters
    LARGE_DATASET_FILTER_MAX: 2000, // 2s for filtering large datasets
    INDEXED_FILTER_MAX: 100, // 100ms for indexed filter queries
    CACHE_HIT_MAX: 10, // 10ms for cached filter results
  };

  beforeAll(async () => {
    // Initialize test environment
    await initializeMultiChainEnvironment({
      environment: 'test',
      chains: [chainId],
      createDataDirectories: true,
    });

    // Setup test database and table
    chainDb = await ChainDatabaseManager.getInstance().getChainDatabase(chainId);
    eventTableManager = new ChainEventTableManager(chainDb);

    // Create test event table with indexes
    const eventParams: EventParameter[] = [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
      { name: 'token', type: 'string', indexed: false },
    ];

    await eventTableManager.createEventTable(
      contractAddress,
      eventParams,
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      'Transfer',
    );

    // Create additional indexes for filtering performance
    await eventTableManager.createFilteringIndexes(tableName, [
      'from',
      'to',
      'value',
      'block_timestamp',
    ]);

    // Insert comprehensive test data
    await insertComprehensiveTestData();
  });

  afterAll(async () => {
    // Cleanup test data
    try {
      await eventTableManager.dropEventTable(tableName);
    }
    catch (error) {
      // Ignore cleanup errors in test environment
    }
  });

  const insertComprehensiveTestData = async () => {
    const testData = Array.from({ length: 10000 }, (_, i) => ({
      blockHash: `0x${i.toString(16).padStart(64, '0')}`,
      logIndex: i % 10,
      transactionHash: `0x${(i + 10000).toString(16).padStart(64, '0')}`,
      transactionIndex: i % 5,
      blockNumber: BigInt(18000000 + i),
      blockTimestamp: new Date(Date.now() - i * 60000), // 1 minute intervals
      contractAddress,
      eventName: ['Transfer', 'Approval', 'TransferFrom'][i % 3],
      eventSignature: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      from: `0x${(i % 100).toString(16).padStart(40, '0')}`,
      to: `0x${((i + 1) % 100).toString(16).padStart(40, '0')}`,
      value: (BigInt(i + 1) * BigInt(10 ** 18)).toString(),
      token: `Token${i % 50}`,
    }));

    // Insert in batches for performance
    const batchSize = 500;
    for (let i = 0; i < testData.length; i += batchSize) {
      const batch = testData.slice(i, i + batchSize);
      await eventTableManager.insertEventDataBatch(tableName, batch);
    }
  };

  describe('Basic Filter Performance', () => {
    it('should filter by event name within 500ms', async () => {
      const startTime = performance.now();

      const searchRequest = {
        filters: {
          eventName: 'Transfer',
        },
        pagination: {
          limit: 100,
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        },
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.FILTERED_QUERY_MAX);

      const data = await response.json();
      expect(data.events).toBeDefined();
      expect(data.events.every((event: any) => event.eventName === 'Transfer')).toBe(true);
    });

    it('should filter by address within 100ms (indexed)', async () => {
      const startTime = performance.now();

      const searchRequest = {
        filters: {
          from: '0x0000000000000000000000000000000000000000',
        },
        pagination: {
          limit: 50,
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        },
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.INDEXED_FILTER_MAX);

      const data = await response.json();
      expect(data.events).toBeDefined();
      expect(data.events.every((event: any) => event.from === '0x0000000000000000000000000000000000000000')).toBe(true);
    });

    it('should filter by value range within 500ms', async () => {
      const startTime = performance.now();

      const searchRequest = {
        filters: {
          value: {
            gte: '1000000000000000000', // 1 ETH
            lte: '5000000000000000000', // 5 ETH
          },
        },
        pagination: {
          limit: 100,
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        },
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.FILTERED_QUERY_MAX);

      const data = await response.json();
      expect(data.events).toBeDefined();

      // Verify value filtering
      data.events.forEach((event: any) => {
        const value = BigInt(event.value);
        expect(value).toBeGreaterThanOrEqual(BigInt('1000000000000000000'));
        expect(value).toBeLessThanOrEqual(BigInt('5000000000000000000'));
      });
    });
  });

  describe('Complex Filter Performance', () => {
    it('should handle multi-parameter filters within 1 second', async () => {
      const startTime = performance.now();

      const searchRequest = {
        filters: {
          eventName: ['Transfer', 'Approval'],
          fromBlock: '18000100',
          toBlock: '18000500',
          from: '0x0000000000000000000000000000000000000000',
          value: {
            gte: '1000000000000000000',
          },
        },
        pagination: {
          limit: 100,
        },
        sort: {
          field: 'blockNumber',
          direction: 'desc',
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        },
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.COMPLEX_FILTER_MAX);

      const data = await response.json();
      expect(data.events).toBeDefined();

      // Verify all filters applied
      data.events.forEach((event: any) => {
        expect(['Transfer', 'Approval']).toContain(event.eventName);
        expect(event.from).toBe('0x0000000000000000000000000000000000000000');
        expect(BigInt(event.value)).toBeGreaterThanOrEqual(BigInt('1000000000000000000'));
      });
    });

    it('should handle timestamp range filtering efficiently', async () => {
      const startTime = performance.now();

      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const searchRequest = {
        filters: {
          fromTimestamp: oneHourAgo.toISOString(),
          toTimestamp: now.toISOString(),
        },
        pagination: {
          limit: 200,
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        },
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.FILTERED_QUERY_MAX);

      const data = await response.json();
      expect(data.events).toBeDefined();
    });

    it('should handle text search with wildcards efficiently', async () => {
      const startTime = performance.now();

      const searchRequest = {
        filters: {
          eventName: {
            like: 'Trans%',
            caseInsensitive: true,
          },
        },
        pagination: {
          limit: 100,
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        },
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.FILTERED_QUERY_MAX);

      const data = await response.json();
      expect(data.events).toBeDefined();

      // Should match 'Transfer' and 'TransferFrom'
      data.events.forEach((event: any) => {
        expect(event.eventName.toLowerCase()).toContain('trans');
      });
    });
  });

  describe('Large Dataset Filtering', () => {
    it('should handle filtering on 10,000+ records within 2 seconds', async () => {
      const startTime = performance.now();

      const searchRequest = {
        filters: {
          fromBlock: '18000000',
          toBlock: '18009999',
        },
        pagination: {
          limit: 500,
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        },
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.LARGE_DATASET_FILTER_MAX);

      const data = await response.json();
      expect(data.events.length).toBe(500);
      expect(data.total).toBeGreaterThan(5000); // Should match many records
    });

    it('should handle deep pagination with filters efficiently', async () => {
      const startTime = performance.now();

      const searchRequest = {
        filters: {
          eventName: 'Transfer',
        },
        pagination: {
          limit: 100,
          offset: 2000, // Page 21
        },
        sort: {
          field: 'blockNumber',
          direction: 'desc',
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        },
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.LARGE_DATASET_FILTER_MAX);

      const data = await response.json();
      expect(data.events.length).toBeGreaterThan(0);
      expect(data.events.every((event: any) => event.eventName === 'Transfer')).toBe(true);
    });
  });

  describe('Filtering Cache Performance', () => {
    it('should return cached filter results within 10ms', async () => {
      const searchRequest = {
        filters: {
          eventName: 'Transfer',
          from: '0x0000000000000000000000000000000000000000',
        },
        pagination: {
          limit: 50,
        },
      };

      // First request (cache miss)
      const firstStartTime = performance.now();
      const firstResponse = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        },
      );
      const firstEndTime = performance.now();
      const firstResponseTime = firstEndTime - firstStartTime;

      expect(firstResponse.status).toBe(200);

      // Second request (cache hit)
      const secondStartTime = performance.now();
      const secondResponse = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        },
      );
      const secondEndTime = performance.now();
      const secondResponseTime = secondEndTime - secondStartTime;

      expect(secondResponse.status).toBe(200);
      expect(secondResponseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.CACHE_HIT_MAX);

      // Second request should be significantly faster
      expect(secondResponseTime).toBeLessThan(firstResponseTime * 0.1);

      const firstData = await firstResponse.json();
      const secondData = await secondResponse.json();
      expect(firstData.events).toEqual(secondData.events);
      expect(secondData.cacheHit).toBe(true);
    });

    it('should invalidate cache when new events are added', async () => {
      const searchRequest = {
        filters: {
          eventName: 'Transfer',
        },
        pagination: {
          limit: 10,
        },
      };

      // First request
      const firstResponse = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        },
      );

      expect(firstResponse.status).toBe(200);
      const firstData = await firstResponse.json();
      const initialCount = firstData.total;

      // Simulate new event being indexed
      const newEvent = {
        blockHash: `0x${'1'.repeat(64)}`,
        logIndex: 0,
        transactionHash: `0x${'2'.repeat(64)}`,
        transactionIndex: 0,
        blockNumber: BigInt(18010000),
        blockTimestamp: new Date(),
        contractAddress,
        eventName: 'Transfer',
        eventSignature: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        from: '0x0000000000000000000000000000000000000000',
        to: '0x1111111111111111111111111111111111111111',
        value: '1000000000000000000',
      };

      await eventTableManager.insertEventData(tableName, newEvent);

      // Second request after new event
      const secondResponse = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        },
      );

      expect(secondResponse.status).toBe(200);
      const secondData = await secondResponse.json();
      expect(secondData.total).toBe(initialCount + 1);
      expect(secondData.cacheHit).toBe(false);
    });
  });

  describe('Concurrent Filtering Performance', () => {
    it('should handle multiple concurrent filter requests efficiently', async () => {
      const concurrentRequests = 20;
      const startTime = performance.now();

      const requests = Array.from({ length: concurrentRequests }, (_, i) => {
        const searchRequest = {
          filters: {
            eventName: ['Transfer', 'Approval', 'TransferFrom'][i % 3],
            fromBlock: (18000000 + (i * 100)).toString(),
            toBlock: (18000100 + (i * 100)).toString(),
          },
          pagination: {
            limit: 50,
          },
        };

        return app.request(
          `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(searchRequest),
          },
        );
      });

      const responses = await Promise.all(requests);
      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // All requests should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });

      // Average time per request should be reasonable
      const averageTimePerRequest = totalTime / concurrentRequests;
      expect(averageTimePerRequest).toBeLessThan(PERFORMANCE_THRESHOLDS.FILTERED_QUERY_MAX);

      // Total time should be less than sum of individual times (parallel processing)
      expect(totalTime).toBeLessThan(concurrentRequests * PERFORMANCE_THRESHOLDS.FILTERED_QUERY_MAX);
    });
  });

  describe('Memory and Resource Usage During Filtering', () => {
    it('should not leak memory during repeated filtering operations', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Run multiple filtering operations
      for (let i = 0; i < 50; i++) {
        const searchRequest = {
          filters: {
            eventName: 'Transfer',
            fromBlock: (18000000 + i * 10).toString(),
            toBlock: (18000050 + i * 10).toString(),
          },
          pagination: {
            limit: 20,
          },
        };

        await app.request(
          `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(searchRequest),
          },
        );
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be minimal (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });

  describe('Filter Query Optimization', () => {
    it('should use optimal indexes for different filter combinations', async () => {
      const startTime = performance.now();

      const searchRequest = {
        filters: {
          eventName: 'Transfer',
          from: '0x0000000000000000000000000000000000000000',
          value: {
            gte: '1000000000000000000',
          },
        },
        pagination: {
          limit: 100,
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        },
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.INDEXED_FILTER_MAX);

      const data = await response.json();
      expect(data.indexesUsed).toBeDefined();
      expect(data.indexesUsed.length).toBeGreaterThan(0);
      expect(data.indexesUsed).toContain('idx_from');
    });

    it('should provide query optimization hints for slow queries', async () => {
      const searchRequest = {
        filters: {
          token: 'Token1', // Non-indexed field
        },
        pagination: {
          limit: 100,
        },
      };

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/search`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchRequest),
        },
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      if (data.executionTime > 200) { // Only suggest for slower queries
        expect(data.optimizationSuggestions).toBeDefined();
        expect(data.optimizationSuggestions.length).toBeGreaterThan(0);
      }
    });
  });
});
