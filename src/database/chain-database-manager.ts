/**
 * 分链数据库管理器
 * 每个链使用独立的数据库文件，不支持跨链查询
 */

import { DuckDBManager } from './duckdb';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { getChainName, getChainType } from '../config/chains';

/**
 * 单个链的数据库管理器
 */
export class ChainDatabaseManager {
  private chainId: number;
  private dbManager: DuckDBManager;
  private dbPath: string;

  constructor(chainId: number) {
    this.chainId = chainId;
    this.dbPath = this.generateDatabasePath(chainId);
    this.dbManager = new DuckDBManager(this.dbPath);
  }

  /**
   * 生成数据库文件路径
   */
  private generateDatabasePath(chainId: number): string {
    const dataDir = join(process.cwd(), "data", "chains");
    const chainName = getChainName(chainId).toLowerCase().replace(/\s+/g, '-');
    const chainType = getChainType(chainId);

    return join(dataDir, chainType, `${chainName}-${chainId}.db`);
  }

  /**
   * 初始化链数据库
   */
  async initialize(): Promise<void> {
    // 确保数据目录存在
    const dataDir = join(process.cwd(), "data", "chains");
    await mkdir(dataDir, { recursive: true });

    await this.dbManager.initialize();
    console.log(`🚀 Initialized database for chain ${this.chainId} (${getChainName(this.chainId)})`);
  }

  /**
   * 执行查询
   */
  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return this.dbManager.query<T>(sql, params);
  }

  /**
   * 执行SQL语句
   */
  async exec(sql: string): Promise<void> {
    return this.dbManager.exec(sql);
  }

  /**
   * 执行事务
   */
  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    return this.dbManager.transaction(callback);
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    return this.dbManager.close();
  }

  /**
   * 获取数据库路径
   */
  getDatabasePath(): string {
    return this.dbPath;
  }

  /**
   * 获取链ID
   */
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
      throw new Error(`Chain database for ${chainId} is not initialized. Call getChainDatabase() first.`);
    }
    return manager;
  }

  /**
   * 初始化所有支持的链数据库
   */
  async initializeAllChains(): Promise<void> {
    console.log(`🔄 Initializing ${this.supportedChains.length} chain databases...`);

    const initPromises = this.supportedChains.map(async (chainId) => {
      try {
        await this.getChainDatabase(chainId);
        console.log(`✅ Chain ${chainId} database initialized`);
      } catch (error) {
        console.error(`❌ Failed to initialize chain ${chainId} database:`, error);
      }
    });

    await Promise.allSettled(initPromises);
    console.log(`🎉 Chain databases initialization completed`);
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
      console.log(`🔒 Closed database for chain ${chainId}`);
    }
  }

  /**
   * 关闭所有链的数据库连接
   */
  async closeAll(): Promise<void> {
    console.log(`🔒 Closing ${this.chainManagers.size} chain databases...`);

    const closePromises = Array.from(this.chainManagers.entries()).map(
      async ([chainId, manager]) => {
        try {
          await manager.close();
          console.log(`✅ Chain ${chainId} database closed`);
        } catch (error) {
          console.error(`❌ Failed to close chain ${chainId} database:`, error);
        }
      }
    );

    await Promise.allSettled(closePromises);
    this.chainManagers.clear();
    console.log(`🎉 All chain databases closed`);
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
      databasePath: manager?.getDatabasePath() || new ChainDatabaseManager(chainId).getDatabasePath(),
      isInitialized: this.isChainInitialized(chainId),
      fileExists: await fs.access(manager?.getDatabasePath() || new ChainDatabaseManager(chainId).getDatabasePath()).then(() => true).catch(() => false)
    };
  }

  /**
   * 获取所有链的统计信息
   */
  async getAllChainStats(): Promise<Array<{
    chainId: number;
    chainName: string;
    databasePath: string;
    isInitialized: boolean;
    fileExists: boolean;
  }>> {
    const statsPromises = this.supportedChains.map(chainId =>
      this.getChainStats(chainId)
    );

    return Promise.all(statsPromises);
  }
}

// 默认的链数据库管理器实例
export const multiChainDb = MultiChainDatabaseManager.getInstance();