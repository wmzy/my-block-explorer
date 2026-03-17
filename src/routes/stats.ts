import { Hono } from "hono";
import { createLogger } from "../server/logger";
import { blockService } from "../services/BlockService";

const logger = createLogger("stats-routes");
import { transactionService } from "../services/TransactionService";
import {
  getChainName,
  getChainSymbol,
  getSupportedChainIds,
} from "../config/chains";
import { safeJsonResponse } from "../utils/serialization";

const app = new Hono();

app.get("/stats/overview", async (c) => {
  try {
    const supportedChainIds = getSupportedChainIds();
    const chainStats = [];

    const topChains = supportedChainIds.slice(0, 10);

    for (const chainId of topChains) {
      try {
        const [blockStats, txStats] = await Promise.all([
          blockService.getBlockStats(chainId).catch(() => ({
            totalBlocks: 0,
            latestBlock: null,
            avgBlockTime: null,
            avgGasUsed: null,
          })),
          transactionService.getTransactionStats(chainId).catch(() => ({
            totalTransactions: 0,
            avgGasPrice: null,
            avgGasUsed: null,
            successRate: 0,
          })),
        ]);

        chainStats.push({
          chainId,
          chainName: getChainName(chainId),
          chainSymbol: getChainSymbol(chainId),
          isIndexed: blockStats.totalBlocks > 0,
          totalBlocks: blockStats.totalBlocks,
          totalTransactions: txStats.totalTransactions,
          latestBlock: blockStats.latestBlock?.toString() ?? null,
          avgBlockTime: blockStats.avgBlockTime,
          successRate: txStats.successRate,
        });
      } catch (error) {
        logger.warn({ err: error, chainId }, "Failed to get stats for chain");
        chainStats.push({
          chainId,
          chainName: getChainName(chainId),
          chainSymbol: getChainSymbol(chainId),
          isIndexed: false,
          totalBlocks: 0,
          totalTransactions: 0,
          latestBlock: null,
          avgBlockTime: null,
          successRate: 0,
        });
      }
    }

    const totalBlocks = chainStats.reduce(
      (sum, chain) => sum + chain.totalBlocks,
      0
    );
    const totalTransactions = chainStats.reduce(
      (sum, chain) => sum + chain.totalTransactions,
      0
    );
    const indexedChains = chainStats.filter((chain) => chain.isIndexed).length;

    c.header("X-Data-Source", "database");

    return c.json({
      supportedChains: supportedChainIds.length,
      indexedChains,
      totalBlocks,
      totalTransactions,
      chains: chainStats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error }, "Stats overview API error");
    return c.json({ error: "Failed to get stats overview" }, 500);
  }
});

export default app;
