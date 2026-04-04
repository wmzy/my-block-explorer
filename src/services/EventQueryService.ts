/**
 * 事件查询服务
 * 负责合约事件的查询、过滤和分页，使用多链数据库隔离架构
 */

import { createLogger } from '../server/logger';
import { ChainDatabaseManager, multiChainDb } from '../database/chain-database-manager';

const logger = createLogger('event-query-service');
import { ChainEventTableManager } from '../database/chain-event-table-manager';
import { multiChainPerformanceManager } from '../database/performance-monitor';
import {
  EventFilters,
  PaginationParams,
  PaginatedResult,
  EventStatistics,
  EventDecodingError,
} from '../types/events';

/**
 * 事件查询选项
 */
export interface EventQueryOptions {
  tableName: string;
  filters?: EventFilters;
  pagination?: PaginationParams;
  sort?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  includeTotal?: boolean;
}

/**
 * 事件查询服务
 * 提供高性能的事件查询功能，支持复杂的过滤和分页
 */
export class EventQueryService {
  private chainId: number;
  private chainDb: ChainDatabaseManager;
  private eventTableManager: ChainEventTableManager;

  constructor(chainId: number) {
    this.chainId = chainId;
    this.chainDb = multiChainDb.getChainDatabaseSync(chainId);
    this.eventTableManager = new ChainEventTableManager(this.chainDb);
  }

  /**
   * 查询事件列表
   */
  async queryEvents(options: EventQueryOptions): Promise<PaginatedResult<Record<string, unknown>>> {
    const startTime = performance.now();
    const performanceMonitor = multiChainPerformanceManager.getChainMonitor(this.chainId);

    try {
      const {
        tableName,
        filters = {},
        pagination = { limit: 50 },
        sort = { field: 'block_timestamp', direction: 'desc' },
        includeTotal = true,
      } = options;

      const { fromBlock, toBlock, fromTimestamp, toTimestamp, ...restFilters } = filters;
      const queryParams: {
        eventName?: string;
        fromBlock?: string;
        toBlock?: string;
        fromTimestamp?: string;
        toTimestamp?: string;
        contractAddress?: `0x${string}`;
        [key: string]: unknown;
      } = {
        ...restFilters,
        fromBlock: fromBlock !== undefined ? String(fromBlock) : undefined,
        toBlock: toBlock !== undefined ? String(toBlock) : undefined,
        fromTimestamp: fromTimestamp !== undefined ? String(fromTimestamp) : undefined,
        toTimestamp: toTimestamp !== undefined ? String(toTimestamp) : undefined,
        limit: pagination.limit,
        cursor: pagination.cursor,
        sort: sort.direction,
        sortBy: sort.field,
      };

      // 执行查询
      const result = await this.eventTableManager.queryEvents(tableName, queryParams, {
        limit: pagination.limit,
        cursor: pagination.cursor,
        sort: sort.direction,
        sortBy: sort.field,
      });

      // 记录性能指标
      const queryTime = performance.now() - startTime;
      performanceMonitor.recordQuery('event_query', queryTime, true);

      // 如果需要总数，进行额外查询
      let total = result.events.length;
      if (includeTotal && (pagination.cursor || pagination.offset)) {
        try {
          const stats = await this.eventTableManager.getEventStatistics(tableName);
          total = stats.totalEvents;
        } catch (error) {
          logger.warn({ err: error }, 'Failed to get total count');
        }
      }

      return {
        data: result.events,
        total,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
        prevCursor: undefined, // 可以根据需要实现
      };
    } catch (error) {
      const queryTime = performance.now() - startTime;
      performanceMonitor.recordQuery('event_query', queryTime, false);

      throw new EventDecodingError(
        `Failed to query events: ${error}`,
        undefined,
        undefined,
        this.chainId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * 获取事件统计信息
   */
  async getEventStatistics(tableName: string, timeRange?: string): Promise<EventStatistics> {
    const startTime = performance.now();
    const performanceMonitor = multiChainPerformanceManager.getChainMonitor(this.chainId);

    try {
      const stats = await this.eventTableManager.getEventStatistics(tableName, timeRange);

      const queryTime = performance.now() - startTime;
      performanceMonitor.recordQuery('event_statistics', queryTime, true);

      const eventsByType = await this.getEventsByType(tableName).catch(() => ({}));

      const avgEventsPerBlock = await (async () => {
        try {
          const result = await this.chainDb.query(`
            SELECT COUNT(DISTINCT block_number) as block_count
            FROM ${tableName}
          `);
          const blockCount = Number((result[0] as { block_count?: number })?.block_count ?? 0);
          return blockCount > 0 ? stats.totalEvents / blockCount : 0;
        } catch {
          return 0;
        }
      })();

      return {
        totalEvents: stats.totalEvents,
        eventsByType,
        eventsByBlockRange: [],
        averageEventsPerBlock: avgEventsPerBlock,
        uniqueAddresses: stats.uniqueAddresses ?? 0,
        storageSize: 0,
        lastIndexedBlock: undefined,
        lastIndexedAt: stats.newestEvent,
      };
    } catch (error) {
      const queryTime = performance.now() - startTime;
      performanceMonitor.recordQuery('event_statistics', queryTime, false);

      throw new EventDecodingError(
        `Failed to get event statistics: ${error}`,
        undefined,
        undefined,
        this.chainId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * 按事件类型分组统计
   */
  async getEventsByType(tableName: string): Promise<Record<string, number>> {
    const startTime = performance.now();
    const performanceMonitor = multiChainPerformanceManager.getChainMonitor(this.chainId);

    try {
      const result = await this.chainDb.query(`
        SELECT
          event_name,
          COUNT(*) as count
        FROM ${tableName}
        GROUP BY event_name
        ORDER BY count DESC
      `);

      const queryTime = performance.now() - startTime;
      performanceMonitor.recordQuery('events_by_type', queryTime, true);

      return (result as Array<{ event_name: string; count: number }>).reduce(
        (acc: Record<string, number>, row) => {
          acc[row.event_name] = Number(row.count);
          return acc;
        },
        {},
      );
    } catch (error) {
      const queryTime = performance.now() - startTime;
      performanceMonitor.recordQuery('events_by_type', queryTime, false);

      throw new EventDecodingError(
        `Failed to get events by type: ${error}`,
        undefined,
        undefined,
        this.chainId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * 按时间范围统计
   */
  async getEventsByTimeRange(
    tableName: string,
    interval: 'hour' | 'day' | 'week' | 'month' = 'day',
    limit: number = 30,
  ): Promise<Array<{ timeRange: string; count: number }>> {
    const startTime = performance.now();
    const performanceMonitor = multiChainPerformanceManager.getChainMonitor(this.chainId);

    try {
      let intervalSql: string;
      switch (interval) {
        case 'hour':
          intervalSql = 'strftime(\'%Y-%m-%d %H:00:00\', block_timestamp)';
          break;
        case 'day':
          intervalSql = 'strftime(\'%Y-%m-%d\', block_timestamp)';
          break;
        case 'week':
          intervalSql = 'strftime(\'%Y-%W\', block_timestamp)';
          break;
        case 'month':
          intervalSql = 'strftime(\'%Y-%m\', block_timestamp)';
          break;
      }

      const result = await this.chainDb.query(`
        SELECT
          ${intervalSql} as time_range,
          COUNT(*) as count
        FROM ${tableName}
        WHERE block_timestamp >= datetime('now', '-${limit} ${interval}s')
        GROUP BY time_range
        ORDER BY time_range DESC
        LIMIT ${limit}
      `);

      const queryTime = performance.now() - startTime;
      performanceMonitor.recordQuery('events_by_time_range', queryTime, true);

      return (result as Record<string, string>[]).map(row => ({
        timeRange: row.time_range,
        count: Number(row.count),
      }));
    } catch (error) {
      const queryTime = performance.now() - startTime;
      performanceMonitor.recordQuery('events_by_time_range', queryTime, false);

      throw new EventDecodingError(
        `Failed to get events by time range: ${error}`,
        undefined,
        undefined,
        this.chainId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * 获取热门地址
   */
  async getTopAddresses(
    tableName: string,
    type: 'from' | 'to' | 'contract',
    limit: number = 10,
  ): Promise<Array<{ address: string; count: number; percentage: number }>> {
    const startTime = performance.now();
    const performanceMonitor = multiChainPerformanceManager.getChainMonitor(this.chainId);

    try {
      let field: string;
      switch (type) {
        case 'from':
          field = 'from';
          break;
        case 'to':
          field = 'to';
          break;
        case 'contract':
          field = 'contract_address';
          break;
      }

      const result = await this.chainDb.query(`
        SELECT
          ${field} as address,
          COUNT(*) as count,
          ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM ${tableName}), 2) as percentage
        FROM ${tableName}
        WHERE ${field} IS NOT NULL
        GROUP BY address
        ORDER BY count DESC
        LIMIT ${limit}
      `);

      const queryTime = performance.now() - startTime;
      performanceMonitor.recordQuery('top_addresses', queryTime, true);

      return (result as Record<string, string>[]).map(row => ({
        address: row.address,
        count: Number(row.count),
        percentage: Number(row.percentage),
      }));
    } catch (error) {
      const queryTime = performance.now() - startTime;
      performanceMonitor.recordQuery('top_addresses', queryTime, false);

      throw new EventDecodingError(
        `Failed to get top addresses: ${error}`,
        undefined,
        undefined,
        this.chainId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * 搜索事件
   */
  async searchEvents(
    tableName: string,
    searchTerm: string,
    options: Partial<EventQueryOptions> = {},
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    const startTime = performance.now();
    const performanceMonitor = multiChainPerformanceManager.getChainMonitor(this.chainId);

    try {
      // 构建搜索查询
      const searchQuery = `
        SELECT * FROM ${tableName}
        WHERE
          event_name LIKE ? OR
          transaction_hash LIKE ? OR
          contract_address LIKE ?
        ORDER BY block_timestamp DESC
        LIMIT ?
      `;

      const searchPattern = `%${searchTerm}%`;
      const limit = options.pagination?.limit ?? 50;

      const result = await this.chainDb.query(searchQuery, [
        searchPattern,
        searchPattern,
        searchPattern,
        limit + 1, // +1 to check if there are more results
      ]);

      const queryTime = performance.now() - startTime;
      performanceMonitor.recordQuery('event_search', queryTime, true);

      const hasMore = result.length > limit;
      const events = hasMore ? result.slice(0, -1) : result;

      return {
        data: events as Record<string, unknown>[],
        total: events.length,
        hasMore,
        nextCursor: hasMore
          ? String((events[events.length - 1] as Record<string, unknown>)?.block_timestamp)
          : undefined,
      };
    } catch (error) {
      const queryTime = performance.now() - startTime;
      performanceMonitor.recordQuery('event_search', queryTime, false);

      throw new EventDecodingError(
        `Failed to search events: ${error}`,
        undefined,
        undefined,
        this.chainId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * 获取事件的详细信息
   */
  async getEventDetails(
    tableName: string,
    blockHash: string,
    logIndex: number,
  ): Promise<Record<string, unknown> | null> {
    const startTime = performance.now();
    const performanceMonitor = multiChainPerformanceManager.getChainMonitor(this.chainId);

    try {
      const result = await this.chainDb.query(
        `
        SELECT * FROM ${tableName}
        WHERE block_hash = ? AND log_index = ?
      `,
        [blockHash, logIndex],
      );

      const queryTime = performance.now() - startTime;
      performanceMonitor.recordQuery('event_details', queryTime, true);

      return (result as Record<string, unknown>[]).length > 0
        ? (result as Record<string, unknown>[])[0]
        : null;
    } catch (error) {
      const queryTime = performance.now() - startTime;
      performanceMonitor.recordQuery('event_details', queryTime, false);

      throw new EventDecodingError(
        `Failed to get event details: ${error}`,
        undefined,
        undefined,
        this.chainId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * 获取相似事件
   */
  async getSimilarEvents(
    tableName: string,
    eventName: string,
    limit: number = 10,
  ): Promise<Record<string, unknown>[]> {
    const startTime = performance.now();
    const performanceMonitor = multiChainPerformanceManager.getChainMonitor(this.chainId);

    try {
      const result = await this.chainDb.query(
        `
        SELECT * FROM ${tableName}
        WHERE event_name = ?
        ORDER BY block_timestamp DESC
        LIMIT ?
      `,
        [eventName, limit],
      );

      const queryTime = performance.now() - startTime;
      performanceMonitor.recordQuery('similar_events', queryTime, true);

      return result as Record<string, unknown>[];
    } catch (error) {
      const queryTime = performance.now() - startTime;
      performanceMonitor.recordQuery('similar_events', queryTime, false);

      throw new EventDecodingError(
        `Failed to get similar events: ${error}`,
        undefined,
        undefined,
        this.chainId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * List all created event tables
   */
  listTables(): string[] {
    return this.eventTableManager.getCreatedTables();
  }

  /**
   * 验证表是否存在
   */
  async validateTable(tableName: string): Promise<boolean> {
    try {
      return await this.eventTableManager.tableExists(tableName);
    } catch (error) {
      logger.warn({ err: error, tableName }, 'Failed to validate table');
      return false;
    }
  }

  /**
   * 获取表结构信息
   */
  async getTableSchema(tableName: string): Promise<{
    columns: Array<{ name: string; type: string; nullable: boolean }>;
    indexes: Array<{ name: string; columns: string[]; unique: boolean }>;
  }> {
    try {
      return await this.eventTableManager.getTableSchema(tableName);
    } catch (error) {
      throw new EventDecodingError(
        `Failed to get table schema: ${error}`,
        undefined,
        undefined,
        this.chainId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * 获取链ID
   */
  getChainId(): number {
    return this.chainId;
  }

  /**
   * 获取性能监控器
   */
  getPerformanceMonitor() {
    return multiChainPerformanceManager.getChainMonitor(this.chainId);
  }
}

// 导出单例管理器
class EventQueryServiceManager {
  private services: Map<number, EventQueryService> = new Map();

  getService(chainId: number): EventQueryService {
    if (!this.services.has(chainId)) {
      this.services.set(chainId, new EventQueryService(chainId));
    }
    return this.services.get(chainId)!;
  }

  removeService(chainId: number): void {
    this.services.delete(chainId);
  }

  getAllServices(): EventQueryService[] {
    return Array.from(this.services.values());
  }
}

export const eventQueryServiceManager = new EventQueryServiceManager();
