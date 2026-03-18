import { Hono } from "hono";
import { createLogger } from "../server/logger";
import { blockService } from "../services/BlockService";
import { transactionService } from "../services/TransactionService";
import { rpcManager } from "../services/RpcManager";
import {
  getChainName,
  getChainSymbol,
  POPULAR_CHAINS,
  getSupportedChainIds,
} from "../config/chains";

const logger = createLogger("stats-routes");

const RPC_TIMEOUT_MS = 3000;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);

const app = new Hono();

app.get("/stats/overview", async (c) => {
  try {
    const popularChainIds = POPULAR_CHAINS.map((chain) => chain.id);
    const chainStats = [];

    const results = await Promise.all(
      popularChainIds.map(async (chainId) => {
        try {
          const [blockStats, txStats, rpcBlockNumber] = await Promise.all([
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
            withTimeout(
              rpcManager
                .getClient(chainId)
                .then((client) => client.getBlockNumber()),
              RPC_TIMEOUT_MS
            ).catch(() => null),
          ]);

          return {
            chainId,
            chainName: getChainName(chainId),
            chainSymbol: getChainSymbol(chainId),
            latestBlockNumber: rpcBlockNumber?.toString() ?? null,
            isIndexed: blockStats.totalBlocks > 0,
            indexedBlocks: blockStats.totalBlocks,
            indexedTransactions: txStats.totalTransactions,
            latestIndexedBlock: blockStats.latestBlock?.toString() ?? null,
            avgBlockTime: blockStats.avgBlockTime,
            successRate: txStats.successRate,
            rpcConnected: rpcBlockNumber !== null,
          };
        } catch (error) {
          logger.warn(
            { err: error, chainId },
            "Failed to get stats for chain"
          );
          return {
            chainId,
            chainName: getChainName(chainId),
            chainSymbol: getChainSymbol(chainId),
            latestBlockNumber: null,
            isIndexed: false,
            indexedBlocks: 0,
            indexedTransactions: 0,
            latestIndexedBlock: null,
            avgBlockTime: null,
            successRate: 0,
            rpcConnected: false,
          };
        }
      })
    );

    chainStats.push(...results);

    const connectedChains = chainStats.filter((ch) => ch.rpcConnected).length;
    const indexedChains = chainStats.filter((ch) => ch.isIndexed).length;
    const totalIndexedBlocks = chainStats.reduce(
      (sum, ch) => sum + ch.indexedBlocks,
      0
    );
    const totalIndexedTransactions = chainStats.reduce(
      (sum, ch) => sum + ch.indexedTransactions,
      0
    );

    c.header("X-Data-Source", "hybrid");

    return c.json({
      supportedChains: getSupportedChainIds().length,
      displayedChains: popularChainIds.length,
      connectedChains,
      indexedChains,
      totalIndexedBlocks,
      totalIndexedTransactions,
      chains: chainStats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error }, "Stats overview API error");
    return c.json({ error: "Failed to get stats overview" }, 500);
  }
});

export default app;
