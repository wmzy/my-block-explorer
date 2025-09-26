import { DuckDBInstance } from "@duckdb/node-api";
import { join } from "path";
import { mkdir } from "fs/promises";
import { type Sql } from "postgres";

/**
 * DuckDB 到 postgres 的适配器
 * 使用最新的 @duckdb/node-api (Neo) 实现 postgres 的核心接口，让 Drizzle ORM 可以直接使用
 */
export class DuckDBPostgresAdapter {
  private instance: DuckDBInstance | null = null;
  private isInitialized = false;
  private dbPath: string;

  constructor(connectionString: string) {
    // 解析连接字符串，提取数据库路径
    this.dbPath = this.parseConnectionString(connectionString);

    // 确保数据目录存在
    const dataDir = join(process.cwd(), "data");
    mkdir(dataDir, { recursive: true }).catch(console.warn);
  }

  private parseConnectionString(connectionString: string): string {
    // 支持格式：duckdb://path/to/database.db
    if (connectionString.startsWith("duckdb://")) {
      return connectionString.replace("duckdb://", "");
    }
    // 默认路径
    return join(process.cwd(), "data", "blockchain.db");
  }

  /**
   * 初始化数据库连接
   */
  private async connect(): Promise<void> {
    if (this.instance) return;

    // 使用 DuckDB Neo API 创建实例
    this.instance = await DuckDBInstance.create(this.dbPath);
  }

  public async getDuckDB(): Promise<DuckDBInstance> {
    if (!this.instance) {
      await this.connect();
    }
    return this.instance!;
  }

  // 内部查询执行方法 - 提取公共逻辑
  private async executeQuery(
    queryText: string,
    queryParams: any[],
    connection?: any
  ): Promise<any[]> {
    const conn = connection || (await this.instance!.connect());
    const shouldDisconnect = !connection;

    try {
      const result =
        queryParams.length > 0
          ? await conn.runAndReadAll(queryText, queryParams)
          : await conn.runAndReadAll(queryText);

      return this.adaptResult(result.getRowObjects());
    } finally {
      if (shouldDisconnect) {
        conn.disconnectSync();
      }
    }
  }

  // 实现 postgres 的核心查询接口
  async query(
    sql: string | TemplateStringsArray,
    ...params: any[]
  ): Promise<any[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.instance) {
      throw new Error("Database not initialized");
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

    // 注意：DuckDB 原生支持 PostgreSQL 风格的参数占位符 ($1, $2, ...)
    // 不需要转换为 ? 风格

    try {
      return await this.executeQuery(queryText, queryParams);
    } catch (error) {
      throw this.adaptError(error as Error);
    }
  }

  // 实现 postgres 的事务接口
  async begin(callback: (sql: any) => Promise<any>): Promise<any> {
    if (!this.instance) {
      throw new Error("Database not initialized");
    }

    console.log("🔄 DuckDB Transaction: BEGIN TRANSACTION");
    const connection = await this.instance.connect();
    let transactionActive = false;

    try {
      await connection.run("BEGIN TRANSACTION");
      transactionActive = true;
      console.log("✅ DuckDB Transaction: Transaction started");

      // 创建事务 SQL 对象，使用同一个连接
      const transactionSql = {
        query: async (sql: string, ...params: any[]) => {
          // 使用公共的查询执行逻辑，传入事务连接
          return await this.executeQuery(sql, params, connection);
        },
        // 添加其他必要的方法
        unsafe: (query: string, params?: any[]) => {
          // 重要：必须使用事务中的连接，而不是创建新连接
          const queryPromise = (async () => {
            // 使用公共的查询执行逻辑，传入事务连接
            return await this.executeQuery(query, params || [], connection);
          })();

          (queryPromise as any).values = async () => {
            const data = await queryPromise;
            return data.map((row: any) => Object.values(row));
          };
          return queryPromise;
        },
      };

      const result = await callback(transactionSql);
      await connection.run("COMMIT");
      console.log("✅ DuckDB Transaction: COMMIT");
      transactionActive = false;
      return result;
    } catch (error) {
      console.error("Transaction error:", error);
      if (transactionActive) {
        try {
          await connection.run("ROLLBACK");
          console.log("🔄 DuckDB Transaction: ROLLBACK");
        } catch (rollbackError) {
          console.warn("Failed to rollback transaction:", rollbackError);
        }
      }
      throw this.adaptError(error as Error);
    } finally {
      connection.disconnectSync();
    }
  }

  // 执行 SQL 语句
  private async exec(sql: string): Promise<void> {
    if (!this.instance) {
      throw new Error("Database not initialized");
    }

    try {
      const connection = await this.instance.connect();
      await connection.run(sql);
      connection.disconnectSync();
    } catch (error) {
      throw this.adaptError(error as Error);
    }
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
      // 处理 BigInt 类型转换和时间戳
      const adaptedRow = { ...row };
      for (const [key, value] of Object.entries(adaptedRow)) {
        if (typeof value === "bigint") {
          adaptedRow[key] = value.toString();
        } else if (
          value &&
          typeof value === "object" &&
          value.constructor.name === "DuckDBTimestampValue"
        ) {
          // 将 DuckDB 时间戳转换为 JavaScript Date
          adaptedRow[key] = new Date(Number(value.micros) / 1000);
        }
      }
      return adaptedRow;
    });
  }

  // 初始化数据库
  private async initialize(): Promise<void> {
    await this.connect();

    // 确保数据目录存在，创建基本schema
    try {
      await this.exec(`CREATE SCHEMA IF NOT EXISTS main`);
    } catch (error) {
      // 忽略schema已存在的错误
      console.warn("Schema creation warning:", error);
    }

    this.isInitialized = true;
  }

  // 实现 postgres 的连接管理
  async end(): Promise<void> {
    if (this.instance) {
      // DuckDB Neo 实例会自动清理
      this.instance = null;
    }
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
  const sql: any = async (
    query: string | TemplateStringsArray,
    ...params: any[]
  ) => {
    return adapter.query(query, ...params);
  };

  // 添加 postgres 的其他方法
  sql.begin = adapter.begin.bind(adapter);
  sql.transaction = adapter.begin.bind(adapter); // Drizzle 可能期望 transaction 方法
  sql.end = adapter.end.bind(adapter);
  sql.on = adapter.on.bind(adapter);
  sql.off = adapter.off.bind(adapter);

  // 添加 Drizzle 需要的 unsafe 方法
  sql.unsafe = (query: string, params?: any[]) => {
    // 直接返回查询结果，不包装在复杂对象中
    const queryPromise = adapter.query(query, ...(params || []));

    // 为查询 Promise 添加 postgres-js 的方法
    (queryPromise as any).values = async () => {
      const data = await queryPromise;

      // postgres-js 的 values() 方法返回数组的数组，而不是对象的数组
      // 我们需要将对象数组转换为数组的数组
      const arrayResult = data.map((row: any) => {
        // 获取所有字段的值，按照查询中的字段顺序
        return Object.values(row);
      });

      return arrayResult;
    };

    (queryPromise as any).raw = () => queryPromise;
    (queryPromise as any).execute = () => queryPromise;
    (queryPromise as any).cursor = () => ({
      next: () => Promise.resolve({ done: true }),
    });
    (queryPromise as any).stream = () => queryPromise;
    (queryPromise as any).forEach = (callback: any) =>
      queryPromise.then((rows: any[]) => rows.forEach(callback));

    // 其他属性
    (queryPromise as any).state = { status: "ready" };
    (queryPromise as any).statement = { query, params };
    (queryPromise as any).signature = query;
    (queryPromise as any).cancel = () => {};
    (queryPromise as any).cancelled = false;
    (queryPromise as any).executed = false;
    (queryPromise as any).active = true;

    return queryPromise;
  };

  // 添加 Drizzle 需要的 options 属性
  sql.options = {
    parsers: {},
    serializers: {},
    transform: {
      undefined: null,
    },
  };

  // 添加其他 postgres 客户端属性
  sql.parameters = {};
  sql.types = {};

  sql.getDuckDB = adapter.getDuckDB.bind(adapter);

  return sql as Sql & Pick<DuckDBPostgresAdapter, "getDuckDB">;
}
