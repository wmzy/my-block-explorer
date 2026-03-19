import { DuckDBInstance } from '@duckdb/node-api';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { createLogger } from '../server/logger';

const logger = createLogger('duckdb');

/**
 * DuckDB数据库管理器
 * 使用最新的 @duckdb/node-api (Neo) 提供简单的查询接口，兼容现有代码
 */
export class DuckDBManager {
  private instance: DuckDBInstance | null = null;
  private isInitialized = false;
  private dbPath: string;

  constructor(dbPath?: string) {
    const dataDir = join(process.cwd(), 'data');
    this.dbPath = dbPath || join(dataDir, 'blockchain.db');

    // 确保数据目录存在
    mkdir(dataDir, { recursive: true }).catch(err => logger.warn({ err }, 'Failed to create data directory'));
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
    logger.info('Initializing DuckDB database');

    try {
      // All DDL must match Drizzle schema in schema.ts exactly (camelCase → snake_case)
      await this.exec(`CREATE TABLE IF NOT EXISTS user_rpc_configs (
        chain_id INTEGER PRIMARY KEY, name VARCHAR(255), url VARCHAR(500),
        supports_history BOOLEAN, max_event_range INTEGER,
        created_at TIMESTAMP_MS, updated_at TIMESTAMP_MS)`);

      await this.exec(`CREATE TABLE IF NOT EXISTS blocks (
        chain_id INTEGER NOT NULL, number BIGNUM NOT NULL,
        hash char(66) NOT NULL, parent_hash char(66),
        timestamp TIMESTAMP_S, miner char(42),
        gas_limit BIGNUM, gas_used BIGNUM, base_fee_per_gas BIGNUM,
        transaction_count INTEGER, size_bytes INTEGER,
        difficulty BIGNUM, total_difficulty BIGNUM,
        extra_data TEXT, logs_bloom TEXT,
        state_root char(66), transactions_root char(66), receipts_root char(66),
        indexed_at TIMESTAMP_MS,
        PRIMARY KEY (chain_id, number))`);

      await this.exec(`CREATE TABLE IF NOT EXISTS transactions (
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
        PRIMARY KEY (chain_id, hash))`);

      await this.exec(`CREATE TABLE IF NOT EXISTS indexed_addresses (
        chain_id INTEGER NOT NULL, address char(42) NOT NULL,
        type VARCHAR(20) NOT NULL, first_seen TIMESTAMP_S,
        last_activity TIMESTAMP_S, transaction_count INTEGER DEFAULT 0,
        indexed_at TIMESTAMP_MS,
        PRIMARY KEY (chain_id, address))`);

      await this.exec(`CREATE TABLE IF NOT EXISTS search_history (
        id INTEGER PRIMARY KEY, chain_id INTEGER,
        query VARCHAR(255), search_type VARCHAR(20),
        result_count INTEGER DEFAULT 0, searched_at TIMESTAMP_MS)`);

      await this.exec(`CREATE TABLE IF NOT EXISTS user_preferences (
        id INTEGER PRIMARY KEY, theme VARCHAR(20) DEFAULT 'light',
        language VARCHAR(10) DEFAULT 'en', updated_at TIMESTAMP_MS)`);

      await this.exec(`CREATE TABLE IF NOT EXISTS index_status (
        chain_id INTEGER NOT NULL, index_type VARCHAR(20) NOT NULL,
        last_indexed_block BIGNUM, last_indexed_at TIMESTAMP_MS,
        PRIMARY KEY (chain_id, index_type))`);

      await this.exec(`CREATE TABLE IF NOT EXISTS access_history (
        chain_id INTEGER NOT NULL, type VARCHAR(20) NOT NULL,
        identifier VARCHAR(66) NOT NULL,
        first_accessed TIMESTAMP_MS, last_accessed TIMESTAMP_MS,
        access_count INTEGER DEFAULT 1,
        PRIMARY KEY (chain_id, type, identifier))`);

      await this.exec(`CREATE TABLE IF NOT EXISTS contract_sources (
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
        PRIMARY KEY (chain_id, address))`);

      await this.exec(`CREATE TABLE IF NOT EXISTS contract_creation_info (
        chain_id INTEGER NOT NULL, address char(42) NOT NULL,
        creation_tx_hash char(66), creation_block_number BIGNUM,
        creation_timestamp TIMESTAMP_S,
        creator_address char(42), factory_address char(42),
        creation_method VARCHAR(50), last_updated TIMESTAMP_MS,
        PRIMARY KEY (chain_id, address))`);

      await this.exec(`CREATE TABLE IF NOT EXISTS indexing_progress (
        chain_id INTEGER NOT NULL, address char(42) NOT NULL,
        creation_block BIGNUM, last_indexed_block BIGNUM,
        last_finalized_block BIGNUM,
        total_events_indexed INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'idle', error_message TEXT,
        updated_at TIMESTAMP_MS,
        PRIMARY KEY (chain_id, address))`);

      await this.exec(`CREATE TABLE IF NOT EXISTS contract_events (
        chain_id INTEGER NOT NULL, contract_address char(42) NOT NULL,
        block_number BIGNUM NOT NULL, block_timestamp TIMESTAMP_S,
        transaction_hash char(66) NOT NULL, transaction_index INTEGER,
        log_index INTEGER NOT NULL, event_name VARCHAR(100),
        event_signature VARCHAR(66), decoded_args TEXT,
        topic0 VARCHAR(66), topic1 VARCHAR(66),
        topic2 VARCHAR(66), topic3 VARCHAR(66),
        data TEXT, is_finalized BOOLEAN DEFAULT false,
        indexed_at TIMESTAMP_MS,
        PRIMARY KEY (chain_id, transaction_hash, log_index))`);

      // 创建索引
      await this.createIndexes();

      logger.info('DuckDB database initialized successfully');
    }
    catch (error) {
      logger.error({ err: error }, 'Database initialization failed');
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
      'CREATE INDEX IF NOT EXISTS contract_sources_chain_verification_idx ON contract_sources (chain_id, verification_status)',
      'CREATE INDEX IF NOT EXISTS contract_sources_proxy_idx ON contract_sources (chain_id, is_proxy)',

      // 合约创建信息索引
      'CREATE INDEX IF NOT EXISTS contract_creation_info_status_idx ON contract_creation_info (search_status)',
      'CREATE INDEX IF NOT EXISTS contract_creation_info_tx_idx ON contract_creation_info (creation_tx_hash)',

      // 区块索引
      'CREATE INDEX IF NOT EXISTS blocks_chain_timestamp_idx ON blocks (chain_id, timestamp)',
      'CREATE INDEX IF NOT EXISTS blocks_chain_miner_idx ON blocks (chain_id, miner)',
      'CREATE INDEX IF NOT EXISTS blocks_hash_idx ON blocks (hash)',

      // 交易索引
      'CREATE INDEX IF NOT EXISTS transactions_chain_block_idx ON transactions (chain_id, block_number)',
      'CREATE INDEX IF NOT EXISTS transactions_chain_from_idx ON transactions (chain_id, from_address)',
      'CREATE INDEX IF NOT EXISTS transactions_chain_to_idx ON transactions (chain_id, to_address)',
      'CREATE INDEX IF NOT EXISTS transactions_chain_timestamp_idx ON transactions (chain_id, timestamp)',

      // 地址索引
      'CREATE INDEX IF NOT EXISTS indexed_addresses_chain_queried_idx ON indexed_addresses (chain_id, last_queried)',
      'CREATE INDEX IF NOT EXISTS indexed_addresses_global_idx ON indexed_addresses (address)',

      // 搜索历史索引
      'CREATE INDEX IF NOT EXISTS search_history_chain_idx ON search_history (chain_id, searched_at)',

      // 访问历史索引
      'CREATE INDEX IF NOT EXISTS access_history_chain_type_idx ON access_history (chain_id, type, last_accessed)',

      // 事件索引
      'CREATE INDEX IF NOT EXISTS contract_events_chain_contract_idx ON contract_events (chain_id, contract_address)',
      'CREATE INDEX IF NOT EXISTS contract_events_chain_contract_block_idx ON contract_events (chain_id, contract_address, block_number)',
      'CREATE INDEX IF NOT EXISTS contract_events_chain_contract_name_idx ON contract_events (chain_id, contract_address, event_name)',
    ];

    for (const indexSql of indexes) {
      try {
        await this.exec(indexSql);
      }
      catch (error) {
        logger.warn({ err: error }, 'Index creation warning');
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
      throw new Error('Database not initialized');
    }

    try {
      // 根据官方文档，使用连接来执行查询
      const connection = await this.instance.connect();

      // 如果有参数，使用参数化查询
      if (params.length > 0) {
        const result = await connection.runAndReadAll(sql, params);
        connection.disconnectSync();
        return result.getRowObjects() as T[];
      }
      else {
        const result = await connection.runAndReadAll(sql);
        connection.disconnectSync();
        return result.getRowObjects() as T[];
      }
    }
    catch (error) {
      logger.error({ err: error, sql, params }, 'DuckDB Query Error');
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
      throw new Error('Database not initialized');
    }

    try {
      // 根据官方文档，使用连接来执行SQL
      const connection = await this.instance.connect();
      await connection.run(sql);
      connection.disconnectSync();
    }
    catch (error) {
      logger.error({ err: error, sql }, 'DuckDB Exec Error');
      throw error;
    }
  }

  /**
   * 执行事务
   */
  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    if (!this.instance) {
      throw new Error('Database not initialized');
    }

    const connection = await this.instance.connect();
    try {
      await connection.run('BEGIN TRANSACTION');
      const result = await callback();
      await connection.run('COMMIT');
      return result;
    }
    catch (error) {
      await connection.run('ROLLBACK');
      throw error;
    }
    finally {
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
