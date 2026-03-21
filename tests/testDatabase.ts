import type { DuckDBInstance } from '@duckdb/node-api';
import { DuckDBInstance as DuckDB } from '@duckdb/node-api';

export class SimpleTestDatabaseManager {
  private instance: DuckDBInstance | null = null;
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.instance = await DuckDB.create(':memory:');
    await this.createTables();
    this.isInitialized = true;
  }

  async query<T = unknown>(sql: string): Promise<T[]> {
    if (!this.instance) {
      throw new Error('Test database not initialized');
    }
    const connection = await this.instance.connect();
    try {
      const result = await connection.runAndReadAll(sql);
      return result.getRowObjects() as T[];
    }
    finally {
      connection.disconnectSync();
    }
  }

  async exec(sql: string): Promise<void> {
    if (!this.instance) {
      throw new Error('Test database not initialized');
    }
    const connection = await this.instance.connect();
    try {
      await connection.run(sql);
    }
    finally {
      connection.disconnectSync();
    }
  }

  async clearAllData(): Promise<void> {
    const tables = [
      'user_rpc_configs',
      'contract_sources',
      'blocks',
      'transactions',
      'indexed_addresses',
    ];
    for (const table of tables) {
      try {
        await this.exec(`DELETE FROM ${table}`);
      }
      catch {
        /* table might not exist */
      }
    }
  }

  async close(): Promise<void> {
    this.instance = null;
    this.isInitialized = false;
  }

  private async createTables(): Promise<void> {
    await this.exec(`CREATE TABLE IF NOT EXISTS user_rpc_configs (
      chain_id INTEGER PRIMARY KEY, name TEXT, url TEXT, max_event_range INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await this.exec(`CREATE TABLE IF NOT EXISTS blocks (
      chain_id INTEGER NOT NULL, number BIGINT NOT NULL, hash VARCHAR NOT NULL, parent_hash VARCHAR,
      timestamp TIMESTAMP, miner VARCHAR, gas_limit BIGINT, gas_used BIGINT, base_fee_per_gas BIGINT,
      transaction_count INTEGER, indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (chain_id, number))`);
    await this.exec(`CREATE TABLE IF NOT EXISTS transactions (
      chain_id INTEGER NOT NULL, hash VARCHAR NOT NULL, block_number BIGINT, transaction_index INTEGER,
      from_address VARCHAR, to_address VARCHAR, value VARCHAR, gas_used BIGINT, status INTEGER,
      timestamp TIMESTAMP, indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (chain_id, hash))`);
    await this.exec(`CREATE TABLE IF NOT EXISTS indexed_addresses (
      chain_id INTEGER NOT NULL, address VARCHAR NOT NULL, label VARCHAR, transaction_count INTEGER DEFAULT 0,
      indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (chain_id, address))`);
    await this.exec(`CREATE TABLE IF NOT EXISTS contract_sources (
      chain_id INTEGER NOT NULL, address VARCHAR NOT NULL, name VARCHAR, source_code TEXT, abi TEXT,
      verification_status VARCHAR, PRIMARY KEY (chain_id, address))`);
  }
}

export const simpleTestDb = new SimpleTestDatabaseManager();
