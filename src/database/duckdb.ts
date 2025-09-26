import { DuckDBInstance } from "@duckdb/node-api";
import { join } from "path";
import { mkdir } from "fs/promises";

/**
 * DuckDB数据库管理器
 * 使用最新的 @duckdb/node-api (Neo) 提供简单的查询接口，兼容现有代码
 */
export class DuckDBManager {
  private instance: DuckDBInstance | null = null;
  private isInitialized = false;
  private dbPath: string;

  constructor(dbPath?: string) {
    const dataDir = join(process.cwd(), "data");
    this.dbPath = dbPath || join(dataDir, "blockchain.db");

    // 确保数据目录存在
    mkdir(dataDir, { recursive: true }).catch(console.warn);
  }

  /**
   * 初始化数据库连接
   */
  private async connect(): Promise<void> {
    if (this.instance) return;

    // 根据官方文档，创建 DuckDB 实例
    this.instance = await DuckDBInstance.create(this.dbPath);
  }

  /**
   * 初始化数据库表结构
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // 防止重复初始化
    this.isInitialized = true;

    await this.connect();
    console.log("🚀 Initializing DuckDB database...");

    try {
      // 创建用户RPC配置表
      await this.exec(`
        CREATE TABLE IF NOT EXISTS user_rpc_configs (
          chain_id INTEGER PRIMARY KEY,
          name TEXT,
          url TEXT,
          max_event_range INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 创建合约源码表
      await this.exec(`
        CREATE TABLE IF NOT EXISTS contract_sources (
          chain_id INTEGER NOT NULL,
          address VARCHAR NOT NULL,
          name VARCHAR,
          compiler_version VARCHAR,
          optimization_enabled BOOLEAN,
          optimization_runs INTEGER,
          source_code TEXT,
          abi TEXT,
          constructor_arguments TEXT,
          verification_status VARCHAR,
          verification_source VARCHAR,
          verified_at TIMESTAMP,
          last_checked TIMESTAMP,
          is_proxy BOOLEAN,
          proxy_type VARCHAR,
          implementation_address VARCHAR,
          PRIMARY KEY (chain_id, address)
        )
      `);

      // 创建合约创建信息表
      await this.exec(`
        CREATE TABLE IF NOT EXISTS contract_creation_info (
          chain_id INTEGER NOT NULL,
          contract_address VARCHAR NOT NULL,
          creator_address VARCHAR,
          creation_tx_hash VARCHAR,
          creation_block_number BIGINT,
          creation_timestamp TIMESTAMP,
          gas_used BIGINT,
          gas_price BIGINT,
          search_status VARCHAR DEFAULT 'pending',
          error_message TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (chain_id, contract_address)
        )
      `);

      // 创建区块表
      await this.exec(`
        CREATE TABLE IF NOT EXISTS blocks (
          chain_id INTEGER NOT NULL,
          number BIGINT NOT NULL,
          hash VARCHAR NOT NULL,
          parent_hash VARCHAR,
          timestamp TIMESTAMP,
          miner VARCHAR,
          gas_limit BIGINT,
          gas_used BIGINT,
          base_fee_per_gas BIGINT,
          transaction_count INTEGER,
          size_bytes BIGINT,
          difficulty VARCHAR,
          total_difficulty VARCHAR,
          extra_data TEXT,
          logs_bloom TEXT,
          state_root VARCHAR,
          transactions_root VARCHAR,
          receipts_root VARCHAR,
          indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (chain_id, number)
        )
      `);

      // 创建交易表
      await this.exec(`
        CREATE TABLE IF NOT EXISTS transactions (
          chain_id INTEGER NOT NULL,
          hash VARCHAR NOT NULL,
          block_number BIGINT,
          transaction_index INTEGER,
          from_address VARCHAR,
          to_address VARCHAR,
          value VARCHAR,
          gas_limit BIGINT,
          gas_price BIGINT,
          max_fee_per_gas BIGINT,
          max_priority_fee_per_gas BIGINT,
          gas_used BIGINT,
          effective_gas_price BIGINT,
          status INTEGER,
          type INTEGER DEFAULT 0,
          nonce BIGINT,
          input_data TEXT,
          logs_count INTEGER DEFAULT 0,
          contract_address VARCHAR,
          cumulative_gas_used BIGINT,
          timestamp TIMESTAMP,
          indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (chain_id, hash)
        )
      `);

      // 创建地址索引表
      await this.exec(`
        CREATE TABLE IF NOT EXISTS indexed_addresses (
          chain_id INTEGER NOT NULL,
          address VARCHAR NOT NULL,
          label VARCHAR,
          first_seen_block BIGINT,
          last_seen_block BIGINT,
          transaction_count INTEGER DEFAULT 0,
          indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_queried TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (chain_id, address)
        )
      `);

      // 创建搜索历史表
      await this.exec(`
        CREATE TABLE IF NOT EXISTS search_history (
          id INTEGER PRIMARY KEY,
          chain_id INTEGER,
          query VARCHAR NOT NULL,
          result_type VARCHAR,
          result_id VARCHAR,
          searched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 创建用户偏好表
      await this.exec(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          key VARCHAR PRIMARY KEY,
          value TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 创建访问历史表
      await this.exec(`
        CREATE TABLE IF NOT EXISTS access_history (
          chain_id INTEGER NOT NULL,
          type VARCHAR NOT NULL,
          identifier VARCHAR NOT NULL,
          first_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          access_count INTEGER DEFAULT 1,
          PRIMARY KEY (chain_id, type, identifier)
        )
      `);

      // 创建索引
      await this.createIndexes();

      console.log("✅ DuckDB database initialized successfully!");
    } catch (error) {
      console.error("❌ Database initialization failed:", error);
      // 重置初始化标志，允许重试
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * 创建索引
   */
  private async createIndexes(): Promise<void> {
    const indexes = [
      // 合约源码索引
      "CREATE INDEX IF NOT EXISTS contract_sources_chain_verification_idx ON contract_sources (chain_id, verification_status)",
      "CREATE INDEX IF NOT EXISTS contract_sources_proxy_idx ON contract_sources (chain_id, is_proxy)",

      // 合约创建信息索引
      "CREATE INDEX IF NOT EXISTS contract_creation_info_status_idx ON contract_creation_info (search_status)",
      "CREATE INDEX IF NOT EXISTS contract_creation_info_tx_idx ON contract_creation_info (creation_tx_hash)",

      // 区块索引
      "CREATE INDEX IF NOT EXISTS blocks_chain_timestamp_idx ON blocks (chain_id, timestamp)",
      "CREATE INDEX IF NOT EXISTS blocks_chain_miner_idx ON blocks (chain_id, miner)",
      "CREATE INDEX IF NOT EXISTS blocks_hash_idx ON blocks (hash)",

      // 交易索引
      "CREATE INDEX IF NOT EXISTS transactions_chain_block_idx ON transactions (chain_id, block_number)",
      "CREATE INDEX IF NOT EXISTS transactions_chain_from_idx ON transactions (chain_id, from_address)",
      "CREATE INDEX IF NOT EXISTS transactions_chain_to_idx ON transactions (chain_id, to_address)",
      "CREATE INDEX IF NOT EXISTS transactions_chain_timestamp_idx ON transactions (chain_id, timestamp)",

      // 地址索引
      "CREATE INDEX IF NOT EXISTS indexed_addresses_chain_queried_idx ON indexed_addresses (chain_id, last_queried)",
      "CREATE INDEX IF NOT EXISTS indexed_addresses_global_idx ON indexed_addresses (address)",

      // 搜索历史索引
      "CREATE INDEX IF NOT EXISTS search_history_chain_idx ON search_history (chain_id, searched_at)",

      // 访问历史索引
      "CREATE INDEX IF NOT EXISTS access_history_chain_type_idx ON access_history (chain_id, type, last_accessed)",
    ];

    for (const indexSql of indexes) {
      try {
        await this.exec(indexSql);
      } catch (error) {
        console.warn(`⚠️ Index creation warning: ${error}`);
      }
    }
  }

  /**
   * 执行查询
   */
  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.instance) {
      throw new Error("Database not initialized");
    }

    try {
      // 根据官方文档，使用连接来执行查询
      const connection = await this.instance.connect();

      // 如果有参数，使用参数化查询
      if (params.length > 0) {
        const result = await connection.runAndReadAll(sql, params);
        connection.disconnectSync();
        return result.getRowObjects() as T[];
      } else {
        const result = await connection.runAndReadAll(sql);
        connection.disconnectSync();
        return result.getRowObjects() as T[];
      }
    } catch (error) {
      console.error("DuckDB Query Error:", { sql, params, error });
      throw error;
    }
  }

  /**
   * 执行SQL语句（无返回值）
   */
  async exec(sql: string): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.instance) {
      throw new Error("Database not initialized");
    }

    try {
      // 根据官方文档，使用连接来执行SQL
      const connection = await this.instance.connect();
      await connection.run(sql);
      connection.disconnectSync();
    } catch (error) {
      console.error("DuckDB Exec Error:", { sql, error });
      throw error;
    }
  }

  /**
   * 执行事务
   */
  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    if (!this.instance) {
      throw new Error("Database not initialized");
    }

    const connection = await this.instance.connect();
    try {
      await connection.run("BEGIN TRANSACTION");
      const result = await callback();
      await connection.run("COMMIT");
      return result;
    } catch (error) {
      await connection.run("ROLLBACK");
      throw error;
    } finally {
      connection.disconnectSync();
    }
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.instance) {
      // DuckDB Neo 实例会自动清理，不需要显式关闭
      this.instance = null;
    }
  }
}

// 全局数据库实例
export const db = new DuckDBManager();
