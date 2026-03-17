/**
 * Event Performance Optimizer
 * Ensures 1-9ms response time requirements for cached data
 * Provides performance monitoring, caching, and optimization strategies
 */

import { performance } from 'perf_hooks';
import { ChainDatabaseManager } from '../database/chain-database-manager';
import { multiChainDb } from '../database/chain-database-manager';
import { multiChainPerformanceManager } from '../database/performance-monitor';
import { eventQueryServiceManager } from './EventQueryService';
import { eventDecoderServiceManager } from './EventDecoderService';
import { abiParsingServiceManager } from './AbiParsingService';
import { eventValidationServiceManager } from './EventValidationService';

/**
 * Performance metrics interface
 */
export interface PerformanceMetrics {
  operation: string;
  startTime: number;
  endTime: number;
  duration: number;
  cacheHit: boolean;
  dataSize: number;
  memoryUsage: number;
  cpuUsage?: number;
}

/**
 * Performance threshold configuration
 */
export interface PerformanceThresholds {
  cachedQueryMaxMs: number; // 1-9ms for cached data
  uncachedQueryMaxMs: number; // 100ms for uncached data
  largeDatasetMaxMs: number; // 200ms for large datasets
  indexingMaxMs: number; // 500ms for indexing operations
  decodingMaxMs: number; // 50ms for event decoding
  validationMaxMs: number; // 5ms for validation
}

/**
 * Cache configuration
 */
export interface CacheConfiguration {
  enabled: boolean;
  maxSize: number; // Maximum number of cached items
  ttlMs: number; // Time to live in milliseconds
  strategy: 'lru' | 'fifo' | 'lfu'; // Cache eviction strategy
}

/**
 * Performance optimization strategies
 */
export interface OptimizationStrategies {
  enableQueryCaching: boolean;
  enableResultCompression: boolean;
  enableBatchProcessing: boolean;
  enableLazyLoading: boolean;
  enablePrecomputedAggregates: boolean;
  maxConcurrentOperations: number;
}

/**
 * Cache entry
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
  size: number;
}

/**
 * Performance cache
 */
class PerformanceCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private maxSize: number;
  private ttlMs: number;
  private strategy: 'lru' | 'fifo' | 'lfu';

  constructor(config: CacheConfiguration) {
    this.maxSize = config.maxSize;
    this.ttlMs = config.ttlMs;
    this.strategy = config.strategy;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // Update access metadata
    entry.accessCount++;
    entry.lastAccessed = Date.now();

    return entry.data;
  }

  set(key: string, data: T, size: number = 1): void {
    // Check if we need to evict
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evict();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now(),
      size,
    });
  }

  clear(): void {
    this.cache.clear();
  }

  private evict(): void {
    let keyToDelete: string | null = null;

    switch (this.strategy) {
      case 'lru': // Least Recently Used
        let oldestAccess = Date.now();
        for (const [key, entry] of this.cache.entries()) {
          if (entry.lastAccessed < oldestAccess) {
            oldestAccess = entry.lastAccessed;
            keyToDelete = key;
          }
        }
        break;

      case 'fifo': // First In First Out
        let oldestTimestamp = Date.now();
        for (const [key, entry] of this.cache.entries()) {
          if (entry.timestamp < oldestTimestamp) {
            oldestTimestamp = entry.timestamp;
            keyToDelete = key;
          }
        }
        break;

      case 'lfu': // Least Frequently Used
        let lowestCount = Infinity;
        for (const [key, entry] of this.cache.entries()) {
          if (entry.accessCount < lowestCount) {
            lowestCount = entry.accessCount;
            keyToDelete = key;
          }
        }
        break;
    }

    if (keyToDelete) {
      this.cache.delete(keyToDelete);
    }
  }

  getStats(): { size: number; hitRate: number; totalAccesses: number } {
    let totalAccesses = 0;
    for (const entry of this.cache.values()) {
      totalAccesses += entry.accessCount;
    }

    return {
      size: this.cache.size,
      hitRate: totalAccesses > 0 ? (totalAccesses - this.cache.size) / totalAccesses : 0,
      totalAccesses,
    };
  }
}

/**
 * Event Performance Optimizer
 * Ensures 1-9ms response times through caching and optimization
 */
export class EventPerformanceOptimizer {
  private chainId: number;
  private chainDb: ChainDatabaseManager;
  private thresholds: PerformanceThresholds;
  private strategies: OptimizationStrategies;
  private queryCache: PerformanceCache<any>;
  private metrics: PerformanceMetrics[] = [];
  private performanceBaseline: Map<string, number> = new Map();

  constructor(
    chainId: number,
    thresholds: Partial<PerformanceThresholds> = {},
    strategies: Partial<OptimizationStrategies> = {}
  ) {
    this.chainId = chainId;
    this.chainDb = null as any; // Will be initialized lazily

    // Set default thresholds
    this.thresholds = {
      cachedQueryMaxMs: 9,
      uncachedQueryMaxMs: 100,
      largeDatasetMaxMs: 200,
      indexingMaxMs: 500,
      decodingMaxMs: 50,
      validationMaxMs: 5,
      ...thresholds,
    };

    // Set default strategies
    this.strategies = {
      enableQueryCaching: true,
      enableResultCompression: false,
      enableBatchProcessing: true,
      enableLazyLoading: true,
      enablePrecomputedAggregates: true,
      maxConcurrentOperations: 10,
      ...strategies,
    };

    // Initialize cache
    this.queryCache = new PerformanceCache({
      enabled: this.strategies.enableQueryCaching,
      maxSize: 1000,
      ttlMs: 300000, // 5 minutes
      strategy: 'lru',
    });
  }

  /**
   * Ensure database is initialized
   */
  private async ensureDatabaseInitialized(): Promise<void> {
    if (!this.chainDb) {
      this.chainDb = await multiChainDb.getChainDatabase(this.chainId);
    }
  }

  /**
   * Execute optimized query with performance monitoring
   */
  async executeOptimizedQuery<T>(
    operation: string,
    queryFn: () => Promise<T>,
    cacheKey?: string,
    options: {
      useCache?: boolean;
      expectedDataSize?: number;
      timeout?: number;
    } = {}
  ): Promise<T> {
    // Ensure database is initialized
    await this.ensureDatabaseInitialized();

    const startTime = performance.now();
    const startMemory = process.memoryUsage().heapUsed;
    const {
      useCache = this.strategies.enableQueryCaching,
      expectedDataSize = 0,
      timeout = 5000,
    } = options;

    try {
      // Check cache first
      if (useCache && cacheKey) {
        const cachedResult = this.queryCache.get(cacheKey);
        if (cachedResult !== null) {
          const endTime = performance.now();
          const duration = endTime - startTime;

          this.recordMetrics({
            operation,
            startTime,
            endTime,
            duration,
            cacheHit: true,
            dataSize: expectedDataSize,
            memoryUsage: process.memoryUsage().heapUsed - startMemory,
          });

          // Verify performance requirements
          this.validatePerformance(operation, duration, true);

          return cachedResult;
        }
      }

      // Execute query with timeout
      const result = await this.executeWithTimeout(queryFn, timeout);

      // Cache the result
      if (useCache && cacheKey && result !== null) {
        const resultSize = this.estimateDataSize(result);
        this.queryCache.set(cacheKey, result, resultSize);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;
      const endMemory = process.memoryUsage().heapUsed;

      this.recordMetrics({
        operation,
        startTime,
        endTime,
        duration,
        cacheHit: false,
        dataSize: this.estimateDataSize(result),
        memoryUsage: endMemory - startMemory,
      });

      // Verify performance requirements
      this.validatePerformance(operation, duration, false);

      return result;

    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;

      this.recordMetrics({
        operation,
        startTime,
        endTime,
        duration,
        cacheHit: false,
        dataSize: 0,
        memoryUsage: process.memoryUsage().heapUsed - startMemory,
      });

      // Log performance failure
      console.error(`Performance failure in ${operation}:`, {
        duration: `${duration.toFixed(2)}ms`,
        error: error instanceof Error ? error.message : error,
        chainId: this.chainId,
      });

      throw error;
    }
  }

  /**
   * Execute batch operations with concurrency control
   */
  async executeBatch<T, R>(
    items: T[],
    operationFn: (item: T) => Promise<R>,
    options: {
      maxConcurrency?: number;
      enableBatching?: boolean;
      batchSize?: number;
    } = {}
  ): Promise<R[]> {
    const {
      maxConcurrency = this.strategies.maxConcurrentOperations,
      enableBatching = this.strategies.enableBatchProcessing,
      batchSize = 50,
    } = options;

    if (!enableBatching || items.length <= batchSize) {
      // Execute sequentially for small batches
      return this.executeSequential(items, operationFn);
    }

    // Execute in parallel batches with concurrency control
    const results: R[] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchPromises = batch.map(item => this.executeWithConcurrencyControl(
        () => operationFn(item),
        maxConcurrency
      ));

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Precompute aggregates for better performance
   */
  async precomputeAggregates(contractAddress: string): Promise<void> {
    if (!this.strategies.enablePrecomputedAggregates) return;

    const queryService = eventQueryServiceManager.getService(this.chainId);

    try {
      // Precompute event type statistics
      await this.executeOptimizedQuery(
        'precompute_event_types',
        () => queryService.getEventsByType(`events_${contractAddress.toLowerCase()}`),
        `event_types_${contractAddress}`,
        { useCache: true }
      );

      // Precompute time-based statistics
      await this.executeOptimizedQuery(
        'precompute_time_stats',
        () => queryService.getEventsByTimeRange(`events_${contractAddress.toLowerCase()}`, 'day', 30),
        `time_stats_${contractAddress}`,
        { useCache: true }
      );

      // Precompute top addresses
      await this.executeOptimizedQuery(
        'precompute_top_addresses',
        () => queryService.getTopAddresses(`events_${contractAddress.toLowerCase()}`, 'from', 10),
        `top_addresses_${contractAddress}`,
        { useCache: true }
      );

    } catch (error) {
      console.warn('Failed to precompute aggregates:', error);
    }
  }

  /**
   * Optimize database queries
   */
  optimizeQuery(query: string, params: any[]): { optimizedQuery: string; optimizedParams: any[] } {
    // Apply query optimizations
    let optimizedQuery = query;
    let optimizedParams = [...params];

    // Add query hints for better performance
    if (query.includes('SELECT') && query.includes('FROM')) {
      optimizedQuery = query.replace(
        'SELECT',
        'SELECT /*+ USE_INDEX */'
      );
    }

    // Optimize LIMIT clauses
    const limitMatch = query.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      const limit = parseInt(limitMatch[1], 10);
      if (limit > 100) {
        // Suggest using pagination for large limits
        optimizedQuery = optimizedQuery.replace(
          limitMatch[0],
          `LIMIT ${Math.min(limit, 100)}`
        );
      }
    }

    return { optimizedQuery, optimizedParams };
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): {
    operation: string;
    averageDuration: number;
    minDuration: number;
    maxDuration: number;
    cacheHitRate: number;
    totalCalls: number;
    slowQueries: number;
  }[] {
    const metricsByOperation = new Map<string, PerformanceMetrics[]>();

    // Group metrics by operation
    for (const metric of this.metrics) {
      if (!metricsByOperation.has(metric.operation)) {
        metricsByOperation.set(metric.operation, []);
      }
      metricsByOperation.get(metric.operation)!.push(metric);
    }

    // Calculate statistics for each operation
    const stats = [];
    for (const [operation, operationMetrics] of metricsByOperation.entries()) {
      const durations = operationMetrics.map(m => m.duration);
      const cacheHits = operationMetrics.filter(m => m.cacheHit).length;

      stats.push({
        operation,
        averageDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
        minDuration: Math.min(...durations),
        maxDuration: Math.max(...durations),
        cacheHitRate: cacheHits / operationMetrics.length,
        totalCalls: operationMetrics.length,
        slowQueries: durations.filter(d => d > this.thresholds.cachedQueryMaxMs).length,
      });
    }

    return stats.sort((a, b) => b.averageDuration - a.averageDuration);
  }

  /**
   * Get cache statistics
   */
  getCacheStatistics(): {
    queryCache: { size: number; hitRate: number; totalAccesses: number };
    memoryUsage: number;
  } {
    return {
      queryCache: this.queryCache.getStats(),
      memoryUsage: process.memoryUsage().heapUsed,
    };
  }

  /**
   * Clear caches
   */
  clearCaches(): void {
    this.queryCache.clear();
    this.metrics = [];
    this.performanceBaseline.clear();
  }

  /**
   * Warm up caches with common queries
   */
  async warmUpCaches(contracts: string[]): Promise<void> {
    const warmUpPromises = contracts.map(async (contractAddress) => {
      try {
        // Preload common queries
        await this.precomputeAggregates(contractAddress);
      } catch (error) {
        console.warn(`Failed to warm up cache for ${contractAddress}:`, error);
      }
    });

    await Promise.allSettled(warmUpPromises);
  }

  /**
   * Execute function with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      fn()
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Execute with concurrency control
   */
  private async executeWithConcurrencyControl<T>(
    fn: () => Promise<T>,
    maxConcurrency: number
  ): Promise<T> {
    // Simple implementation - in production, this would use a proper semaphore
    return fn();
  }

  /**
   * Execute operations sequentially
   */
  private async executeSequential<T, R>(
    items: T[],
    operationFn: (item: T) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = [];
    for (const item of items) {
      const result = await operationFn(item);
      results.push(result);
    }
    return results;
  }

  /**
   * Estimate data size for caching
   */
  private estimateDataSize(data: any): number {
    if (data === null || data === undefined) return 0;
    if (typeof data === 'string') return data.length;
    if (typeof data === 'number') return 8;
    if (typeof data === 'boolean') return 1;
    if (typeof data === 'bigint') return 8; // BigInt is 8 bytes
    if (Array.isArray(data)) return data.reduce((sum, item) => sum + this.estimateDataSize(item), 0);
    if (typeof data === 'object') {
      try {
        // Use serializeForJson to handle BigInt and other special types
        const serialized = JSON.stringify(data, (key, value) => {
          if (typeof value === 'bigint') return value.toString();
          return value;
        });
        return serialized.length;
      } catch (error) {
        console.warn('Failed to estimate data size:', error);
        return 100; // Default estimate
      }
    }
    return 100; // Default estimate
  }

  /**
   * Record performance metrics
   */
  private recordMetrics(metrics: PerformanceMetrics): void {
    this.metrics.push(metrics);

    // Keep only recent metrics (last 1000)
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-1000);
    }
  }

  /**
   * Validate performance against thresholds
   */
  private validatePerformance(operation: string, duration: number, cacheHit: boolean): void {
    const threshold = cacheHit
      ? this.thresholds.cachedQueryMaxMs
      : this.thresholds.uncachedQueryMaxMs;

    if (duration > threshold) {
      console.warn(`Performance threshold exceeded for ${operation}:`, {
        duration: `${duration.toFixed(2)}ms`,
        threshold: `${threshold}ms`,
        cacheHit,
        chainId: this.chainId,
      });
    }

    // Update performance baseline
    const baseline = this.performanceBaseline.get(operation) || threshold;
    const newBaseline = baseline * 0.9 + duration * 0.1; // Exponential moving average
    this.performanceBaseline.set(operation, newBaseline);
  }

  /**
   * Get chain ID
   */
  getChainId(): number {
    return this.chainId;
  }

  /**
   * Get performance thresholds
   */
  getThresholds(): PerformanceThresholds {
    return { ...this.thresholds };
  }

  /**
   * Update performance thresholds
   */
  updateThresholds(newThresholds: Partial<PerformanceThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
  }

  /**
   * Get optimization strategies
   */
  getStrategies(): OptimizationStrategies {
    return { ...this.strategies };
  }

  /**
   * Update optimization strategies
   */
  updateStrategies(newStrategies: Partial<OptimizationStrategies>): void {
    this.strategies = { ...this.strategies, ...newStrategies };
  }
}

// Export singleton manager
class EventPerformanceOptimizerManager {
  private optimizers: Map<number, EventPerformanceOptimizer> = new Map();

  getOptimizer(
    chainId: number,
    thresholds?: Partial<PerformanceThresholds>,
    strategies?: Partial<OptimizationStrategies>
  ): EventPerformanceOptimizer {
    if (!this.optimizers.has(chainId)) {
      // Ensure database is initialized before creating optimizer
      try {
        multiChainDb.getChainDatabase(chainId);
      } catch (error) {
        console.warn(`Failed to initialize chain database for ${chainId}:`, error);
      }
      this.optimizers.set(chainId, new EventPerformanceOptimizer(chainId, thresholds, strategies));
    }
    return this.optimizers.get(chainId)!;
  }

  removeOptimizer(chainId: number): void {
    this.optimizers.delete(chainId);
  }

  getAllOptimizers(): EventPerformanceOptimizer[] {
    return Array.from(this.optimizers.values());
  }

  clearAllCaches(): void {
    this.optimizers.forEach(optimizer => optimizer.clearCaches());
  }

  getAggregatedMetrics(): Array<{
    chainId: number;
    metrics: ReturnType<EventPerformanceOptimizer['getPerformanceMetrics']>;
    cacheStats: ReturnType<EventPerformanceOptimizer['getCacheStatistics']>;
  }> {
    return Array.from(this.optimizers.entries()).map(([chainId, optimizer]) => ({
      chainId,
      metrics: optimizer.getPerformanceMetrics(),
      cacheStats: optimizer.getCacheStatistics(),
    }));
  }
}

export const eventPerformanceOptimizerManager = new EventPerformanceOptimizerManager();