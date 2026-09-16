// Project-level data fetching layer: cache/binding mechanisms plus the
// createQueryHook scenario assembly. bindQueryFn carries the compile-time
// phantom brand keeping unbranded service functions out of createQueryHook.
import { useRef } from 'react';

import {
  createMemoryCacheProvider,
  hashArgs,
  useArgsStatus,
  useCache,
  useFocusRevalidate,
  useInjectable,
  useLoading,
  useReconnectRevalidate,
  useRefresh,
  useResultSelect,
  useRun,
  type BoundMutation,
  type CacheProvider,
  type MutationSpec,
  type PersistOptions,
} from 'react-toolroom/async';

import { DEFAULT_STALE_TIME, resetRefreshSeen } from './loaderCache';

// gcTime default aligned with TanStack Query.
const DEFAULT_CACHE_TIME = 5 * 60_000;

// useResultSelect always applies select when a result exists (passing an
// undefined select throws); a module-level constant keeps the identity
// stable.
const identity = <T>(r: T) => r;

// Method shorthand keeps the members bivariant, so a concrete cache fills
// wide slots while branded values keep precise types.
export type EntityCache<T, K extends unknown[]> = CacheProvider<T, K> & {
  mutation<Args extends unknown[], Resp>(
    spec: (...args: Args) => MutationSpec<T, K, Args, Resp>
  ): BoundMutation<Args, Resp>;
};

// The registry is the single source of truth for clearAllCaches iteration.
// Entries only need clear() — a structural slot avoids invariant cache types
// in the registry.
type CacheRegistryEntry = {
  name: string;
  cache: { clear(): void };
};

// Exported as-is (temporary test caches are visible in it too).
export const allCaches: CacheRegistryEntry[] = [];

export function createQueryCache<T, K extends unknown[]>(
  name: string,
  cacheTime = DEFAULT_CACHE_TIME,
  opts: { persist?: PersistOptions } = {},
): EntityCache<T, K> {
  // opts.persist passes the library option through untouched (a localStorage
  // mirror is opt-in per cache); enabled=false only gates disk reads/writes.
  const provider = createMemoryCacheProvider<T, K>({
    cacheTime,
    hash: hashArgs,
    persist: opts.persist,
  });
  // clear wrapper: a whole-entity clear explicitly resets the refresh-seen
  // generation (clear and delete emit identical events, so clear cannot be
  // told apart in the subscription).
  const rawClear = provider.clear.bind(provider);
  provider.clear = () => {
    rawClear();
    resetRefreshSeen(provider);
  };
  const cache = provider as EntityCache<T, K>;

  allCaches.push({ name, cache });
  return cache;
}

// Wiping is built into the library clear; it must be complete (a cold start
// of a next session must not hydrate the previous session's data).
export const clearAllCaches = () => {
  for (const { cache } of allCaches) cache.clear();
};

const BASELINE_CACHES = allCaches.slice();

// Edge case: caches created at test-file module level get unregistered by the
// first reset (such test files deliberately keep clearAllCaches instead).
export const resetAllCaches = () => {
  clearAllCaches();
  allCaches.length = 0;
  for (const entry of BASELINE_CACHES) allCaches.push(entry);
};

// [bound] private phantom brand (zero runtime): a plain service function
// cannot reach createQueryHook at compile time.
declare const bound: unique symbol;

export type QueryFn<T, K extends unknown[]> = ((
  ...args: [...K, signal?: AbortSignal]
) => Promise<T>) & {
  [bound]: true;
};

// Functions are the keys; values are stored type-free (the pairing is
// restored through the QueryFn type at the getCache boundary).
const boundCaches = new WeakMap<object, unknown>();

// One fetch binds exactly one cache; rebinding to a different cache throws
// early in DEV, production keeps last-write-wins.
export function bindQueryFn<T, K extends unknown[]>(
  fetch: (...args: [...K, signal?: AbortSignal]) => Promise<T>,
  cache: EntityCache<T, K>,
): QueryFn<T, K> {
  if (import.meta.env.DEV) {
    const existing = boundCaches.get(fetch);
    if (existing && existing !== cache) {
      throw new Error(
        '[bindQueryFn] service function rebound to a different cache — one fetch pairs with exactly one cache (rebinding the same cache is idempotent); check the declaration site',
      );
    }
  }
  boundCaches.set(fetch, cache);
  return fetch as QueryFn<T, K>;
}

// Unbound fails fast — more locatable than an error deep inside the chain.
export function getCache<T, K extends unknown[]>(
  queryFn: QueryFn<T, K>,
): EntityCache<T, K> {
  const cache = boundCaches.get(queryFn);
  if (!cache) {
    throw new Error(
      '[getCache] queryFn is not bound to a cache — service functions must be paired via bindQueryFn(fetch, cache) first',
    );
  }
  return cache as EntityCache<T, K>;
}

type QueryResult<T> = {
  /** initData fallback; scenarios declaring initData narrow this to non-null */
  data: T;
  /** Initial load: current args in flight with no result for them yet; background refetches never set it */
  loading: boolean;
  fetching: boolean;
  error: Error | undefined;
  /** Failures for these args since their last success; a same-args success resets it */
  failureCount: number;
  stale: boolean;
  /** keepPrevious retained-value window: data holds the previous key's value, not a result for the current args */
  placeholder: boolean;
  /** Timestamp of the most recent successful settle for these args (provenance: the result was fetched with exactly these args) */
  dataUpdatedAt: number | undefined;
  /** Deletes the current args' cache entry then refetches (stable reference; resolves undefined on failure) */
  refetch: () => void | Promise<unknown>;
};

// Immutable at creation; the cache travels with the bound queryFn (T and K
// are inferred from queryFn).
export type QueryHookConfig<T, K extends unknown[]> = {
  queryFn: QueryFn<T, K>;
  staleTime?: number;
  /** Declaring it narrows data to non-null */
  initData?: T;
  /**
   * When args switch to a new key that has no data of its own, keep the
   * previous key's data (placeholder=true, loading=false; the in-flight
   * state is expressed by fetching); if the new key fails, data honestly
   * yields undefined so the error branch stays reachable. TanStack
   * placeholderData: keepPreviousData counterpart.
   */
  keepPrevious?: boolean;
};

// With initData declared, data narrows to the scene data type T; otherwise
// it stays `T | undefined`.
type SceneData<C, T> = T | (C extends { initData: unknown } ? never : undefined);

export function createQueryHook<
  T,
  K extends unknown[],
  C extends QueryHookConfig<T, K>,
>(
  config: C & { queryFn: QueryFn<T, K> },
): (args: K) => QueryResult<SceneData<C, T>> {
  const { queryFn, staleTime = DEFAULT_STALE_TIME, initData, keepPrevious } = config;
  const cache = getCache(queryFn);

  return (args: K): QueryResult<SceneData<C, T>> => {
    // The runtime call signature is [...K, signal?]; widening the generic
    // tuple and the cache once keeps every downstream hook parameterization
    // exact (same object at runtime — only the static tuple shape widens).
    const runArgs = args as unknown as [...K, signal?: AbortSignal];
    const provider = cache as unknown as CacheProvider<T, [...K, signal?: AbortSignal]>;

    // Named registration: visible to DevTool panels.
    const injectable = useInjectable(queryFn, { name: queryFn.name || 'query' });

    const stale = useCache(injectable, provider, staleTime);

    // Freshness gating lives in the event hooks: within the fresh window the
    // whole path is skipped.
    const revalidate = { args: runArgs, cacheProvider: provider, staleTime };
    useFocusRevalidate(injectable, revalidate);
    useReconnectRevalidate(injectable, revalidate);

    // initData fills the init slot without landing in the store, so initial
    // loading stays true.
    const storeData = useResultSelect(injectable, identity, initData);
    const fetching = useLoading(injectable);

    // loading rebuilds the SWR initial-load semantics; errors are read from
    // the return value — no dangling rejections.
    const argsStatus = useArgsStatus(injectable, runArgs);
    let loading = argsStatus.loading && argsStatus.data === undefined;
    const error = argsStatus.error;
    const failureCount = argsStatus.failureCount;
    const dataUpdatedAt = argsStatus.dataUpdatedAt;

    // The hash makes structural change — not reference equality — the rerun
    // basis.
    useRun(injectable, runArgs, { signal: true, hash: hashArgs });

    const refetch = useRefresh(injectable, runArgs, provider);

    // keepPrevious: this hook instance keeps "the last owned data + its key
    // hash"; when args switch to a new key without data of its own, the kept
    // value is served instead of flashing back to the initial-load
    // placeholder. The kept value comes from the per-args slot
    // (argsStatus.data) so the recorded value provably belongs to the
    // recorded key; on new-key failure data honestly yields undefined
    // (consumers take the error branch). Same-key refetches never enter the
    // window: the per-args data is still there.
    let data = storeData;
    let placeholder = false;
    const keptRef = useRef<{ hash: string; data: T | undefined } | undefined>(undefined);
    if (keepPrevious) {
      if (argsStatus.data !== undefined) {
        keptRef.current = { hash: hashArgs(args), data: argsStatus.data };
      } else if (keptRef.current && keptRef.current.hash !== hashArgs(args)) {
        if (argsStatus.error) {
          data = undefined;
        } else if (argsStatus.loading) {
          data = keptRef.current.data;
          placeholder = true;
          loading = false;
        }
      }
    }

    const result: QueryResult<T | undefined> = {
      data,
      loading,
      fetching,
      error,
      failureCount,
      stale,
      refetch,
      dataUpdatedAt,
      placeholder,
    };
    return result as QueryResult<SceneData<C, T>>;
  };
}
