import * as duckdb from "duckdb";
import { join } from "path";

/**
 * DuckDB 到 postgres 的适配器
 * 实现 postgres 的核心接口，让 Drizzle ORM 可以直接使用
 */
export class DuckDBPostgresAdapter {
  private db: duckdb.Database;
  private connection: duckdb.Connection;
  private isInitialized = false;

  constructor(connectionString: string) {
    // 解析连接字符串，提取数据库路径
    const dbPath = this.parseConnectionString(connectionString);
    this.db = new duckdb.Database(dbPath);
    this.connection = this.db.connect();
  }

  private parseConnectionString(connectionString: string): string {
    // 支持格式：duckdb://path/to/database.db
    if (connectionString.startsWith("duckdb://")) {
      return connectionString.replace("duckdb://", "");
    }
    // 默认路径
    return join(process.cwd(), "data", "blockchain.db");
  }

  // 实现 postgres 的核心查询接口
  async query(
    sql: string | TemplateStringsArray,
    ...params: any[]
  ): Promise<any[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // 处理模板字符串格式 (Drizzle 使用的格式)
    let queryText: string;
    let queryParams: any[];

    if (typeof sql === "string") {
      queryText = sql;
      queryParams = params;
    } else {
      // 处理模板字符串 + 参数
      queryText = sql.join("?");
      queryParams = params;
    }

    return new Promise((resolve, reject) => {
      this.connection.all(
        queryText,
        ...queryParams,
        (err: Error | null, result: any[]) => {
          if (err) {
            reject(this.adaptError(err));
          } else {
            resolve(this.adaptResult(result || []));
          }
        }
      );
    });
  }

  // 实现 postgres 的事务接口
  async begin(callback: (sql: any) => Promise<any>): Promise<any> {
    await this.exec("BEGIN TRANSACTION");
    try {
      const result = await callback(this.createTransactionSql());
      await this.exec("COMMIT");
      return result;
    } catch (error) {
      await this.exec("ROLLBACK");
      throw error;
    }
  }

  // 创建事务 SQL 对象
  private createTransactionSql() {
    return {
      query: this.query.bind(this),
      // 其他 postgres 事务方法...
    };
  }

  // 执行 SQL 语句
  private async exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connection.exec(sql, (err: Error | null) => {
        if (err) reject(this.adaptError(err));
        else resolve();
      });
    });
  }

  // 错误适配 - 将 DuckDB 错误转换为 PostgreSQL 兼容格式
  private adaptError(error: Error): Error {
    // 这里可以将 DuckDB 的错误转换为 PostgreSQL 风格的错误
    // 让 Drizzle ORM 能够正确理解
    const adaptedError = new Error(error.message);
    (adaptedError as any).code = this.mapErrorCode(error.message);
    return adaptedError;
  }

  private mapErrorCode(message: string): string {
    // 将 DuckDB 错误映射到 PostgreSQL 错误代码
    if (message.includes("unique constraint")) return "23505";
    if (message.includes("not null constraint")) return "23502";
    if (message.includes("foreign key constraint")) return "23503";
    return "42000"; // 默认语法错误
  }

  // 结果适配 - 将 DuckDB 结果转换为 PostgreSQL 兼容格式
  private adaptResult(result: any[]): any[] {
    // DuckDB 和 PostgreSQL 的结果格式基本兼容
    // 这里可以做一些细微的调整
    return result.map((row) => {
      // 处理 BigInt 类型转换
      const adaptedRow = { ...row };
      for (const [key, value] of Object.entries(adaptedRow)) {
        if (typeof value === "bigint") {
          adaptedRow[key] = value.toString();
        }
      }
      return adaptedRow;
    });
  }

  // 初始化数据库
  private async initialize(): Promise<void> {
    // 确保数据目录存在
    await this.exec(`CREATE SCHEMA IF NOT EXISTS main`);
    this.isInitialized = true;
  }

  // 实现 postgres 的连接管理
  async end(): Promise<void> {
    return new Promise((resolve) => {
      this.db.close(() => resolve());
    });
  }

  // 实现 postgres 的监听器接口（可选）
  on(event: string, callback: Function): void {
    // DuckDB 不支持 LISTEN/NOTIFY，这里可以是空实现
  }

  off(event: string, callback?: Function): void {
    // 空实现
  }
}

// 创建适配器工厂函数，模拟 postgres 的使用方式
export function createDuckDBAdapter(connectionString: string) {
  const adapter = new DuckDBPostgresAdapter(connectionString);

  // 返回一个类似 postgres 的函数接口
  const sql = async (
    query: string | TemplateStringsArray,
    ...params: any[]
  ) => {
    return adapter.query(query, ...params);
  };

  // 添加 postgres 的其他方法
  sql.begin = adapter.begin.bind(adapter);
  sql.end = adapter.end.bind(adapter);
  sql.on = adapter.on.bind(adapter);
  sql.off = adapter.off.bind(adapter);

  return sql;
}
