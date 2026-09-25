import { createPublicClient, http, PublicClient } from 'viem';
import {
  getChainInfo,
  getDefaultRpcUrl,
  getEffectiveRpcUrl,
  type UserRpcConfig,
} from '../config/chains';
import {
  listCustomChainIds,
  registerCustomChain,
  removeCustomChain,
} from '../config/customChains';
import { createLogger } from '../server/logger';

const logger = createLogger('rpc-manager');
import { db, userRpcConfigs, customChains } from '../database/init';
import { seedBuiltinLabels } from '../database/seedBuiltinLabels';
import { eq } from 'drizzle-orm';
import { createRetryableDbCall, RpcError, logError } from '../utils/errorHandler';

/**
 * RPC client manager
 * Creates and manages RPC clients for different chains
 */
export class RpcManager {
  private clients = new Map<number, PublicClient>();
  private userConfigs = new Map<number, UserRpcConfig>();
  private configsReady: Promise<void>;

  constructor() {
    this.configsReady = this.loadUserConfigs();
  }

  // Reload RPC configurations
  async reloadConfigs(): Promise<void> {
    this.userConfigs.clear();
    this.clients.clear();
    this.configsReady = this.loadUserConfigs();
    await this.configsReady;
  }

  // Load user RPC configurations
  private async loadUserConfigs(): Promise<void> {
    const loadConfigs = createRetryableDbCall(async () => {
      const configs = await db.select().from(userRpcConfigs);

      for (const config of configs) {
        this.userConfigs.set(config.chainId, {
          chainId: config.chainId,
          customRpcUrl: config.url ?? undefined,
          rpcBackups: undefined,
          timeout: 10000,
          retryCount: 3,
          rateLimit: 100,
        });
      }
    });

    // Custom chains (user-registered, outside viem's registry): each row
    // feeds BOTH the runtime chain registry — so every getChainInfo
    // consumer resolves the id process-wide — and this manager's per-chain
    // RPC fallback, exactly the way userRpcConfigs rows do. This one load
    // path serves both the startup bootstrap (the singleton constructor)
    // and post-write reloads; failures are logged, never fatal, so a
    // half-open database degrades to "no custom chains" instead of
    // crashing the server. The registry is reconciled against the table:
    // ids whose rows disappeared (DELETE /api/chains/custom/:id) drop out
    // here too.
    const loadCustomChains = createRetryableDbCall(async () => {
      const rows = await db.select().from(customChains);

      const loadedIds = new Set<number>();
      for (const row of rows) {
        loadedIds.add(row.chainId);
        registerCustomChain({
          chainId: row.chainId,
          name: row.name,
          symbol: row.symbol,
          decimals: row.decimals ?? 18,
          rpcUrl: row.rpcUrl,
        });
        // A user RPC override (user_rpc_configs) loaded above wins over
        // the chain's own registration URL — keep it when one exists.
        if (!this.userConfigs.has(row.chainId)) {
          this.userConfigs.set(row.chainId, {
            chainId: row.chainId,
            customRpcUrl: row.rpcUrl,
            rpcBackups: undefined,
            timeout: 10000,
            retryCount: 3,
            rateLimit: 100,
          });
        }
      }

      for (const id of listCustomChainIds()) {
        if (!loadedIds.has(id)) removeCustomChain(id);
      }
    });

    try {
      await loadConfigs();
    } catch (error) {
      logError(error, 'RpcManager.loadUserConfigs');
    }
    try {
      await loadCustomChains();
    } catch (error) {
      logError(error, 'RpcManager.loadCustomChains');
    }

    // Built-in label seeds: plant the curated dataset (config/
    // builtinLabels.ts) into address_labels on first startup. This lives
    // here because loadUserConfigs is the one bootstrap both lifecycles
    // share — the standalone server and the vite dev bridge — so a fresh
    // local instance gets the bundled names regardless of how it was
    // started. The seeder is first-startup-only, never overwrites
    // existing rows, and swallows its own failures.
    await seedBuiltinLabels(db);
  }

  // Get an RPC client
  async getClient(chainId: number): Promise<PublicClient> {
    await this.configsReady;

    if (!this.clients.has(chainId)) {
      try {
        logger.info({ chainId }, 'Creating new RPC client for chain');
        const config = this.userConfigs.get(chainId);
        logger.info({ configFound: !!config, customRpc: config?.customRpcUrl }, 'RPC config');

        const client = await this.createClient(chainId);
        this.clients.set(chainId, client);
      } catch (error) {
        logError(error, `RpcManager.getClient`, { chainId });
        throw new RpcError(
          `Failed to create RPC client for chain ${chainId}`,
          undefined,
          undefined,
          chainId,
        );
      }
    }
    return this.clients.get(chainId)!;
  }

  // Create an RPC client
  private async createClient(chainId: number): Promise<PublicClient> {
    // Get the chain definition straight from viem
    const viemChain = getChainInfo(chainId);
    if (!viemChain) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }

    // Get the effective RPC URL (user config first, otherwise the viem default)
    const userConfig = this.userConfigs.get(chainId);
    const rpcUrl = userConfig?.customRpcUrl ?? getDefaultRpcUrl(chainId);

    logger.info({ rpcUrl }, 'Creating client with RPC URL');

    return createPublicClient({
      chain: viemChain,
      transport: http(rpcUrl, {
        timeout: userConfig?.timeout ?? 10000,
        retryCount: userConfig?.retryCount ?? 3,
      }),
    });
  }

  // Get the chain name
  getChainName(chainId: number): string {
    const chain = getChainInfo(chainId);
    return chain?.name ?? `Chain ${chainId}`;
  }

  // Update a user RPC configuration
  async updateUserRpcConfig(config: UserRpcConfig): Promise<void> {
    try {
      await db
        .insert(userRpcConfigs)
        .values({
          chainId: config.chainId,
          name: config.customRpcUrl ? `Custom RPC` : null,
          url: config.customRpcUrl ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userRpcConfigs.chainId,
          set: {
            url: config.customRpcUrl ?? null,
          },
        });

      this.userConfigs.set(config.chainId, config);
      this.clients.delete(config.chainId);
    } catch (error) {
      logError(error, 'RpcManager.updateUserRpcConfig');
      throw new Error('Failed to update RPC configuration', { cause: error });
    }
  }

  // Delete a user RPC configuration
  async deleteUserRpcConfig(chainId: number): Promise<void> {
    try {
      await db.delete(userRpcConfigs).where(eq(userRpcConfigs.chainId, chainId));

      this.userConfigs.delete(chainId);
      this.clients.delete(chainId);
    } catch (error) {
      logError(error, 'RpcManager.deleteUserRpcConfig');
      throw new Error('Failed to delete RPC configuration', { cause: error });
    }
  }

  // Get a user RPC configuration
  getUserRpcConfig(chainId: number): UserRpcConfig | undefined {
    return this.userConfigs.get(chainId);
  }

  // Get all user RPC configurations
  getAllUserRpcConfigs(): UserRpcConfig[] {
    return Array.from(this.userConfigs.values());
  }

  // Test an RPC connection
  async testRpcConnection(
    chainId: number,
    rpcUrl?: string,
  ): Promise<{ success: boolean; latency?: number; error?: string }> {
    try {
      const startTime = Date.now();

      // Create a temporary client for the test
      const viemChain = getChainInfo(chainId);
      if (!viemChain) {
        return { success: false, error: 'Unsupported chain' };
      }

      const testUrl = rpcUrl ?? getEffectiveRpcUrl(chainId, this.userConfigs.get(chainId));
      const testClient = createPublicClient({
        chain: viemChain,
        transport: http(testUrl, { timeout: 5000 }),
      });

      // Simple RPC call test
      await testClient.getBlockNumber();

      const latency = Date.now() - startTime;
      return { success: true, latency };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Tear down all client connections
  cleanup(): void {
    this.clients.clear();
    this.userConfigs.clear();
  }
}

// Global RPC manager instance
export const rpcManager = new RpcManager();
