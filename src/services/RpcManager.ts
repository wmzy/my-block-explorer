import { createPublicClient, http, PublicClient } from "viem";
import {
  getChainInfo,
  getEffectiveRpcUrl,
  type UserRpcConfig,
} from "@/shared/config/chains";
import { db, userRpcConfigs } from "@/server/database/drizzle";
import { eq } from "drizzle-orm";

/**
 * RPC客户端管理器
 * 负责创建和管理不同链的RPC客户端
 */
export class RpcManager {
  private clients = new Map<number, PublicClient>();
  private userConfigs = new Map<number, UserRpcConfig>();

  constructor() {
    this.loadUserConfigs();
  }

  // 加载用户RPC配置
  private async loadUserConfigs(): Promise<void> {
    try {
      const configs = await db.select().from(userRpcConfigs);
      for (const config of configs) {
        this.userConfigs.set(config.chainId, {
          chainId: config.chainId,
          customRpcUrl: config.customRpcUrl || undefined,
          rpcBackups: config.rpcBackupUrls
            ? JSON.parse(config.rpcBackupUrls)
            : undefined,
          timeout: config.timeoutMs || 10000,
          retryCount: config.retryCount || 3,
          rateLimit: config.rateLimit || 100,
        });
      }
    } catch (error) {
      console.warn("Failed to load user RPC configs:", error);
    }
  }

  // 获取RPC客户端
  async getClient(chainId: number): Promise<PublicClient> {
    if (!this.clients.has(chainId)) {
      const client = await this.createClient(chainId);
      this.clients.set(chainId, client);
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
    const rpcUrl = getEffectiveRpcUrl(chainId, userConfig);

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
          customRpcUrl: config.customRpcUrl,
          rpcBackupUrls: config.rpcBackups
            ? JSON.stringify(config.rpcBackups)
            : null,
          timeoutMs: config.timeout,
          retryCount: config.retryCount,
          rateLimit: config.rateLimit,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userRpcConfigs.chainId,
          set: {
            customRpcUrl: config.customRpcUrl,
            rpcBackupUrls: config.rpcBackups
              ? JSON.stringify(config.rpcBackups)
              : null,
            timeoutMs: config.timeout,
            retryCount: config.retryCount,
            rateLimit: config.rateLimit,
            updatedAt: new Date(),
          },
        });

      // 更新内存缓存
      this.userConfigs.set(config.chainId, config);

      // 清除旧的客户端，强制重新创建
      this.clients.delete(config.chainId);
    } catch (error) {
      console.error("Failed to update user RPC config:", error);
      throw new Error("Failed to update RPC configuration");
    }
  }

  // 删除用户RPC配置
  async deleteUserRpcConfig(chainId: number): Promise<void> {
    try {
      await db
        .delete(userRpcConfigs)
        .where(eq(userRpcConfigs.chainId, chainId));

      // 清除内存缓存
      this.userConfigs.delete(chainId);

      // 清除客户端，强制使用默认配置重新创建
      this.clients.delete(chainId);
    } catch (error) {
      console.error("Failed to delete user RPC config:", error);
      throw new Error("Failed to delete RPC configuration");
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
    rpcUrl?: string
  ): Promise<{ success: boolean; latency?: number; error?: string }> {
    try {
      const startTime = Date.now();

      // 创建临时客户端进行测试
      const viemChain = getChainInfo(chainId);
      if (!viemChain) {
        return { success: false, error: "Unsupported chain" };
      }

      const testUrl =
        rpcUrl || getEffectiveRpcUrl(chainId, this.userConfigs.get(chainId));
      const testClient = createPublicClient({
        chain: viemChain,
        transport: http(testUrl, { timeout: 5000 }),
      });

      // 简单的RPC调用测试
      await testClient.getBlockNumber();

      const latency = Date.now() - startTime;
      return { success: true, latency };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // 清理所有客户端连接
  cleanup(): void {
    this.clients.clear();
    this.userConfigs.clear();
  }
}
