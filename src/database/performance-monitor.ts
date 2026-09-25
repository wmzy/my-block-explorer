/**
 * Multi-chain performance monitoring
 * Collects and analyzes per-chain performance metrics
 */

import { MultiChainStatistics } from '../types/events';

// Performance metrics interface
export interface PerformanceMetrics {
  // Database performance
  queryTime: number;
  queryCount: number;
  errorCount: number;

  // Event indexing performance
  eventsIndexed: number;
  indexingTime: number;
  blocksProcessed: number;

  // Memory usage
  memoryUsage: number;
  tableCount: number;

  // Network performance
  rpcCalls: number;
  rpcResponseTime: number;
  rpcErrors: number;
}

// Chain performance monitor
export class ChainPerformanceMonitor {
  private chainId: number;
  private metrics: Map<string, PerformanceMetrics>;
  private startTime: number;
  private lastResetTime: number;

  constructor(chainId: number) {
    this.chainId = chainId;
    this.metrics = new Map();
    this.startTime = Date.now();
    this.lastResetTime = Date.now();
  }

  // Record query performance
  recordQuery(operation: string, queryTime: number, success: boolean = true): void {
    const current = this.metrics.get(operation) ?? {
      queryTime: 0,
      queryCount: 0,
      errorCount: 0,
      eventsIndexed: 0,
      indexingTime: 0,
      blocksProcessed: 0,
      memoryUsage: 0,
      tableCount: 0,
      rpcCalls: 0,
      rpcResponseTime: 0,
      rpcErrors: 0,
    };

    current.queryCount++;
    current.queryTime += queryTime;

    if (!success) {
      current.errorCount++;
    }

    this.metrics.set(operation, current);
  }

  // Record event indexing performance
  recordEventIndexing(eventsCount: number, indexingTime: number, blocksProcessed: number): void {
    const current = this.metrics.get('event_indexing') ?? {
      queryTime: 0,
      queryCount: 0,
      errorCount: 0,
      eventsIndexed: 0,
      indexingTime: 0,
      blocksProcessed: 0,
      memoryUsage: 0,
      tableCount: 0,
      rpcCalls: 0,
      rpcResponseTime: 0,
      rpcErrors: 0,
    };

    current.eventsIndexed += eventsCount;
    current.indexingTime += indexingTime;
    current.blocksProcessed += blocksProcessed;

    this.metrics.set('event_indexing', current);
  }

  // Record RPC performance
  recordRpcCall(responseTime: number, success: boolean = true): void {
    const current = this.metrics.get('rpc_calls') ?? {
      queryTime: 0,
      queryCount: 0,
      errorCount: 0,
      eventsIndexed: 0,
      indexingTime: 0,
      blocksProcessed: 0,
      memoryUsage: 0,
      tableCount: 0,
      rpcCalls: 0,
      rpcResponseTime: 0,
      rpcErrors: 0,
    };

    current.rpcCalls++;
    current.rpcResponseTime += responseTime;

    if (!success) {
      current.rpcErrors++;
    }

    this.metrics.set('rpc_calls', current);
  }

  // Get average performance for an operation
  getAveragePerformance(operation: string): {
    averageQueryTime: number;
    queriesPerSecond: number;
    errorRate: number;
  } | null {
    const metrics = this.metrics.get(operation);
    if (!metrics || metrics.queryCount === 0) {
      return null;
    }

    const uptime = (Date.now() - this.lastResetTime) / 1000; // seconds

    return {
      averageQueryTime: metrics.queryTime / metrics.queryCount,
      queriesPerSecond: metrics.queryCount / uptime,
      errorRate: metrics.errorCount / metrics.queryCount,
    };
  }

  // Get event indexing performance
  getIndexingPerformance(): {
    eventsPerSecond: number;
    averageIndexingTime: number;
    blocksPerSecond: number;
  } | null {
    const metrics = this.metrics.get('event_indexing');
    if (!metrics || metrics.eventsIndexed === 0) {
      return null;
    }

    const uptime = (Date.now() - this.lastResetTime) / 1000; // seconds

    return {
      eventsPerSecond: metrics.eventsIndexed / uptime,
      averageIndexingTime: metrics.indexingTime / metrics.blocksProcessed,
      blocksPerSecond: metrics.blocksProcessed / uptime,
    };
  }

  // Get RPC performance
  getRpcPerformance(): {
    averageResponseTime: number;
    callsPerSecond: number;
    errorRate: number;
  } | null {
    const metrics = this.metrics.get('rpc_calls');
    if (!metrics || metrics.rpcCalls === 0) {
      return null;
    }

    const uptime = (Date.now() - this.lastResetTime) / 1000; // seconds

    return {
      averageResponseTime: metrics.rpcResponseTime / metrics.rpcCalls,
      callsPerSecond: metrics.rpcCalls / uptime,
      errorRate: metrics.rpcErrors / metrics.rpcCalls,
    };
  }

  // Reset metrics
  resetMetrics(): void {
    this.metrics.clear();
    this.lastResetTime = Date.now();
  }

  // Get uptime
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  // Get the chain ID
  getChainId(): number {
    return this.chainId;
  }

  // Get all metrics
  getAllMetrics(): Map<string, PerformanceMetrics> {
    return new Map(this.metrics);
  }
}

// Multi-chain performance monitoring manager
export class MultiChainPerformanceManager {
  private monitors: Map<number, ChainPerformanceMonitor>;
  private globalStats: MultiChainStatistics;

  constructor() {
    this.monitors = new Map();
    this.globalStats = {
      totalChains: 0,
      activeChains: 0,
      totalEvents: 0,
      totalTables: 0,
      totalDatabaseSize: 0,
      chainStats: [],
    };
  }

  // Get or create a chain performance monitor
  getChainMonitor(chainId: number): ChainPerformanceMonitor {
    if (!this.monitors.has(chainId)) {
      this.monitors.set(chainId, new ChainPerformanceMonitor(chainId));
      this.updateGlobalStats();
    }
    return this.monitors.get(chainId)!;
  }

  // Remove a chain monitor
  removeChainMonitor(chainId: number): void {
    this.monitors.delete(chainId);
    this.updateGlobalStats();
  }

  // Get all active chains
  getActiveChains(): number[] {
    return Array.from(this.monitors.keys());
  }

  // Get a chain performance report
  getChainPerformanceReport(chainId: number): {
    chainId: number;
    uptime: number;
    queryPerformance: Record<
      string,
      { averageQueryTime: number; queriesPerSecond: number; errorRate: number } | null
    >;
    indexingPerformance: {
      eventsPerSecond: number;
      averageIndexingTime: number;
      blocksPerSecond: number;
    } | null;
    rpcPerformance: {
      averageResponseTime: number;
      callsPerSecond: number;
      errorRate: number;
    } | null;
  } | null {
    const monitor = this.monitors.get(chainId);
    if (!monitor) {
      return null;
    }

    const queryPerformance: Record<
      string,
      { averageQueryTime: number; queriesPerSecond: number; errorRate: number } | null
    > = {};

    // Aggregate all query performance
    for (const [operation, metrics] of monitor.getAllMetrics()) {
      if (metrics.queryCount > 0) {
        queryPerformance[operation] = monitor.getAveragePerformance(operation);
      }
    }

    return {
      chainId,
      uptime: monitor.getUptime(),
      queryPerformance,
      indexingPerformance: monitor.getIndexingPerformance(),
      rpcPerformance: monitor.getRpcPerformance(),
    };
  }

  // Get the multi-chain performance summary
  getMultiChainPerformanceSummary(): {
    totalChains: number;
    activeChains: number;
    globalStats: MultiChainStatistics;
    chainReports: Array<{
      chainId: number;
      uptime: number;
      hasActivity: boolean;
      performance: {
        chainId: number;
        uptime: number;
        queryPerformance: Record<
          string,
          { averageQueryTime: number; queriesPerSecond: number; errorRate: number } | null
        >;
        indexingPerformance: {
          eventsPerSecond: number;
          averageIndexingTime: number;
          blocksPerSecond: number;
        } | null;
        rpcPerformance: {
          averageResponseTime: number;
          callsPerSecond: number;
          errorRate: number;
        } | null;
      } | null;
    }>;
  } {
    const chainReports = Array.from(this.monitors.entries()).map(([chainId, monitor]) => ({
      chainId,
      uptime: monitor.getUptime(),
      hasActivity: monitor.getAllMetrics().size > 0,
      performance: this.getChainPerformanceReport(chainId),
    }));

    return {
      totalChains: this.monitors.size,
      activeChains: chainReports.filter(report => report.hasActivity).length,
      globalStats: this.globalStats,
      chainReports,
    };
  }

  // Update global statistics
  private async updateGlobalStats(): Promise<void> {
    // Real database statistics collection could be integrated here
    // Provides the scaffolding for now
    this.globalStats = {
      totalChains: this.monitors.size,
      activeChains: Array.from(this.monitors.values()).filter(
        monitor => monitor.getAllMetrics().size > 0,
      ).length,
      totalEvents: 0, // must come from the real database
      totalTables: 0, // must come from the real database
      totalDatabaseSize: 0, // must come from the real database
      chainStats: [], // must come from the real database
    };
  }

  // Reset metrics for all chains
  resetAllMetrics(): void {
    for (const monitor of this.monitors.values()) {
      monitor.resetMetrics();
    }
  }

  // Performance alert checks
  checkPerformanceAlerts(): Array<{
    chainId: number;
    type: 'high_error_rate' | 'slow_queries' | 'rpc_issues' | 'indexing_slow';
    message: string;
    severity: 'warning' | 'error' | 'critical';
  }> {
    const alerts: Array<{
      chainId: number;
      type: 'high_error_rate' | 'slow_queries' | 'rpc_issues' | 'indexing_slow';
      message: string;
      severity: 'warning' | 'error' | 'critical';
    }> = [];

    for (const [chainId, monitor] of this.monitors) {
      // Check the query error rate
      for (const [operation, _] of monitor.getAllMetrics()) {
        const perf = monitor.getAveragePerformance(operation);
        if (perf && perf.errorRate > 0.1) {
          // 10% error-rate threshold
          alerts.push({
            chainId,
            type: 'high_error_rate',
            message: `High error rate for ${operation}: ${(perf.errorRate * 100).toFixed(2)}%`,
            severity: perf.errorRate > 0.3 ? 'critical' : 'warning',
          });
        }

        if (perf && perf.averageQueryTime > 1000) {
          // 1 second threshold
          alerts.push({
            chainId,
            type: 'slow_queries',
            message: `Slow queries for ${operation}: ${perf.averageQueryTime.toFixed(2)}ms average`,
            severity: perf.averageQueryTime > 5000 ? 'critical' : 'warning',
          });
        }
      }

      // Check RPC performance
      const rpcPerf = monitor.getRpcPerformance();
      if (rpcPerf) {
        if (rpcPerf.errorRate > 0.05) {
          // 5% RPC error-rate threshold
          alerts.push({
            chainId,
            type: 'rpc_issues',
            message: `RPC error rate: ${(rpcPerf.errorRate * 100).toFixed(2)}%`,
            severity: rpcPerf.errorRate > 0.2 ? 'critical' : 'warning',
          });
        }

        if (rpcPerf.averageResponseTime > 5000) {
          // 5 second threshold
          alerts.push({
            chainId,
            type: 'rpc_issues',
            message: `Slow RPC responses: ${rpcPerf.averageResponseTime.toFixed(2)}ms average`,
            severity: rpcPerf.averageResponseTime > 10000 ? 'critical' : 'warning',
          });
        }
      }

      // Check indexing performance
      const indexingPerf = monitor.getIndexingPerformance();
      if (indexingPerf && indexingPerf.eventsPerSecond < 1) {
        // At least 1 event per second
        alerts.push({
          chainId,
          type: 'indexing_slow',
          message: `Slow event indexing: ${indexingPerf.eventsPerSecond.toFixed(2)} events/sec`,
          severity: 'warning',
        });
      }
    }

    return alerts;
  }

  // Export performance data
  exportPerformanceData(): {
    timestamp: number;
    chains: Record<
      number,
      { uptime: number; metrics: Record<string, unknown>; performance: unknown }
    >;
    summary: {
      totalChains: number;
      activeChains: number;
      globalStats: MultiChainStatistics;
      chainReports: Array<{
        chainId: number;
        uptime: number;
        hasActivity: boolean;
        performance: {
          chainId: number;
          uptime: number;
          queryPerformance: Record<
            string,
            { averageQueryTime: number; queriesPerSecond: number; errorRate: number } | null
          >;
          indexingPerformance: {
            eventsPerSecond: number;
            averageIndexingTime: number;
            blocksPerSecond: number;
          } | null;
          rpcPerformance: {
            averageResponseTime: number;
            callsPerSecond: number;
            errorRate: number;
          } | null;
        } | null;
      }>;
    };
    alerts: Array<{
      chainId: number;
      type: 'high_error_rate' | 'slow_queries' | 'rpc_issues' | 'indexing_slow';
      message: string;
      severity: 'warning' | 'error' | 'critical';
    }>;
  } {
    const chains: Record<
      number,
      { uptime: number; metrics: Record<string, unknown>; performance: unknown }
    > = {};

    for (const [chainId, monitor] of this.monitors) {
      chains[chainId] = {
        uptime: monitor.getUptime(),
        metrics: Object.fromEntries(monitor.getAllMetrics()),
        performance: this.getChainPerformanceReport(chainId),
      };
    }

    return {
      timestamp: Date.now(),
      chains,
      summary: this.getMultiChainPerformanceSummary(),
      alerts: this.checkPerformanceAlerts(),
    };
  }
}

// Performance monitoring decorator
export function monitorPerformance(operation: string) {
  return function (target: object, propertyName: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    if (typeof originalMethod !== 'function') {
      return descriptor;
    }

    descriptor.value = function (
      this: { performanceMonitor?: ChainPerformanceMonitor },
      ...args: unknown[]
    ) {
      const startTime = Date.now();
      let success = true;

      const execute = async () => {
        try {
          const result = await (originalMethod as (...args: unknown[]) => Promise<unknown>).apply(
            this,
            args,
          );
          return result;
        } catch (error) {
          success = false;
          throw error;
        } finally {
          const duration = Date.now() - startTime;
          if (this.performanceMonitor) {
            this.performanceMonitor.recordQuery(operation, duration, success);
          }
        }
      };

      return execute();
    };

    return descriptor;
  };
}

// Query performance monitoring wrapper
export function createMonitoredQuery<T extends unknown[], R>(
  queryFn: (...args: T) => Promise<R>,
  monitor: ChainPerformanceMonitor,
  operation: string,
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    const startTime = Date.now();
    let success = true;

    try {
      const result = await queryFn(...args);
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const endTime = Date.now();
      const duration = endTime - startTime;
      monitor.recordQuery(operation, duration, success);
    }
  };
}

// Global multi-chain performance manager instance
export const multiChainPerformanceManager = new MultiChainPerformanceManager();
