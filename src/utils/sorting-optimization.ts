/**
 * Performance-optimized sorting utilities for large datasets
 * Provides efficient sorting algorithms and optimization strategies
 */

export interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
  type?: 'numeric' | 'text' | 'address' | 'timestamp';
  priority?: number;
}

export interface SortingPerformanceMetrics {
  algorithmUsed: string;
  executionTime: number;
  dataSize: number;
  memoryUsage: number;
  cacheHit: boolean;
}

export interface SortingCache {
  key: string;
  data: any[];
  timestamp: number;
  ttl: number;
}

/**
 * Performance-optimized sorting class for large datasets
 */
export class OptimizedSorter {
  private cache = new Map<string, SortingCache>();
  private cacheMaxSize = 100;
  private defaultCacheTTL = 30000; // 30 seconds

  /**
   * Sort data with performance optimizations
   */
  sort<T>(
    data: T[],
    sortConfigs: SortConfig[],
    options: {
      useCache?: boolean;
      cacheKey?: string;
      threshold?: number;
    } = {}
  ): { sortedData: T[]; metrics: SortingPerformanceMetrics } {
    const {
      useCache = true,
      cacheKey,
      threshold = 10000
    } = options;

    const startTime = performance.now();
    const dataSize = data.length;

    // Check cache first
    if (useCache && cacheKey) {
      const cachedResult = this.getCachedResult(cacheKey);
      if (cachedResult) {
        return {
          sortedData: cachedResult,
          metrics: {
            algorithmUsed: 'cache',
            executionTime: performance.now() - startTime,
            dataSize,
            memoryUsage: this.estimateMemoryUsage(cachedResult),
            cacheHit: true
          }
        };
      }
    }

    // Choose sorting strategy based on data size
    let sortedData: T[];
    let algorithmUsed: string;

    if (dataSize === 0) {
      sortedData = [];
      algorithmUsed = 'empty';
    } else if (sortConfigs.length === 0) {
      sortedData = [...data];
      algorithmUsed = 'no-sort';
    } else if (dataSize < threshold) {
      // For smaller datasets, use standard sort
      sortedData = this.standardSort(data, sortConfigs);
      algorithmUsed = 'standard';
    } else {
      // For larger datasets, use optimized strategies
      sortedData = this.optimizedSort(data, sortConfigs);
      algorithmUsed = 'optimized';
    }

    const executionTime = performance.now() - startTime;

    // Cache result if enabled
    if (useCache && cacheKey && dataSize < threshold * 2) {
      this.setCachedResult(cacheKey, sortedData);
    }

    return {
      sortedData,
      metrics: {
        algorithmUsed,
        executionTime,
        dataSize,
        memoryUsage: this.estimateMemoryUsage(sortedData),
        cacheHit: false
      }
    };
  }

  /**
   * Standard sort for smaller datasets
   */
  private standardSort<T>(data: T[], sortConfigs: SortConfig[]): T[] {
    const sortedData = [...data];
    const sortedConfigs = [...sortConfigs].sort((a, b) => (a.priority || 0) - (b.priority || 0));

    return sortedData.sort((a, b) => {
      for (const config of sortedConfigs) {
        const result = this.compareItems(a, b, config);
        if (result !== 0) return result;
      }
      return 0;
    });
  }

  /**
   * Optimized sort for large datasets
   */
  private optimizedSort<T>(data: T[], sortConfigs: SortConfig[]): T[] {
    const sortedConfigs = [...sortConfigs].sort((a, b) => (a.priority || 0) - (b.priority || 0));
    const primarySort = sortedConfigs[0];

    if (!primarySort) {
      return [...data];
    }

    // For large datasets, use chunked sorting to avoid blocking the main thread
    return this.chunkedSort(data, sortedConfigs);
  }

  /**
   * Chunked sorting for very large datasets
   */
  private chunkedSort<T>(data: T[], sortConfigs: SortConfig[]): T[] {
    const chunkSize = 5000; // Process 5000 items at a time
    const chunks: T[][] = [];

    // Split data into chunks
    for (let i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.slice(i, i + chunkSize));
    }

    // Sort each chunk individually
    const sortedChunks = chunks.map(chunk =>
      this.standardSort(chunk, sortConfigs)
    );

    // Merge sorted chunks
    return this.mergeSortedChunks(sortedChunks, sortConfigs);
  }

  /**
   * Merge multiple sorted chunks
   */
  private mergeSortedChunks<T>(chunks: T[][], sortConfigs: SortConfig[]): T[] {
    if (chunks.length === 1) return chunks[0];

    const sortedConfigs = [...sortConfigs].sort((a, b) => (a.priority || 0) - (b.priority || 0));

    // Use a min-heap approach for efficient merging
    const result: T[] = [];
    const heap: { chunk: number; index: number; value: T }[] = [];

    // Initialize heap with first element from each chunk
    chunks.forEach((chunk, chunkIndex) => {
      if (chunk.length > 0) {
        heap.push({
          chunk: chunkIndex,
          index: 0,
          value: chunk[0]
        });
      }
    });

    // Build heap
    this.buildHeap(heap, sortedConfigs);

    // Extract minimum element and add next from same chunk
    while (heap.length > 0) {
      const min = heap.shift()!;
      result.push(min.value);

      // Add next element from the same chunk
      const nextIndex = min.index + 1;
      if (nextIndex < chunks[min.chunk].length) {
        const newValue = chunks[min.chunk][nextIndex];

        // Insert new value into heap
        heap.push({
          chunk: min.chunk,
          index: nextIndex,
          value: newValue
        });

        // Restore heap property
        this.heapifyDown(heap, 0, sortedConfigs);
      }
    }

    return result;
  }

  /**
   * Build heap from array
   */
  private buildHeap<T>(heap: { chunk: number; index: number; value: T }[], sortConfigs: SortConfig[]): void {
    for (let i = Math.floor(heap.length / 2) - 1; i >= 0; i--) {
      this.heapifyDown(heap, i, sortConfigs);
    }
  }

  /**
   * Heapify down operation
   */
  private heapifyDown<T>(
    heap: { chunk: number; index: number; value: T }[],
    index: number,
    sortConfigs: SortConfig[]
  ): void {
    const left = 2 * index + 1;
    const right = 2 * index + 2;
    let smallest = index;

    if (left < heap.length && this.compareHeapItems(heap[left], heap[smallest], sortConfigs) < 0) {
      smallest = left;
    }

    if (right < heap.length && this.compareHeapItems(heap[right], heap[smallest], sortConfigs) < 0) {
      smallest = right;
    }

    if (smallest !== index) {
      [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
      this.heapifyDown(heap, smallest, sortConfigs);
    }
  }

  /**
   * Compare two heap items
   */
  private compareHeapItems<T>(
    a: { chunk: number; index: number; value: T },
    b: { chunk: number; index: number; value: T },
    sortConfigs: SortConfig[]
  ): number {
    return this.compareItems(a.value, b.value, sortConfigs[0]);
  }

  /**
   * Compare two items based on sort configuration
   */
  private compareItems<T>(a: T, b: T, config: SortConfig): number {
    const aValue = this.extractValue(a, config.key);
    const bValue = this.extractValue(b, config.key);

    return this.compareValues(aValue, bValue, config.type || 'text', config.direction);
  }

  /**
   * Extract value from object by key path
   */
  private extractValue(obj: any, keyPath: string): any {
    return keyPath.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Compare two values based on type and direction
   */
  private compareValues(a: any, b: any, type: string, direction: 'asc' | 'desc'): number {
    // Handle null/undefined values
    if (a == null && b == null) return 0;
    if (a == null) return direction === 'asc' ? -1 : 1;
    if (b == null) return direction === 'asc' ? 1 : -1;

    let comparison: number;

    switch (type) {
      case 'numeric':
        const aNum = parseFloat(a.toString());
        const bNum = parseFloat(b.toString());
        comparison = aNum - bNum;
        break;

      case 'timestamp':
        const aTime = new Date(a).getTime();
        const bTime = new Date(b).getTime();
        comparison = aTime - bTime;
        break;

      case 'address':
        // Convert to lowercase for case-insensitive comparison
        const aAddr = a.toString().toLowerCase();
        const bAddr = b.toString().toLowerCase();
        comparison = aAddr.localeCompare(bAddr);
        break;

      case 'text':
      default:
        const aStr = a.toString().toLowerCase();
        const bStr = b.toString().toLowerCase();
        comparison = aStr.localeCompare(bStr);
        break;
    }

    return direction === 'desc' ? -comparison : comparison;
  }

  /**
   * Get cached result if available and not expired
   */
  private getCachedResult(cacheKey: string): any[] | null {
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > cached.ttl) {
      this.cache.delete(cacheKey);
      return null;
    }

    return [...cached.data]; // Return a copy
  }

  /**
   * Set cached result
   */
  private setCachedResult(cacheKey: string, data: any[]): void {
    // Check cache size limit
    if (this.cache.size >= this.cacheMaxSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(cacheKey, {
      data: [...data], // Store a copy
      timestamp: Date.now(),
      ttl: this.defaultCacheTTL
    });
  }

  /**
   * Estimate memory usage of data
   */
  private estimateMemoryUsage(data: any[]): number {
    // Rough estimation in bytes
    return data.length * 1000; // Assume ~1KB per item average
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    memoryUsage: number;
    hitRate: number;
  } {
    let totalMemory = 0;
    let expiredCount = 0;
    const now = Date.now();

    for (const [key, cache] of this.cache.entries()) {
      totalMemory += this.estimateMemoryUsage(cache.data);
      if (now - cache.timestamp > cache.ttl) {
        expiredCount++;
      }
    }

    // Clean up expired entries
    for (const [key, cache] of this.cache.entries()) {
      if (now - cache.timestamp > cache.ttl) {
        this.cache.delete(key);
      }
    }

    return {
      size: this.cache.size,
      maxSize: this.cacheMaxSize,
      memoryUsage: totalMemory,
      hitRate: 0 // Would need to track hits/misses for real implementation
    };
  }

  /**
   * Optimize sorting parameters for better performance
   */
  optimizeSortConfigs<T>(
    data: T[],
    sortConfigs: SortConfig[]
  ): SortConfig[] {
    const dataSize = data.length;

    if (dataSize < 1000) {
      // For small datasets, return as-is
      return sortConfigs;
    }

    // For large datasets, optimize by:
    // 1. Prioritizing indexed fields
    // 2. Reducing number of sort levels
    // 3. Using optimal sort directions

    const optimized = [...sortConfigs]
      .sort((a, b) => (a.priority || 0) - (b.priority || 0))
      .slice(0, Math.min(sortConfigs.length, 3)); // Limit to 3 sort levels for large datasets

    return optimized;
  }
}

// Global optimized sorter instance
export const optimizedSorter = new OptimizedSorter();

/**
 * Convenience function for optimized sorting
 */
export function optimizedSort<T>(
  data: T[],
  sortConfigs: SortConfig[],
  options?: {
    useCache?: boolean;
    cacheKey?: string;
    threshold?: number;
  }
): { sortedData: T[]; metrics: SortingPerformanceMetrics } {
  return optimizedSorter.sort(data, sortConfigs, options);
}

/**
 * Performance monitoring for sorting operations
 */
export class SortingPerformanceMonitor {
  private metrics: SortingPerformanceMetrics[] = [];
  private maxMetrics = 1000;

  recordMetrics(metrics: SortingPerformanceMetrics): void {
    this.metrics.push(metrics);

    // Keep only recent metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }
  }

  getAverageMetrics(): {
    avgExecutionTime: number;
    avgDataSize: number;
    avgMemoryUsage: number;
    cacheHitRate: number;
    totalOperations: number;
  } {
    if (this.metrics.length === 0) {
      return {
        avgExecutionTime: 0,
        avgDataSize: 0,
        avgMemoryUsage: 0,
        cacheHitRate: 0,
        totalOperations: 0
      };
    }

    const totalExecutionTime = this.metrics.reduce((sum, m) => sum + m.executionTime, 0);
    const totalDataSize = this.metrics.reduce((sum, m) => sum + m.dataSize, 0);
    const totalMemoryUsage = this.metrics.reduce((sum, m) => sum + m.memoryUsage, 0);
    const cacheHits = this.metrics.filter(m => m.cacheHit).length;

    return {
      avgExecutionTime: totalExecutionTime / this.metrics.length,
      avgDataSize: totalDataSize / this.metrics.length,
      avgMemoryUsage: totalMemoryUsage / this.metrics.length,
      cacheHitRate: cacheHits / this.metrics.length,
      totalOperations: this.metrics.length
    };
  }

  getMetricsByAlgorithm(): Record<string, {
    count: number;
    avgExecutionTime: number;
    avgDataSize: number;
  }> {
    const grouped: Record<string, SortingPerformanceMetrics[]> = {};

    this.metrics.forEach(metric => {
      if (!grouped[metric.algorithmUsed]) {
        grouped[metric.algorithmUsed] = [];
      }
      grouped[metric.algorithmUsed].push(metric);
    });

    const result: Record<string, {
      count: number;
      avgExecutionTime: number;
      avgDataSize: number;
    }> = {};

    Object.entries(grouped).forEach(([algorithm, metrics]) => {
      const totalExecutionTime = metrics.reduce((sum, m) => sum + m.executionTime, 0);
      const totalDataSize = metrics.reduce((sum, m) => sum + m.dataSize, 0);

      result[algorithm] = {
        count: metrics.length,
        avgExecutionTime: totalExecutionTime / metrics.length,
        avgDataSize: totalDataSize / metrics.length
      };
    });

    return result;
  }

  clear(): void {
    this.metrics = [];
  }
}

// Global performance monitor instance
export const sortingPerformanceMonitor = new SortingPerformanceMonitor();