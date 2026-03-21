/**
 * 动态表管理服务
 * 负责根据ABI事件动态创建和管理数据库表结构
 */

import { createLogger } from '../server/logger';

const logger = createLogger('dynamic-table-manager');
import { db } from '../database/init';
import { sql } from 'drizzle-orm';
import {
  TableColumn,
  TableIndex,
  ColumnType,
  EventParameter,
  EventIndexingConfig,
  TableCreationError,
  DEFAULT_EVENT_INDEXING_CONFIG,
  DEFAULT_TYPE_MAPPING,
  TypeMappingConfig,
} from '../types/events';

/**
 * Dynamic table schema definition
 */
type DynamicTableSchema = {
  tableName: string;
  columns: TableColumn[];
  indexes: TableIndex[];
};

/**
 * 表命名策略
 */
interface TableNamingStrategy {
  generateTableName(
    chainId: number,
    contractAddress: string,
    eventSignature: string,
    config: EventIndexingConfig,
  ): string;
}

/**
 * 默认表命名策略
 */
class DefaultTableNamingStrategy implements TableNamingStrategy {
  generateTableName(
    chainId: number,
    contractAddress: string,
    eventSignature: string,
    config: EventIndexingConfig,
  ): string {
    // 截取合约地址的前8位
    const shortAddress = contractAddress.slice(2, 10);
    // 截取事件签名的前8位
    const shortSignature = eventSignature.slice(2, 10);

    const tableName = `${config.tableNamePrefix}_${chainId}_${shortAddress}_${shortSignature}`;

    // 确保表名长度不超过限制
    if (tableName.length > config.maxTableNameLength) {
      return tableName.slice(0, config.maxTableNameLength);
    }

    return tableName;
  }
}

/**
 * 动态表管理器
 */
export class DynamicTableManager {
  private namingStrategy: TableNamingStrategy;
  private config: EventIndexingConfig;
  private typeMapping: TypeMappingConfig;
  private createdTables: Set<string>;

  constructor(
    config: Partial<EventIndexingConfig> = {},
    typeMapping: Partial<TypeMappingConfig> = {},
  ) {
    this.namingStrategy = new DefaultTableNamingStrategy();
    this.config = { ...DEFAULT_EVENT_INDEXING_CONFIG, ...config };
    this.typeMapping = { ...DEFAULT_TYPE_MAPPING, ...typeMapping };
    this.createdTables = new Set();
  }

  /**
   * 为ABI事件创建动态表结构
   */
  async createEventTable(
    chainId: number,
    contractAddress: string,
    eventParams: EventParameter[],
    eventSignature: string,
  ): Promise<string> {
    try {
      const tableName = this.namingStrategy.generateTableName(
        chainId,
        contractAddress,
        eventSignature,
        this.config,
      );

      // 检查表是否已存在
      if (this.createdTables.has(tableName)) {
        return tableName;
      }

      // 生成表结构
      const tableSchema = this.generateTableSchema(
        tableName,
        chainId,
        contractAddress,
        eventParams,
      );

      // 创建表
      await this.executeTableCreation(tableSchema);

      // 创建索引
      if (this.config.autoCreateIndexes) {
        await this.createTableIndexes(tableName, eventParams);
      }

      this.createdTables.add(tableName);
      logger.info({ tableName }, 'Created event table');

      return tableName;
    }
    catch (error) {
      const creationError = error instanceof Error ? error : new Error(String(error));
      throw new TableCreationError(
        `Failed to create table for event: ${creationError.message}`,
        `${this.config.tableNamePrefix}_${chainId}_${contractAddress}`,
        creationError,
      );
    }
  }

  /**
   * 检查表是否存在
   */
  async tableExists(tableName: string): Promise<boolean> {
    try {
      const result = await db.execute(
        sql`SELECT table_name FROM information_schema.tables WHERE table_name = ${tableName}`,
      );
      return result.length > 0;
    }
    catch {
      return false;
    }
  }

  /**
   * 获取表结构信息
   */
  async getTableSchema(tableName: string): Promise<TableColumn[]> {
    try {
      const result = await db.execute(
        sql`SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = ${tableName}`,
      );

      return result.map((row: Record<string, unknown>) => ({
        name: row.column_name as string,
        type: this.mapSqlTypeToColumnType(row.data_type as string),
        nullable: row.is_nullable === 'YES',
        defaultValue: row.column_default as string | undefined,
      }));
    }
    catch (error) {
      throw new Error(`Failed to get table schema for ${tableName}: ${error}`, { cause: error });
    }
  }

  /**
   * 删除表
   */
  async dropTable(tableName: string): Promise<void> {
    try {
      await db.execute(sql`DROP TABLE IF EXISTS ${tableName}`);
      this.createdTables.delete(tableName);
      logger.info({ tableName }, 'Dropped table');
    }
    catch (error) {
      throw new Error(`Failed to drop table ${tableName}: ${error}`, { cause: error });
    }
  }

  /**
   * 清理过期的表
   */
  async cleanupOldTables(retentionDays: number): Promise<string[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const cleanedTables: string[] = [];

    try {
      const prefix = `${this.config.tableNamePrefix}_%`;
      const tables = await db.execute(
        sql`SELECT table_name AS name FROM information_schema.tables WHERE table_name LIKE ${prefix}`,
      );

      for (const table of tables) {
        const tableName = table.name as string;

        // 检查表的最旧记录
        const oldestRecord = await db.execute(
          sql`SELECT MIN(indexedAt) as oldest FROM ${tableName}`,
        );

        if (oldestRecord.length > 0 && oldestRecord[0].oldest) {
          const oldestDate = new Date(oldestRecord[0].oldest as string | number | Date);

          if (oldestDate < cutoffDate) {
            await this.dropTable(tableName);
            cleanedTables.push(tableName);
          }
        }
      }

      logger.info({ count: cleanedTables.length }, 'Cleaned up old tables');
      return cleanedTables;
    }
    catch (error) {
      logger.error({ err: error }, 'Failed to cleanup old tables');
      return [];
    }
  }

  /**
   * 批量创建表
   */
  async createTablesBatch(
    tableDefinitions: Array<{
      chainId: number;
      contractAddress: string;
      eventParams: EventParameter[];
      eventSignature: string;
    }>,
  ): Promise<string[]> {
    const tableNames: string[] = [];
    const errors: Error[] = [];

    for (const definition of tableDefinitions) {
      try {
        const tableName = await this.createEventTable(
          definition.chainId,
          definition.contractAddress,
          definition.eventParams,
          definition.eventSignature,
        );
        tableNames.push(tableName);
      }
      catch (error) {
        errors.push(error as Error);
        logger.error(
          { err: error, eventSignature: definition.eventSignature },
          'Failed to create table for event',
        );
      }
    }

    if (errors.length > 0) {
      logger.warn(
        { tableCount: tableNames.length, errorCount: errors.length },
        'Created tables with errors',
      );
    }

    return tableNames;
  }

  /**
   * 生成表结构
   */
  private generateTableSchema(
    tableName: string,
    chainId: number,
    contractAddress: string,
    eventParams: EventParameter[],
  ): DynamicTableSchema {
    const columns: TableColumn[] = [
      // 通用字段
      {
        name: 'chainId',
        type: ColumnType.INTEGER,
        nullable: false,
      },
      {
        name: 'txHash',
        type: ColumnType.TX_HASH,
        nullable: false,
      },
      {
        name: 'blockNumber',
        type: ColumnType.BIGNUM,
        nullable: false,
      },
      {
        name: 'transactionIndex',
        type: ColumnType.INTEGER,
        nullable: false,
      },
      {
        name: 'logIndex',
        type: ColumnType.INTEGER,
        nullable: false,
      },
      {
        name: 'contractAddress',
        type: ColumnType.ADDRESS,
        nullable: false,
      },
      {
        name: 'eventSignature',
        type: ColumnType.HASH32,
        nullable: false,
      },
      {
        name: 'blockTimestamp',
        type: ColumnType.TIMESTAMP,
        nullable: false,
      },
      {
        name: 'indexedAt',
        type: ColumnType.DATETIME,
        nullable: false,
        defaultValue: sql`now()`,
      },

      // 事件参数字段
      ...eventParams.map(param => this.createColumnFromParameter(param)),
    ];

    return {
      tableName,
      columns,
      indexes: this.generateIndexDefinitions(tableName, eventParams),
    };
  }

  /**
   * 从事件参数创建列定义
   */
  private createColumnFromParameter(param: EventParameter): TableColumn {
    const columnName = this.sanitizeColumnName(param.name);
    const columnType = this.getColumnType(param.type);

    return {
      name: columnName,
      type: columnType,
      nullable: !param.indexed, // indexed参数不能为空
      indexed: param.indexed,
    };
  }

  /**
   * 获取列类型
   */
  private getColumnType(abiType: string): ColumnType {
    // 检查基础类型
    if (this.typeMapping.basicTypes[abiType]) {
      return this.typeMapping.basicTypes[abiType];
    }

    // 检查数组类型
    if (this.typeMapping.arrayTypes[abiType]) {
      return this.typeMapping.arrayTypes[abiType];
    }

    // 检查自定义类型
    if (this.typeMapping.customTypes[abiType]) {
      return this.typeMapping.customTypes[abiType];
    }

    // 动态类型判断
    if (abiType.match(/^(u?)int\d+$/)) {
      return ColumnType.BIGNUM;
    }

    if (abiType.match(/^bytes\d*$/)) {
      if (abiType === 'bytes32') {
        return ColumnType.HASH32;
      }
      return ColumnType.HEX_DATA;
    }

    if (abiType.includes('[]')) {
      return ColumnType.TEXT; // 数组存储为JSON
    }

    if (abiType === 'tuple') {
      return ColumnType.TEXT; // 结构体存储为JSON
    }

    // 默认使用TEXT类型
    return ColumnType.TEXT;
  }

  /**
   * 清理列名
   */
  private sanitizeColumnName(name: string): string {
    // 移除特殊字符，确保SQL安全
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * 生成索引定义
   */
  private generateIndexDefinitions(tableName: string, eventParams: EventParameter[]): TableIndex[] {
    const indexes: TableIndex[] = [
      // 基础索引
      {
        name: `idx_${tableName}_chain_block`,
        columns: ['chainId', 'blockNumber'],
      },
      {
        name: `idx_${tableName}_tx_hash`,
        columns: ['txHash'],
      },
      {
        name: `idx_${tableName}_contract_addr`,
        columns: ['contractAddress'],
      },
      {
        name: `idx_${tableName}_event_sig`,
        columns: ['eventSignature'],
      },
      {
        name: `idx_${tableName}_block_time`,
        columns: ['blockTimestamp'],
      },
    ];

    // 为indexed参数创建索引
    eventParams
      .filter(param => param.indexed)
      .forEach((param) => {
        const columnName = this.sanitizeColumnName(param.name);
        indexes.push({
          name: `idx_${tableName}_${columnName}`,
          columns: [columnName],
        });
      });

    // 为常见事件模式创建复合索引
    if (this.isCommonEvent(eventParams)) {
      indexes.push(...this.getCommonEventIndexes(tableName, eventParams));
    }

    return indexes;
  }

  /**
   * 判断是否为常见事件类型
   */
  private isCommonEvent(eventParams: EventParameter[]): boolean {
    const commonEventSignatures = [
      'Transfer(address,address,uint256)',
      'Approval(address,address,uint256)',
      'Transfer(address,address)',
      'Swap(address,uint256,uint256,uint256,uint256,address)',
    ];

    const eventSignature = eventParams
      .map(p => `${p.type}${p.indexed ? ' indexed' : ''} ${p.name}`)
      .join(', ');

    return commonEventSignatures.some(sig => eventSignature.includes(sig));
  }

  /**
   * 获取常见事件的特殊索引
   */
  private getCommonEventIndexes(tableName: string, eventParams: EventParameter[]): TableIndex[] {
    const indexes: TableIndex[] = [];

    // Transfer事件索引
    if (
      eventParams.length === 3
      && eventParams[0].type === 'address'
      && eventParams[1].type === 'address'
      && eventParams[2].type === 'uint256'
    ) {
      indexes.push({
        name: `idx_${tableName}_from_to`,
        columns: ['from', 'to'],
      });
    }

    return indexes;
  }

  /**
   * 执行表创建SQL
   */
  private async executeTableCreation(schema: DynamicTableSchema): Promise<void> {
    const columnsSQL = schema.columns
      .map((col) => {
        let columnDef = `${col.name} ${this.getColumnTypeSQL(col.type)}`;

        if (!col.nullable) {
          columnDef += ' NOT NULL';
        }

        if (col.defaultValue !== undefined) {
          columnDef += ` DEFAULT ${col.defaultValue}`;
        }

        return columnDef;
      })
      .join(', ');

    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS ${schema.tableName} (
        ${columnsSQL},
        PRIMARY KEY (chainId, txHash, logIndex)
      )
    `;

    await db.execute(sql.raw(createTableSQL));
  }

  /**
   * 创建表索引
   */
  private async createTableIndexes(
    tableName: string,
    eventParams: EventParameter[],
  ): Promise<void> {
    const indexes = this.generateIndexDefinitions(tableName, eventParams);

    for (const index of indexes) {
      const indexSQL = `
        CREATE INDEX IF NOT EXISTS ${index.name}
        ON ${tableName}(${index.columns.join(', ')})
      `;

      await db.execute(sql.raw(indexSQL));
    }
  }

  /**
   * 获取列类型的SQL表示
   */
  private getColumnTypeSQL(type: ColumnType): string {
    const typeMapping = {
      [ColumnType.INTEGER]: 'INTEGER',
      [ColumnType.BIGNUM]: 'TEXT', // 使用TEXT存储大数字
      [ColumnType.BOOLEAN]: 'INTEGER',
      [ColumnType.ADDRESS]: 'CHAR(42)',
      [ColumnType.TX_HASH]: 'CHAR(66)',
      [ColumnType.BLOCK_HASH]: 'CHAR(66)',
      [ColumnType.HASH32]: 'CHAR(66)',
      [ColumnType.HEX_DATA]: 'TEXT',
      [ColumnType.TEXT]: 'TEXT',
      [ColumnType.TIMESTAMP]: 'INTEGER',
      [ColumnType.DATETIME]: 'TEXT',
    };

    return typeMapping[type] || 'TEXT';
  }

  /**
   * 将SQL类型映射到ColumnType
   */
  private mapSqlTypeToColumnType(sqlType: string): ColumnType {
    const typeMapping: Record<string, ColumnType> = {
      'INTEGER': ColumnType.INTEGER,
      'TEXT': ColumnType.TEXT,
      'CHAR(42)': ColumnType.ADDRESS,
      'CHAR(66)': ColumnType.HASH32,
    };

    return typeMapping[sqlType.toUpperCase()] || ColumnType.TEXT;
  }
}

/**
 * 导出单例实例
 */
export const dynamicTableManager = new DynamicTableManager();
