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
// No focus/reconnect revalidation follows the polledQuery factory
// defaults (see polledQuery.ts header for the rationale), and usePolling
// already skips ticks while document.hidden (react-toolroom default,
// whenHidden: false). What the factory does not do is catch up after a
// long-hidden tab, so each feed below adds one immediate refetch on
// visibility regain before the cadence resumes.
//
// The dataUpdatedAt field the hooks expose is the last-successful-fetch
// timestamp: react-toolroom stamps it only in the result commit path, so
// failed settles never touch it — the staleness clock the Home banner
// renders.
import { useEffect } from 'react';
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
// window while an unknown chain param is being replaced with the
// remembered/preferred landing chain).
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

// usePolling already skips ticks while the document is hidden, but a tab
// restored after minutes away would otherwise keep showing stale data for
// up to one full interval. One immediate catch-up fetch per feed on
// visibility regain closes that window; the poll cadence then takes over.
// refetch is reference-stable (react-toolroom memoizes it on the
// injectable + provider), so the listener is registered once per feed.
function useRefetchOnVisible(refetch: () => void | Promise<unknown>): void {
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void Promise.resolve(refetch()).catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refetch]);
}

// Old call-site shape kept: one hook per feed, chainId positional.
export function useLatestBlocksFeed(chainId: number) {
  const feed = useLatestBlocksFeedQuery([chainId]);
  useRefetchOnVisible(feed.refetch);
  return feed;
}

export function useLatestTransactionsFeed(chainId: number) {
  const feed = useLatestTransactionsFeedQuery([chainId]);
  useRefetchOnVisible(feed.refetch);
  return feed;
}
