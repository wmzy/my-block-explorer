// Chain-scoped cache clearing for dev-chain resets (PM-review P0):
// anvil/hardhat `reset` keeps the chain id but rewinds the head, so every
// cached-immutable row this explorer holds for that id (contract sources,
// storage layouts) may now describe contracts that no longer exist at
// those addresses. This service drops exactly those two caches for ONE
// chain and reports honest, counted numbers — never a fabricated count.
//
// Scope is deliberately narrow: per-chain event DB files
// (data/chains/...) are NOT touched — they are held open by the running
// process, and event data / indexing ranges have their own management on
// the Events page. The route response documents that scope so the caller
// can show it honestly.
import { count, eq } from 'drizzle-orm';
import { db, sqlCountTotal } from '../database/init';
import { contractSources, storageLayouts } from '../database/schema';
import { createLogger } from '../server/logger';

const logger = createLogger('chain-cache-service');

/** Rows removed per cache, exactly as counted before each delete. */
export type ClearedChainCacheCounts = {
  contractSources: number;
  storageLayouts: number;
};

export class ChainCacheService {
  /**
   * Delete this chain's contract-source and storage-layout cache rows.
   * Each table is counted immediately before its delete, so the reported
   * number is the set of rows that existed at deletion time (the local
   * DuckDB is single-writer, so no concurrent writer can skew the pair).
   * Both caches are immutable-fetch caches: cleared rows simply refetch
   * on demand, which is what makes this delete non-destructive.
   */
  async clearChainCachedData(chainId: number): Promise<ClearedChainCacheCounts> {
    try {
      const sourceCountRows = await db
        .select({ value: count() })
        .from(contractSources)
        .where(eq(contractSources.chainId, chainId));
      const contractSourcesCleared = sqlCountTotal(sourceCountRows);

      await db.delete(contractSources).where(eq(contractSources.chainId, chainId));

      const layoutCountRows = await db
        .select({ value: count() })
        .from(storageLayouts)
        .where(eq(storageLayouts.chainId, chainId));
      const storageLayoutsCleared = sqlCountTotal(layoutCountRows);

      await db.delete(storageLayouts).where(eq(storageLayouts.chainId, chainId));

      logger.info(
        {
          chainId,
          contractSources: contractSourcesCleared,
          storageLayouts: storageLayoutsCleared,
        },
        'Cleared chain-scoped immutable caches',
      );

      return {
        contractSources: contractSourcesCleared,
        storageLayouts: storageLayoutsCleared,
      };
    } catch (error) {
      logger.error({ err: error, chainId }, 'Failed to clear chain-scoped immutable caches');
      throw error;
    }
  }
}

export const chainCacheService = new ChainCacheService();
