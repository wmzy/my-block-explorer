/**
 * 多链性能监控系统
 * 提供链级别的性能指标收集和分析
 */

import { MultiChainStatistics } from '../types/events';

// 性能指标接口
export interface PerformanceMetrics {
  // 数据库性能
  queryTime: number;
  queryCount: number;
  errorCount: number;

  // 事件索引性能
  eventsIndexed: number;
  indexingTime: number;
  blocksProcessed: number;

  // 内存使用
  memoryUsage: number;
  tableCount: number;

  // 网络性能
  rpcCalls: number;
  rpcResponseTime: number;
  rpcErrors: number;
}

// 链性能监控器
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

  // 记录查询性能
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

  // 记录事件索引性能
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

  // 记录RPC性能
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

  // 获取操作平均性能
  getAveragePerformance(operation: string): {
    averageQueryTime: number;
    queriesPerSecond: number;
    errorRate: number;
  } | null {
    const metrics = this.metrics.get(operation);
    if (!metrics || metrics.queryCount === 0) {
      return null;
    }

    const uptime = (Date.now() - this.lastResetTime) / 1000; // 秒

    return {
      averageQueryTime: metrics.queryTime / metrics.queryCount,
      queriesPerSecond: metrics.queryCount / uptime,
      errorRate: metrics.errorCount / metrics.queryCount,
    };
  }

  // 获取事件索引性能
  getIndexingPerformance(): {
    eventsPerSecond: number;
    averageIndexingTime: number;
    blocksPerSecond: number;
  } | null {
    const metrics = this.metrics.get('event_indexing');
    if (!metrics || metrics.eventsIndexed === 0) {
      return null;
    }

    const uptime = (Date.now() - this.lastResetTime) / 1000; // 秒

    return {
      eventsPerSecond: metrics.eventsIndexed / uptime,
      averageIndexingTime: metrics.indexingTime / metrics.blocksProcessed,
      blocksPerSecond: metrics.blocksProcessed / uptime,
    };
  }

  // 获取RPC性能
  getRpcPerformance(): {
    averageResponseTime: number;
    callsPerSecond: number;
    errorRate: number;
  } | null {
    const metrics = this.metrics.get('rpc_calls');
    if (!metrics || metrics.rpcCalls === 0) {
      return null;
    }

    const uptime = (Date.now() - this.lastResetTime) / 1000; // 秒

    return {
      averageResponseTime: metrics.rpcResponseTime / metrics.rpcCalls,
      callsPerSecond: metrics.rpcCalls / uptime,
      errorRate: metrics.rpcErrors / metrics.rpcCalls,
    };
  }

  // 重置指标
  resetMetrics(): void {
    this.metrics.clear();
    this.lastResetTime = Date.now();
  }

  // 获取运行时间
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  // 获取链ID
  getChainId(): number {
    return this.chainId;
  }

  // 获取所有指标
  getAllMetrics(): Map<string, PerformanceMetrics> {
    return new Map(this.metrics);
  }
}

// 多链性能监控管理器
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

  // 获取或创建链性能监控器
  getChainMonitor(chainId: number): ChainPerformanceMonitor {
    if (!this.monitors.has(chainId)) {
      this.monitors.set(chainId, new ChainPerformanceMonitor(chainId));
      this.updateGlobalStats();
    }
    return this.monitors.get(chainId)!;
  }

  // 移除链监控器
  removeChainMonitor(chainId: number): void {
    this.monitors.delete(chainId);
    this.updateGlobalStats();
  }

  // 获取所有活跃链
  getActiveChains(): number[] {
    return Array.from(this.monitors.keys());
  }

  // 获取链性能报告
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

    // 收集所有查询性能
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

  // 获取多链性能摘要
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

  // 更新全局统计信息
  private async updateGlobalStats(): Promise<void> {
    // 这里可以集成实际的数据库统计信��收集
    // 目前提供基础结构
    this.globalStats = {
      totalChains: this.monitors.size,
      activeChains: Array.from(this.monitors.values()).filter(
        monitor => monitor.getAllMetrics().size > 0,
      ).length,
      totalEvents: 0, // 需要从实际数据库获取
      totalTables: 0, // 需要从实际数据库获取
      totalDatabaseSize: 0, // 需要从实际数据库获取
      chainStats: [], // 需要从实际数据库获取
    };
  }

  // 重置所有链的指标
  resetAllMetrics(): void {
    for (const monitor of this.monitors.values()) {
      monitor.resetMetrics();
    }
  }

  // 性能警报检查
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
      // 检查查询错误率
      for (const [operation, _] of monitor.getAllMetrics()) {
        const perf = monitor.getAveragePerformance(operation);
        if (perf && perf.errorRate > 0.1) {
          // 10%错误率阈值
          alerts.push({
            chainId,
            type: 'high_error_rate',
            message: `High error rate for ${operation}: ${(perf.errorRate * 100).toFixed(2)}%`,
            severity: perf.errorRate > 0.3 ? 'critical' : 'warning',
          });
        }

        if (perf && perf.averageQueryTime > 1000) {
          // 1秒阈值
          alerts.push({
            chainId,
            type: 'slow_queries',
            message: `Slow queries for ${operation}: ${perf.averageQueryTime.toFixed(2)}ms average`,
            severity: perf.averageQueryTime > 5000 ? 'critical' : 'warning',
          });
        }
      }

      // 检查RPC性能
      const rpcPerf = monitor.getRpcPerformance();
      if (rpcPerf) {
        if (rpcPerf.errorRate > 0.05) {
          // 5%RPC错误率阈值
          alerts.push({
            chainId,
            type: 'rpc_issues',
            message: `RPC error rate: ${(rpcPerf.errorRate * 100).toFixed(2)}%`,
            severity: rpcPerf.errorRate > 0.2 ? 'critical' : 'warning',
          });
        }

        if (rpcPerf.averageResponseTime > 5000) {
          // 5秒阈值
          alerts.push({
            chainId,
            type: 'rpc_issues',
            message: `Slow RPC responses: ${rpcPerf.averageResponseTime.toFixed(2)}ms average`,
            severity: rpcPerf.averageResponseTime > 10000 ? 'critical' : 'warning',
          });
        }
      }

      // 检查索引性能
      const indexingPerf = monitor.getIndexingPerformance();
      if (indexingPerf && indexingPerf.eventsPerSecond < 1) {
        // 每秒至少1个事件
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

  // 导出性能数据
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

// 性能监控装饰器
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

// 查询性能监控包装器
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

// 全局多链性能管理器实例
export const multiChainPerformanceManager = new MultiChainPerformanceManager();
