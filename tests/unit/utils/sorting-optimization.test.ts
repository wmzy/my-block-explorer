/**
 * Unit tests for sorting optimization utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OptimizedSorter, optimizedSort, sortingPerformanceMonitor, SortingPerformanceMonitor } from '@/utils/sorting-optimization';

describe('OptimizedSorter', () => {
  let sorter: OptimizedSorter;

  beforeEach(() => {
    sorter = new OptimizedSorter();
    sortingPerformanceMonitor.clear();
  });

  afterEach(() => {
    sorter.clearCache();
    sortingPerformanceMonitor.clear();
  });

  describe('basic sorting functionality', () => {
    it('should sort empty array', () => {
      const result = sorter.sort([], []);
      expect(result.sortedData).toEqual([]);
      expect(result.metrics.algorithmUsed).toBe('empty');
    });

    it('should return unsorted array when no sort configs provided', () => {
      const data = [{ id: 3 }, { id: 1 }, { id: 2 }];
      const result = sorter.sort(data, []);
      expect(result.sortedData).toEqual(data);
      expect(result.metrics.algorithmUsed).toBe('no-sort');
    });

    it('should sort by numeric field in ascending order', () => {
      const data = [
        { id: 3, name: 'C' },
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ];
      const sortConfigs = [{ key: 'id', direction: 'asc' as const, type: 'numeric' as const }];

      const result = sorter.sort(data, sortConfigs);
      expect(result.sortedData).toEqual([
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 3, name: 'C' },
      ]);
    });

    it('should sort by numeric field in descending order', () => {
      const data = [
        { id: 1, name: 'A' },
        { id: 3, name: 'C' },
        { id: 2, name: 'B' },
      ];
      const sortConfigs = [{ key: 'id', direction: 'desc' as const, type: 'numeric' as const }];

      const result = sorter.sort(data, sortConfigs);
      expect(result.sortedData).toEqual([
        { id: 3, name: 'C' },
        { id: 2, name: 'B' },
        { id: 1, name: 'A' },
      ]);
    });

    it('should sort by text field', () => {
      const data = [
        { name: 'Charlie' },
        { name: 'Alice' },
        { name: 'Bob' },
      ];
      const sortConfigs = [{ key: 'name', direction: 'asc' as const, type: 'text' as const }];

      const result = sorter.sort(data, sortConfigs);
      expect(result.sortedData).toEqual([
        { name: 'Alice' },
        { name: 'Bob' },
        { name: 'Charlie' },
      ]);
    });

    it('should handle null and undefined values', () => {
      const data = [
        { id: null, name: 'A' },
        { id: 2, name: 'B' },
        { id: undefined, name: 'C' },
        { id: 1, name: 'D' },
      ];
      const sortConfigs = [{ key: 'id', direction: 'asc' as const, type: 'numeric' as const }];

      const result = sorter.sort(data, sortConfigs);
      expect(result.sortedData[0].id).toBeNull();
      expect(result.sortedData[1].id).toBeUndefined();
    });
  });

  describe('multi-level sorting', () => {
    it('should sort by multiple fields with priority', () => {
      const data = [
        { category: 'A', value: 3, name: 'C3' },
        { category: 'B', value: 1, name: 'B1' },
        { category: 'A', value: 1, name: 'A1' },
        { category: 'B', value: 2, name: 'B2' },
        { category: 'A', value: 2, name: 'A2' },
      ];
      const sortConfigs = [
        { key: 'category', direction: 'asc' as const, type: 'text' as const, priority: 0 },
        { key: 'value', direction: 'asc' as const, type: 'numeric' as const, priority: 1 },
      ];

      const result = sorter.sort(data, sortConfigs);
      expect(result.sortedData).toEqual([
        { category: 'A', value: 1, name: 'A1' },
        { category: 'A', value: 2, name: 'A2' },
        { category: 'A', value: 3, name: 'C3' },
        { category: 'B', value: 1, name: 'B1' },
        { category: 'B', value: 2, name: 'B2' },
      ]);
    });
  });

  describe('nested field sorting', () => {
    it('should sort by nested object fields', () => {
      const data = [
        { user: { profile: { age: 30 } }, name: 'A' },
        { user: { profile: { age: 25 } }, name: 'B' },
        { user: { profile: { age: 35 } }, name: 'C' },
      ];
      const sortConfigs = [{ key: 'user.profile.age', direction: 'asc' as const, type: 'numeric' as const }];

      const result = sorter.sort(data, sortConfigs);
      expect(result.sortedData).toEqual([
        { user: { profile: { age: 25 } }, name: 'B' },
        { user: { profile: { age: 30 } }, name: 'A' },
        { user: { profile: { age: 35 } }, name: 'C' },
      ]);
    });
  });

  describe('performance optimization', () => {
    it('should use cache for identical sort operations', () => {
      const data = Array.from({ length: 100 }, (_, i) => ({ id: i, value: Math.random() }));
      const sortConfigs = [{ key: 'id', direction: 'asc' as const, type: 'numeric' as const }];

      const result1 = sorter.sort(data, sortConfigs, { useCache: true, cacheKey: 'test-sort' });
      const result2 = sorter.sort(data, sortConfigs, { useCache: true, cacheKey: 'test-sort' });

      expect(result1.metrics.cacheHit).toBe(false);
      expect(result2.metrics.cacheHit).toBe(true);
      expect(result2.metrics.executionTime).toBeLessThan(result1.metrics.executionTime);
    });

    it('should use optimized algorithm for large datasets', () => {
      const data = Array.from({ length: 15000 }, (_, i) => ({ id: i, value: Math.random() }));
      const sortConfigs = [{ key: 'id', direction: 'asc' as const, type: 'numeric' as const }];

      const result = sorter.sort(data, sortConfigs, { threshold: 10000 });
      expect(result.metrics.algorithmUsed).toBe('optimized');
      expect(result.sortedData.length).toBe(data.length);
      expect(result.sortedData[0].id).toBe(0);
      expect(result.sortedData[data.length - 1].id).toBe(data.length - 1);
    });

    it('should use standard algorithm for small datasets', () => {
      const data = Array.from({ length: 100 }, (_, i) => ({ id: i, value: Math.random() }));
      const sortConfigs = [{ key: 'id', direction: 'asc' as const, type: 'numeric' as const }];

      const result = sorter.sort(data, sortConfigs, { threshold: 1000 });
      expect(result.metrics.algorithmUsed).toBe('standard');
    });
  });

  describe('caching', () => {
    it('should cache results with TTL', async () => {
      const data = [{ id: 1 }, { id: 2 }];
      const sortConfigs = [{ key: 'id', direction: 'asc' as const, type: 'numeric' as const }];

      sorter = new OptimizedSorter();
      sorter['defaultCacheTTL'] = 100; // 100ms TTL for testing

      const result1 = sorter.sort(data, sortConfigs, { useCache: true, cacheKey: 'test-ttl' });
      expect(result1.metrics.cacheHit).toBe(false);

      // Should hit cache immediately
      const result2 = sorter.sort(data, sortConfigs, { useCache: true, cacheKey: 'test-ttl' });
      expect(result2.metrics.cacheHit).toBe(true);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      const result3 = sorter.sort(data, sortConfigs, { useCache: true, cacheKey: 'test-ttl' });
      expect(result3.metrics.cacheHit).toBe(false);
    });

    it('should limit cache size', () => {
      sorter = new OptimizedSorter();
      sorter['cacheMaxSize'] = 2;

      const data = [{ id: 1 }];
      const sortConfigs = [{ key: 'id', direction: 'asc' as const, type: 'numeric' as const }];

      // Fill cache beyond max size
      sorter.sort(data, sortConfigs, { useCache: true, cacheKey: 'test1' });
      sorter.sort(data, sortConfigs, { useCache: true, cacheKey: 'test2' });
      sorter.sort(data, sortConfigs, { useCache: true, cacheKey: 'test3' });

      const stats = sorter.getCacheStats();
      expect(stats.size).toBeLessThanOrEqual(2);
    });
  });

  describe('type-specific sorting', () => {
    it('should sort timestamps correctly', () => {
      const data = [
        { timestamp: '2023-01-03T00:00:00Z' },
        { timestamp: '2023-01-01T00:00:00Z' },
        { timestamp: '2023-01-02T00:00:00Z' },
      ];
      const sortConfigs = [{ key: 'timestamp', direction: 'asc' as const, type: 'timestamp' as const }];

      const result = sorter.sort(data, sortConfigs);
      expect(result.sortedData[0].timestamp).toBe('2023-01-01T00:00:00Z');
      expect(result.sortedData[1].timestamp).toBe('2023-01-02T00:00:00Z');
      expect(result.sortedData[2].timestamp).toBe('2023-01-03T00:00:00Z');
    });

    it('should sort addresses case-insensitively', () => {
      const data = [
        { address: '0xABCDEF1234567890' },
        { address: '0xabcdef1234567890' },
        { address: '0x1234567890ABCDEF' },
      ];
      const sortConfigs = [{ key: 'address', direction: 'asc' as const, type: 'address' as const }];

      const result = sorter.sort(data, sortConfigs);
      expect(result.sortedData[0].address).toBe('0x1234567890ABCDEF');
      expect(result.sortedData[1].address).toBe('0xABCDEF1234567890');
      expect(result.sortedData[2].address).toBe('0xabcdef1234567890');
    });
  });

  describe('optimization methods', () => {
    it('should optimize sort configurations for large datasets', () => {
      const data = Array.from({ length: 2000 }, (_, i) => ({ id: i }));
      const sortConfigs = [
        { key: 'field1', direction: 'asc' as const, type: 'text' as const, priority: 3 },
        { key: 'field2', direction: 'desc' as const, type: 'numeric' as const, priority: 1 },
        { key: 'field3', direction: 'asc' as const, type: 'text' as const, priority: 2 },
        { key: 'field4', direction: 'desc' as const, type: 'text' as const, priority: 4 },
        { key: 'field5', direction: 'asc' as const, type: 'numeric' as const, priority: 0 },
      ];

      const optimized = sorter.optimizeSortConfigs(data, sortConfigs);
      expect(optimized.length).toBeLessThanOrEqual(3); // Should limit to 3 for large datasets
      expect(optimized[0].priority).toBe(0); // Should be sorted by priority
    });
  });
});

describe('optimizedSort convenience function', () => {
  beforeEach(() => {
    sortingPerformanceMonitor.clear();
  });

  it('should provide the same interface as OptimizedSorter.sort', () => {
    const data = [{ id: 3 }, { id: 1 }, { id: 2 }];
    const sortConfigs = [{ key: 'id', direction: 'asc' as const, type: 'numeric' as const }];

    const result = optimizedSort(data, sortConfigs);
    expect(result.sortedData).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    expect(result.metrics).toBeDefined();
  });
});

describe('SortingPerformanceMonitor', () => {
  let monitor: SortingPerformanceMonitor;

  beforeEach(() => {
    monitor = new SortingPerformanceMonitor();
  });

  it('should record and average metrics', () => {
    const metrics = [
      { algorithmUsed: 'standard', executionTime: 10, dataSize: 100, memoryUsage: 1000, cacheHit: false },
      { algorithmUsed: 'optimized', executionTime: 20, dataSize: 200, memoryUsage: 2000, cacheHit: true },
      { algorithmUsed: 'standard', executionTime: 15, dataSize: 150, memoryUsage: 1500, cacheHit: false },
    ];

    metrics.forEach(metric => monitor.recordMetrics(metric));

    const avg = monitor.getAverageMetrics();
    expect(avg.avgExecutionTime).toBe(15); // (10 + 20 + 15) / 3
    expect(avg.avgDataSize).toBe(150); // (100 + 200 + 150) / 3
    expect(avg.avgMemoryUsage).toBe(1500); // (1000 + 2000 + 1500) / 3
    expect(avg.cacheHitRate).toBe(1 / 3); // 1 cache hit out of 3
    expect(avg.totalOperations).toBe(3);
  });

  it('should group metrics by algorithm', () => {
    const metrics = [
      { algorithmUsed: 'standard', executionTime: 10, dataSize: 100, memoryUsage: 1000, cacheHit: false },
      { algorithmUsed: 'standard', executionTime: 15, dataSize: 150, memoryUsage: 1500, cacheHit: false },
      { algorithmUsed: 'optimized', executionTime: 20, dataSize: 200, memoryUsage: 2000, cacheHit: true },
    ];

    metrics.forEach(metric => monitor.recordMetrics(metric));

    const grouped = monitor.getMetricsByAlgorithm();
    expect(grouped.standard.count).toBe(2);
    expect(grouped.standard.avgExecutionTime).toBe(12.5); // (10 + 15) / 2
    expect(grouped.optimized.count).toBe(1);
    expect(grouped.optimized.avgExecutionTime).toBe(20);
  });

  it('should handle empty metrics gracefully', () => {
    const avg = monitor.getAverageMetrics();
    const grouped = monitor.getMetricsByAlgorithm();

    expect(avg.avgExecutionTime).toBe(0);
    expect(avg.avgDataSize).toBe(0);
    expect(avg.avgMemoryUsage).toBe(0);
    expect(avg.cacheHitRate).toBe(0);
    expect(avg.totalOperations).toBe(0);
    expect(Object.keys(grouped)).toHaveLength(0);
  });

  it('should limit metrics history', () => {
    monitor = new SortingPerformanceMonitor();
    monitor['maxMetrics'] = 2;

    // Add more metrics than the limit
    for (let i = 0; i < 5; i++) {
      monitor.recordMetrics({
        algorithmUsed: 'standard',
        executionTime: i,
        dataSize: i * 10,
        memoryUsage: i * 100,
        cacheHit: false,
      });
    }

    const avg = monitor.getAverageMetrics();
    expect(avg.totalOperations).toBeLessThanOrEqual(2);
  });

  it('should clear metrics', () => {
    monitor.recordMetrics({
      algorithmUsed: 'standard',
      executionTime: 10,
      dataSize: 100,
      memoryUsage: 1000,
      cacheHit: false,
    });

    expect(monitor.getAverageMetrics().totalOperations).toBe(1);

    monitor.clear();
    expect(monitor.getAverageMetrics().totalOperations).toBe(0);
  });
});
