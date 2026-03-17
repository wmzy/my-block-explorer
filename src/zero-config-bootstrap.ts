/**
 * Zero Configuration Bootstrap
 * Auto-initializes the blockchain explorer environment
 */

import { createLogger } from './server/logger';
import { zeroConfig, initializeBlockchainExplorer } from './config/zero-config';

const logger = createLogger("zero-config-bootstrap");
import { performanceMonitor } from './services/PerformanceMonitor';

/**
 * Bootstrap the application with zero configuration
 */
export async function bootstrap(): Promise<void> {
  logger.info("Bootstrapping blockchain explorer with zero configuration");

  try {
    // Initialize the zero-config environment
    await initializeBlockchainExplorer();

    // Check system readiness
    const readiness = await zeroConfig.checkReadiness();

    if (readiness.ready) {
      logger.info("System is ready for operation");

      // Show status
      const status = zeroConfig.getStatus();
      logger.info({ chainCount: status.chainCount, databaseCount: status.databasePaths.length }, "Bootstrap status");

    } else {
      logger.warn("System needs attention");
      readiness.issues.forEach(issue => logger.warn({ issue }, "Issue"));
      if (readiness.recommendations.length > 0) {
        readiness.recommendations.forEach(rec => logger.info({ recommendation: rec }, "Recommendation"));
      }
    }

    logger.info("Bootstrap completed successfully");

  } catch (error) {
    logger.error({ err: error }, "Bootstrap failed");
    throw error;
  }
}

/**
 * Auto-bootstrap when this file is executed
 */
if (require.main === module) {
  bootstrap().catch(error => {
    logger.error({ err: error }, "Auto-bootstrap failed");
    process.exit(1);
  });
}

export default bootstrap;