import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { createLogger } from '../server/logger';
import { createDuckDBAdapter } from './duckdb-postgres-adapter';
import { getChainName, getChainType } from '../config/chains';
import * as chainSchema from './chain-schema';

const logger = createLogger('chain-database-manager');

export class ChainDatabaseManager {
  private chainId: number;
  private dbPath: string;
  private sql: ReturnType<typeof createDuckDBAdapter>;
  private drizzleInstance: PostgresJsDatabase<typeof chainSchema> | null = null;

  constructor(chainId: number) {
    this.chainId = chainId;
    this.dbPath = this.generateDatabasePath(chainId);

    const connectionString = `duckdb://${this.dbPath}`;
    this.sql = createDuckDBAdapter(connectionString);
  }

  private generateDatabasePath(chainId: number): string {
    const dataDir = join(process.cwd(), 'data', 'chains');
    const chainName = getChainName(chainId).toLowerCase().replace(/\s+/g, '-');
    const chainType = getChainType(chainId);
    return join(dataDir, chainType, `${chainName}-${chainId}.db`);
  }

  async initialize(): Promise<void> {
    const dataDir = join(process.cwd(), 'data', 'chains');
    await mkdir(dataDir, { recursive: true });

    // Eagerly trigger the adapter's lazy connect + ensureTables path
    await this.sql.unsafe('SELECT 1');
    logger.info(
      { chainId: this.chainId, chainName: getChainName(this.chainId) },
      'Initialized database for chain',
    );
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result =
      params.length > 0
        ? await (this.sql.unsafe as (q: string, p?: unknown[]) => Promise<unknown[]>)(sql, params)
        : await (this.sql.unsafe as (q: string) => Promise<unknown[]>)(sql);
    return result as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.sql.unsafe(sql);
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    return this.sql.begin(async () => callback()) as Promise<T>;
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  getDrizzle(): PostgresJsDatabase<typeof chainSchema> {
    this.drizzleInstance ??= drizzle(this.sql, { schema: chainSchema, casing: 'snake_case' });
    return this.drizzleInstance;
  }

  getChainId(): number {
    return this.chainId;
  }
}

/**
 * Multi-chain database manager
 * Manages database connections for all chains, providing chain-isolated query access
 */
export class MultiChainDatabaseManager {
  private static instance: MultiChainDatabaseManager;
  private chainManagers: Map<number, ChainDatabaseManager>;
  private supportedChains: number[];

  private constructor(supportedChainIds: number[] = []) {
    this.chainManagers = new Map();
    this.supportedChains = supportedChainIds;
  }

  /**
   * Get the singleton instance
   */
  static getInstance(supportedChainIds?: number[]): MultiChainDatabaseManager {
    if (!MultiChainDatabaseManager.instance) {
      MultiChainDatabaseManager.instance = new MultiChainDatabaseManager(supportedChainIds);
    }
    return MultiChainDatabaseManager.instance;
  }

  /**
   * Get the database manager for a specific chain
   */
  async getChainDatabase(chainId: number): Promise<ChainDatabaseManager> {
    // Check whether the chain is supported
    if (this.supportedChains.length > 0 && !this.supportedChains.includes(chainId)) {
      throw new Error(`Chain ${chainId} is not supported`);
    }

    // Check the cache
    if (this.chainManagers.has(chainId)) {
      return this.chainManagers.get(chainId)!;
    }

    // Create a new chain database manager
    const chainManager = new ChainDatabaseManager(chainId);
    await chainManager.initialize();

    // Cache the manager
    this.chainManagers.set(chainId, chainManager);

    return chainManager;
  }

  /**
   * Get a chain database manager synchronously (when already initialized)
   */
  getChainDatabaseSync(chainId: number): ChainDatabaseManager {
    const manager = this.chainManagers.get(chainId);
    if (!manager) {
      throw new Error(
        `Chain database for ${chainId} is not initialized. Call getChainDatabase() first.`,
      );
    }
    return manager;
  }

  /**
   * Initialize databases for all supported chains
   */
  async initializeAllChains(): Promise<void> {
    logger.info({ count: this.supportedChains.length }, 'Initializing chain databases');

    const initPromises = this.supportedChains.map(async chainId => {
      try {
        await this.getChainDatabase(chainId);
        logger.info({ chainId }, 'Chain database initialized');
      } catch (error) {
        logger.error({ err: error, chainId }, 'Failed to initialize chain database');
      }
    });

    await Promise.allSettled(initPromises);
    logger.info('Chain databases initialization completed');
  }

  /**
   * List initialized chains
   */
  getInitializedChains(): number[] {
    return Array.from(this.chainManagers.keys());
  }

  /**
   * Check whether a chain is initialized
   */
  isChainInitialized(chainId: number): boolean {
    return this.chainManagers.has(chainId);
  }

  /**
   * Close a specific chain's database connection
   */
  async closeChainDatabase(chainId: number): Promise<void> {
    const manager = this.chainManagers.get(chainId);
    if (manager) {
      await manager.close();
      this.chainManagers.delete(chainId);
      logger.info({ chainId }, 'Closed database for chain');
    }
  }

  /**
   * Close all chain database connections
   */
  async closeAll(): Promise<void> {
    logger.info({ count: this.chainManagers.size }, 'Closing chain databases');

    const closePromises = Array.from(this.chainManagers.entries()).map(
      async ([chainId, manager]) => {
        try {
          await manager.close();
          logger.info({ chainId }, 'Chain database closed');
        } catch (error) {
          logger.error({ err: error, chainId }, 'Failed to close chain database');
        }
      },
    );

    await Promise.allSettled(closePromises);
    this.chainManagers.clear();
    logger.info('All chain databases closed');
  }

  /**
   * Get chain database statistics
   */
  async getChainStats(chainId: number): Promise<{
    chainId: number;
    chainName: string;
    databasePath: string;
    isInitialized: boolean;
    fileExists: boolean;
  }> {
    const manager = this.chainManagers.get(chainId);
    const fs = await import('fs/promises');

    return {
      chainId,
      chainName: getChainName(chainId),
      databasePath:
        manager?.getDatabasePath() ?? new ChainDatabaseManager(chainId).getDatabasePath(),
      isInitialized: this.isChainInitialized(chainId),
      fileExists: await fs
        .access(manager?.getDatabasePath() ?? new ChainDatabaseManager(chainId).getDatabasePath())
        .then(() => true)
        .catch(() => false),
    };
  }

  /**
   * Get statistics for all chains
   */
  async getAllChainStats(): Promise<
    Array<{
      chainId: number;
      chainName: string;
      databasePath: string;
      isInitialized: boolean;
      fileExists: boolean;
    }>
  > {
    const statsPromises = this.supportedChains.map(chainId => this.getChainStats(chainId));

    return Promise.all(statsPromises);
  }
}

// Default multi-chain database manager instance
export const multiChainDb = MultiChainDatabaseManager.getInstance();
