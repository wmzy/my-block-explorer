import { DuckDBInstance } from '@duckdb/node-api';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { type Sql } from 'postgres';
import { createLogger } from '../server/logger';

const logger = createLogger('duckdb-postgres-adapter');

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
    const dataDir = join(process.cwd(), 'data');
    mkdir(dataDir, { recursive: true }).catch(err => logger.warn({ err }, 'Failed to create data directory'));
  }

  private parseConnectionString(connectionString: string): string {
    // 支持格式：duckdb://path/to/database.db
    if (connectionString.startsWith('duckdb://')) {
      return connectionString.replace('duckdb://', '');
    }
    // 默认路径
    return join(process.cwd(), 'data', 'blockchain.db');
  }

  /**
   * 初始化数据库连接
   */
  private async connect(): Promise<void> {
    if (this.instance) return;

    this.instance = await DuckDBInstance.create(this.dbPath);
    await this.ensureTables();
  }

  private async ensureTables(): Promise<void> {
    if (!this.instance) return;
    const conn = await this.instance.connect();
    try {
      const ddls = [
        // user_rpc_configs: matches schema.ts userRpcConfigs
        `CREATE TABLE IF NOT EXISTS user_rpc_configs (
          chain_id INTEGER PRIMARY KEY, name VARCHAR(255), url VARCHAR(500),
          supports_history BOOLEAN, max_event_range INTEGER,
          created_at TIMESTAMP_MS, updated_at TIMESTAMP_MS)`,
        // blocks: matches schema.ts blocks
        `CREATE TABLE IF NOT EXISTS blocks (
          chain_id INTEGER NOT NULL, number BIGNUM NOT NULL,
          hash char(66) NOT NULL, parent_hash char(66),
          timestamp TIMESTAMP_S, miner char(42),
          gas_limit BIGNUM, gas_used BIGNUM, base_fee_per_gas BIGNUM,
          transaction_count INTEGER, size_bytes INTEGER,
          difficulty BIGNUM, total_difficulty BIGNUM,
          extra_data TEXT, logs_bloom TEXT,
          state_root char(66), transactions_root char(66), receipts_root char(66),
          indexed_at TIMESTAMP_MS,
          PRIMARY KEY (chain_id, number))`,
        // transactions: matches schema.ts transactions
        `CREATE TABLE IF NOT EXISTS transactions (
          chain_id INTEGER NOT NULL, hash char(66) NOT NULL,
          block_number BIGNUM, transaction_index INTEGER,
          from_address char(42), to_address char(42), value BIGNUM,
          gas_limit BIGNUM, gas_price BIGNUM,
          max_fee_per_gas BIGNUM, max_priority_fee_per_gas BIGNUM,
          gas_used BIGNUM, effective_gas_price BIGNUM,
          status INTEGER, type INTEGER DEFAULT 0, nonce BIGNUM,
          input_data TEXT, logs_count INTEGER DEFAULT 0,
          contract_address char(42), cumulative_gas_used BIGNUM,
          timestamp TIMESTAMP_S, indexed_at TIMESTAMP_MS,
          PRIMARY KEY (chain_id, hash))`,
        // indexed_addresses: matches schema.ts indexedAddresses
        `CREATE TABLE IF NOT EXISTS indexed_addresses (
          chain_id INTEGER NOT NULL, address char(42) NOT NULL,
          type VARCHAR(20) NOT NULL, first_seen TIMESTAMP_S,
          last_activity TIMESTAMP_S, transaction_count INTEGER DEFAULT 0,
          indexed_at TIMESTAMP_MS,
          PRIMARY KEY (chain_id, address))`,
        // search_history: matches schema.ts searchHistory
        `CREATE TABLE IF NOT EXISTS search_history (
          id INTEGER PRIMARY KEY, chain_id INTEGER,
          query VARCHAR(255), search_type VARCHAR(20),
          result_count INTEGER DEFAULT 0, searched_at TIMESTAMP_MS)`,
        // user_preferences: matches schema.ts userPreferences
        `CREATE TABLE IF NOT EXISTS user_preferences (
          id INTEGER PRIMARY KEY, theme VARCHAR(20) DEFAULT 'light',
          language VARCHAR(10) DEFAULT 'en', updated_at TIMESTAMP_MS)`,
        // index_status: matches schema.ts indexStatus
        `CREATE TABLE IF NOT EXISTS index_status (
          chain_id INTEGER NOT NULL, index_type VARCHAR(20) NOT NULL,
          last_indexed_block BIGNUM, last_indexed_at TIMESTAMP_MS,
          PRIMARY KEY (chain_id, index_type))`,
        // access_history: matches schema.ts accessHistory
        `CREATE TABLE IF NOT EXISTS access_history (
          chain_id INTEGER NOT NULL, type VARCHAR(20) NOT NULL,
          identifier VARCHAR(66) NOT NULL,
          first_accessed TIMESTAMP_MS, last_accessed TIMESTAMP_MS,
          access_count INTEGER DEFAULT 1,
          PRIMARY KEY (chain_id, type, identifier))`,
        // contract_sources: matches schema.ts contractSources
        `CREATE TABLE IF NOT EXISTS contract_sources (
          chain_id INTEGER NOT NULL, address char(42) NOT NULL,
          source_code TEXT, abi TEXT,
          contract_name VARCHAR(255), compiler_version VARCHAR(50),
          optimization_used BOOLEAN, runs INTEGER,
          constructor_arguments TEXT, evm_version VARCHAR(50),
          library TEXT, license_type VARCHAR(50),
          proxy VARCHAR(50), implementation char(42),
          swarm_source VARCHAR(100),
          is_verified BOOLEAN DEFAULT false,
          verification_date TIMESTAMP_MS, last_updated TIMESTAMP_MS,
          PRIMARY KEY (chain_id, address))`,
        // contract_creation_info: matches schema.ts contractCreationInfo
        `CREATE TABLE IF NOT EXISTS contract_creation_info (
          chain_id INTEGER NOT NULL, address char(42) NOT NULL,
          creation_tx_hash char(66), creation_block_number BIGNUM,
          creation_timestamp TIMESTAMP_S,
          creator_address char(42), factory_address char(42),
          creation_method VARCHAR(50), last_updated TIMESTAMP_MS,
          PRIMARY KEY (chain_id, address))`,
        // indexing_progress: matches schema.ts indexingProgress
        `CREATE TABLE IF NOT EXISTS indexing_progress (
          chain_id INTEGER NOT NULL, address char(42) NOT NULL,
          creation_block BIGNUM, last_indexed_block BIGNUM,
          last_finalized_block BIGNUM,
          total_events_indexed INTEGER DEFAULT 0,
          status VARCHAR(20) DEFAULT 'idle', error_message TEXT,
          updated_at TIMESTAMP_MS,
          PRIMARY KEY (chain_id, address))`,
        // contract_events: matches schema.ts contractEvents
        `CREATE TABLE IF NOT EXISTS contract_events (
          chain_id INTEGER NOT NULL, contract_address char(42) NOT NULL,
          block_number BIGNUM NOT NULL, block_timestamp TIMESTAMP_S,
          transaction_hash char(66) NOT NULL, transaction_index INTEGER,
          log_index INTEGER NOT NULL, event_name VARCHAR(100),
          event_signature VARCHAR(66), decoded_args TEXT,
          topic0 VARCHAR(66), topic1 VARCHAR(66),
          topic2 VARCHAR(66), topic3 VARCHAR(66),
          data TEXT, is_finalized BOOLEAN DEFAULT false,
          indexed_at TIMESTAMP_MS,
          PRIMARY KEY (chain_id, transaction_hash, log_index))`,
        `CREATE INDEX IF NOT EXISTS contract_events_chain_contract_idx ON contract_events (chain_id, contract_address)`,
        `CREATE INDEX IF NOT EXISTS contract_events_chain_contract_block_idx ON contract_events (chain_id, contract_address, block_number)`,
        `CREATE INDEX IF NOT EXISTS contract_events_chain_contract_name_idx ON contract_events (chain_id, contract_address, event_name)`,
      ];
      for (const ddl of ddls) {
        try { await conn.run(ddl); }
        catch { /* already exists */ }
      }
    }
    finally {
      conn.disconnectSync();
    }
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
    queryParams: unknown[],
    connection?: Awaited<ReturnType<DuckDBInstance['connect']>>,
  ): Promise<Record<string, unknown>[]> {
    const conn = connection || (await this.instance!.connect());
    const shouldDisconnect = !connection;

    try {
      const result
        = queryParams.length > 0
          ? await conn.runAndReadAll(queryText, queryParams as Parameters<typeof conn.runAndReadAll>[1])
          : await conn.runAndReadAll(queryText);

      return this.adaptResult(result.getRowObjects() as Record<string, unknown>[]);
    }
    finally {
      if (shouldDisconnect) {
        conn.disconnectSync();
      }
    }
  }

  // 实现 postgres 的核心查询接口
  async query(
    sql: string | TemplateStringsArray,
    ...params: unknown[]
  ): Promise<Record<string, unknown>[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.instance) {
      throw new Error('Database not initialized');
    }

    // 处理模板字符串格式 (Drizzle 使用的格式)
    let queryText: string;
    let queryParams: unknown[];

    if (typeof sql === 'string') {
      queryText = sql;
      queryParams = params;
    }
    else {
      // 处理模板字符串 + 参数
      queryText = sql.join('?');
      queryParams = params;
    }

    // 注意：DuckDB 原生支持 PostgreSQL 风格的参数占位符 ($1, $2, ...)
    // 不需要转换为 ? 风格

    try {
      return await this.executeQuery(queryText, queryParams);
    }
    catch (error) {
      throw this.adaptError(error as Error);
    }
  }

  // 实现 postgres 的事务接口
  async begin<T>(callback: (sql: TransactionSql) => Promise<T>): Promise<T> {
    if (!this.instance) {
      throw new Error('Database not initialized');
    }

    logger.info('DuckDB Transaction: BEGIN TRANSACTION');
    const connection = await this.instance.connect();
    let transactionActive = false;

    try {
      await connection.run('BEGIN TRANSACTION');
      transactionActive = true;
      logger.info('DuckDB Transaction: Transaction started');

      // 创建事务 SQL 对象，使用同一个连接
      const transactionSql: TransactionSql = {
        query: async (sql: string, ...params: unknown[]) => {
          return await this.executeQuery(sql, params, connection);
        },
        unsafe: (query: string, params?: unknown[]) => {
          const queryPromise = (async () => {
            return await this.executeQuery(query, params || [], connection);
          })();
          return this.extendQueryPromise(queryPromise, query, params || []);
        },
      };

      const result = await callback(transactionSql);
      await connection.run('COMMIT');
      logger.info('DuckDB Transaction: COMMIT');
      transactionActive = false;
      return result;
    }
    catch (error) {
      logger.error({ err: error }, 'Transaction error');
      if (transactionActive) {
        try {
          await connection.run('ROLLBACK');
          logger.info('DuckDB Transaction: ROLLBACK');
        }
        catch (rollbackError) {
          logger.warn({ err: rollbackError }, 'Failed to rollback transaction');
        }
      }
      throw this.adaptError(error as Error);
    }
    finally {
      connection.disconnectSync();
    }
  }

  // 执行 SQL 语句
  private async exec(sql: string): Promise<void> {
    if (!this.instance) {
      throw new Error('Database not initialized');
    }

    try {
      const connection = await this.instance.connect();
      await connection.run(sql);
      connection.disconnectSync();
    }
    catch (error) {
      throw this.adaptError(error as Error);
    }
  }

  // 错误适配 - 将 DuckDB 错误转换为 PostgreSQL 兼容格式
  private adaptError(error: Error): Error & { code?: string } {
    const adaptedError = new Error(error.message) as Error & { code?: string };
    adaptedError.code = this.mapErrorCode(error.message);
    return adaptedError;
  }

  private mapErrorCode(message: string): string {
    // 将 DuckDB 错误映射到 PostgreSQL 错误代码
    if (message.includes('unique constraint')) return '23505';
    if (message.includes('not null constraint')) return '23502';
    if (message.includes('foreign key constraint')) return '23503';
    return '42000'; // 默认语法错误
  }

  // 结果适配 - 将 DuckDB 结果转换为 PostgreSQL 兼容格式
  private adaptResult(result: Record<string, unknown>[]): Record<string, unknown>[] {
    return result.map((row: Record<string, unknown>) => {
      const adaptedRow: Record<string, unknown> = { ...row };
      for (const [key, value] of Object.entries(adaptedRow)) {
        if (typeof value === 'bigint') {
          adaptedRow[key] = value.toString();
        }
        else if (value && typeof value === 'object') {
          // Handle DuckDB HUGEINT (128-bit integer) returned by count(*)
          // HUGEINT is represented as { high: number, low: bigint } or similar
          const obj = value as Record<string, unknown>;
          if ('high' in obj && 'low' in obj) {
            // Convert HUGEINT to number (safe for counts up to 2^53 - 1)
            const low = typeof obj.low === 'bigint' ? obj.low : BigInt(obj.low as number);
            const high = typeof obj.high === 'number' ? BigInt(obj.high) : obj.high as bigint;
            adaptedRow[key] = Number((high << 64n) + low);
          }
          else if (value.constructor.name === 'DuckDBTimestampValue') {
            const tsValue = value as { micros?: number };
            adaptedRow[key] = new Date(Number(tsValue.micros) / 1000);
          }
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
    }
    catch (error) {
      // 忽略schema已存在的错误
      logger.warn({ err: error }, 'Schema creation warning');
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
  on(_event: string, _callback: (...args: unknown[]) => void): void {
    // DuckDB 不支持 LISTEN/NOTIFY，这里可以是空实现
  }

  off(_event: string, _callback?: (...args: unknown[]) => void): void {
    // 空实现
  }

  // 扩展查询 Promise 以兼容 postgres-js 接口
  extendQueryPromise(
    queryPromise: Promise<Record<string, unknown>[]>,
    query: string,
    params: unknown[],
  ): Promise<Record<string, unknown>[]> & PostgresQueryExtensions {
    const extended = queryPromise as Promise<Record<string, unknown>[]>
      & PostgresQueryExtensions;
    extended.values = async () =>
      (await queryPromise).map(row => Object.values(row));
    extended.raw = () => queryPromise;
    extended.execute = () => queryPromise;
    extended.cursor = () => ({ next: () => Promise.resolve({ done: true }) });
    extended.stream = () => queryPromise;
    extended.forEach = (callback: (row: Record<string, unknown>) => void) =>
      queryPromise.then(rows => rows.forEach(callback));
    extended.state = { status: 'ready' };
    extended.statement = { query, params };
    extended.signature = query;
    extended.cancel = () => {};
    extended.cancelled = false;
    extended.executed = false;
    extended.active = true;
    return extended;
  }
}

type TransactionSql = {
  query: (sql: string, ...params: unknown[]) => Promise<Record<string, unknown>[]>;
  unsafe: (
    query: string,
    params?: unknown[],
  ) => Promise<Record<string, unknown>[]> & PostgresQueryExtensions;
};

type PostgresQueryExtensions = {
  values: () => Promise<unknown[][]>;
  raw: () => Promise<Record<string, unknown>[]>;
  execute: () => Promise<Record<string, unknown>[]>;
  cursor: () => { next: () => Promise<{ done: boolean }> };
  stream: () => Promise<Record<string, unknown>[]>;
  forEach: (callback: (row: Record<string, unknown>) => void) => Promise<void>;
  state: { status: string };
  statement: { query: string; params: unknown[] };
  signature: string;
  cancel: () => void;
  cancelled: boolean;
  executed: boolean;
  active: boolean;
};

// 创建适配器工厂函数，模拟 postgres 的使用方式
export function createDuckDBAdapter(connectionString: string) {
  const adapter = new DuckDBPostgresAdapter(connectionString);

  type SqlFunction = (
    query: string | TemplateStringsArray,
    ...params: unknown[]
  ) => Promise<Record<string, unknown>[]>;

  const sql = (async (
    query: string | TemplateStringsArray,
    ...params: unknown[]
  ) => adapter.query(query, ...params)) as SqlFunction & {
    begin: typeof adapter.begin;
    transaction: typeof adapter.begin;
    end: typeof adapter.end;
    on: typeof adapter.on;
    off: typeof adapter.off;
    unsafe: (
      query: string,
      params?: unknown[],
    ) => Promise<Record<string, unknown>[]> & PostgresQueryExtensions;
    options: { parsers: Record<string, unknown>; serializers: Record<string, unknown>; transform: Record<string, unknown> };
    parameters: Record<string, unknown>;
    types: Record<string, unknown>;
    getDuckDB: typeof adapter.getDuckDB;
  };

  sql.begin = adapter.begin.bind(adapter);
  sql.transaction = adapter.begin.bind(adapter);
  sql.end = adapter.end.bind(adapter);
  sql.on = adapter.on.bind(adapter);
  sql.off = adapter.off.bind(adapter);

  sql.unsafe = (query: string, params?: unknown[]) => {
    const queryPromise = adapter.query(query, ...(params || []));
    return adapter.extendQueryPromise(queryPromise, query, params || []);
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

  return sql as unknown as Sql & Pick<DuckDBPostgresAdapter, 'getDuckDB'>;
}
