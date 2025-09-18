import { Hono } from "hono";
import { BlockService } from "@/server/services/BlockService";
import { TransactionService } from "@/server/services/TransactionService";
import { RpcManager } from "@/server/services/RpcManager";
import { validateChainId } from "@/server/middleware/validation";
import { timingMiddleware } from "@/server/middleware/timing";
import {
  SUPPORTED_CHAINS,
  getChainName,
  getChainSymbol,
} from "@/shared/config/chains";

// 创建服务实例
const rpcManager = new RpcManager();
const blockService = new BlockService(rpcManager);
const transactionService = new TransactionService(rpcManager);

// 创建统计路由
export const statsRouter = new Hono();

// 添加通用中间件
statsRouter.use("*", timingMiddleware);

// 获取链统计信息
// GET /api/chains/:chainId/stats
statsRouter.get("/:chainId/stats", validateChainId, async (c) => {
  try {
    const chainId = c.get("chainId");

    // 并发获取统计数据
    const [blockStats, txStats, latestBlockNumber, currentGasPrice] =
      await Promise.all([
        blockService.getBlockStats(chainId),
        transactionService.getTransactionStats(chainId),
        blockService.getLatestBlockNumber(chainId).catch(() => null),
        rpcManager
          .getClient(chainId)
          .then((client) => client.getGasPrice().catch(() => null)),
      ]);

    const chainName = getChainName(chainId);
    const chainSymbol = getChainSymbol(chainId);

    // 计算TPS（基于最近的区块）
    let tps: number | null = null;
    if (blockStats.avgBlockTime && txStats.totalTransactions > 0) {
      // 简单估算：平均交易数 / 平均出块时间
      const recentBlocks = Math.min(100, blockStats.totalBlocks);
      if (recentBlocks > 0) {
        const avgTxPerBlock = txStats.totalTransactions / recentBlocks;
        tps =
          blockStats.avgBlockTime > 0
            ? avgTxPerBlock / blockStats.avgBlockTime
            : null;
      }
    }

    const stats = {
      chainId,
      chainName,
      chainSymbol,
      latestBlock: latestBlockNumber || blockStats.latestBlock,
      totalBlocks: blockStats.totalBlocks,
      totalTransactions: txStats.totalTransactions,
      avgBlockTime: blockStats.avgBlockTime,
      avgGasPrice: txStats.avgGasPrice,
      currentGasPrice: currentGasPrice?.toString() || null,
      avgGasUsed: blockStats.avgGasUsed,
      tps: tps ? Math.round(tps * 100) / 100 : null,
      successRate: txStats.successRate,
      indexedBlockCount: blockStats.totalBlocks,
      lastUpdated: new Date().toISOString(),
    };

    c.header("X-Data-Source", "hybrid");
    c.header("X-Chain-Id", chainId.toString());

    return con(stats);
  } catch (error) {
    throw error;
  }
});

// 获取所有支持链的概览统计
// GET /api/stats/overview
statsRouter.get("/overview", async (c) => {
  try {
    const chainOverviews = await Promise.all(
      SUPPORTED_CHAINS.map(async (chain) => {
        try {
          const [blockStats, txStats, latestBlockNumber] = await Promise.all([
            blockService.getBlockStats(chain.id).catch(() => ({
              totalBlocks: 0,
              latestBlock: null,
              avgBlockTime: null,
              avgGasUsed: null,
            })),
            transactionService.getTransactionStats(chain.id).catch(() => ({
              totalTransactions: 0,
              avgGasPrice: null,
              avgGasUsed: null,
              successRate: null,
            })),
            blockService.getLatestBlockNumber(chain.id).catch(() => null),
          ]);

          return {
            chainId: chain.id,
            chainName: chain.name,
            chainSymbol: chain.nativeCurrency.symbol,
            latestBlock: latestBlockNumber || blockStats.latestBlock,
            totalBlocks: blockStats.totalBlocks,
            totalTransactions: txStats.totalTransactions,
            avgBlockTime: blockStats.avgBlockTime,
            isIndexed: blockStats.totalBlocks > 0,
            lastUpdated: new Date().toISOString(),
          };
        } catch (error) {
          console.warn(`Failed to get stats for chain ${chain.id}:`, error);
          return {
            chainId: chain.id,
            chainName: chain.name,
            chainSymbol: chain.nativeCurrency.symbol,
            latestBlock: null,
            totalBlocks: 0,
            totalTransactions: 0,
            avgBlockTime: null,
            isIndexed: false,
            lastUpdated: new Date().toISOString(),
          };
        }
      })
    );

    // 计算总体统计
    const totalBlocks = chainOverviews.reduce(
      (sum, chain) => sum + chain.totalBlocks,
      0
    );
    const totalTransactions = chainOverviews.reduce(
      (sum, chain) => sum + chain.totalTransactions,
      0
    );
    const indexedChains = chainOverviews.filter(
      (chain) => chain.isIndexed
    ).length;

    const overview = {
      supportedChains: SUPPORTED_CHAINS.length,
      indexedChains,
      totalBlocks,
      totalTransactions,
      chains: chainOverviews,
      lastUpdated: new Date().toISOString(),
    };

    c.header("X-Data-Source", "hybrid");
    c.header("X-Supported-Chains", SUPPORTED_CHAINS.length.toString());
    c.header("X-Indexed-Chains", indexedChains.toString());

    return con(overview);
  } catch (error) {
    throw error;
  }
});

// 获取链的实时状态
// GET /api/chains/:chainId/status
statsRouter.get("/:chainId/status", validateChainId, async (c) => {
  try {
    const chainId = c.get("chainId");

    // 测试RPC连接和获取基本信息
    const startTime = Date.now();
    const client = await rpcManager.getClient(chainId);

    const [blockNumber, gasPrice, chainIdFromRpc] = await Promise.all([
      client.getBlockNumber(),
      client.getGasPrice().catch(() => null),
      client.getChainId().catch(() => null),
    ]);

    const rpcLatency = Date.now() - startTime;

    // 检查链ID匹配
    const chainIdMatch = !chainIdFromRpc || Number(chainIdFromRpc) === chainId;

    const status = {
      chainId,
      chainName: getChainName(chainId),
      isOnline: true,
      latestBlock: Number(blockNumber),
      currentGasPrice: gasPrice?.toString() || null,
      rpcLatency,
      chainIdMatch,
      timestamp: new Date().toISOString(),
    };

    c.header("X-Data-Source", "rpc");
    c.header("X-Chain-Id", chainId.toString());
    c.header("X-RPC-Latency", rpcLatency.toString());
    c.header("X-Chain-Online", "true");

    return con(status);
  } catch (error) {
    // RPC连接失败
    const status = {
      chainId: c.get("chainId"),
      chainName: getChainName(c.get("chainId")),
      isOnline: false,
      latestBlock: null,
      currentGasPrice: null,
      rpcLatency: null,
      chainIdMatch: null,
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    };

    c.header("X-Data-Source", "rpc");
    c.header("X-Chain-Id", c.get("chainId").toString());
    c.header("X-Chain-Online", "false");

    return con(status);
  }
});

// 健康检查接口
// GET /api/health
statsRouter.get("/health", async (c) => {
  try {
    // 测试数据库连接
    const dbHealthy = await blockService
      .getIndexedBlockCount(1)
      .then(() => true)
      .catch(() => false);

    // 测试至少一个RPC连接
    let rpcHealthy = false;
    try {
      const mainnetClient = await rpcManager.getClient(1);
      await mainnetClient.getBlockNumber();
      rpcHealthy = true;
    } catch (error) {
      console.warn("RPC health check failed:", error);
    }

    const health = {
      status: dbHealthy && rpcHealthy ? "healthy" : "degraded",
      database: dbHealthy ? "online" : "offline",
      rpc: rpcHealthy ? "online" : "offline",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || "1.0.0",
    };

    const statusCode = health.status === "healthy" ? 200 : 503;

    c.header("X-Health-Status", health.status);
    c.header("X-Database-Status", health.database);
    c.header("X-RPC-Status", health.rpc);

    return con(health, statusCode);
  } catch (error) {
    const health = {
      status: "unhealthy",
      database: "unknown",
      rpc: "unknown",
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    };

    c.header("X-Health-Status", "unhealthy");

    return con(health, 503);
  }
});
