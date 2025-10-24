/**
 * Performance tests for event list query response times
 * Tests: T014 - Event query performance requirements (1-9ms for cached data)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../../src/api-app';
import { ChainDatabaseManager } from '../../../src/database/chain-database-manager';
import { ChainEventTableManager } from '../../../src/database/chain-event-table-manager';
import { initializeMultiChainEnvironment } from '../../../src/database/multi-chain-setup';
import { EventParameter } from '../../../src/types/events';

describe('Event Query Performance Tests', () => {
  const chainId = 1; // Ethereum mainnet
  const contractAddress = '0x1234567890123456789012345678901234567890';
  const tableName = 'events_performance_test';
  let chainDb: ChainDatabaseManager;
  let eventTableManager: ChainEventTableManager;

  // Performance thresholds (in milliseconds)
  const PERFORMANCE_THRESHOLDS = {
    CACHED_QUERY_MAX: 9, // 1-9ms requirement for cached data
    UNCACHED_QUERY_MAX: 100, // 100ms for uncached data
    LARGE_DATASET_MAX: 200, // 200ms for large datasets
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

    // Create test event table
    const eventParams: EventParameter[] = [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: false },
      { name: 'value', type: 'uint256', indexed: false },
    ];

    await eventTableManager.createEventTable(
      contractAddress,
      eventParams,
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      'Transfer'
    );

    // Insert test data
    await insertTestData();
  });

  afterAll(async () => {
    // Cleanup test data
    try {
      await eventTableManager.dropEventTable(tableName);
    } catch (error) {
      // Ignore cleanup errors in test environment
    }
  });

  const insertTestData = async () => {
    const testData = Array.from({ length: 1000 }, (_, i) => ({
      blockHash: `0x${i.toString(16).padStart(64, '0')}`,
      logIndex: i % 10,
      transactionHash: `0x${(i + 1000).toString(16).padStart(64, '0')}`,
      transactionIndex: i % 5,
      blockNumber: BigInt(18000000 + i),
      blockTimestamp: new Date(Date.now() - i * 60000), // 1 minute intervals
      contractAddress,
      eventName: 'Transfer',
      eventSignature: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      from: `0x${(i + 1).toString(16).padStart(40, '0')}`,
      to: `0x${(i + 2).toString(16).padStart(40, '0')}`,
      value: (BigInt(i + 1) * BigInt(10 ** 18)).toString(),
    }));

    // Insert in batches
    const batchSize = 100;
    for (let i = 0; i < testData.length; i += batchSize) {
      const batch = testData.slice(i, i + batchSize);
      await eventTableManager.insertEventDataBatch(tableName, batch);
    }
  };

  describe('Basic Event Query Performance', () => {
    it('should return first page within 9ms for cached data', async () => {
      const startTime = performance.now();

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?limit=50`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.CACHED_QUERY_MAX);

      const data = await response.json();
      expect(data.events).toBeDefined();
      expect(data.events.length).toBeLessThanOrEqual(50);
    });

    it('should handle small result sets quickly', async () => {
      const startTime = performance.now();

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?limit=10`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.CACHED_QUERY_MAX);
    });

    it('should maintain performance with event type filter', async () => {
      const startTime = performance.now();

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?eventName=Transfer&limit=50`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.CACHED_QUERY_MAX);
    });
  });

  describe('Pagination Performance', () => {
    it('should handle deep pagination efficiently', async () => {
      const startTime = performance.now();

      // Request page 20 (offset 950)
      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?limit=50&offset=950`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.UNCACHED_QUERY_MAX);

      const data = await response.json();
      expect(data.events.length).toBeLessThanOrEqual(50);
    });

    it('should handle cursor-based pagination efficiently', async () => {
      // First, get first page to get cursor
      const firstResponse = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?limit=50`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      expect(firstResponse.status).toBe(200);
      const firstData = await firstResponse.json();

      if (firstData.events.length > 0 && firstData.nextCursor) {
        const startTime = performance.now();

        const response = await app.request(
          `/api/chains/${chainId}/contracts/${contractAddress}/events?limit=50&cursor=${firstData.nextCursor}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        const endTime = performance.now();
        const responseTime = endTime - startTime;

        expect(response.status).toBe(200);
        expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.CACHED_QUERY_MAX);
      }
    });
  });

  describe('Filter Performance', () => {
    it('should handle date range filters efficiently', async () => {
      const startTime = performance.now();

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?fromTimestamp=${Date.now() - 3600000}&toTimestamp=${Date.now()}&limit=100`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.UNCACHED_QUERY_MAX);
    });

    it('should handle block range filters efficiently', async () => {
      const startTime = performance.now();

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?fromBlock=18000000&toBlock=18000100&limit=100`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.UNCACHED_QUERY_MAX);
    });

    it('should handle address filters efficiently', async () => {
      const startTime = performance.now();

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?from=0x1234567890abcdef1234567890abcdef12345678&limit=100`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.CACHED_QUERY_MAX);
    });
  });

  describe('Concurrent Request Performance', () => {
    it('should handle multiple concurrent requests efficiently', async () => {
      const concurrentRequests = 10;
      const startTime = performance.now();

      const promises = Array.from({ length: concurrentRequests }, () =>
        app.request(
          `/api/chains/${chainId}/contracts/${contractAddress}/events?limit=50`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        )
      );

      const responses = await Promise.all(promises);
      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Average time per request should still be reasonable
      const averageTimePerRequest = totalTime / concurrentRequests;
      expect(averageTimePerRequest).toBeLessThan(PERFORMANCE_THRESHOLDS.UNCACHED_QUERY_MAX);
    });
  });

  describe('Memory and Resource Usage', () => {
    it('should not leak memory on repeated queries', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Run multiple queries
      for (let i = 0; i < 100; i++) {
        await app.request(
          `/api/chains/${chainId}/contracts/${contractAddress}/events?limit=50`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be minimal (less than 10MB)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });
  });

  describe('Response Size Performance', () => {
    it('should handle large result sets efficiently', async () => {
      const startTime = performance.now();

      const response = await app.request(
        `/api/chains/${chainId}/contracts/${contractAddress}/events?limit=500`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.LARGE_DATASET_MAX);

      const data = await response.json();
      expect(data.events.length).toBeLessThanOrEqual(500);

      // Response size should be reasonable
      const responseSize = JSON.stringify(data).length;
      expect(responseSize).toBeLessThan(5 * 1024 * 1024); // Less than 5MB
    });
  });
});