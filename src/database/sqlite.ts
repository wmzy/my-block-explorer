import Database from "better-sqlite3";
import { join } from "path";
import { mkdir } from "fs/promises";

/**
 * SQLite数据库管理器
 * 使用better-sqlite3替代DuckDB，提供更好的兼容性
 */
export class SQLiteManager {
  private db: Database.Database;
  private isInitialized = false;

  constructor(dbPath?: string) {
    const dataDir = join(process.cwd(), "data");
    const defaultPath = join(dataDir, "blockchain.db");

    // 确保数据目录存在
    mkdir(dataDir, { recursive: true }).catch(console.warn);

    this.db = new Database(dbPath || defaultPath);

    // 启用WAL模式以提高并发性能
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("cache_size = 1000000");
    this.db.pragma("temp_store = memory");
  }

  /**
   * 初始化数据库表结构
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log("🚀 Initializing SQLite database...");

    try {
      // 创建用户RPC配置表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS user_rpc_configs (
          chain_id INTEGER PRIMARY KEY,
          custom_rpc_url TEXT,
          rpc_backup_urls TEXT,
          timeout_ms INTEGER DEFAULT 10000,
          retry_count INTEGER DEFAULT 3,
          rate_limit INTEGER DEFAULT 100,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 创建区块表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS blocks (
          chain_id INTEGER NOT NULL,
          number INTEGER NOT NULL,
          hash TEXT NOT NULL,
          parent_hash TEXT,
          timestamp DATETIME,
          miner TEXT,
          gas_limit INTEGER,
          gas_used INTEGER,
          base_fee_per_gas INTEGER,
          transaction_count INTEGER,
          size_bytes INTEGER,
          difficulty TEXT,
          total_difficulty TEXT,
          extra_data TEXT,
          logs_bloom TEXT,
          state_root TEXT,
          transactions_root TEXT,
          receipts_root TEXT,
          indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (chain_id, number)
        )
      `);

      // 创建交易表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS transactions (
          chain_id INTEGER NOT NULL,
          hash TEXT NOT NULL,
          block_number INTEGER,
          transaction_index INTEGER,
          from_address TEXT,
          to_address TEXT,
          value TEXT,
          gas_limit INTEGER,
          gas_price INTEGER,
          max_fee_per_gas INTEGER,
          max_priority_fee_per_gas INTEGER,
          gas_used INTEGER,
          effective_gas_price INTEGER,
          status INTEGER,
          type INTEGER DEFAULT 0,
          nonce INTEGER,
          input_data TEXT,
          logs_count INTEGER DEFAULT 0,
          contract_address TEXT,
          cumulative_gas_used INTEGER,
          timestamp DATETIME,
          indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (chain_id, hash)
        )
      `);

      // 创建地址索引表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS indexed_addresses (
          chain_id INTEGER NOT NULL,
          address TEXT NOT NULL,
          label TEXT,
          first_seen_block INTEGER,
          last_seen_block INTEGER,
          transaction_count INTEGER DEFAULT 0,
          indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_queried DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (chain_id, address)
        )
      `);

      // 创建搜索历史表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS search_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chain_id INTEGER,
          query TEXT NOT NULL,
          result_type TEXT,
          result_id TEXT,
          searched_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 创建用户偏好表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 创建访问历史表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS access_history (
          chain_id INTEGER NOT NULL,
          type TEXT NOT NULL,
          identifier TEXT NOT NULL,
          first_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
          access_count INTEGER DEFAULT 1,
          PRIMARY KEY (chain_id, type, identifier)
        )
      `);

      // 创建索引
      await this.createIndexes();

      this.isInitialized = true;
      console.log("✅ Database initialized successfully!");
    } catch (error) {
      console.error("❌ Database initialization failed:", error);
      throw error;
    }
  }

  /**
   * 创建索引
   */
  private async createIndexes(): Promise<void> {
    const indexes = [
      // 区块索引
      "CREATE INDEX IF NOT EXISTS blocks_chain_timestamp_idx ON blocks (chain_id, timestamp)",
      "CREATE INDEX IF NOT EXISTS blocks_chain_miner_idx ON blocks (chain_id, miner)",
      "CREATE INDEX IF NOT EXISTS blocks_hash_idx ON blocks (hash)",

      // 交易索引
      "CREATE INDEX IF NOT EXISTS transactions_chain_block_idx ON transactions (chain_id, block_number)",
      "CREATE INDEX IF NOT EXISTS transactions_chain_from_idx ON transactions (chain_id, from_address)",
      "CREATE INDEX IF NOT EXISTS transactions_chain_to_idx ON transactions (chain_id, to_address)",
      "CREATE INDEX IF NOT EXISTS transactions_chain_timestamp_idx ON transactions (chain_id, timestamp)",
      "CREATE INDEX IF NOT EXISTS transactions_hash_idx ON transactions (hash)",

      // 地址索引
      "CREATE INDEX IF NOT EXISTS indexed_addresses_chain_queried_idx ON indexed_addresses (chain_id, last_queried)",
      "CREATE INDEX IF NOT EXISTS indexed_addresses_global_idx ON indexed_addresses (address)",

      // 搜索历史索引
      "CREATE INDEX IF NOT EXISTS search_history_chain_idx ON search_history (chain_id, searched_at)",

      // 访问历史索引
      "CREATE INDEX IF NOT EXISTS access_history_chain_type_idx ON access_history (chain_id, type, last_accessed)",
      "CREATE INDEX IF NOT EXISTS access_history_count_idx ON access_history (access_count)",
    ];

    for (const indexSql of indexes) {
      try {
        this.db.exec(indexSql);
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

    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.all(...params) as T[];
      return result;
    } catch (error) {
      console.error("SQL Query Error:", { sql, params, error });
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

    try {
      this.db.exec(sql);
    } catch (error) {
      console.error("SQL Exec Error:", { sql, error });
      throw error;
    }
  }

  /**
   * 执行事务
   */
  async transaction<T>(callback: () => T): Promise<T> {
    const transaction = this.db.transaction(callback);
    return transaction();
  }

  /**
   * 获取数据库统计信息
   */
  getStats(): {
    totalSize: number;
    pageCount: number;
    pageSize: number;
    walMode: boolean;
  } {
    const sizeResult = this.db.pragma("page_count", { simple: true }) as number;
    const pageSizeResult = this.db.pragma("page_size", {
      simple: true,
    }) as number;
    const walResult = this.db.pragma("journal_mode", {
      simple: true,
    }) as string;

    return {
      totalSize: sizeResult * pageSizeResult,
      pageCount: sizeResult,
      pageSize: pageSizeResult,
      walMode: walResult === "wal",
    };
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    this.db.close();
  }
}

// 全局数据库实例
export const db = new SQLiteManager();

// 自动初始化
db.initialize().catch(console.error);
