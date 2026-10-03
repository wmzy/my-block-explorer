import { Hono } from 'hono';
import { createLogger } from '../server/logger';
import { blockService } from '../services/BlockService';
import { transactionService } from '../services/TransactionService';
import { rpcManager } from '../services/RpcManager';
import {
  getChainName,
  getChainSymbol,
  POPULAR_CHAINS,
  getSupportedChainIds,
} from '../config/chains';

const logger = createLogger('stats-routes');

const RPC_TIMEOUT_MS = 3000;

// The timeout's timer must die with the race: a losing setTimeout keeps
// the event loop alive for the full window (and stacks one per chain per
// request here), so both outcomes of the wrapped promise clear it.
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  new Promise<T | null>((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const app = new Hono();

app.get('/stats/overview', async c => {
  try {
    const popularChainIds = POPULAR_CHAINS.map(chain => chain.id);
    const chainStats = [];

    const results = await Promise.all(
      popularChainIds.map(async chainId => {
        // Indexed counts come from DuckDB and BOTH services throw when the
        // database cannot be read. Those throws used to be caught into a
        // zeroed default, which answered 200 with a confident
        // "indexed nothing / successRate 0" for a chain whose database was
        // broken — indistinguishable from a chain that genuinely has no
        // indexed data, and summed into the cross-chain totals. Let the
        // rejection reach the handler below, which reports 503
        // stats_unavailable; a real zero still comes back as a real zero.
        const [blockStats, txStats, rpcBlockNumber] = await Promise.all([
          blockService.getBlockStats(chainId),
          transactionService.getTransactionStats(chainId),
          // The live head probe is the one read that degrades instead: an
          // unreachable node is a normal condition and the response has
          // always documented a null head with rpcConnected:false.
          withTimeout(
            rpcManager.getClient(chainId).then(client => client.getBlockNumber()),
            RPC_TIMEOUT_MS,
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
      }),
    );

    chainStats.push(...results);

    const connectedChains = chainStats.filter(ch => ch.rpcConnected).length;
    const indexedChains = chainStats.filter(ch => ch.isIndexed).length;
    const totalIndexedBlocks = chainStats.reduce((sum, ch) => sum + ch.indexedBlocks, 0);
    const totalIndexedTransactions = chainStats.reduce(
      (sum, ch) => sum + ch.indexedTransactions,
      0,
    );

    c.header('X-Data-Source', 'hybrid');

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
    // 503 + the same error vocabulary the sibling indexing-status route
    // uses: a database we could not read is NOT the same answer as a
    // database that reported zero indexed blocks.
    logger.error({ err: error }, 'Stats overview API error');
    return c.json(
      {
        error: 'stats_unavailable',
        message: error instanceof Error ? error.message : 'Failed to load stats overview',
      },
      503,
    );
  }
});

export default app;
