/**
 * 链特定事件表管理器
 * 为每个链管理独立的事件表，不支持跨链查询
 */

import { ChainDatabaseManager } from './chain-database-manager';
import { ChainSchemaManager } from './chain-schema-manager';
import {
  DynamicTableSchema,
  TableColumn,
  EventParameter,
  EventIndexingConfig
} from '../types/events';

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
      ...config
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
    eventName: string
  ): Promise<string> {
    try {
      const tableName = this.generateTableName(contractAddress, eventSignature);

      // 检查表是否已存在
      if (this.createdTables.has(tableName)) {
        return tableName;
      }

      const eventAbi = {
        name: eventName,
        type: 'event',
        inputs: eventParams
      };

      // 创建事件表
      await this.chainDb.exec(this.schemaManager.getCreateEventTableSQL(tableName, eventAbi));

      // 创建索引
      const indexes = this.schemaManager.getEventTableIndexesSQL(tableName, eventAbi);
      for (const indexSql of indexes) {
        await this.chainDb.exec(indexSql);
      }

      // 注册事件表
      await this.registerEventTable(contractAddress, eventSignature, eventName, tableName, eventAbi);

      // 缓存表名
      this.createdTables.add(tableName);

      console.log(`✅ Created event table: ${tableName} for ${eventName} on chain ${this.chainDb.getChainId()}`);
      return tableName;

    } catch (error) {
      console.error(`❌ Failed to create event table for ${eventName}:`, error);
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
    eventAbi: any
  ): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO event_table_registry (
        contract_address, event_signature, event_name, table_name, table_schema, updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    await this.chainDb.exec(sql);
  }

  /**
   * 插入事件数据
   */
  async insertEventData(tableName: string, eventData: any): Promise<void> {
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
  async insertEventDataBatch(tableName: string, eventsData: any[]): Promise<void> {
    if (eventsData.length === 0) return;

    const columns = Object.keys(eventsData[0]);
    const placeholders = eventsData.map(() =>
      `(${columns.map(() => '?').join(', ')})`
    ).join(', ');

    const values = eventsData.flatMap(event => Object.values(event));

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
      [key: string]: any;
    } = {},
    options: {
      limit?: number;
      cursor?: string;
      sort?: 'asc' | 'desc';
      sortBy?: string;
    } = {}
  ): Promise<{ events: any[]; hasMore: boolean; nextCursor?: string }> {
    let whereClauses: string[] = [];
    let params: any[] = [];

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
      if (!['eventName', 'fromBlock', 'toBlock', 'fromTimestamp', 'toTimestamp'].includes(key) && value !== undefined) {
        whereClauses.push(`${key} = ?`);
        params.push(value);
      }
    });

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 排序
    const sortBy = options.sortBy || 'block_timestamp';
    const sortOrder = options.sort || 'desc';
    const orderClause = `ORDER BY ${sortBy} ${sortOrder}`;

    // 分页
    const limit = Math.min(options.limit || 50, 1000);
    let cursorClause = '';
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
    let nextCursor;
    if (hasMore && returnedEvents.length > 0) {
      const lastEvent = returnedEvents[returnedEvents.length - 1];
      nextCursor = lastEvent[sortBy];
    }

    return {
      events: returnedEvents,
      hasMore,
      nextCursor
    };
  }

  /**
   * 获取事件统计信息
   */
  async getEventStatistics(tableName: string, timeRange?: string): Promise<{
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

    let params: any[] = [];
    if (timeRange) {
      sql += ` WHERE block_timestamp >= DATE_SUB(NOW(), INTERVAL ${timeRange})`;
    }

    const result = await this.chainDb.query(sql, params);

    if (result.length === 0) {
      return { totalEvents: 0 };
    }

    const stats = result[0];

    // 获取唯一地址数量（需要额外的查询）
    let uniqueAddresses;
    if (stats.total_events > 0) {
      const addressQuery = `
        SELECT COUNT(DISTINCT contract_address) as unique_addresses
        FROM ${tableName}
        ${timeRange ? ` WHERE block_timestamp >= DATE_SUB(NOW(), INTERVAL ${timeRange})` : ''}
      `;
      const addressResult = await this.chainDb.query(addressQuery);
      uniqueAddresses = addressResult[0]?.unique_addresses || 0;
    }

    return {
      totalEvents: Number(stats.total_events),
      oldestEvent: stats.oldest_event,
      newestEvent: stats.newest_event,
      uniqueAddresses
    };
  }

  /**
   * 检查表是否存在
   */
  async tableExists(tableName: string): Promise<boolean> {
    try {
      const result = await this.chainDb.query(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name=?
      `, [tableName]);
      return result.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * 获取合约的事件表列表
   */
  async getContractEventTables(contractAddress: string): Promise<string[]> {
    const result = await this.chainDb.query(`
      SELECT table_name FROM event_table_registry
      WHERE contract_address = ? AND is_active = TRUE
    `, [contractAddress]);

    return result.map(row => row.table_name);
  }

  /**
   * 删除事件表
   */
  async dropEventTable(tableName: string): Promise<void> {
    try {
      await this.chainDb.exec(`DROP TABLE IF EXISTS ${tableName}`);
      await this.chainDb.exec(`
        DELETE FROM event_table_registry
        WHERE table_name = ?
      `, [tableName]);

      this.createdTables.delete(tableName);
      console.log(`🗑️ Dropped event table: ${tableName}`);
    } catch (error) {
      console.error(`❌ Failed to drop table ${tableName}:`, error);
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
    // 获取列信息
    const columnsResult = await this.chainDb.query(`
      PRAGMA table_info(${tableName})
    `);

    const columns = columnsResult.map(col => ({
      name: col.name,
      type: col.type,
      nullable: col.notnull === 0
    }));

    // 获取索引信息
    const indexesResult = await this.chainDb.query(`
      PRAGMA index_list(${tableName})
    `);

    const indexes = await Promise.all(
      indexesResult.map(async (index) => {
        const indexInfoResult = await this.chainDb.query(`
          PRAGMA index_info(${index.name})
        `);

        return {
          name: index.name,
          columns: indexInfoResult.map(info => info.name),
          unique: index.unique === 1
        };
      })
    );

    return { columns, indexes };
  }

  /**
   * 清理过期的事件表
   */
  async cleanupOldTables(daysOld: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.chainDb.query(`
      SELECT table_name FROM event_table_registry
      WHERE last_accessed < ? OR last_accessed IS NULL
    `, [cutoffDate.toISOString()]);

    let cleanedCount = 0;
    for (const row of result) {
      try {
        await this.dropEventTable(row.table_name);
        cleanedCount++;
      } catch (error) {
        console.error(`Failed to cleanup table ${row.table_name}:`, error);
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
   * 获取已创建的表列表
   */
  getCreatedTables(): string[] {
    return Array.from(this.createdTables);
  }
}