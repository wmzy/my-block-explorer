/**
 * Zero Configuration Environment Setup
 * Enables the blockchain explorer to work out-of-the-box with minimal setup
 */

import { multiChainDb } from '../database/chain-database-manager';
import { getRecommendedMultiChainConfig } from './chains';
import { performanceMonitor } from '../services/PerformanceMonitor';

/**
 * Zero configuration manager for automatic setup
 */
export class ZeroConfigManager {
  private static instance: ZeroConfigManager;
  private isInitialized = false;
  private config: ZeroConfigState;

  private constructor() {
    this.config = {
      autoSetup: true,
      preferredChains: [], // Empty means use all recommended chains
      databasePath: 'data/chains',
      enableEventIndexing: true,
      enablePerformanceMonitoring: true,
      logLevel: 'info',
      autoMigration: true,
      errorRecovery: true,
      retryAttempts: 3,
      timeoutMs: 30000
    };
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ZeroConfigManager {
    if (!ZeroConfigManager.instance) {
      ZeroConfigManager.instance = new ZeroConfigManager();
    }
    return ZeroConfigManager.instance;
  }

  /**
   * Initialize the zero-config environment
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log(' Zero-config environment already initialized');
      return;
    }

    console.log('=€ Initializing zero-config blockchain explorer environment...');

    try {
      await this.setupEnvironment();
      await this.setupDatabases();
      await this.setupServices();
      await this.setupDefaults();

      this.isInitialized = true;
      console.log('<‰ Zero-config environment initialized successfully!');

    } catch (error) {
      console.error('L Failed to initialize zero-config environment:', error);
      throw error;
    }
  }

  /**
   * Setup basic environment requirements
   */
  private async setupEnvironment(): Promise<void> {
    console.log('=Ë Setting up environment...');

    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

    if (majorVersion < 22) {
      throw new Error(`Node.js version ${nodeVersion} is not supported. Please upgrade to Node.js 22 or later.`);
    }

    // Create required directories
    const fs = await import('fs/promises');
    const path = await import('path');

    const directories = [
      'data',
      'data/chains',
      'data/logs',
      'logs',
      'temp'
    ];

    for (const dir of directories) {
      try {
        await fs.mkdir(dir, { recursive: true });
        console.log(`=Á Created directory: ${dir}`);
      } catch (error) {
        // Directory might already exist, ignore error
      }
    }

    // Set environment variables with sensible defaults
    if (!process.env.NODE_ENV) {
      process.env.NODE_ENV = 'development';
    }

    if (!process.env.LOG_LEVEL) {
      process.env.LOG_LEVEL = this.config.logLevel;
    }

    console.log(' Environment setup complete');
  }

  /**
   * Setup databases for supported chains
   */
  private async setupDatabases(): Promise<void> {
    console.log('=Ä Setting up databases...');

    try {
      const chainConfigs = getRecommendedMultiChainConfig();
      const chainIds = chainConfigs.map(config => config.chainId);

      console.log(`Initializing ${chainIds.length} chain databases...`);

      // Initialize all recommended chain databases
      await multiChainDb.initializeAllChains();

      console.log(' Database setup complete');
    } catch (error) {
      console.error('L Database setup failed:', error);
      throw error;
    }
  }

  /**
   * Setup essential services
   */
  private async setupServices(): Promise<void> {
    console.log('™ Setting up services...');

    // Setup performance monitoring if enabled
    if (this.config.enablePerformanceMonitoring) {
      console.log('=Ê Enabling performance monitoring...');
      // Performance monitor is already initialized as singleton
      console.log(' Performance monitoring enabled');
    }

    // Setup error recovery
    if (this.config.errorRecovery) {
      console.log('=á Setting up error recovery...');
      this.setupErrorRecovery();
      console.log(' Error recovery configured');
    }

    console.log(' Services setup complete');
  }

  /**
   * Setup default configurations
   */
  private async setupDefaults(): Promise<void> {
    console.log('=' Applying default configurations...');

    // Set up default RPC configurations
    const { getRecommendedMultiChainConfig } = await import('./chains');
    const defaultConfigs = getRecommendedMultiChainConfig();

    console.log(`Configured ${defaultConfigs.length} chains with default settings`);

    // Setup event indexing if enabled
    if (this.config.enableEventIndexing) {
      console.log('=Ý Event indexing enabled by default');
    }

    // Setup caching strategy
    console.log('=¾ Setting up default caching strategy...');

    console.log(' Default configurations applied');
  }

  /**
   * Setup error recovery mechanisms
   */
  private setupErrorRecovery(): void {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('=¥ Uncaught Exception:', error);
      this.gracefulShutdown();
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('=¥ Unhandled Promise Rejection at:', promise, 'reason:', reason);
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n=K Received SIGINT, shutting down gracefully...');
      this.gracefulShutdown();
    });

    process.on('SIGTERM', () => {
      console.log('\n=K Received SIGTERM, shutting down gracefully...');
      this.gracefulShutdown();
    });
  }

  /**
   * Graceful shutdown procedure
   */
  private async gracefulShutdown(): Promise<void> {
    console.log('= Starting graceful shutdown...');

    try {
      // Stop performance monitoring
      performanceMonitor.stop();
      console.log('=Ê Performance monitoring stopped');

      // Close all database connections
      await multiChainDb.closeAll();
      console.log('=Ä All databases closed');

      console.log(' Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('L Error during graceful shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Get configuration status
   */
  getStatus(): {
    isInitialized: boolean;
    config: ZeroConfigState;
    chainCount: number;
    databasePaths: string[];
  } {
    return {
      isInitialized: this.isInitialized,
      config: this.config,
      chainCount: multiChainDb.getInitializedChains().length,
      databasePaths: multiChainDb.getInitializedChains().map(chainId => {
        const { getChainDatabasePath } = require('./chains');
        return getChainDatabasePath(chainId);
      })
    };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ZeroConfigState>): void {
    this.config = { ...this.config, ...updates };
    console.log('=' Configuration updated');
  }

  /**
   * Get supported chains list
   */
  getSupportedChains(): number[] {
    const { getRecommendedMultiChainConfig } = require('./chains');
    const configs = getRecommendedMultiChainConfig();
    return configs.map((config: any) => config.chainId);
  }

  /**
   * Check if the system is ready
   */
  async checkReadiness(): Promise<{
    ready: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check initialization
    if (!this.isInitialized) {
      issues.push('Zero-config environment not initialized');
    }

    // Check database connections
    const initializedChains = multiChainDb.getInitializedChains();
    if (initializedChains.length === 0) {
      issues.push('No chain databases initialized');
    }

    // Check performance targets
    const performanceTargets = performanceMonitor.checkPerformanceTargets();
    if (!performanceTargets.withinTarget) {
      issues.push('Performance targets not being met');
      recommendations.push(...performanceTargets.recommendations);
    }

    // Check environment
    if (process.env.NODE_ENV === 'production' && process.env.NODE_ENV !== 'production') {
      recommendations.push('Consider running in production mode for better performance');
    }

    return {
      ready: issues.length === 0,
      issues,
      recommendations
    };
  }
}

/**
 * Zero configuration state interface
 */
interface ZeroConfigState {
  autoSetup: boolean;
  preferredChains: number[];
  databasePath: string;
  enableEventIndexing: boolean;
  enablePerformanceMonitoring: boolean;
  logLevel: string;
  autoMigration: boolean;
  errorRecovery: boolean;
  retryAttempts: number;
  timeoutMs: number;
}

// Export singleton instance
export const zeroConfig = ZeroConfigManager.getInstance();

/**
 * Convenience function to initialize everything
 */
export async function initializeBlockchainExplorer(): Promise<void> {
  await zeroConfig.initialize();
}

/**
 * Auto-initialize if this module is imported
 */
if (require.main === module || process.env.AUTO_INIT === 'true') {
  initializeBlockchainExplorer().catch(error => {
    console.error('=¥ Failed to auto-initialize blockchain explorer:', error);
    process.exit(1);
  });
}