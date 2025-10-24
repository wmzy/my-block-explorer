/**
 * 多链零配置环境
 * 自动初始化和配置多链数据库环境
 */

import { MultiChainDatabaseManager } from './chain-database-manager';
import { ChainSchemaManager } from './chain-schema-manager';
import { ChainEventTableManager } from './chain-event-table-manager';
import { multiChainPerformanceManager } from './performance-monitor';
import {
  getRecommendedMultiChainConfig,
  getDevelopmentMultiChainConfig,
  getChainDatabaseConfig,
  validateMultiChainConfig,
  RECOMMENDED_MULTI_CHAINS,
  DEVELOPMENT_CHAINS
} from '../config/chains';
import {
  MultiChainConfig,
  ChainDatabaseStatus,
  MultiChainIndexingStatus,
  ChainDatabaseError,
  ChainConfigError
} from '../types/events';
import { mkdir } from 'fs/promises';
import { join } from 'path';

// 零配置选项
export interface ZeroConfigOptions {
  // 环境类型
  environment?: 'development' | 'production' | 'test';

  // 链配置
  chains?: number[] | 'recommended' | 'development' | 'all';

  // 数据目录
  dataDirectory?: string;

  // 性能配置
  enablePerformanceMonitoring?: boolean;

  // 自动索引
  autoStartIndexing?: boolean;

  // 初始化选项
  skipValidation?: boolean;
  createDataDirectories?: boolean;

  // 并发控制
  maxConcurrentInitialization?: number;
}

// 多链环境状态
export interface MultiChainEnvironmentStatus {
  isInitialized: boolean;
  initializedChains: number[];
  failedChains: number[];
  totalChains: number;
  initializationTime: number;
  environment: string;
  dataDirectory: string;
  errors: string[];
}

// 多链环境管理器
export class MultiChainEnvironment {
  private multiChainDb: MultiChainDatabaseManager;
  private options: Required<ZeroConfigOptions>;
  private status: MultiChainEnvironmentStatus;
  private initializationStartTime: number;

  constructor(options: ZeroConfigOptions = {}) {
    this.options = {
      environment: options.environment || (process.env.NODE_ENV as any) || 'development',
      chains: options.chains || 'recommended',
      dataDirectory: options.dataDirectory || 'data',
      enablePerformanceMonitoring: options.enablePerformanceMonitoring ?? true,
      autoStartIndexing: options.autoStartIndexing ?? false,
      skipValidation: options.skipValidation ?? false,
      createDataDirectories: options.createDataDirectories ?? true,
      maxConcurrentInitialization: options.maxConcurrentInitialization || 5,
    };

    this.multiChainDb = MultiChainDatabaseManager.getInstance();
    this.status = {
      isInitialized: false,
      initializedChains: [],
      failedChains: [],
      totalChains: 0,
      initializationTime: 0,
      environment: this.options.environment,
      dataDirectory: this.options.dataDirectory,
      errors: [],
    };
    this.initializationStartTime = 0;
  }

  // 初始化多链环境
  async initialize(): Promise<MultiChainEnvironmentStatus> {
    if (this.status.isInitialized) {
      return this.status;
    }

    this.initializationStartTime = Date.now();
    console.log(`🚀 Initializing multi-chain environment (${this.options.environment})`);

    try {
      // 1. 确定要初始化的链
      const chainIds = await this.resolveChainIds();
      this.status.totalChains = chainIds.length;

      if (chainIds.length === 0) {
        throw new Error('No chains to initialize');
      }

      console.log(`📋 Initializing ${chainIds.length} chains: ${chainIds.join(', ')}`);

      // 2. 验证链配置
      if (!this.options.skipValidation) {
        const validation = validateMultiChainConfig(chainIds);
        if (!validation.valid) {
          throw new ChainConfigError(
            `Invalid chain configuration: ${validation.errors.join(', ')}`,
            0,
            'chain_validation'
          );
        }
      }

      // 3. 创建数据目录
      if (this.options.createDataDirectories) {
        await this.createDataDirectories(chainIds);
      }

      // 4. 并发初始化链数据库
      await this.initializeChainDatabases(chainIds);

      // 5. 设置性能监控
      if (this.options.enablePerformanceMonitoring) {
        this.setupPerformanceMonitoring(chainIds);
      }

      // 6. 自动启动索引（如果启用）
      if (this.options.autoStartIndexing) {
        await this.startAutoIndexing(chainIds);
      }

      this.status.isInitialized = true;
      this.status.initializationTime = Date.now() - this.initializationStartTime;

      console.log(`✅ Multi-chain environment initialized successfully in ${this.status.initializationTime}ms`);
      console.log(`📊 Initialized ${this.status.initializedChains.length}/${chainIds.length} chains`);

      if (this.status.failedChains.length > 0) {
        console.warn(`⚠️ Failed to initialize ${this.status.failedChains.length} chains: ${this.status.failedChains.join(', ')}`);
      }

      return this.status;

    } catch (error) {
      this.status.errors.push(error instanceof Error ? error.message : String(error));
      console.error(`❌ Failed to initialize multi-chain environment:`, error);
      throw error;
    }
  }

  // 解析要初始化的链ID
  private async resolveChainIds(): Promise<number[]> {
    switch (this.options.chains) {
      case 'recommended':
        return RECOMMENDED_MULTI_CHAINS;
      case 'development':
        return DEVELOPMENT_CHAINS;
      case 'all':
        const { getSupportedChainIds } = await import('../config/chains');
        return getSupportedChainIds();
      default:
        if (Array.isArray(this.options.chains)) {
          return this.options.chains;
        }
        throw new Error(`Invalid chains configuration: ${this.options.chains}`);
    }
  }

  // 创建数据目录
  private async createDataDirectories(chainIds: number[]): Promise<void> {
    const directories = new Set<string>();

    for (const chainId of chainIds) {
      const config = getChainDatabaseConfig(chainId);
      const dirPath = join(this.options.dataDirectory, config.chainType);
      directories.add(dirPath);
    }

    console.log(`📁 Creating ${directories.size} data directories...`);

    const creationPromises = Array.from(directories).map(async (dirPath) => {
      try {
        await mkdir(dirPath, { recursive: true });
        console.log(`✅ Created directory: ${dirPath}`);
      } catch (error) {
        throw new ChainDatabaseError(
          `Failed to create directory: ${dirPath}`,
          0,
          dirPath,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    });

    await Promise.allSettled(creationPromises);
  }

  // 初始化链数据库
  private async initializeChainDatabases(chainIds: number[]): Promise<void> {
    console.log(`🗄️ Initializing chain databases...`);

    // 分批处理以控制并发
    const batchSize = this.options.maxConcurrentInitialization;
    for (let i = 0; i < chainIds.length; i += batchSize) {
      const batch = chainIds.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chainIds.length / batchSize)}: ${batch.join(', ')}`);

      const batchPromises = batch.map(async (chainId) => {
        try {
          await this.initializeSingleChain(chainId);
          this.status.initializedChains.push(chainId);
          console.log(`✅ Initialized chain ${chainId}`);
        } catch (error) {
          this.status.failedChains.push(chainId);
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.status.errors.push(`Chain ${chainId}: ${errorMessage}`);
          console.error(`❌ Failed to initialize chain ${chainId}:`, error);
        }
      });

      await Promise.allSettled(batchPromises);
    }
  }

  // 初始化单个链
  private async initializeSingleChain(chainId: number): Promise<void> {
    try {
      // 获取链数据库管理器
      const chainDb = await this.multiChainDb.getChainDatabase(chainId);

      // 创建基础表结构
      const schemaManager = new ChainSchemaManager(chainId);
      const tableCreationSQLs = schemaManager.getAllTableCreationSQL();
      const indexCreationSQLs = schemaManager.getIndexCreationSQL();

      // 执行表创建
      for (const sql of tableCreationSQLs) {
        await chainDb.exec(sql);
      }

      // 执行索引创建
      for (const sql of indexCreationSQLs) {
        await chainDb.exec(sql);
      }

      console.log(`🗄️ Chain ${chainId} database schema created`);

    } catch (error) {
      throw new ChainDatabaseError(
        `Failed to initialize chain database`,
        chainId,
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // 设置性能监控
  private setupPerformanceMonitoring(chainIds: number[]): void {
    console.log(`📊 Setting up performance monitoring for ${chainIds.length} chains...`);

    for (const chainId of chainIds) {
      multiChainPerformanceManager.getChainMonitor(chainId);
    }

    console.log(`✅ Performance monitoring enabled`);
  }

  // 启动自动索引
  private async startAutoIndexing(chainIds: number[]): Promise<void> {
    console.log(`🔄 Starting auto-indexing for ${chainIds.length} chains...`);

    // 这里可以集成实际的事件索引启动逻辑
    // 目前提供基础结构
    for (const chainId of chainIds) {
      try {
        // 创建事件表管理器
        const chainDb = await this.multiChainDb.getChainDatabase(chainId);
        const eventTableManager = new ChainEventTableManager(chainDb);

        console.log(`📋 Event table manager created for chain ${chainId}`);
      } catch (error) {
        console.warn(`⚠️ Failed to create event table manager for chain ${chainId}:`, error);
      }
    }

    console.log(`✅ Auto-indexing configuration completed`);
  }

  // 获取环境状态
  getStatus(): MultiChainEnvironmentStatus {
    return { ...this.status };
  }

  // 获取链数据库状态
  async getChainDatabaseStatuses(): Promise<ChainDatabaseStatus[]> {
    const statuses: ChainDatabaseStatus[] = [];

    for (const chainId of this.status.initializedChains) {
      try {
        const stats = await this.multiChainDb.getChainStats(chainId);
        const config = getChainDatabaseConfig(chainId);

        statuses.push({
          chainId,
          chainName: stats.chainName,
          chainType: config.chainType,
          databasePath: stats.databasePath,
          isInitialized: stats.isInitialized,
          fileExists: stats.fileExists,
          fileSize: 0, // 需要实际获取文件大小
          tableCount: 0, // 需要实际查询表数量
          totalEvents: 0, // 需要实际查询事件数量
          lastIndexedAt: undefined,
          indexingActive: false, // 需要实际查询索引状态
        });
      } catch (error) {
        console.warn(`⚠️ Failed to get status for chain ${chainId}:`, error);
      }
    }

    return statuses;
  }

  // 获取多链索引状态
  async getMultiChainIndexingStatus(): Promise<MultiChainIndexingStatus[]> {
    const statuses: MultiChainIndexingStatus[] = [];

    for (const chainId of this.status.initializedChains) {
      try {
        const config = getChainDatabaseConfig(chainId);
        const monitor = multiChainPerformanceManager.getChainMonitor(chainId);

        statuses.push({
          chainId,
          chainName: config.chainName,
          isInitialized: true,
          isIndexing: false, // 需要实际查询索引状态
          lastIndexedBlock: undefined,
          totalEventsIndexed: 0, // 需要实际查询
          indexingProgress: 0,
          estimatedTimeRemaining: undefined,
          errors: [],
        });
      } catch (error) {
        console.warn(`⚠️ Failed to get indexing status for chain ${chainId}:`, error);
      }
    }

    return statuses;
  }

  // 关闭环境
  async shutdown(): Promise<void> {
    console.log(`🔒 Shutting down multi-chain environment...`);

    try {
      await this.multiChainDb.closeAll();
      console.log(`✅ Multi-chain environment shutdown completed`);
    } catch (error) {
      console.error(`❌ Error during shutdown:`, error);
      throw error;
    }
  }

  // 重新初始化失败的链
  async retryFailedChains(): Promise<void> {
    if (this.status.failedChains.length === 0) {
      console.log(`✅ No failed chains to retry`);
      return;
    }

    console.log(`🔄 Retrying ${this.status.failedChains.length} failed chains...`);

    const failedChains = [...this.status.failedChains];
    this.status.failedChains = [];

    for (const chainId of failedChains) {
      try {
        await this.initializeSingleChain(chainId);
        this.status.initializedChains.push(chainId);
        console.log(`✅ Successfully retried chain ${chainId}`);
      } catch (error) {
        this.status.failedChains.push(chainId);
        console.error(`❌ Retry failed for chain ${chainId}:`, error);
      }
    }

    console.log(`🔄 Retry completed. ${this.status.initializedChains.length} chains initialized, ${this.status.failedChains.length} still failed`);
  }
}

// 快速初始化函数
export async function initializeMultiChainEnvironment(
  options?: ZeroConfigOptions
): Promise<MultiChainEnvironmentStatus> {
  const environment = new MultiChainEnvironment(options);
  return await environment.initialize();
}

// 预设配置
export const MULTI_CHAIN_PRESETS = {
  // 开发环境预设
  development: {
    environment: 'development' as const,
    chains: 'development' as const,
    enablePerformanceMonitoring: true,
    autoStartIndexing: false,
    maxConcurrentInitialization: 3,
  },

  // 生产环境预设
  production: {
    environment: 'production' as const,
    chains: 'recommended' as const,
    enablePerformanceMonitoring: true,
    autoStartIndexing: true,
    maxConcurrentInitialization: 5,
  },

  // 测试环境预设
  test: {
    environment: 'test' as const,
    chains: ['1', '11155111'] as number[], // Ethereum mainnet and Sepolia
    enablePerformanceMonitoring: false,
    autoStartIndexing: false,
    maxConcurrentInitialization: 2,
  },

  // 最小预设（仅Ethereum主网）
  minimal: {
    environment: 'development' as const,
    chains: [1] as number[],
    enablePerformanceMonitoring: false,
    autoStartIndexing: false,
    maxConcurrentInitialization: 1,
  },
};

// 使用预设初始化
export async function initializeWithPreset(
  preset: keyof typeof MULTI_CHAIN_PRESETS,
  overrides?: ZeroConfigOptions
): Promise<MultiChainEnvironmentStatus> {
  const options = { ...MULTI_CHAIN_PRESETS[preset], ...overrides };
  return await initializeMultiChainEnvironment(options);
}

// 全局环境实例（单例）
let globalEnvironment: MultiChainEnvironment | null = null;

// 获取全局环境实例
export function getGlobalMultiChainEnvironment(): MultiChainEnvironment {
  if (!globalEnvironment) {
    globalEnvironment = new MultiChainEnvironment();
  }
  return globalEnvironment;
}

// 初始化全局环境
export async function initializeGlobalMultiChainEnvironment(
  options?: ZeroConfigOptions
): Promise<MultiChainEnvironmentStatus> {
  const environment = getGlobalMultiChainEnvironment();
  return await environment.initialize();
}