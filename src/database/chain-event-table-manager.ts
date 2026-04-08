/**
 * 链特定事件表管理器
 * 为每个链管理独立的事件表，不支持跨链查询
 */

import { eq, and, lt, or, sql } from 'drizzle-orm';
import { createLogger } from '../server/logger';
import { ChainDatabaseManager } from './chain-database-manager';
import { ChainSchemaManager } from './chain-schema-manager';
import { eventTableRegistry } from './chain-schema';
import { EventParameter, EventIndexingConfig, EventAbiShape } from '../types/events';
import type { AbiEvent } from 'viem';

const logger = createLogger('chain-event-table-manager');

/**
 * 链特定的事件表管理器
 */
export class ChainEventTableManager {
  private chainDb: ChainDatabaseManager;
  private schemaManager: ChainSchemaManager;
  private config: EventIndexingConfig;
  private createdTables: Set<string>;

  constructor(chainDb: ChainDatabaseManager, config: Partial<EventIndexingConfig> = {}) {
    this.chainDb = chainDb;
    this.schemaManager = new ChainSchemaManager(chainDb.getChainId());
    this.config = {
      tableNamePrefix: 'events',
      maxTableNameLength: 63,
      batchSize: 1000,
      maxConcurrency: 5,
      compressionEnabled: true,
      partitioningEnabled: false,
      retentionDays: 365,
      autoCreateIndexes: true,
      indexThreshold: 10000,
      metricsEnabled: true,
      errorTracking: true,
      ...config,
    };
    this.createdTables = new Set();
  }

  /**
   * 为ABI事件创建动态表
   */
  async createEventTable(
    contractAddress: string,
    eventParams: EventParameter[],
    eventSignature: string,
    eventName: string,
  ): Promise<string> {
    try {
      const tableName = this.generateTableName(contractAddress, eventSignature);

      // 检查表是否已存在
      if (this.createdTables.has(tableName)) {
        return tableName;
      }

      const eventAbi: AbiEvent = {
        name: eventName,
        type: 'event',
        inputs: eventParams as unknown as AbiEvent['inputs'],
      };

      // 创建事件表
      const createTableSQL = await this.schemaManager.getCreateEventTableSQL(tableName, eventAbi);
      await this.chainDb.exec(createTableSQL);

      // 创建索引
      const indexes = this.schemaManager.getEventTableIndexesSQL(tableName, eventAbi);
      for (const indexSql of indexes) {
        await this.chainDb.exec(indexSql);
      }

      // 注册事件表
      await this.registerEventTable(
        contractAddress,
        eventSignature,
        eventName,
        tableName,
        eventAbi as unknown as EventAbiShape,
      );

      // 缓存表名
      this.createdTables.add(tableName);

      logger.info(
        { tableName, eventName, chainId: this.chainDb.getChainId() },
        'Created event table',
      );
      return tableName;
    } catch (error) {
      logger.error({ err: error, eventName }, 'Failed to create event table');
      throw error;
    }
  }

  /**
   * 生成表名（链内唯一）
   */
  private generateTableName(contractAddress: string, eventSignature: string): string {
    // 截取合约地址的前8位
    const shortAddress = contractAddress.slice(2, 10);
    // 截取事件签名的前8位
    const shortSignature = eventSignature.slice(2, 10);

    const tableName = `${this.config.tableNamePrefix}_${shortAddress}_${shortSignature}`;

    // 确保表名长度不超过限制
    if (tableName.length > this.config.maxTableNameLength) {
      return tableName.slice(0, this.config.maxTableNameLength);
    }

    return tableName;
  }

  /**
   * 注册事件表到元数据表
   */
  private async registerEventTable(
    contractAddress: string,
    eventSignature: string,
    eventName: string,
    tableName: string,
    eventAbi: EventAbiShape,
  ): Promise<void> {
    const db = this.chainDb.getDrizzle();
    await db
      .insert(eventTableRegistry)
      .values({
        contractAddress: contractAddress as `0x${string}`,
        eventSignature,
        eventName,
        tableName,
        tableSchema: JSON.stringify(eventAbi),
        isActive: true,
        updatedAt: new Date(),
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [eventTableRegistry.contractAddress, eventTableRegistry.eventSignature],
        set: {
          tableName,
          eventName,
          tableSchema: sql`excluded.table_schema`,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * 插入事件数据
   */
  async insertEventData(tableName: string, eventData: Record<string, unknown>): Promise<void> {
    const columns = Object.keys(eventData);
    const values = Object.values(eventData);
    const placeholders = values.map(() => '?').join(', ');

    const sql = `
      INSERT INTO ${tableName} (${columns.join(', ')})
      VALUES (${placeholders})
    `;

    await this.chainDb.exec(sql);
  }

  /**
   * 批量插入事件数据
   */
  async insertEventDataBatch(
    tableName: string,
    eventsData: Record<string, unknown>[],
  ): Promise<void> {
    if (eventsData.length === 0) return;

    const columns = Object.keys(eventsData[0]);
    const placeholders = eventsData.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');

    const _values = eventsData.flatMap(event => Object.values(event));

    const sql = `
      INSERT INTO ${tableName} (${columns.join(', ')})
      VALUES ${placeholders}
    `;

    await this.chainDb.exec(sql);
  }

  /**
   * 查询事件数据
   */
  async queryEvents(
    tableName: string,
    filters: {
      eventName?: string;
      fromBlock?: string;
      toBlock?: string;
      fromTimestamp?: string;
      toTimestamp?: string;
      [key: string]: unknown;
    } = {},
    options: {
      limit?: number;
      cursor?: string;
      sort?: 'asc' | 'desc';
      sortBy?: string;
    } = {},
  ): Promise<{ events: Record<string, unknown>[]; hasMore: boolean; nextCursor?: string }> {
    const whereClauses: string[] = [];
    const params: unknown[] = [];

    // 构建WHERE条件
    if (filters.eventName) {
      whereClauses.push('event_name = ?');
      params.push(filters.eventName);
    }

    if (filters.fromBlock) {
      whereClauses.push('block_number >= ?');
      params.push(filters.fromBlock);
    }

    if (filters.toBlock) {
      whereClauses.push('block_number <= ?');
      params.push(filters.toBlock);
    }

    if (filters.fromTimestamp) {
      whereClauses.push('block_timestamp >= ?');
      params.push(filters.fromTimestamp);
    }

    if (filters.toTimestamp) {
      whereClauses.push('block_timestamp <= ?');
      params.push(filters.toTimestamp);
    }

    // 处理自定义过滤条件
    Object.entries(filters).forEach(([key, value]) => {
      if (
        !['eventName', 'fromBlock', 'toBlock', 'fromTimestamp', 'toTimestamp'].includes(key) &&
        value !== undefined
      ) {
        whereClauses.push(`${key} = ?`);
        params.push(value);
      }
    });

    const _whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 排序
    const sortBy = options.sortBy ?? 'block_timestamp';
    const sortOrder = options.sort ?? 'desc';
    const orderClause = `ORDER BY ${sortBy} ${sortOrder}`;

    // 分页
    const limit = Math.min(options.limit ?? 50, 1000);
    const _cursorClause = '';
    if (options.cursor) {
      if (sortOrder === 'desc') {
        whereClauses.push(`${sortBy} < ?`);
      } else {
        whereClauses.push(`${sortBy} > ?`);
      }
      params.push(options.cursor);
    }

    const finalWhereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 查询数据
    const querySql = `
      SELECT * FROM ${tableName}
      ${finalWhereClause}
      ${orderClause}
      LIMIT ${limit + 1}
    `;

    const events = await this.chainDb.query(querySql, params);

    // 检查是否有更多数据
    const hasMore = events.length > limit;
    const returnedEvents = hasMore ? events.slice(0, -1) : events;

    // 生成下一页游标
    let nextCursor: string | undefined;
    if (hasMore && returnedEvents.length > 0) {
      const lastEvent = returnedEvents[returnedEvents.length - 1] as Record<string, unknown>;
      const cursorVal = lastEvent[sortBy];
      nextCursor = cursorVal != null ? String(cursorVal) : undefined;
    }

    return {
      events: returnedEvents as Record<string, unknown>[],
      hasMore,
      nextCursor,
    };
  }

  /**
   * 获取事件统计信息
   */
  async getEventStatistics(
    tableName: string,
    timeRange?: string,
  ): Promise<{
    totalEvents: number;
    oldestEvent?: string;
    newestEvent?: string;
    uniqueAddresses?: number;
  }> {
    let sql = `
      SELECT
        COUNT(*) as total_events,
        MIN(block_timestamp) as oldest_event,
        MAX(block_timestamp) as newest_event
      FROM ${tableName}
    `;

    const params: unknown[] = [];
    if (timeRange) {
      sql += ` WHERE block_timestamp >= DATE_SUB(NOW(), INTERVAL ${timeRange})`;
    }

    const result = await this.chainDb.query(sql, params);

    if (result.length === 0) {
      return { totalEvents: 0 };
    }

    const stats = result[0] as {
      total_events?: number;
      oldest_event?: string;
      newest_event?: string;
      unique_addresses?: number;
    };

    // 获取唯一地址数量（需要额外的查询）
    let uniqueAddresses;
    if ((stats.total_events ?? 0) > 0) {
      const addressQuery = `
        SELECT COUNT(DISTINCT contract_address) as unique_addresses
        FROM ${tableName}
        ${timeRange ? ` WHERE block_timestamp >= DATE_SUB(NOW(), INTERVAL ${timeRange})` : ''}
      `;
      const addressResult = await this.chainDb.query(addressQuery);
      uniqueAddresses = (addressResult[0] as { unique_addresses?: number })?.unique_addresses ?? 0;
    }

    return {
      totalEvents: Number(stats.total_events ?? 0),
      oldestEvent: stats.oldest_event,
      newestEvent: stats.newest_event,
      uniqueAddresses,
    };
  }

  /**
   * 检查表是否存在
   */
  async tableExists(tableName: string): Promise<boolean> {
    try {
      const result = await this.chainDb.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_name = ?`,
        [tableName],
      );
      return result.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * 获取合约的事件表列表
   */
  async getContractEventTables(contractAddress: string): Promise<string[]> {
    try {
      const db = this.chainDb.getDrizzle();
      const results = await db
        .select({ tableName: eventTableRegistry.tableName })
        .from(eventTableRegistry)
        .where(
          and(
            eq(eventTableRegistry.contractAddress, contractAddress as `0x${string}`),
            eq(eventTableRegistry.isActive, true),
          ),
        );

      return results.map(r => r.tableName);
    } catch (error) {
      // If the table doesn't exist, return empty array
      if (error instanceof Error && error.message.includes('does not exist')) {
        logger.info('event_table_registry table does not exist yet, returning empty list');
        return [];
      }
      // For other errors, re-throw
      throw error;
    }
  }

  /**
   * 删除事件表
   */
  async dropEventTable(tableName: string): Promise<void> {
    try {
      await this.chainDb.exec(`DROP TABLE IF EXISTS ${tableName}`);

      const db = this.chainDb.getDrizzle();
      await db.delete(eventTableRegistry).where(eq(eventTableRegistry.tableName, tableName));

      this.createdTables.delete(tableName);
      logger.info({ tableName }, 'Dropped event table');
    } catch (error) {
      logger.error({ err: error, tableName }, 'Failed to drop table');
      throw error;
    }
  }

  /**
   * 获取表结构信息
   */
  async getTableSchema(tableName: string): Promise<{
    columns: Array<{ name: string; type: string; nullable: boolean }>;
    indexes: Array<{ name: string; columns: string[]; unique: boolean }>;
  }> {
    const columnsResult = await this.chainDb.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = ?`,
      [tableName],
    );

    const columns = columnsResult.map(col => ({
      name: (col as { column_name: string }).column_name,
      type: (col as { data_type: string }).data_type,
      nullable: (col as { is_nullable: string }).is_nullable === 'YES',
    }));

    const indexesResult = await this.chainDb.query(
      `SELECT index_name, column_name, is_unique
       FROM duckdb_indexes()
       WHERE table_name = ?`,
      [tableName],
    );

    const indexMap = new Map<string, { columns: string[]; unique: boolean }>();
    for (const row of indexesResult) {
      const r = row as { index_name: string; column_name: string; is_unique: boolean };
      const existing = indexMap.get(r.index_name);
      if (existing) {
        existing.columns.push(r.column_name);
      } else {
        indexMap.set(r.index_name, {
          columns: [r.column_name],
          unique: r.is_unique,
        });
      }
    }

    const indexes = Array.from(indexMap.entries()).map(([name, info]) => ({
      name,
      columns: info.columns,
      unique: info.unique,
    }));

    return { columns, indexes };
  }

  /**
   * 清理过期的事件表
   */
  async cleanupOldTables(daysOld: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const db = this.chainDb.getDrizzle();
    const results = await db
      .select({ tableName: eventTableRegistry.tableName })
      .from(eventTableRegistry)
      .where(
        or(
          lt(eventTableRegistry.lastAccessed, cutoffDate),
          sql`${eventTableRegistry.lastAccessed} IS NULL`,
        ),
      );

    let cleanedCount = 0;
    for (const row of results) {
      try {
        await this.dropEventTable(row.tableName);
        cleanedCount++;
      } catch (error) {
        logger.error({ err: error, tableName: row.tableName }, 'Failed to cleanup table');
      }
    }

    return cleanedCount;
  }

  /**
   * 获取链ID
   */
  getChainId(): number {
    return this.chainDb.getChainId();
  }

  /**
   * 创建用于过滤的参数索引
   */
  async createFilteringIndexes(tableName: string, parameters: string[]): Promise<void> {
    try {
      logger.info({ tableName }, 'Creating filtering indexes for table');

      // 为每个参数创建索引（如果它们是常用过滤字段）
      for (const param of parameters) {
        if (this.shouldCreateIndex(param)) {
          const indexName = `idx_${param}`;
          try {
            await this.chainDb.exec(`
              CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${param})
            `);
            logger.info({ indexName, param }, 'Created index');
          } catch (error) {
            logger.warn({ err: error, indexName }, 'Failed to create index');
          }
        }
      }

      // 创建复合索引以提高常见过滤组合的性能
      await this.createCompositeIndexes(tableName, parameters);
    } catch (error) {
      logger.error({ err: error, tableName }, 'Failed to create filtering indexes');
      throw error;
    }
  }

  /**
   * 判断是否应该为参数创建索引
   */
  private shouldCreateIndex(paramName: string): boolean {
    // 常见的过滤字段
    const indexableFields = [
      'from',
      'to',
      'owner',
      'spender',
      'sender',
      'value',
      'token',
      'event_name',
      'transaction_hash',
      'block_number',
      'block_timestamp',
      'contract_address',
    ];

    return indexableFields.includes(paramName);
  }

  /**
   * 创建复合索引以提高查询性能
   */
  private async createCompositeIndexes(tableName: string, parameters: string[]): Promise<void> {
    // 常见的复合索引组合
    const compositeIndexes = [
      { fields: ['from', 'block_timestamp'], name: 'idx_from_time' },
      { fields: ['to', 'block_timestamp'], name: 'idx_to_time' },
      { fields: ['event_name', 'block_timestamp'], name: 'idx_event_time' },
      { fields: ['transaction_hash', 'log_index'], name: 'idx_tx_log' },
      { fields: ['block_number', 'log_index'], name: 'idx_block_log' },
      { fields: ['contract_address', 'event_name'], name: 'idx_contract_event' },
      { fields: ['from', 'to'], name: 'idx_from_to' },
      { fields: ['value', 'block_timestamp'], name: 'idx_value_time' },
    ];

    for (const index of compositeIndexes) {
      // 检查所有字段都存在于参数中
      if (index.fields.every(field => parameters.includes(field))) {
        try {
          await this.chainDb.exec(`
            CREATE INDEX IF NOT EXISTS ${index.name} ON ${tableName} (${index.fields.join(', ')})
          `);
          logger.info({ indexName: index.name, fields: index.fields }, 'Created composite index');
        } catch (error) {
          logger.warn({ err: error, indexName: index.name }, 'Failed to create composite index');
        }
      }
    }
  }

  /**
   * 分析查询模式并建议新索引
   */
  async analyzeQueryPatterns(
    tableName: string,
    recentQueries: Record<string, unknown>[],
  ): Promise<{
    suggestions: string[];
    recommendedIndexes: Array<{ fields: string[]; reason: string }>;
  }> {
    const suggestions: string[] = [];
    const recommendedIndexes: Array<{ fields: string[]; reason: string }> = [];

    // 分析最近的查询模式
    const queryPatterns = this._analyzeQueryPatterns(recentQueries);

    // 生成索引建议
    for (const pattern of queryPatterns) {
      if (pattern.frequency > 5) {
        // 如果查询频率超过阈值
        recommendedIndexes.push({
          fields: pattern.fields,
          reason: `Frequently used ${pattern.frequency} times`,
        });

        if (!this.indexExists(tableName, pattern.fields)) {
          suggestions.push(
            `Consider creating index on (${pattern.fields.join(', ')}) for improved performance`,
          );
        }
      }
    }

    return { suggestions, recommendedIndexes };
  }

  /**
   * 分析查询模式
   */
  private _analyzeQueryPatterns(queries: Record<string, unknown>[]): Array<{
    fields: string[];
    frequency: number;
    type: string;
  }> {
    const patterns = new Map<string, { fields: string[]; frequency: number; type: string }>();

    for (const query of queries) {
      const filters = query.filters as { fields?: string[] } | undefined;
      const fields = Array.isArray(filters?.fields) ? filters.fields : [];
      const key = JSON.stringify(fields);
      const existing = patterns.get(key);

      if (existing) {
        existing.frequency++;
      } else {
        patterns.set(key, {
          fields,
          frequency: 1,
          type: typeof query.type === 'string' ? query.type : 'unknown',
        });
      }
    }

    return Array.from(patterns.values()).sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * 检查索引是否存在
   */
  private async indexExists(tableName: string, fields: string[]): Promise<boolean> {
    try {
      const indexesResult = await this.chainDb.query(
        `SELECT index_name, column_name
         FROM duckdb_indexes()
         WHERE table_name = ?`,
        [tableName],
      );

      const indexMap = new Map<string, string[]>();
      for (const row of indexesResult) {
        const r = row as { index_name: string; column_name: string };
        const cols = indexMap.get(r.index_name) ?? [];
        cols.push(r.column_name);
        indexMap.set(r.index_name, cols);
      }

      for (const indexColumns of indexMap.values()) {
        if (fields.every(field => indexColumns.includes(field))) {
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.warn({ err: error }, 'Failed to check index existence');
      return false;
    }
  }

  /**
   * 获取表的索引使用统计
   */
  async getIndexUsageStats(tableName: string): Promise<
    Array<{
      indexName: string;
      fields: string[];
      usageCount: number;
      lastUsed: Date | null;
      efficiency: number;
    }>
  > {
    try {
      // 在真实实现中，这里会查询数据库的索引使用统计
      // 目前返回模拟数据
      const schema = await this.getTableSchema(tableName);

      return schema.indexes.map(index => ({
        indexName: index.name,
        fields: index.columns,
        usageCount: Math.floor(Math.random() * 1000), // 模拟使用次数
        lastUsed: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000), // 模拟最后使用时间
        efficiency: 0.8 + Math.random() * 0.2, // 模拟效率评分
      }));
    } catch (error) {
      logger.warn({ err: error }, 'Failed to get index usage stats');
      return [];
    }
  }

  /**
   * 优化表索引
   */
  async optimizeIndexes(tableName: string): Promise<{
    optimizedIndexes: string[];
    droppedIndexes: string[];
    createdIndexes: string[];
  }> {
    const optimizedIndexes: string[] = [];
    const droppedIndexes: string[] = [];
    const createdIndexes: string[] = [];

    try {
      // 获取当前索引使用统计
      const indexStats = await this.getIndexUsageStats(tableName);

      // 分析哪些索引需要优化
      for (const stat of indexStats) {
        if (stat.efficiency < 0.5 && stat.usageCount < 10) {
          // 效率低且使用频率不高的索引
          try {
            await this.chainDb.exec(`DROP INDEX IF EXISTS ${stat.indexName}`);
            droppedIndexes.push(stat.indexName);
            logger.info({ indexName: stat.indexName }, 'Dropped inefficient index');
          } catch (error) {
            logger.warn({ err: error, indexName: stat.indexName }, 'Failed to drop index');
          }
        } else if (stat.usageCount > 100 && stat.efficiency > 0.8) {
          // 使用频繁且效率高的索引
          optimizedIndexes.push(stat.indexName);
        }
      }

      // 重新创建需要的索引
      const schema = await this.getTableSchema(tableName);
      const parameters = schema.columns.map(col => col.name);

      await this.createFilteringIndexes(tableName, parameters);
      createdIndexes.push(...parameters.filter(param => this.shouldCreateIndex(param)));

      logger.info({ tableName }, 'Index optimization completed for table');

      return { optimizedIndexes, droppedIndexes, createdIndexes };
    } catch (error) {
      logger.error({ err: error, tableName }, 'Failed to optimize indexes');
      throw error;
    }
  }

  /**
   * 获取索引建议
   */
  async getIndexingRecommendations(tableName: string): Promise<{
    currentIndexes: string[];
    suggestedIndexes: Array<{
      fields: string[];
      reason: string;
      priority: 'high' | 'medium' | 'low';
    }>;
    performanceImpact: string;
  }> {
    try {
      const schema = await this.getTableSchema(tableName);
      const currentIndexes = schema.indexes.map(index => index.name);

      const suggestedIndexes: Array<{
        fields: string[];
        reason: string;
        priority: 'high' | 'medium' | 'low';
      }> = [];

      // 基于字段类型和常用查询模式建议索引
      const parameters = schema.columns.map(col => col.name);

      // 高优先级：地址和时间字段
      const highPriorityFields = ['from', 'to', 'block_timestamp', 'transaction_hash'];
      for (const field of highPriorityFields) {
        if (parameters.includes(field) && !this.hasIndexForField(currentIndexes, field)) {
          suggestedIndexes.push({
            fields: [field],
            reason: 'Frequently filtered field',
            priority: 'high',
          });
        }
      }

      // 中优先级：数值和事件类型字段
      const mediumPriorityFields = ['value', 'event_name', 'block_number'];
      for (const field of mediumPriorityFields) {
        if (parameters.includes(field) && !this.hasIndexForField(currentIndexes, field)) {
          suggestedIndexes.push({
            fields: [field],
            reason: 'Commonly filtered field',
            priority: 'medium',
          });
        }
      }

      // 低优先级：其他字段
      const lowPriorityFields = parameters.filter(
        param => !highPriorityFields.includes(param) && !mediumPriorityFields.includes(param),
      );
      for (const field of lowPriorityFields) {
        if (!this.hasIndexForField(currentIndexes, field)) {
          suggestedIndexes.push({
            fields: [field],
            reason: 'Potentially useful for filtering',
            priority: 'low',
          });
        }
      }

      const compositeSuggestions: Array<{
        fields: string[];
        reason: string;
        priority: 'high' | 'medium' | 'low';
      }> = [
        {
          fields: ['from', 'block_timestamp'],
          reason: 'Address + time filtering',
          priority: 'high',
        },
        {
          fields: ['event_name', 'block_timestamp'],
          reason: 'Event type + time filtering',
          priority: 'high',
        },
        {
          fields: ['transaction_hash', 'log_index'],
          reason: 'Transaction lookup optimization',
          priority: 'medium',
        },
        {
          fields: ['block_number', 'log_index'],
          reason: 'Block navigation optimization',
          priority: 'medium',
        },
        { fields: ['from', 'to'], reason: 'Transfer pair filtering', priority: 'medium' },
      ];

      for (const suggestion of compositeSuggestions) {
        if (
          suggestion.fields.every(field => parameters.includes(field)) &&
          !this.hasIndexForField(currentIndexes, ...suggestion.fields)
        ) {
          suggestedIndexes.push({
            fields: suggestion.fields,
            reason: suggestion.reason,
            priority: suggestion.priority,
          });
        }
      }

      const performanceImpact = this.calculatePerformanceImpact(suggestedIndexes);

      return {
        currentIndexes,
        suggestedIndexes,
        performanceImpact,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get indexing recommendations');
      return {
        currentIndexes: [],
        suggestedIndexes: [],
        performanceImpact: 'unknown',
      };
    }
  }

  /**
   * 检查是否已存在指定字段的索引
   */
  private hasIndexForField(indexes: string[], ...fields: string[]): boolean {
    return indexes.some(indexName =>
      fields.some(field => indexName.toLowerCase().includes(field.toLowerCase())),
    );
  }

  /**
   * 计算性能影响
   */
  private calculatePerformanceImpact(
    suggestions: Array<{
      fields: string[];
      reason: string;
      priority: 'high' | 'medium' | 'low';
    }>,
  ): string {
    const highPriorityCount = suggestions.filter(s => s.priority === 'high').length;
    const mediumPriorityCount = suggestions.filter(s => s.priority === 'medium').length;
    const lowPriorityCount = suggestions.filter(s => s.priority === 'low').length;

    if (highPriorityCount > 0) {
      return 'High - Will significantly improve query performance';
    } else if (mediumPriorityCount > 2) {
      return 'Medium - Will moderately improve query performance';
    } else if (lowPriorityCount > 5) {
      return 'Low - May slightly improve query performance';
    } else {
      return 'Minimal - Little performance impact expected';
    }
  }

  /**
   * 获取已创建的表列表
   */
  getCreatedTables(): string[] {
    return Array.from(this.createdTables);
  }
}
