// Polled scenario hook factory: the composition behind useOverviewStats and
// useLatestBlock (the two hooks the old TanStack layer drove with
// refetchInterval).
//
// Why this file exists instead of reusing createQueryHook: a tick from
// react-toolroom's usePolling only reaches the store a hook reads when BOTH
// share the same useInjectable instance — the result broadcast store and the
// keyed status slots live on that instance, so polling a second instance of
// the same fetch function would fire requests whose settles never reach the
// mounted hook (silent no-op polling). createQueryHook creates its instance
// internally, so the poller must be composed here, onto the same instance the
// useRun of this scenario drives.
//
// Differences vs createQueryHook, both deliberate:
// - No focus/reconnect revalidation: the old app's QueryClient ran with
//   refetchOnWindowFocus: false and the poll cadence owns updates.
// - usePolling pauses while the document is hidden (react-toolroom default);
//   TanStack's refetchInterval kept running in background tabs. Polled data
//   here is dashboard-grade, so skipping hidden-tab ticks is the cheaper and
//   intended behavior.
import {
  hashArgs,
  useArgsStatus,
  useCache,
  useInjectable,
  useLoading,
  usePolling,
  useRefresh,
  useResultSelect,
  useRun,
  type CacheProvider,
} from 'react-toolroom/async';

import { DEFAULT_STALE_TIME } from '@/util/loaderCache';
import { getCache, type QueryFn } from '@/util/useQuery';

export type PolledQueryResult<T> = {
  data: T | undefined;
  loading: boolean;
  fetching: boolean;
  error: Error | undefined;
  failureCount: number;
  stale: boolean;
  dataUpdatedAt: number | undefined;
  refetch: () => void | Promise<unknown>;
};

// useResultSelect always applies select when a result exists; a module-level
// identity keeps the reference stable.
const identity = <T>(r: T) => r;

export function createPolledQueryHook<T, K extends unknown[]>(config: {
  queryFn: QueryFn<T, K>;
  /** Fixed delay between ticks in ms (TanStack refetchInterval counterpart). */
  interval: number;
  /**
   * Fresh window for non-tick reads (remounts, refetch bypasses it anyway).
   * Must stay below `interval` or fresh entries would swallow the ticks.
   */
  staleTime?: number;
}): (args: K) => PolledQueryResult<T> {
  const { queryFn, interval, staleTime = DEFAULT_STALE_TIME } = config;
  const cache = getCache(queryFn);

  return (args: K): PolledQueryResult<T> => {
    // Same widening createQueryHook performs: the runtime signature is
    // [...K, signal?] and the cache slot widens with it.
    const runArgs = args as unknown as [...K, signal?: AbortSignal];
    const provider = cache as unknown as CacheProvider<
      T,
      [...K, signal?: AbortSignal]
    >;

    const injectable = useInjectable(queryFn, { name: queryFn.name || 'query' });
    const stale = useCache(injectable, provider, staleTime);
    const data = useResultSelect(injectable, identity);
    const fetching = useLoading(injectable);
    const status = useArgsStatus(injectable, runArgs);
    const loading = status.loading && status.data === undefined;

    useRun(injectable, runArgs, { signal: true, hash: hashArgs });

    // Logical args only (no signal slot): ticks and useRun's signal-appended
    // run hash to the same cache entry because the key derivation trims a
    // trailing signal before hashing. The widening cast mirrors runArgs —
    // at runtime the tuple keeps exactly K's elements.
    usePolling(injectable, interval, {
      args: args as unknown as [...K, signal?: AbortSignal],
    });

    const refetch = useRefresh(injectable, runArgs, provider);

    return {
      data,
      loading,
      fetching,
      error: status.error,
      failureCount: status.failureCount,
      stale,
      dataUpdatedAt: status.dataUpdatedAt,
      refetch,
    };
  };
}
