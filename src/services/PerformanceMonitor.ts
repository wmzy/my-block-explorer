/**
 * Performance monitoring service for blockchain explorer
 * Ensures 1-9ms response time targets for cached data
 */

interface PerformanceMetrics {
  operation: string;
  duration: number;
  timestamp: Date;
  chainId?: number;
  success: boolean;
  errorType?: string;
  cacheHit?: boolean;
  dataSize?: number;
  metadata?: Record<string, any>;
}

interface PerformanceStats {
  operation: string;
  totalCalls: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  successRate: number;
  errorRate: number;
  cacheHitRate: number;
  callsPerSecond: number;
}

export class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private maxMetrics: number = 10000;
  private reportInterval: number = 60000; // 1 minute
  private reportTimer?: NodeJS.Timeout;
  private listeners: Array<(stats: PerformanceStats[]) => void> = [];

  constructor(maxMetrics: number = 10000) {
    this.maxMetrics = maxMetrics;
    this.startReporting();
  }

  /**
   * Record a performance metric
   */
  record(metric: PerformanceMetrics): void {
    this.metrics.push(metric);

    // Keep metrics array under limit
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    // Check if we're hitting performance targets
    if (metric.duration > 9) {
      console.warn(`  Slow operation detected: ${metric.operation} took ${metric.duration}ms`);
    }

    // Log errors
    if (!metric.success) {
      console.error(`L Operation failed: ${metric.operation} - ${metric.errorType}`);
    }
  }

  /**
   * Execute an operation with automatic performance tracking
   */
  async executeTracked<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: {
      chainId?: number;
      cacheHit?: boolean;
      expectedDataSize?: number;
    }
  ): Promise<T> {
    const startTime = performance.now();
    const timestamp = new Date();

    try {
      const result = await fn();
      const duration = performance.now() - startTime;

      this.record({
        operation,
        duration,
        timestamp,
        chainId: metadata?.chainId,
        success: true,
        cacheHit: metadata?.cacheHit,
        dataSize: metadata?.expectedDataSize,
        metadata
      });

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;

      this.record({
        operation,
        duration,
        timestamp,
        chainId: metadata?.chainId,
        success: false,
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        metadata
      });

      throw error;
    }
  }

  /**
   * Get performance statistics for an operation
   */
  getStats(operation?: string, timeWindow?: number): PerformanceStats[] {
    const now = Date.now();
    const cutoff = timeWindow ? now - timeWindow : 0;

    let filteredMetrics = this.metrics.filter(m => m.timestamp.getTime() > cutoff);

    if (operation) {
      filteredMetrics = filteredMetrics.filter(m => m.operation === operation);
    }

    // Group by operation
    const operationGroups = new Map<string, PerformanceMetrics[]>();
    filteredMetrics.forEach(metric => {
      if (!operationGroups.has(metric.operation)) {
        operationGroups.set(metric.operation, []);
      }
      operationGroups.get(metric.operation)!.push(metric);
    });

    const stats: PerformanceStats[] = [];

    operationGroups.forEach((metrics, op) => {
      if (metrics.length === 0) return;

      const durations = metrics.map(m => m.duration).sort((a, b) => a - b);
      const successful = metrics.filter(m => m.success);
      const cacheHits = metrics.filter(m => m.cacheHit === true);

      const totalCalls = metrics.length;
      const averageDuration = durations.reduce((sum, d) => sum + d, 0) / totalCalls;
      const minDuration = durations[0];
      const maxDuration = durations[durations.length - 1];

      // Calculate percentiles
      const p50 = durations[Math.floor(totalCalls * 0.5)];
      const p90 = durations[Math.floor(totalCalls * 0.9)];
      const p95 = durations[Math.floor(totalCalls * 0.95)];
      const p99 = durations[Math.floor(totalCalls * 0.99)];

      const successRate = (successful.length / totalCalls) * 100;
      const errorRate = 100 - successRate;
      const cacheHitRate = (cacheHits.length / totalCalls) * 100;

      // Calculate calls per second
      const timeSpan = (metrics[metrics.length - 1].timestamp.getTime() - metrics[0].timestamp.getTime()) / 1000;
      const callsPerSecond = timeSpan > 0 ? totalCalls / timeSpan : 0;

      stats.push({
        operation: op,
        totalCalls,
        averageDuration,
        minDuration,
        maxDuration,
        p50,
        p90,
        p95,
        p99,
        successRate,
        errorRate,
        cacheHitRate,
        callsPerSecond
      });
    });

    return stats;
  }

  /**
   * Get overall system performance summary
   */
  getSystemSummary(): {
    totalOperations: number;
    averageResponseTime: number;
    slowOperationsCount: number;
    errorRate: number;
    cacheHitRate: number;
    operationsWithinTarget: number;
    targetComplianceRate: number;
  } {
    const allStats = this.getStats();
    const totalOperations = allStats.reduce((sum, stat) => sum + stat.totalCalls, 0);
    const averageResponseTime = allStats.reduce((sum, stat) => sum + stat.averageDuration, 0) / (allStats.length || 1);

    const slowOperations = this.metrics.filter(m => m.duration > 9);
    const slowOperationsCount = slowOperations.length;

    const successfulOperations = this.metrics.filter(m => m.success);
    const errorRate = ((this.metrics.length - successfulOperations.length) / this.metrics.length) * 100;

    const cacheHits = this.metrics.filter(m => m.cacheHit === true);
    const cacheHitRate = (cacheHits.length / this.metrics.length) * 100;

    const operationsWithinTarget = this.metrics.filter(m => m.duration <= 9).length;
    const targetComplianceRate = (operationsWithinTarget / this.metrics.length) * 100;

    return {
      totalOperations,
      averageResponseTime,
      slowOperationsCount,
      errorRate,
      cacheHitRate,
      operationsWithinTarget,
      targetComplianceRate
    };
  }

  /**
   * Check if performance targets are being met
   */
  checkPerformanceTargets(): {
    withinTarget: boolean;
    averageResponseTime: number;
    targetCompliance: number;
    recommendations: string[];
  } {
    const summary = this.systemSummary;
    const withinTarget = summary.targetComplianceRate >= 95; // 95% of operations should be under 9ms

    const recommendations: string[] = [];

    if (summary.averageResponseTime > 9) {
      recommendations.push('Average response time exceeds 9ms target');
    }

    if (summary.targetComplianceRate < 95) {
      recommendations.push('Target compliance rate below 95% - consider optimization');
    }

    if (summary.cacheHitRate < 80) {
      recommendations.push('Cache hit rate is low - consider caching strategy improvements');
    }

    if (summary.errorRate > 5) {
      recommendations.push('Error rate is high - investigate failing operations');
    }

    return {
      withinTarget,
      averageResponseTime: summary.averageResponseTime,
      targetCompliance: summary.targetComplianceRate,
      recommendations
    };
  }

  /**
   * Get performance insights for specific chains
   */
  getChainPerformance(chainId: number): PerformanceStats[] {
    return this.getStats(undefined, undefined).filter(stat =>
      this.metrics.some(m =>
        m.chainId === chainId &&
        m.operation === stat.operation
      )
    );
  }

  /**
   * Start periodic performance reporting
   */
  private startReporting(): void {
    this.reportTimer = setInterval(() => {
      this.report();
    }, this.reportInterval);
  }

  /**
   * Generate performance report
   */
  private report(): void {
    const stats = this.getStats();
    const targets = this.checkPerformanceTargets();

    console.log('=Ê Performance Report');
    console.log('====================');
    console.log(`Operations within 9ms target: ${targets.targetCompliance.toFixed(1)}%`);
    console.log(`Average response time: ${targets.averageResponseTime.toFixed(2)}ms`);
    console.log(`Cache hit rate: ${this.systemSummary.cacheHitRate.toFixed(1)}%`);
    console.log(`Error rate: ${this.systemSummary.errorRate.toFixed(1)}%`);

    if (targets.recommendations.length > 0) {
      console.log('  Recommendations:');
      targets.recommendations.forEach(rec => console.log(`  - ${rec}`));
    }

    // Notify listeners
    this.listeners.forEach(listener => {
      try {
        listener(stats);
      } catch (error) {
        console.error('Error in performance report listener:', error);
      }
    });
  }

  /**
   * Add performance report listener
   */
  addListener(listener: (stats: PerformanceStats[]) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Remove performance report listener
   */
  removeListener(listener: (stats: PerformanceStats[]) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
  }

  /**
   * Export metrics for analysis
   */
  exportMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  /**
   * Import metrics (useful for testing or analysis)
   */
  importMetrics(metrics: PerformanceMetrics[]): void {
    this.metrics = [...metrics];
  }

  /**
   * Stop monitoring and cleanup
   */
  stop(): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = undefined;
    }
    this.listeners = [];
  }

  /**
   * Get system summary (alias for getSystemSummary)
   */
  get systemSummary() {
    return this.getSystemSummary();
  }

  /**
   * Quick performance check for common operations
   */
  async checkOperation<T>(
    operation: string,
    fn: () => Promise<T>,
    options: {
      timeout?: number;
      retries?: number;
      expectedDuration?: number;
    } = {}
  ): Promise<{
    success: boolean;
    duration: number;
    result?: T;
    error?: Error;
  }> {
    const timeout = options.timeout || 5000;
    const retries = options.retries || 0;
    const expectedDuration = options.expectedDuration || 9;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await Promise.race([
          this.executeTracked(operation, fn),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Operation timeout')), timeout)
          )
        ]);

        return { success: true, duration: 0, result };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < retries) {
          console.log(`Retrying operation ${operation} (attempt ${attempt + 2})`);
        }
      }
    }

    return {
      success: false,
      duration: 0,
      error: lastError
    };
  }
}

// Global performance monitor instance
export const performanceMonitor = new PerformanceMonitor();

// Convenience functions for common operations
export async function trackPerformance<T>(
  operation: string,
  fn: () => Promise<T>,
  metadata?: {
    chainId?: number;
    cacheHit?: boolean;
  }
): Promise<T> {
  return performanceMonitor.executeTracked(operation, fn, metadata);
}

// Performance monitoring decorator
export function PerformanceTrack(operation: string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return trackPerformance(
        `${operation}.${propertyName}`,
        () => method.apply(this, args),
        { chainId: this.chainId }
      );
    };

    return descriptor;
  };
}