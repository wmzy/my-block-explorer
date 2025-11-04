/**
 * Event Search Performance Optimization Utilities
 * Provides efficient filtering, caching, and performance monitoring for event searches
 */

import { EventFilters, FormattedEventData, PaginationParams } from '../types/events';

export interface SearchCacheEntry {
  key: string;
  data: FormattedEventData[];
  total: number;
  timestamp: number;
  ttl: number;
  filters: EventFilters;
  pagination: PaginationParams;
}

export interface SearchPerformanceMetrics {
  operation: 'filter' | 'sort' | 'paginate' | 'cache' | 'api';
  executionTime: number;
  dataSize: number;
  cacheHit: boolean;
  memoryUsage: number;
  algorithm?: string;
}

export interface SearchOptimizationOptions {
  enableCache?: boolean;
  cacheTTL?: number;
  maxCacheSize?: number;
  enableClientSideFiltering?: boolean;
  clientSideThreshold?: number;
  enablePerformanceMonitoring?: boolean;
}

/**
 * Performance-optimized event search manager
 */
export class EventSearchOptimizer {
  private cache = new Map<string, SearchCacheEntry>();
  private performanceMetrics: SearchPerformanceMetrics[] = [];
  private options: Required<SearchOptimizationOptions>;

  constructor(options: SearchOptimizationOptions = {}) {
    this.options = {
      enableCache: options.enableCache ?? true,
      cacheTTL: options.cacheTTL ?? 300000, // 5 minutes
      maxCacheSize: options.maxCacheSize ?? 100,
      enableClientSideFiltering: options.enableClientSideFiltering ?? true,
      clientSideThreshold: options.clientSideThreshold ?? 10000,
      enablePerformanceMonitoring: options.enablePerformanceMonitoring ?? true,
    };
  }

  /**
   * Search events with performance optimizations
   */
  async searchEvents(
    events: FormattedEventData[],
    filters: EventFilters,
    pagination: PaginationParams
  ): Promise<{
    events: FormattedEventData[];
    total: number;
    metrics: SearchPerformanceMetrics[];
  }> {
    const startTime = performance.now();
    const metrics: SearchPerformanceMetrics[] = [];

    try {
      // Step 1: Check cache first
      if (this.options.enableCache) {
        const cacheKey = this.generateCacheKey(filters, pagination);
        const cachedResult = this.getCachedResult(cacheKey);

        if (cachedResult) {
          const cacheMetric: SearchPerformanceMetrics = {
            operation: 'cache',
            executionTime: performance.now() - startTime,
            dataSize: cachedResult.data.length,
            cacheHit: true,
            memoryUsage: this.estimateMemoryUsage(cachedResult.data),
            algorithm: 'cache'
          };
          metrics.push(cacheMetric);

          if (this.options.enablePerformanceMonitoring) {
            this.recordMetrics(cacheMetric);
          }

          return {
            events: cachedResult.data,
            total: cachedResult.total,
            metrics
          };
        }
      }

      // Step 2: Apply filters
      let filteredEvents = events;
      let filterMetrics: SearchPerformanceMetrics | null = null;

      if (Object.keys(filters).length > 0) {
        const filterStartTime = performance.now();

        // Choose filtering strategy based on data size
        if (events.length <= this.options.clientSideThreshold) {
          filteredEvents = this.clientSideFilter(events, filters);
          filterMetrics = {
            operation: 'filter',
            executionTime: performance.now() - filterStartTime,
            dataSize: events.length,
            cacheHit: false,
            memoryUsage: this.estimateMemoryUsage(filteredEvents),
            algorithm: 'client-side'
          };
        } else {
          // For large datasets, we'd typically delegate to server-side filtering
          // For now, we'll still use client-side but with optimizations
          filteredEvents = this.optimizedClientSideFilter(events, filters);
          filterMetrics = {
            operation: 'filter',
            executionTime: performance.now() - filterStartTime,
            dataSize: events.length,
            cacheHit: false,
            memoryUsage: this.estimateMemoryUsage(filteredEvents),
            algorithm: 'optimized-client-side'
          };
        }

        if (this.options.enablePerformanceMonitoring) {
          this.recordMetrics(filterMetrics);
        }
        metrics.push(filterMetrics);
      }

      // Step 3: Apply pagination
      const paginatedStartTime = performance.now();
      const paginatedEvents = this.applyPagination(filteredEvents, pagination);
      const paginatedMetrics: SearchPerformanceMetrics = {
        operation: 'paginate',
        executionTime: performance.now() - paginatedStartTime,
        dataSize: filteredEvents.length,
        cacheHit: false,
        memoryUsage: this.estimateMemoryUsage(paginatedEvents),
        algorithm: 'slice'
      };

      if (this.options.enablePerformanceMonitoring) {
        this.recordMetrics(paginatedMetrics);
      }
      metrics.push(paginatedMetrics);

      // Step 4: Cache result
      if (this.options.enableCache && filteredEvents.length < this.options.clientSideThreshold * 2) {
        const cacheKey = this.generateCacheKey(filters, pagination);
        this.setCachedResult(cacheKey, paginatedEvents, filteredEvents.length, filters, pagination);
      }

      const totalExecutionTime = performance.now() - startTime;
      const totalMetric: SearchPerformanceMetrics = {
        operation: 'api',
        executionTime: totalExecutionTime,
        dataSize: events.length,
        cacheHit: false,
        memoryUsage: this.estimateMemoryUsage(paginatedEvents),
        algorithm: 'complete-search'
      };

      return {
        events: paginatedEvents,
        total: filteredEvents.length,
        metrics: [...metrics, totalMetric]
      };

    } catch (error) {
      const errorMetric: SearchPerformanceMetrics = {
        operation: 'api',
        executionTime: performance.now() - startTime,
        dataSize: events.length,
        cacheHit: false,
        memoryUsage: 0,
        algorithm: 'error'
      };

      if (this.options.enablePerformanceMonitoring) {
        this.recordMetrics(errorMetric);
      }

      throw error;
    }
  }

  /**
   * Client-side filtering for smaller datasets
   */
  private clientSideFilter(events: FormattedEventData[], filters: EventFilters): FormattedEventData[] {
    return events.filter(event => this.matchesFilters(event, filters));
  }

  /**
   * Optimized client-side filtering for larger datasets
   */
  private async optimizedClientSideFilter(events: FormattedEventData[], filters: EventFilters): Promise<FormattedEventData[]> {
    // Use chunked processing to avoid blocking the main thread
    const chunkSize = 5000;
    const results: FormattedEventData[] = [];

    for (let i = 0; i < events.length; i += chunkSize) {
      const chunk = events.slice(i, i + chunkSize);
      const filteredChunk = chunk.filter(event => this.matchesFilters(event, filters));
      results.push(...filteredChunk);

      // Yield control to browser periodically
      if (i % (chunkSize * 2) === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    return results;
  }

  /**
   * Check if event matches filters
   */
  private matchesFilters(event: FormattedEventData, filters: EventFilters): boolean {
    // Event name filter
    if (filters.eventName && event.eventSignature !== filters.eventName) {
      return false;
    }

    // Block range filter
    if (filters.fromBlock !== undefined && Number(event.blockNumber) < Number(filters.fromBlock)) {
      return false;
    }
    if (filters.toBlock !== undefined && Number(event.blockNumber) > Number(filters.toBlock)) {
      return false;
    }

    // Timestamp range filter
    if (filters.fromTimestamp !== undefined && event.blockTimestamp < filters.fromTimestamp) {
      return false;
    }
    if (filters.toTimestamp !== undefined && event.blockTimestamp > filters.toTimestamp) {
      return false;
    }

    // Dynamic parameter filters
    for (const [key, value] of Object.entries(filters)) {
      if (['eventName', 'fromBlock', 'toBlock', 'fromTimestamp', 'toTimestamp'].includes(key)) {
        continue; // Skip special filters
      }

      const eventValue = event[key];
      if (eventValue === undefined) continue;

      if (!this.matchesFilterValue(eventValue, value)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if specific value matches filter value
   */
  private matchesFilterValue(eventValue: any, filterValue: any): boolean {
    if (filterValue === null || filterValue === undefined || filterValue === '') {
      return true;
    }

    // Handle range filters
    if (typeof filterValue === 'object' && (filterValue.gte !== undefined || filterValue.lte !== undefined)) {
      const numEventValue = Number(eventValue);
      if (filterValue.gte !== undefined && numEventValue < Number(filterValue.gte)) {
        return false;
      }
      if (filterValue.lte !== undefined && numEventValue > Number(filterValue.lte)) {
        return false;
      }
      return true;
    }

    // Handle LIKE filters
    if (typeof filterValue === 'object' && filterValue.like) {
      const pattern = filterValue.like.replace(/%/g, '.*');
      const regex = new RegExp(pattern, filterValue.caseInsensitive ? 'i' : '');
      return regex.test(String(eventValue));
    }

    // Handle exact matches
    return String(eventValue).toLowerCase() === String(filterValue).toLowerCase();
  }

  /**
   * Apply pagination to filtered results
   */
  private applyPagination(events: FormattedEventData[], pagination: PaginationParams): FormattedEventData[] {
    const { limit, offset = 0 } = pagination;
    return events.slice(offset, offset + limit);
  }

  /**
   * Generate cache key from filters and pagination
   */
  private generateCacheKey(filters: EventFilters, pagination: PaginationParams): string {
    const filterString = JSON.stringify(filters, Object.keys(filters).sort());
    const paginationString = JSON.stringify(pagination);
    return btoa(`${filterString}:${paginationString}`).replace(/[^a-zA-Z0-9]/g, '');
  }

  /**
   * Get cached result if available and not expired
   */
  private getCachedResult(cacheKey: string): SearchCacheEntry | null {
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > cached.ttl) {
      this.cache.delete(cacheKey);
      return null;
    }

    return {
      ...cached,
      data: [...cached.data] // Return a copy
    };
  }

  /**
   * Set cached result
   */
  private setCachedResult(
    cacheKey: string,
    data: FormattedEventData[],
    total: number,
    filters: EventFilters,
    pagination: PaginationParams
  ): void {
    // Check cache size limit
    if (this.cache.size >= this.options.maxCacheSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(cacheKey, {
      data: [...data], // Store a copy
      total,
      timestamp: Date.now(),
      ttl: this.options.cacheTTL,
      filters: { ...filters },
      pagination: { ...pagination }
    });
  }

  /**
   * Estimate memory usage of data
   */
  private estimateMemoryUsage(data: FormattedEventData[]): number {
    // Rough estimation in bytes
    return data.length * 500; // Assume ~500 bytes per event average
  }

  /**
   * Record performance metrics
   */
  private recordMetrics(metrics: SearchPerformanceMetrics): void {
    this.performanceMetrics.push(metrics);

    // Keep only recent metrics (last 1000)
    if (this.performanceMetrics.length > 1000) {
      this.performanceMetrics = this.performanceMetrics.slice(-1000);
    }
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(): {
    totalOperations: number;
    averageExecutionTime: number;
    cacheHitRate: number;
    operationBreakdown: Record<string, {
      count: number;
      avgTime: number;
      avgDataSize: number;
    }>;
    cacheStats: {
      size: number;
      maxSize: number;
      hitRate: number;
      memoryUsage: number;
    };
  } {
    const totalOps = this.performanceMetrics.length;
    const cacheHits = this.performanceMetrics.filter(m => m.cacheHit).length;
    const totalTime = this.performanceMetrics.reduce((sum, m) => sum + m.executionTime, 0);

    // Operation breakdown
    const operationBreakdown: Record<string, {
      count: number;
      avgTime: number;
      avgDataSize: number;
    }> = {};

    this.performanceMetrics.forEach(metric => {
      if (!operationBreakdown[metric.operation]) {
        operationBreakdown[metric.operation] = {
          count: 0,
          avgTime: 0,
          avgDataSize: 0
        };
      }

      const op = operationBreakdown[metric.operation];
      op.count++;
      op.avgTime = (op.avgTime * (op.count - 1) + metric.executionTime) / op.count;
      op.avgDataSize = (op.avgDataSize * (op.count - 1) + metric.dataSize) / op.count;
    });

    // Cache statistics
    const cacheStats = {
      size: this.cache.size,
      maxSize: this.options.maxCacheSize,
      hitRate: totalOps > 0 ? cacheHits / totalOps : 0,
      memoryUsage: Array.from(this.cache.values())
        .reduce((total, entry) => total + this.estimateMemoryUsage(entry.data), 0)
    };

    return {
      totalOperations: totalOps,
      averageExecutionTime: totalOps > 0 ? totalTime / totalOps : 0,
      cacheHitRate: totalOps > 0 ? cacheHits / totalOps : 0,
      operationBreakdown,
      cacheStats
    };
  }

  /**
   * Clear cache and metrics
   */
  clear(): void {
    this.cache.clear();
    this.performanceMetrics = [];
  }

  /**
   * Optimize search parameters for better performance
   */
  optimizeSearchParameters(
    filters: EventFilters,
    pagination: PaginationParams,
    totalEvents: number
  ): {
    optimizedFilters: EventFilters;
    optimizedPagination: PaginationParams;
    strategy: 'client-side' | 'server-side' | 'hybrid';
  } {
    // Determine optimal strategy
    let strategy: 'client-side' | 'server-side' | 'hybrid';

    if (totalEvents <= this.options.clientSideThreshold) {
      strategy = 'client-side';
    } else if (Object.keys(filters).length === 0 && pagination.limit! >= 1000) {
      strategy = 'server-side';
    } else {
      strategy = 'hybrid';
    }

    // Optimize pagination
    const optimizedPagination = { ...pagination };
    if (strategy === 'client-side' && pagination.limit! > totalEvents) {
      optimizedPagination.limit = totalEvents;
    }

    // Optimize filters
    const optimizedFilters = { ...filters };

    // Remove redundant filters
    if (optimizedFilters.fromBlock !== undefined &&
        optimizedFilters.toBlock !== undefined &&
        Number(optimizedFilters.fromBlock) > Number(optimizedFilters.toBlock)) {
      delete optimizedFilters.fromBlock;
      delete optimizedFilters.toBlock;
    }

    return {
      optimizedFilters,
      optimizedPagination,
      strategy
    };
  }
}

// Global optimizer instance
export const eventSearchOptimizer = new EventSearchOptimizer();

/**
 * Convenience function for optimized event search
 */
export async function searchEventsOptimized(
  events: FormattedEventData[],
  filters: EventFilters,
  pagination: PaginationParams,
  options?: SearchOptimizationOptions
): Promise<{
  events: FormattedEventData[];
  total: number;
  metrics: SearchPerformanceMetrics[];
}> {
  const optimizer = new EventSearchOptimizer(options);
  return optimizer.searchEvents(events, filters, pagination);
}