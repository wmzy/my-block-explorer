/**
 * Performance tests for EventPerformanceOptimizer
 * Tests 1-9ms response time requirements and optimization strategies
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventPerformanceOptimizer } from '../../../src/services/EventPerformanceOptimizer';
import { ChainDatabaseManager } from '../../../src/database/chain-database-manager';
import { initializeMultiChainEnvironment } from '../../../src/database/multi-chain-setup';

describe('EventPerformanceOptimizer', () => {
  const chainId = 1;
  let optimizer: EventPerformanceOptimizer;
  let chainDb: ChainDatabaseManager;

  beforeEach(async () => {
    // Initialize test environment
    await initializeMultiChainEnvironment({
      environment: 'test',
      chains: [chainId],
      createDataDirectories: true,
    });

    // Setup optimizer with strict thresholds
    optimizer = new EventPerformanceOptimizer(chainId, {
      cachedQueryMaxMs: 9, // Strict 1-9ms requirement
      uncachedQueryMaxMs: 100,
      largeDatasetMaxMs: 200,
      indexingMaxMs: 500,
      decodingMaxMs: 50,
      validationMaxMs: 5,
    }, {
      enableQueryCaching: true,
      enableBatchProcessing: true,
      maxConcurrentOperations: 5,
    });

    chainDb = await ChainDatabaseManager.getInstance().getChainDatabase(chainId);
  });

  describe('Cached query performance', () => {
    it('should return cached results within 9ms', async () => {
      const mockData = { events: [], total: 0 };
      const queryFn = vi.fn().mockResolvedValue(mockData);
      const cacheKey = 'test_query';

      // First call - uncached
      const result1 = await optimizer.executeOptimizedQuery(
        'test_operation',
        queryFn,
        cacheKey,
      );

      expect(result1).toEqual(mockData);
      expect(queryFn).toHaveBeenCalledTimes(1);

      // Second call - should be cached
      const startTime = performance.now();
      const result2 = await optimizer.executeOptimizedQuery(
        'test_operation',
        queryFn,
        cacheKey,
      );
      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(result2).toEqual(mockData);
      expect(queryFn).toHaveBeenCalledTimes(1); // Should not call again
      expect(duration).toBeLessThan(9); // Must meet 1-9ms requirement
    });

    it('should handle multiple cached queries efficiently', async () => {
      const queries = Array.from({ length: 100 }, (_, i) => ({
        key: `query_${i}`,
        data: { id: i, value: `test_${i}` },
      }));

      // First populate cache
      for (const query of queries) {
        await optimizer.executeOptimizedQuery(
          'populate_cache',
          async () => query.data,
          query.key,
        );
      }

      // Now test cached performance
      const startTime = performance.now();
      const results = await Promise.all(
        queries.map(query =>
          optimizer.executeOptimizedQuery(
            'cached_query',
            async () => query.data,
            query.key,
          ),
        ),
      );
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      const averageTime = totalTime / queries.length;

      expect(results).toHaveLength(100);
      expect(averageTime).toBeLessThan(9); // Each query should be under 9ms
      expect(totalTime).toBeLessThan(500); // Total should be reasonable
    });

    it('should maintain cache hit rate above 90% for repeated queries', async () => {
      const mockData = { result: 'test' };
      const queryKey = 'cache_test';

      // Execute same query multiple times
      for (let i = 0; i < 100; i++) {
        await optimizer.executeOptimizedQuery(
          'repeated_query',
          async () => mockData,
          queryKey,
        );
      }

      const cacheStats = optimizer.getCacheStatistics();
      expect(cacheStats.queryCache.hitRate).toBeGreaterThan(0.9); // 90% hit rate
    });
  });

  describe('Uncached query performance', () => {
    it('should complete simple uncached queries within 100ms', async () => {
      const queryFn = async () => {
        // Simulate simple database operation
        await new Promise(resolve => setTimeout(resolve, 10));
        return { events: Array.from({ length: 10 }, (_, i) => ({ id: i })) };
      };

      const startTime = performance.now();
      const result = await optimizer.executeOptimizedQuery(
        'simple_query',
        queryFn,
        undefined, // No caching
        { useCache: false },
      );
      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(result.events).toHaveLength(10);
      expect(duration).toBeLessThan(100);
    });

    it('should handle larger uncached queries within 200ms', async () => {
      const queryFn = async () => {
        // Simulate larger database operation
        await new Promise(resolve => setTimeout(resolve, 50));
        return { events: Array.from({ length: 1000 }, (_, i) => ({ id: i, data: 'test'.repeat(10) })) };
      };

      const startTime = performance.now();
      const result = await optimizer.executeOptimizedQuery(
        'large_query',
        queryFn,
        undefined, // No caching
        { useCache: false, expectedDataSize: 1000 },
      );
      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(result.events).toHaveLength(1000);
      expect(duration).toBeLessThan(200);
    });
  });

  describe('Batch processing performance', () => {
    it('should process batch operations efficiently', async () => {
      const items = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      const operationFn = async (item: any) => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return { ...item, processed: true };
      };

      const startTime = performance.now();
      const results = await optimizer.executeBatch(
        items,
        operationFn,
        { maxConcurrency: 10, batchSize: 20 },
      );
      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(results).toHaveLength(100);
      expect(results.every(r => r.processed)).toBe(true);
      expect(duration).toBeLessThan(1000); // Should be efficient
    });

    it('should respect concurrency limits', async () => {
      const items = Array.from({ length: 50 }, (_, i) => ({ id: i }));
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const operationFn = async (item: any) => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise(resolve => setTimeout(resolve, 20));
        concurrentCount--;
        return { ...item, processed: true };
      };

      await optimizer.executeBatch(
        items,
        operationFn,
        { maxConcurrency: 5, batchSize: 10 },
      );

      expect(maxConcurrent).toBeLessThanOrEqual(5);
    });
  });

  describe('Memory efficiency', () => {
    it('should not leak memory during repeated operations', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Perform many operations
      for (let i = 0; i < 1000; i++) {
        await optimizer.executeOptimizedQuery(
          `memory_test_${i}`,
          async () => ({ data: 'x'.repeat(1000) }),
          `cache_key_${i}`,
        );
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });

    it('should limit cache size to prevent memory bloat', async () => {
      // Fill cache beyond its limits
      for (let i = 0; i < 2000; i++) {
        await optimizer.executeOptimizedQuery(
          'cache_size_test',
          async () => ({ id: i, data: 'x'.repeat(1000) }),
          `size_test_${i}`,
        );
      }

      const cacheStats = optimizer.getCacheStatistics();
      expect(cacheStats.queryCache.size).toBeLessThanOrEqual(1000); // Default max size
    });
  });

  describe('Performance monitoring', () => {
    it('should track performance metrics accurately', async () => {
      const queryFn = async () => ({ result: 'test' });

      // Execute queries with different performance characteristics
      await optimizer.executeOptimizedQuery('fast_query', queryFn, 'fast');
      await optimizer.executeOptimizedQuery('slow_query', async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { result: 'slow' };
      }, 'slow');

      const metrics = optimizer.getPerformanceMetrics();

      expect(metrics).toHaveLength(2);
      expect(metrics.some(m => m.operation === 'fast_query')).toBe(true);
      expect(metrics.some(m => m.operation === 'slow_query')).toBe(true);

      const fastMetric = metrics.find(m => m.operation === 'fast_query');
      const slowMetric = metrics.find(m => m.operation === 'slow_query');

      expect(fastMetric!.averageDuration).toBeLessThan(slowMetric!.averageDuration);
      expect(slowMetric!.slowQueries).toBeGreaterThan(0);
    });

    it('should calculate cache hit rates correctly', async () => {
      const queryFn = async () => ({ result: 'test' });
      const cacheKey = 'hit_rate_test';

      // First call (cache miss)
      await optimizer.executeOptimizedQuery('hit_rate_test', queryFn, cacheKey);

      // Subsequent calls (cache hits)
      for (let i = 0; i < 9; i++) {
        await optimizer.executeOptimizedQuery('hit_rate_test', queryFn, cacheKey);
      }

      const metrics = optimizer.getPerformanceMetrics();
      const hitRateMetric = metrics.find(m => m.operation === 'hit_rate_test');

      expect(hitRateMetric!.cacheHitRate).toBe(0.9); // 9/10 hits = 90%
    });
  });

  describe('Query optimization', () => {
    it('should optimize queries for better performance', () => {
      const originalQuery = 'SELECT * FROM events WHERE contract = ? LIMIT 1000';
      const params = ['0x1234567890123456789012345678901234567890'];

      const { optimizedQuery, optimizedParams } = optimizer.optimizeQuery(originalQuery, params);

      expect(optimizedQuery).toContain('/*+ USE_INDEX */');
      expect(optimizedQuery).toContain('LIMIT 100'); // Should reduce large limit
      expect(optimizedParams).toEqual(params);
    });

    it('should preserve query semantics during optimization', () => {
      const originalQuery = 'SELECT block_number, event_name FROM events ORDER BY block_timestamp DESC LIMIT 50';
      const params = [];

      const { optimizedQuery, optimizedParams } = optimizer.optimizeQuery(originalQuery, params);

      expect(optimizedQuery).toContain('block_number');
      expect(optimizedQuery).toContain('event_name');
      expect(optimizedQuery).toContain('ORDER BY');
      expect(optimizedParams).toEqual([]);
    });
  });

  describe('Timeout handling', () => {
    it('should timeout slow operations', async () => {
      const slowQueryFn = async () => {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        return { result: 'too_slow' };
      };

      await expect(
        optimizer.executeOptimizedQuery(
          'timeout_test',
          slowQueryFn,
          undefined,
          { timeout: 100 }, // 100ms timeout
        ),
      ).rejects.toThrow('timed out');
    });

    it('should complete fast operations within timeout', async () => {
      const fastQueryFn = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return { result: 'fast_enough' };
      };

      const result = await optimizer.executeOptimizedQuery(
        'timeout_success_test',
        fastQueryFn,
        undefined,
        { timeout: 100 }, // 100ms timeout
      );

      expect(result.result).toBe('fast_enough');
    });
  });

  describe('Cache management', () => {
    it('should respect TTL for cache entries', async () => {
      // Create optimizer with short TTL
      const shortTtlOptimizer = new EventPerformanceOptimizer(chainId, {}, {
        enableQueryCaching: true,
      });

      // Override TTL for testing
      (shortTtlOptimizer as any).queryCache.ttlMs = 50; // 50ms TTL

      const queryFn = async () => ({ result: 'ttl_test' });
      const cacheKey = 'ttl_test_key';

      // First call
      await shortTtlOptimizer.executeOptimizedQuery('ttl_test', queryFn, cacheKey);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      // Second call should miss cache
      const startTime = performance.now();
      await shortTtlOptimizer.executeOptimizedQuery('ttl_test', queryFn, cacheKey);
      const endTime = performance.now();

      // Should take longer than cache hit (indicating cache miss)
      expect(endTime - startTime).toBeGreaterThan(1);
    });

    it('should clear caches properly', async () => {
      // Populate cache
      for (let i = 0; i < 10; i++) {
        await optimizer.executeOptimizedQuery(
          'clear_test',
          async () => ({ id: i }),
          `clear_test_${i}`,
        );
      }

      let cacheStats = optimizer.getCacheStatistics();
      expect(cacheStats.queryCache.size).toBeGreaterThan(0);

      // Clear caches
      optimizer.clearCaches();

      cacheStats = optimizer.getCacheStatistics();
      expect(cacheStats.queryCache.size).toBe(0);
    });
  });

  describe('Precomputation', () => {
    it('should precompute aggregates for common queries', async () => {
      const contractAddress = '0x1234567890123456789012345678901234567890';

      // Mock the query service methods
      const mockQueryService = {
        getEventsByType: vi.fn().mockResolvedValue({ Transfer: 100, Approval: 50 }),
        getEventsByTimeRange: vi.fn().mockResolvedValue([]),
        getTopAddresses: vi.fn().mockResolvedValue([]),
      };

      vi.mock('../../../src/services/EventQueryService', () => ({
        eventQueryServiceManager: {
          getService: () => mockQueryService,
        },
      }));

      await optimizer.precomputeAggregates(contractAddress);

      expect(mockQueryService.getEventsByType).toHaveBeenCalled();
      expect(mockQueryService.getEventsByTimeRange).toHaveBeenCalled();
      expect(mockQueryService.getTopAddresses).toHaveBeenCalled();
    });
  });

  describe('Performance thresholds', () => {
    it('should use custom performance thresholds', () => {
      const customOptimizer = new EventPerformanceOptimizer(chainId, {
        cachedQueryMaxMs: 5,
        uncachedQueryMaxMs: 50,
      });

      const thresholds = customOptimizer.getThresholds();
      expect(thresholds.cachedQueryMaxMs).toBe(5);
      expect(thresholds.uncachedQueryMaxMs).toBe(50);
    });

    it('should update performance thresholds dynamically', () => {
      optimizer.updateThresholds({
        cachedQueryMaxMs: 3,
        uncachedQueryMaxMs: 75,
      });

      const thresholds = optimizer.getThresholds();
      expect(thresholds.cachedQueryMaxMs).toBe(3);
      expect(thresholds.uncachedQueryMaxMs).toBe(75);
    });
  });

  describe('Error handling', () => {
    it('should handle query failures gracefully', async () => {
      const failingQueryFn = async () => {
        throw new Error('Query failed');
      };

      await expect(
        optimizer.executeOptimizedQuery('failing_query', failingQueryFn),
      ).rejects.toThrow('Query failed');

      // Should still record metrics
      const metrics = optimizer.getPerformanceMetrics();
      expect(metrics.some(m => m.operation === 'failing_query')).toBe(true);
    });

    it('should log performance warnings when thresholds are exceeded', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const slowQueryFn = async () => {
        await new Promise(resolve => setTimeout(resolve, 20)); // 20ms - exceeds 9ms threshold
        return { result: 'slow' };
      };

      await optimizer.executeOptimizedQuery('threshold_exceeded', slowQueryFn, 'slow_key');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Performance threshold exceeded'),
        expect.any(Object),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Configuration', () => {
    it('should support different optimization strategies', () => {
      optimizer.updateStrategies({
        enableQueryCaching: false,
        enableBatchProcessing: false,
        maxConcurrentOperations: 1,
      });

      const strategies = optimizer.getStrategies();
      expect(strategies.enableQueryCaching).toBe(false);
      expect(strategies.enableBatchProcessing).toBe(false);
      expect(strategies.maxConcurrentOperations).toBe(1);
    });

    it('should provide chain ID information', () => {
      expect(optimizer.getChainId()).toBe(chainId);
    });
  });
});
