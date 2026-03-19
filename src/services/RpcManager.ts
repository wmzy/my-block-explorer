import { createPublicClient, http, PublicClient } from 'viem';
import {
  getChainInfo,
  getDefaultRpcUrl,
  type UserRpcConfig,
} from '../config/chains';
import { createLogger } from '../server/logger';

const logger = createLogger('rpc-manager');
import { db, userRpcConfigs } from '../database/init';
import { eq } from 'drizzle-orm';
import {
  createRetryableRpcCall,
  createRetryableDbCall,
  RpcError,
  logError,
} from '../utils/errorHandler';

/**
 * RPC客户端管理器
 * 负责创建和管理不同链的RPC客户端
 */
export class RpcManager {
  private clients = new Map<number, PublicClient>();
  private userConfigs = new Map<number, UserRpcConfig>();
  private configsReady: Promise<void>;

  constructor() {
    this.configsReady = this.loadUserConfigs();
  }

  // 重新加载RPC配置
  async reloadConfigs(): Promise<void> {
    this.userConfigs.clear();
    this.clients.clear();
    this.configsReady = this.loadUserConfigs();
    await this.configsReady;
  }

  // 加载用户RPC配置
  private async loadUserConfigs(): Promise<void> {
    const loadConfigs = createRetryableDbCall(async () => {
      const configs = await db.select().from(userRpcConfigs);

      for (const config of configs) {
        this.userConfigs.set(config.chainId, {
          chainId: config.chainId,
          customRpcUrl: config.url || undefined,
          rpcBackups: undefined,
          timeout: 10000,
          retryCount: 3,
          rateLimit: 100,
        });
      }
    });

    try {
      await loadConfigs();
    }
    catch (error) {
      logError(error, 'RpcManager.loadUserConfigs');
    }
  }

  // 获取RPC客户端
  async getClient(chainId: number): Promise<PublicClient> {
    await this.configsReady;

    if (!this.clients.has(chainId)) {
      try {
        logger.info({ chainId }, 'Creating new RPC client for chain');
        const config = this.userConfigs.get(chainId);
        logger.info(
          { configFound: !!config, customRpc: config?.customRpcUrl },
          'RPC config',
        );

        const client = await this.createClient(chainId);
        this.clients.set(chainId, client);
      }
      catch (error) {
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

  // 创建RPC客户端
  private async createClient(chainId: number): Promise<PublicClient> {
    // 直接从viem获取链定义
    const viemChain = getChainInfo(chainId);
    if (!viemChain) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }

    // 获取有效的RPC URL（用户配置优先，否则viem默认）
    const userConfig = this.userConfigs.get(chainId);
    const rpcUrl = userConfig?.customRpcUrl || getDefaultRpcUrl(chainId);

    logger.info({ rpcUrl }, 'Creating client with RPC URL');

    return createPublicClient({
      chain: viemChain,
      transport: http(rpcUrl, {
        timeout: userConfig?.timeout || 10000,
        retryCount: userConfig?.retryCount || 3,
      }),
    });
  }

  // 获取链名称
  getChainName(chainId: number): string {
    const chain = getChainInfo(chainId);
    return chain?.name || `Chain ${chainId}`;
  }

  // 更新用户RPC配置
  async updateUserRpcConfig(config: UserRpcConfig): Promise<void> {
    try {
      await db
        .insert(userRpcConfigs)
        .values({
          chainId: config.chainId,
          name: config.customRpcUrl ? `Custom RPC` : null,
          url: config.customRpcUrl ?? null,
        })
        .onConflictDoUpdate({
          target: userRpcConfigs.chainId,
          set: {
            url: config.customRpcUrl ?? null,
          },
        });

      this.userConfigs.set(config.chainId, config);
      this.clients.delete(config.chainId);
    }
    catch (error) {
      logError(error, 'RpcManager.updateUserRpcConfig');
      throw new Error('Failed to update RPC configuration');
    }
  }

  // 删除用户RPC配置
  async deleteUserRpcConfig(chainId: number): Promise<void> {
    try {
      await db
        .delete(userRpcConfigs)
        .where(eq(userRpcConfigs.chainId, chainId));

      this.userConfigs.delete(chainId);
      this.clients.delete(chainId);
    }
    catch (error) {
      logError(error, 'RpcManager.deleteUserRpcConfig');
      throw new Error('Failed to delete RPC configuration');
    }
  }

  // 获取用户RPC配置
  getUserRpcConfig(chainId: number): UserRpcConfig | undefined {
    return this.userConfigs.get(chainId);
  }

  // 获取所有用户RPC配置
  getAllUserRpcConfigs(): UserRpcConfig[] {
    return Array.from(this.userConfigs.values());
  }

  // 测试RPC连接
  async testRpcConnection(
    chainId: number,
    rpcUrl?: string,
  ): Promise<{ success: boolean; latency?: number; error?: string }> {
    try {
      const startTime = Date.now();

      // 创建临时客户端进行测试
      const viemChain = getChainInfo(chainId);
      if (!viemChain) {
        return { success: false, error: 'Unsupported chain' };
      }

      const testUrl
        = rpcUrl || getEffectiveRpcUrl(chainId, this.userConfigs.get(chainId));
      const testClient = createPublicClient({
        chain: viemChain,
        transport: http(testUrl, { timeout: 5000 }),
      });

      // 简单的RPC调用测试
      await testClient.getBlockNumber();

      const latency = Date.now() - startTime;
      return { success: true, latency };
    }
    catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // 清理所有客户端连接
  cleanup(): void {
    this.clients.clear();
    this.userConfigs.clear();
  }
}

// 全局RPC管理器实例
export const rpcManager = new RpcManager();
