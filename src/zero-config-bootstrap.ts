/**
 * Zero Configuration Bootstrap
 * Auto-initializes the blockchain explorer environment
 */

import { zeroConfig, initializeBlockchainExplorer } from './config/zero-config';
import { performanceMonitor } from './services/PerformanceMonitor';

/**
 * Bootstrap the application with zero configuration
 */
export async function bootstrap(): Promise<void> {
  console.log('🚀 Bootstrapping blockchain explorer with zero configuration...');

  try {
    // Initialize the zero-config environment
    await initializeBlockchainExplorer();

    // Check system readiness
    const readiness = await zeroConfig.checkReadiness();

    if (readiness.ready) {
      console.log('✅ System is ready for operation!');

      // Show status
      const status = zeroConfig.getStatus();
      console.log(`📊 Status: ${status.chainCount} chains initialized`);
      console.log(`💾 Databases: ${status.databasePaths.length} database files`);

    } else {
      console.log('⚠️ System needs attention:');
      readiness.issues.forEach(issue => console.log(`  ❌ ${issue}`));

      if (readiness.recommendations.length > 0) {
        console.log('💡 Recommendations:');
        readiness.recommendations.forEach(rec => console.log(`  💡 ${rec}`));
      }
    }

    console.log('🎉 Bootstrap completed successfully!');

  } catch (error) {
    console.error('💥 Bootstrap failed:', error);
    throw error;
  }
}

/**
 * Auto-bootstrap when this file is executed
 */
if (require.main === module) {
  bootstrap().catch(error => {
    console.error('💥 Auto-bootstrap failed:', error);
    process.exit(1);
  });
}

export default bootstrap;