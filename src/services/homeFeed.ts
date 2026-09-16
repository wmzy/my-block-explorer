// Home feed service: the RPC-direct polled lists behind the Home view.
//
// The old HomePage drove two poll loops by hand — a 12s setInterval over
// createRpcClient (block number -> block -> gas price -> block transactions),
// accumulating a rolling window in component state. The walk-and-format
// logic for exactly that window already lives in utils/blockRpcData
// (getLatestBlocks / getLatestTransactions run over the same RPC channel and
// produce the RpcBlock/RpcTransaction shapes the view renders today), so each
// feed here wraps those functions in a polled query hook instead of keeping
// the manual loops. Gas price rides the blocks feed because the old loop
// fetched it on the same tick as the block number.
//
// No focus/reconnect revalidation and hidden-tab pausing follow the
// polledQuery factory defaults (see polledQuery.ts header for the rationale).
import { createRpcClient } from '@/utils/realTimeData';
import {
  getLatestBlocks,
  getLatestTransactions,
  type RpcBlock,
  type RpcTransaction,
} from '@/utils/blockRpcData';

import { bindQueryFn, createQueryCache } from '@/util/useQuery';

import { createPolledQueryHook } from './polledQuery';

// Rolling-window size the old HomePage rendered (MAX_LIST_ITEMS).
export const HOME_FEED_ITEMS = 10;

// Same cadence as the old HomePage poll loop.
const HOME_FEED_INTERVAL = 12_000;

export type LatestBlocksFeed = {
  blocks: RpcBlock[];
  latestBlockNumber: bigint;
  gasPrice: bigint | null;
};

// Same invalid-arg guard the HTTP services use: a non-positive chain id
// resolves undefined without touching an RPC endpoint (covers the redirect
// window while an unknown chain param is being replaced with /chain/1).
export async function fetchLatestBlocksFeed(
  chainId: number,
): Promise<LatestBlocksFeed | undefined> {
  if (!(chainId > 0)) return undefined;
  const client = await createRpcClient(chainId);
  // Old loop tolerated gas-price failures (kept the previous-null value).
  const gasPrice = await client.getGasPrice().catch(() => null);
  const { blocks, latestBlockNumber } = await getLatestBlocks(chainId, HOME_FEED_ITEMS);
  return { blocks, latestBlockNumber, gasPrice };
}

export async function fetchLatestTransactionsFeed(
  chainId: number,
): Promise<RpcTransaction[] | undefined> {
  if (!(chainId > 0)) return undefined;
  const { transactions } = await getLatestTransactions(chainId, HOME_FEED_ITEMS);
  return transactions;
}

export const latestBlocksFeedCache = createQueryCache<LatestBlocksFeed | undefined, [number]>(
  'home-blocks-feed',
);

export const latestTransactionsFeedCache = createQueryCache<
  RpcTransaction[] | undefined,
  [number]
>('home-transactions-feed');

const queryLatestBlocksFeed = bindQueryFn(fetchLatestBlocksFeed, latestBlocksFeedCache);
const queryLatestTransactionsFeed = bindQueryFn(
  fetchLatestTransactionsFeed,
  latestTransactionsFeedCache,
);

const useLatestBlocksFeedQuery = createPolledQueryHook({
  queryFn: queryLatestBlocksFeed,
  interval: HOME_FEED_INTERVAL,
});

const useLatestTransactionsFeedQuery = createPolledQueryHook({
  queryFn: queryLatestTransactionsFeed,
  interval: HOME_FEED_INTERVAL,
});

// Old call-site shape kept: one hook per feed, chainId positional.
export function useLatestBlocksFeed(chainId: number) {
  return useLatestBlocksFeedQuery([chainId]);
}

export function useLatestTransactionsFeed(chainId: number) {
  return useLatestTransactionsFeedQuery([chainId]);
}
