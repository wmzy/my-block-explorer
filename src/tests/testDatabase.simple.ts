import { DuckDBInstance } from "@duckdb/node-api";

/**
 * Simple test database manager using DuckDB in-memory mode
 */
export class SimpleTestDatabaseManager {
  private instance: DuckDBInstance | null = null;
  private isInitialized = false;

  /**
   * Initialize test database with in-memory DuckDB
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Create in-memory DuckDB instance
    this.instance = await DuckDBInstance.create(":memory:");
    
    // Initialize tables
    await this.createTables();
    
    this.isInitialized = true;
  }

  /**
   * Execute raw SQL query
   */
  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.instance) {
      throw new Error("Test database not initialized");
    }

    const connection = await this.instance.connect();
    try {
      const result = params.length > 0 
        ? await connection.runAndReadAll(sql, params)
        : await connection.runAndReadAll(sql);
      return result.getRowObjects() as T[];
    } finally {
      connection.disconnectSync();
    }
  }

  /**
   * Execute SQL statement
   */
  async exec(sql: string): Promise<void> {
    if (!this.instance) {
      throw new Error("Test database not initialized");
    }

    const connection = await this.instance.connect();
    try {
      await connection.run(sql);
    } finally {
      connection.disconnectSync();
    }
  }

  /**
   * Clear all data from tables
   */
  async clearAllData(): Promise<void> {
    const tables = [
      'user_rpc_configs',
      'contract_sources',
      'blocks',
      'transactions',
      'indexed_addresses'
    ];

    for (const table of tables) {
      try {
        await this.exec(`DELETE FROM ${table}`);
      } catch (error) {
        // Table might not exist, ignore error
      }
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.instance) {
      this.instance = null;
      this.isInitialized = false;
    }
  }

  /**
   * Create all database tables
   */
  private async createTables(): Promise<void> {
    // User RPC configs table
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

    // Blocks table
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
        indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chain_id, number)
      )
    `);

    // Transactions table
    await this.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        chain_id INTEGER NOT NULL,
        hash VARCHAR NOT NULL,
        block_number BIGINT,
        transaction_index INTEGER,
        from_address VARCHAR,
        to_address VARCHAR,
        value VARCHAR,
        gas_used BIGINT,
        status INTEGER,
        timestamp TIMESTAMP,
        indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chain_id, hash)
      )
    `);

    // Indexed addresses table
    await this.exec(`
      CREATE TABLE IF NOT EXISTS indexed_addresses (
        chain_id INTEGER NOT NULL,
        address VARCHAR NOT NULL,
        label VARCHAR,
        transaction_count INTEGER DEFAULT 0,
        indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chain_id, address)
      )
    `);

    // Contract sources table
    await this.exec(`
      CREATE TABLE IF NOT EXISTS contract_sources (
        chain_id INTEGER NOT NULL,
        address VARCHAR NOT NULL,
        name VARCHAR,
        source_code TEXT,
        abi TEXT,
        verification_status VARCHAR,
        PRIMARY KEY (chain_id, address)
      )
    `);
  }
}

// Global test database instance
export const simpleTestDb = new SimpleTestDatabaseManager();
