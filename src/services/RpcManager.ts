import { createPublicClient, http, PublicClient } from "viem";
import {
  getChainInfo,
  getDefaultRpcUrl,
  type UserRpcConfig,
} from "../config/chains";
import { duckdb as db } from "../database/init";
import {
  createRetryableRpcCall,
  createRetryableDbCall,
  RpcError,
  logError,
} from "../utils/errorHandler";

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

  // 重新加载RPC配置
  async reloadConfigs(): Promise<void> {
    this.userConfigs.clear();
    this.clients.clear();
    await this.loadUserConfigs();
  }

  // 加载用户RPC配置
  private async loadUserConfigs(): Promise<void> {
    const loadConfigs = createRetryableDbCall(async () => {
      const configs = await db.query<{
        chain_id: number;
        name: string;
        url: string;
        is_custom: boolean;
        supports_history: boolean | null;
        max_event_range: number | null;
        timeout_ms?: number;
        retry_count?: number;
        rate_limit?: number;
      }>(`SELECT * FROM user_rpc_configs`);

      for (const config of configs) {
        this.userConfigs.set(config.chain_id, {
          chainId: config.chain_id,
          customRpcUrl: config.url,
          rpcBackups: undefined, // 暂时不支持备用RPC
          timeout: config.timeout_ms || 10000,
          retryCount: config.retry_count || 3,
          rateLimit: config.rate_limit || 100,
        });
      }
    });

    try {
      await loadConfigs();
    } catch (error) {
      logError(error, "RpcManager.loadUserConfigs");
    }
  }

  // 获取RPC客户端
  async getClient(chainId: number): Promise<PublicClient> {
    if (!this.clients.has(chainId)) {
      try {
        console.log(`🔗 Creating new RPC client for chain ${chainId}`);
        const config = this.userConfigs.get(chainId);
        console.log(
          `   Config found: ${!!config}, Custom RPC: ${config?.customRpcUrl}`
        );

        const client = await this.createClient(chainId);
        this.clients.set(chainId, client);
      } catch (error) {
        logError(error, `RpcManager.getClient`, { chainId });
        throw new RpcError(
          `Failed to create RPC client for chain ${chainId}`,
          undefined,
          undefined,
          chainId
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

    console.log(`   Creating client with RPC URL: ${rpcUrl}`);

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
      // 使用 INSERT OR REPLACE 语法
      await db.exec(`
        INSERT OR REPLACE INTO user_rpc_configs (
          chain_id, custom_rpc_url, rpc_backup_urls, 
          timeout_ms, retry_count, rate_limit, updated_at
        ) VALUES (
          ${config.chainId}, 
          ${config.customRpcUrl ? `'${config.customRpcUrl}'` : "NULL"}, 
          ${config.rpcBackups ? `'${JSON.stringify(config.rpcBackups)}'` : "NULL"},
          ${config.timeout || 10000},
          ${config.retryCount || 3},
          ${config.rateLimit || 100},
          CURRENT_TIMESTAMP
        )
      `);

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
      await db.exec(`DELETE FROM user_rpc_configs WHERE chain_id = ${chainId}`);

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

// 全局RPC管理器实例
export const rpcManager = new RpcManager();
