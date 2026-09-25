/**
 * Chain-specific event table manager
 * Manages per-chain event tables; cross-chain queries are not supported
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
 * Chain-specific event table manager
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
   * Create a dynamic table for an ABI event
   */
  async createEventTable(
    contractAddress: string,
    eventParams: EventParameter[],
    eventSignature: string,
    eventName: string,
  ): Promise<string> {
    try {
      const tableName = this.generateTableName(contractAddress, eventSignature);

      // Check whether the table already exists
      if (this.createdTables.has(tableName)) {
        return tableName;
      }

      const eventAbi: AbiEvent = {
        name: eventName,
        type: 'event',
        inputs: eventParams,
      };

      // Create the event table
      const createTableSQL = await this.schemaManager.getCreateEventTableSQL(tableName, eventAbi);
      await this.chainDb.exec(createTableSQL);

      // Create indexes
      const indexes = this.schemaManager.getEventTableIndexesSQL(tableName, eventAbi);
      for (const indexSql of indexes) {
        await this.chainDb.exec(indexSql);
      }

      // Register the event table
      await this.registerEventTable(
        contractAddress,
        eventSignature,
        eventName,
        tableName,
        eventAbi as unknown as EventAbiShape,
      );

      // Cache the table name
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
   * Generate a table name (unique within the chain)
   */
  private generateTableName(contractAddress: string, eventSignature: string): string {
    // Take the first 8 chars of the contract address
    const shortAddress = contractAddress.slice(2, 10);
    // Take the first 8 chars of the event signature
    const shortSignature = eventSignature.slice(2, 10);

    const tableName = `${this.config.tableNamePrefix}_${shortAddress}_${shortSignature}`;

    // Keep the table name within the length limit
    if (tableName.length > this.config.maxTableNameLength) {
      return tableName.slice(0, this.config.maxTableNameLength);
    }

    return tableName;
  }

  /**
   * Register an event table in the metadata table
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
   * Insert event data
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
   * Insert event data in batch
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
   * Query event data
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

    // Build the WHERE clauses
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

    // Handle custom filter conditions
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

    // Sort
    const sortBy = options.sortBy ?? 'block_timestamp';
    const sortOrder = options.sort ?? 'desc';
    const orderClause = `ORDER BY ${sortBy} ${sortOrder}`;

    // Paginate
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

    // Query the data
    const querySql = `
      SELECT * FROM ${tableName}
      ${finalWhereClause}
      ${orderClause}
      LIMIT ${limit + 1}
    `;

    const events = await this.chainDb.query(querySql, params);

    // Check whether more data exists
    const hasMore = events.length > limit;
    const returnedEvents = hasMore ? events.slice(0, -1) : events;

    // Build the next-page cursor
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
   * Get event statistics
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

    // Count unique addresses (needs an extra query)
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
   * Check whether a table exists
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
   * List a contract's event tables
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
   * Drop an event table
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
   * Get table schema information
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
   * Clean up expired event tables
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
   * Get the chain ID
   */
  getChainId(): number {
    return this.chainDb.getChainId();
  }

  /**
   * Create indexes on parameters used for filtering
   */
  async createFilteringIndexes(tableName: string, parameters: string[]): Promise<void> {
    try {
      logger.info({ tableName }, 'Creating filtering indexes for table');

      // Index each parameter that is a common filter field
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

      // Create composite indexes for common filter combinations
      await this.createCompositeIndexes(tableName, parameters);
    } catch (error) {
      logger.error({ err: error, tableName }, 'Failed to create filtering indexes');
      throw error;
    }
  }

  /**
   * Decide whether a parameter should be indexed
   */
  private shouldCreateIndex(paramName: string): boolean {
    // Common filter fields
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
   * Create composite indexes to speed up queries
   */
  private async createCompositeIndexes(tableName: string, parameters: string[]): Promise<void> {
    // Common composite index combinations
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
      // Check that all fields exist among the parameters
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
   * Analyze query patterns and suggest new indexes
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

    // Analyze recent query patterns
    const queryPatterns = this._analyzeQueryPatterns(recentQueries);

    // Produce index suggestions
    for (const pattern of queryPatterns) {
      if (pattern.frequency > 5) {
        // When query frequency exceeds the threshold
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
   * Analyze query patterns
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
   * Check whether an index exists
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
   * Get index usage statistics for a table
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
      // A real implementation would query the database for index usage statistics
      // Return mock data for now
      const schema = await this.getTableSchema(tableName);

      return schema.indexes.map(index => ({
        indexName: index.name,
        fields: index.columns,
        usageCount: Math.floor(Math.random() * 1000), // mock usage count
        lastUsed: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000), // mock last-used time
        efficiency: 0.8 + Math.random() * 0.2, // mock efficiency score
      }));
    } catch (error) {
      logger.warn({ err: error }, 'Failed to get index usage stats');
      return [];
    }
  }

  /**
   * Optimize table indexes
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
      // Get current index usage statistics
      const indexStats = await this.getIndexUsageStats(tableName);

      // Analyze which indexes need optimization
      for (const stat of indexStats) {
        if (stat.efficiency < 0.5 && stat.usageCount < 10) {
          // Inefficient and rarely used indexes
          try {
            await this.chainDb.exec(`DROP INDEX IF EXISTS ${stat.indexName}`);
            droppedIndexes.push(stat.indexName);
            logger.info({ indexName: stat.indexName }, 'Dropped inefficient index');
          } catch (error) {
            logger.warn({ err: error, indexName: stat.indexName }, 'Failed to drop index');
          }
        } else if (stat.usageCount > 100 && stat.efficiency > 0.8) {
          // Frequently used, efficient indexes
          optimizedIndexes.push(stat.indexName);
        }
      }

      // Recreate the indexes we keep
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
   * Get index suggestions
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

      // Suggest indexes from field types and common query patterns
      const parameters = schema.columns.map(col => col.name);

      // High priority: address and time fields
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

      // Medium priority: numeric and event-type fields
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

      // Low priority: other fields
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
   * Check whether an index already exists for the given fields
   */
  private hasIndexForField(indexes: string[], ...fields: string[]): boolean {
    return indexes.some(indexName =>
      fields.some(field => indexName.toLowerCase().includes(field.toLowerCase())),
    );
  }

  /**
   * Estimate performance impact
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
   * List created tables
   */
  getCreatedTables(): string[] {
    return Array.from(this.createdTables);
  }
}
