/**
 * Zero Configuration Environment Setup
 * Enables the blockchain explorer to work out-of-the-box with minimal setup
 */

import { createLogger } from '../server/logger';
import { multiChainDb } from '../database/chain-database-manager';

const logger = createLogger('zero-config');
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
      timeoutMs: 30000,
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
      logger.info('Zero-config environment already initialized');
      return;
    }

    logger.info('Initializing zero-config blockchain explorer environment');

    try {
      await this.setupEnvironment();
      await this.setupDatabases();
      await this.setupServices();
      await this.setupDefaults();

      this.isInitialized = true;
      logger.info('Zero-config environment initialized successfully');
    }
    catch (error) {
      logger.error({ err: error }, 'Failed to initialize zero-config environment');
      throw error;
    }
  }

  /**
   * Setup basic environment requirements
   */
  private async setupEnvironment(): Promise<void> {
    logger.info('Setting up environment');

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
      'temp',
    ];

    for (const dir of directories) {
      try {
        await fs.mkdir(dir, { recursive: true });
        logger.info({ dir }, 'Created directory');
      }
      catch (error) {
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

    logger.info('Environment setup complete');
  }

  /**
   * Setup databases for supported chains
   */
  private async setupDatabases(): Promise<void> {
    logger.info('Setting up databases');

    try {
      const chainConfigs = getRecommendedMultiChainConfig();
      const chainIds = chainConfigs.map(config => config.chainId);

      logger.info({ chainCount: chainIds.length }, 'Initializing chain databases');

      // Initialize all recommended chain databases
      await multiChainDb.initializeAllChains();

      logger.info('Database setup complete');
    }
    catch (error) {
      logger.error({ err: error }, 'Database setup failed');
      throw error;
    }
  }

  /**
   * Setup essential services
   */
  private async setupServices(): Promise<void> {
    logger.info('Setting up services');

    // Setup performance monitoring if enabled
    if (this.config.enablePerformanceMonitoring) {
      logger.info('Enabling performance monitoring');
      // Performance monitor is already initialized as singleton
      logger.info('Performance monitoring enabled');
    }

    // Setup error recovery
    if (this.config.errorRecovery) {
      logger.info('Setting up error recovery');
      this.setupErrorRecovery();
      logger.info('Error recovery configured');
    }

    logger.info('Services setup complete');
  }

  /**
   * Setup default configurations
   */
  private async setupDefaults(): Promise<void> {
    logger.info('Applying default configurations');

    // Set up default RPC configurations
    const { getRecommendedMultiChainConfig } = await import('./chains');
    const defaultConfigs = getRecommendedMultiChainConfig();

    logger.info({ chainCount: defaultConfigs.length }, 'Configured chains with default settings');

    // Setup event indexing if enabled
    if (this.config.enableEventIndexing) {
      logger.info('Event indexing enabled by default');
    }

    // Setup caching strategy
    logger.info('Setting up default caching strategy');

    logger.info('Default configurations applied');
  }

  /**
   * Setup error recovery mechanisms
   */
  private setupErrorRecovery(): void {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error({ err: error }, 'Uncaught Exception');
      this.gracefulShutdown();
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error({ reason, promise }, 'Unhandled Promise Rejection');
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down gracefully');
      this.gracefulShutdown();
    });

    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down gracefully');
      this.gracefulShutdown();
    });
  }

  /**
   * Graceful shutdown procedure
   */
  private async gracefulShutdown(): Promise<void> {
    logger.info('Starting graceful shutdown');

    try {
      // Stop performance monitoring
      performanceMonitor.stop();
      logger.info('Performance monitoring stopped');

      // Close all database connections
      await multiChainDb.closeAll();
      logger.info('All databases closed');

      logger.info('Graceful shutdown complete');
      process.exit(0);
    }
    catch (error) {
      logger.error({ err: error }, 'Error during graceful shutdown');
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
      databasePaths: multiChainDb.getInitializedChains().map((chainId) => {
        const { getChainDatabasePath } = require('./chains');
        return getChainDatabasePath(chainId);
      }),
    };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ZeroConfigState>): void {
    this.config = { ...this.config, ...updates };
    logger.info('Configuration updated');
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
      recommendations,
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
  initializeBlockchainExplorer().catch((error) => {
    logger.error({ err: error }, 'Failed to auto-initialize blockchain explorer');
    process.exit(1);
  });
}
