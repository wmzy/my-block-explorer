/**
 * 内存数据库实现
 * 用于开发和测试，不依赖原生数据库模块
 */

export type QueryResult = Record<string, any>;

/**
 * 简单的内存数据库
 */
export class MemoryDatabase {
  private tables = new Map<string, QueryResult[]>();
  private isInitialized = false;

  constructor() {
    this.initializeTables();
  }

  /**
   * 初始化表结构
   */
  private initializeTables(): void {
    // 初始化所有需要的表
    this.tables.set("user_rpc_configs", []);
    this.tables.set("blocks", []);
    this.tables.set("transactions", []);
    this.tables.set("indexed_addresses", []);
    this.tables.set("search_history", []);
    this.tables.set("user_preferences", []);
    this.tables.set("access_history", []);
    this.tables.set("contract_sources", []);

    this.isInitialized = true;
    console.log(
      "✅ Memory database initialized with tables:",
      Array.from(this.tables.keys())
    );
  }

  /**
   * 执行查询
   */
  async query<T = QueryResult>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.isInitialized) {
      this.initializeTables();
    }

    // 简化的SQL解析
    const normalizedSql = sql.trim().toLowerCase();

    try {
      // SELECT 查询
      if (normalizedSql.startsWith("select")) {
        return this.handleSelect(sql, params) as T[];
      }

      // INSERT 查询
      if (normalizedSql.startsWith("insert")) {
        return this.handleInsert(sql, params) as T[];
      }

      // UPDATE 查询
      if (normalizedSql.startsWith("update")) {
        return this.handleUpdate(sql, params) as T[];
      }

      // DELETE 查询
      if (normalizedSql.startsWith("delete")) {
        return this.handleDelete(sql, params) as T[];
      }

      // 默认返回空结果
      return [] as T[];
    } catch (error) {
      console.warn("Memory DB Query Warning:", { sql, params, error });
      return [] as T[];
    }
  }

  /**
   * 执行SQL语句
   */
  async exec(sql: string): Promise<void> {
    await this.query(sql);
  }

  /**
   * 执行事务
   */
  async transaction<T>(callback: () => T): Promise<T> {
    // 在内存数据库中，事务就是直接执行
    return callback();
  }

  /**
   * 处理SELECT查询
   */
  private handleSelect(sql: string, params: any[]): QueryResult[] {
    // 提取表名
    const tableMatch = sql.match(/from\s+(\w+)/i);
    if (!tableMatch) {
      return [];
    }

    const tableName = tableMatch[1];
    const table = this.tables.get(tableName);

    if (!table) {
      return [];
    }

    // 简单的WHERE条件处理
    let results = [...table];

    // 处理WHERE条件
    const whereMatch = sql.match(
      /where\s+(.+?)(?:\s+order\s+by|\s+limit|\s*$)/i
    );
    if (whereMatch && params.length > 0) {
      const whereClause = whereMatch[1];

      // 简单的参数替换
      let paramIndex = 0;
      results = results.filter((row) => {
        // 这里是一个非常简化的WHERE处理
        // 实际应用中需要更复杂的SQL解析
        if (
          whereClause.includes("chain_id = ?") &&
          params[paramIndex] !== undefined
        ) {
          return row.chain_id === params[paramIndex];
        }
        if (
          whereClause.includes("hash = ?") &&
          params[paramIndex] !== undefined
        ) {
          return row.hash === params[paramIndex];
        }
        if (
          whereClause.includes("address = ?") &&
          params[paramIndex] !== undefined
        ) {
          return row.address === params[paramIndex];
        }
        if (
          whereClause.includes("key = ?") &&
          params[paramIndex] !== undefined
        ) {
          return row.key === params[paramIndex];
        }
        return true;
      });
    }

    // 处理ORDER BY
    const orderMatch = sql.match(/order\s+by\s+(\w+)(?:\s+(desc|asc))?/i);
    if (orderMatch) {
      const column = orderMatch[1];
      const direction = orderMatch[2]?.toLowerCase() || "asc";

      results.sort((a, b) => {
        const aVal = a[column];
        const bVal = b[column];

        if (aVal < bVal) return direction === "asc" ? -1 : 1;
        if (aVal > bVal) return direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    // 处理LIMIT
    const limitMatch = sql.match(/limit\s+(\?|\d+)(?:\s+offset\s+(\?|\d+))?/i);
    if (limitMatch) {
      let limit: number;
      let offset: number = 0;

      if (limitMatch[1] === "?") {
        // 从参数中获取limit值
        const limitParamIndex = (sql.match(/\?/g) || []).length - 1;
        limit = parseInt(params[limitParamIndex] || "10");
      } else {
        limit = parseInt(limitMatch[1]);
      }

      if (limitMatch[2]) {
        if (limitMatch[2] === "?") {
          // 从参数中获取offset值
          const offsetParamIndex = (sql.match(/\?/g) || []).length - 1;
          offset = parseInt(params[offsetParamIndex] || "0");
        } else {
          offset = parseInt(limitMatch[2]);
        }
      }

      results = results.slice(offset, offset + limit);
    }

    return results;
  }

  /**
   * 处理INSERT查询
   */
  private handleInsert(sql: string, params: any[]): QueryResult[] {
    const tableMatch = sql.match(/insert\s+(?:or\s+replace\s+)?into\s+(\w+)/i);
    if (!tableMatch) {
      return [];
    }

    const tableName = tableMatch[1];
    const table = this.tables.get(tableName);

    if (!table) {
      return [];
    }

    // 提取列名
    const columnsMatch = sql.match(/\(([^)]+)\)\s+values/i);
    if (!columnsMatch) {
      return [];
    }

    const columns = columnsMatch[1].split(",").map((col) => col.trim());

    // 创建新记录
    const newRecord: QueryResult = {};
    columns.forEach((col, index) => {
      newRecord[col] = params[index];
    });

    // 添加时间戳
    if (
      !newRecord.created_at &&
      !newRecord.indexed_at &&
      !newRecord.updated_at
    ) {
      newRecord.indexed_at = new Date().toISOString();
    }

    // 检查是否是REPLACE操作
    if (sql.toLowerCase().includes("or replace")) {
      // 简单的替换逻辑：根据主键替换
      const existingIndex = table.findIndex((row) => {
        if (tableName === "user_preferences") {
          return row.key === newRecord.key;
        }
        if (tableName === "blocks") {
          return (
            row.chain_id === newRecord.chain_id &&
            row.number === newRecord.number
          );
        }
        if (tableName === "transactions") {
          return (
            row.chain_id === newRecord.chain_id && row.hash === newRecord.hash
          );
        }
        if (tableName === "indexed_addresses") {
          return (
            row.chain_id === newRecord.chain_id &&
            row.address === newRecord.address
          );
        }
        return false;
      });

      if (existingIndex >= 0) {
        table[existingIndex] = { ...table[existingIndex], ...newRecord };
      } else {
        table.push(newRecord);
      }
    } else {
      table.push(newRecord);
    }

    return [newRecord];
  }

  /**
   * 处理UPDATE查询
   */
  private handleUpdate(sql: string, params: any[]): QueryResult[] {
    // 简化实现：暂时返回空结果
    return [];
  }

  /**
   * 处理DELETE查询
   */
  private handleDelete(sql: string, params: any[]): QueryResult[] {
    // 简化实现：暂时返回空结果
    return [];
  }

  /**
   * 获取表数据（用于调试）
   */
  getTable(tableName: string): QueryResult[] {
    return this.tables.get(tableName) || [];
  }

  /**
   * 获取所有表名
   */
  getTables(): string[] {
    return Array.from(this.tables.keys());
  }

  /**
   * 清空所有数据
   */
  clear(): void {
    for (const table of this.tables.values()) {
      table.length = 0;
    }
  }

  /**
   * 关闭数据库（内存数据库无需关闭）
   */
  async close(): Promise<void> {
    console.log("Memory database closed");
  }

  /**
   * 初始化方法（兼容接口）
   */
  async initialize(): Promise<void> {
    if (!this.isInitialized) {
      this.initializeTables();
    }
  }
}

// 全局内存数据库实例
export const db = new MemoryDatabase();
