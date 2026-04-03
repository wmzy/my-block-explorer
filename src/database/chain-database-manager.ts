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
 * 多链数据库管理器
 * 管理所有链的数据库连接，提供链隔离的查询接口
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
   * 获取单例实例
   */
  static getInstance(supportedChainIds?: number[]): MultiChainDatabaseManager {
    if (!MultiChainDatabaseManager.instance) {
      MultiChainDatabaseManager.instance = new MultiChainDatabaseManager(supportedChainIds);
    }
    return MultiChainDatabaseManager.instance;
  }

  /**
   * 获取指定链的数据库管理器
   */
  async getChainDatabase(chainId: number): Promise<ChainDatabaseManager> {
    // 检查链是否支持
    if (this.supportedChains.length > 0 && !this.supportedChains.includes(chainId)) {
      throw new Error(`Chain ${chainId} is not supported`);
    }

    // 检查缓存
    if (this.chainManagers.has(chainId)) {
      return this.chainManagers.get(chainId)!;
    }

    // 创建新的链数据库管理器
    const chainManager = new ChainDatabaseManager(chainId);
    await chainManager.initialize();

    // 缓存管理器
    this.chainManagers.set(chainId, chainManager);

    return chainManager;
  }

  /**
   * 同步获取链数据库管理器（如果已初始化）
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
   * 初始化所有支持的链数据库
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
   * 获取已初始化的链列表
   */
  getInitializedChains(): number[] {
    return Array.from(this.chainManagers.keys());
  }

  /**
   * 检查链是否已初始化
   */
  isChainInitialized(chainId: number): boolean {
    return this.chainManagers.has(chainId);
  }

  /**
   * 关闭指定链的数据库连接
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
   * 关闭所有链的数据库连接
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
   * 获取链数据库统计信息
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
   * 获取所有链的统计信息
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

// 默认的链数据库管理器实例
export const multiChainDb = MultiChainDatabaseManager.getInstance();
