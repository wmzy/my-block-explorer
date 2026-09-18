// createQueryHook (scenario hook factory) composition behavior: loading→data
// settle, in-flight dedupe, per-args key isolation, refetch, error state, and
// the bindQueryFn phantom-brand binding layer. Adapted from painless's
// useQuery.test.ts to minimal local caches (no app entities).
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import {
  allCaches,
  bindQueryFn,
  clearAllCaches,
  createQueryCache,
  createQueryHook,
  getCache,
  resetAllCaches,
} from '@/util/useQuery';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('createQueryHook (scenario hook)', () => {
  it('loading → data: initData served first, then data/loading/stale settle', async () => {
    const pending = deferred<string[]>();
    const fetchTags = () => pending.promise;
    const cache = createQueryCache<string[], []>('loading-data');
    const useTagsQuery = createQueryHook({
      queryFn: bindQueryFn(fetchTags, cache),
      initData: ['init'],
    });

    const { result } = renderHook(() => useTagsQuery([]));

    expect(result.current.data).toEqual(['init']);
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeUndefined();

    await act(async () => {
      pending.resolve(['a', 'b']);
    });

    expect(result.current.data).toEqual(['a', 'b']);
    expect(result.current.loading).toBe(false);
    expect(result.current.stale).toBe(false);
  });

  it('initial load: loading and fetching both true until the first settle', async () => {
    const pending = deferred<string[]>();
    const fn = vi.fn().mockReturnValue(pending.promise);
    const cache = createQueryCache<string[], []>('initial-loading');
    const useQ = createQueryHook({
      queryFn: bindQueryFn(fn, cache),
      initData: [] as string[],
    });

    const { result } = renderHook(() => useQ([]));

    // initData is only a local fallback — the store has no result yet, so
    // the initial-load semantics keep loading true as well.
    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(true);
    expect(result.current.fetching).toBe(true);

    await act(async () => {
      pending.resolve(['a']);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.fetching).toBe(false);
    expect(result.current.data).toEqual(['a']);
  });

  it('request failure: error lands in the result, loading resets, data stays undefined', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const cache = createQueryCache<string[], []>('error-state');
    const useQ = createQueryHook({ queryFn: bindQueryFn(fn, cache) });

    const { result } = renderHook(() => useQ([]));

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('failureCount: increments per failure, resets on a same-args success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom-1'))
      .mockRejectedValueOnce(new Error('boom-2'))
      .mockResolvedValueOnce(['ok']);
    const cache = createQueryCache<string[], []>('failure-count');
    const useQ = createQueryHook({
      queryFn: bindQueryFn(fn, cache),
      initData: [] as string[],
    });

    const { result } = renderHook(() => useQ([]));

    await waitFor(() => expect(result.current.error?.message).toBe('boom-1'));
    expect(result.current.failureCount).toBe(1);

    await act(async () => {
      void result.current.refetch();
    });
    await waitFor(() => expect(result.current.error?.message).toBe('boom-2'));
    expect(result.current.failureCount).toBe(2);

    await act(async () => {
      void result.current.refetch();
    });
    await waitFor(() => expect(result.current.data).toEqual(['ok']));
    expect(result.current.failureCount).toBe(0);
    expect(result.current.error).toBeUndefined();
  });

  it('refetch: bypasses the fresh cache, reference stays stable across renders', async () => {
    const fn = vi.fn().mockResolvedValueOnce(['v1']).mockResolvedValueOnce(['v2']);
    const cache = createQueryCache<string[], []>('refetch-stable');
    const useQ = createQueryHook({
      queryFn: bindQueryFn(fn, cache),
      initData: [] as string[],
    });

    const { result, rerender } = renderHook(() => useQ([]));
    await waitFor(() => expect(result.current.data).toEqual(['v1']));

    const refetch = result.current.refetch;
    rerender();
    expect(result.current.refetch).toBe(refetch);

    await act(async () => {
      void refetch();
    });
    await waitFor(() => expect(result.current.data).toEqual(['v2']));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('background refetch with a result present: loading stays false, fetching tells the truth', async () => {
    const pending = deferred<string[]>();
    const fn = vi.fn().mockResolvedValueOnce(['v1']).mockReturnValueOnce(pending.promise);
    const cache = createQueryCache<string[], []>('background-fetching');
    const useQ = createQueryHook({
      queryFn: bindQueryFn(fn, cache),
      initData: [] as string[],
    });

    const { result } = renderHook(() => useQ([]));
    await waitFor(() => expect(result.current.data).toEqual(['v1']));
    expect(result.current.loading).toBe(false);

    await act(async () => {
      void result.current.refetch();
    });

    // A result exists: no return to initial loading (no full-screen spinner
    // flash); the in-flight state is expressed by fetching alone.
    expect(result.current.loading).toBe(false);
    expect(result.current.fetching).toBe(true);
    expect(result.current.data).toEqual(['v1']);

    await act(async () => {
      pending.resolve(['v2']);
    });
    expect(result.current.fetching).toBe(false);
    expect(result.current.data).toEqual(['v2']);
  });

  it('remount within the fresh window: cache hit, no second request', async () => {
    const fn = vi.fn().mockResolvedValue(['v1']);
    const cache = createQueryCache<string[], []>('fresh-remount');
    const useQ = createQueryHook({
      queryFn: bindQueryFn(fn, cache),
      initData: [] as string[],
    });

    const first = renderHook(() => useQ([]));
    await waitFor(() => expect(first.result.current.data).toEqual(['v1']));
    first.unmount();

    const second = renderHook(() => useQ([]));
    await waitFor(() => expect(second.result.current.data).toEqual(['v1']));
    expect(fn).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it('two components mounted concurrently: shared in-flight, one underlying fetch', async () => {
    const pending = deferred<string[]>();
    const fn = vi.fn().mockReturnValue(pending.promise);
    const cache = createQueryCache<string[], []>('shared-inflight');
    const useQ = createQueryHook({
      queryFn: bindQueryFn(fn, cache),
      initData: [] as string[],
    });

    const first = renderHook(() => useQ([]));
    const second = renderHook(() => useQ([]));

    expect(first.result.current.loading).toBe(true);
    expect(second.result.current.loading).toBe(true);

    await act(async () => {
      pending.resolve(['shared']);
    });

    expect(first.result.current.data).toEqual(['shared']);
    expect(second.result.current.data).toEqual(['shared']);
    expect(fn).toHaveBeenCalledTimes(1);
    first.unmount();
    second.unmount();
  });

  it('key isolation: switching args to an uncached key honestly re-enters loading', async () => {
    const forA = deferred<string[]>();
    const forB = deferred<string[]>();
    const fn = vi
      .fn()
      .mockImplementationOnce(() => forA.promise)
      .mockImplementationOnce(() => forB.promise);
    const cache = createQueryCache<string[], [string]>('args-switch-loading');
    const useQ = createQueryHook({
      queryFn: bindQueryFn(fn, cache),
      initData: [] as string[],
    });

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useQ([key]),
      { initialProps: { key: 'a' } },
    );

    expect(result.current.loading).toBe(true);
    await act(async () => {
      forA.resolve(['from-a']);
    });
    await waitFor(() => expect(result.current.data).toEqual(['from-a']));
    expect(result.current.loading).toBe(false);

    // b is uncached and in flight with no result of its own → loading truthy
    rerender({ key: 'b' });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      forB.resolve(['from-b']);
    });
    await waitFor(() => expect(result.current.data).toEqual(['from-b']));
    expect(result.current.loading).toBe(false);

    // Each key kept its own entry: a's data is still cached, untouched by b.
    expect(cache.peek?.(['a'])?.value).toEqual(['from-a']);
    expect(cache.peek?.(['b'])?.value).toEqual(['from-b']);
  });

  it('hash normalization: object args with different key order hit the same cache entry', async () => {
    const fn: (args: Record<string, unknown>) => Promise<string[]> = vi.fn(
      () => Promise.resolve(['v1']),
    );
    const cache = createQueryCache<string[], [Record<string, unknown>]>('hash-normalize');
    const useQ = createQueryHook({
      queryFn: bindQueryFn(fn, cache),
      initData: [] as string[],
    });

    const first = renderHook(
      ({ args }) => useQ([args]),
      { initialProps: { args: { page: 1, tab: 'feed' } } },
    );
    await waitFor(() => expect(first.result.current.data).toEqual(['v1']));
    first.unmount();

    // Reversed key order + a fresh object literal: structurally normalized
    // to the same cache key (JSON.stringify would produce two keys).
    const second = renderHook(
      ({ args }) => useQ([args]),
      { initialProps: { args: { tab: 'feed', page: 1 } } },
    );
    await waitFor(() => expect(second.result.current.data).toEqual(['v1']));
    expect(fn).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it('stale hit: old value served first and marked stale while a background refresh runs', async () => {
    const pending = deferred<string[]>();
    const fn = vi
      .fn()
      .mockResolvedValueOnce(['old'])
      .mockReturnValueOnce(pending.promise);
    const cache = createQueryCache<string[], []>('stale-swr');
    const useQ = createQueryHook({
      queryFn: bindQueryFn(fn, cache),
      initData: [] as string[],
      staleTime: 20,
    });

    const first = renderHook(() => useQ([]));
    await waitFor(() => expect(first.result.current.data).toEqual(['old']));
    expect(first.result.current.stale).toBe(false);
    first.unmount();

    await sleep(30); // past staleTime=20, far within cacheTime (5min)

    const second = renderHook(() => useQ([]));
    await waitFor(() => expect(second.result.current.stale).toBe(true));
    expect(second.result.current.data).toEqual(['old']); // stale value first
    expect(fn).toHaveBeenCalledTimes(2); // background revalidation sent

    await act(async () => {
      pending.resolve(['new']);
    });
    expect(second.result.current.data).toEqual(['new']);
    expect(second.result.current.stale).toBe(false);
    second.unmount();
  });

  // Compile-time nails (vitest does not typecheck; the scoped tsc pass does):
  // the phantom brand keeps unbranded service functions out, initData must
  // match the scene data type, and args must match the fetch's tuple.
  it('type contracts: brand and shapes enforced at compile time', () => {
    const cache = createQueryCache<string[], [string]>('type-nails');
    const fetchTags = async (slug: string): Promise<string[]> => [slug];
    const queryFn = bindQueryFn(fetchTags, cache);
    const useQ = createQueryHook({ queryFn, initData: ['ok'] });
    expect(typeof useQ).toBe('function');

    // Runtime mirror of the compile-time brand rejection: an unbound service
    // function fails fast inside the factory.
    const unbranded = async (slug: string): Promise<string[]> => [slug];
    // @ts-expect-error unbranded service function rejected by the phantom brand
    expect(() => createQueryHook({ queryFn: unbranded })).toThrow(/getCache/);

    // Runtime-harmless (initData only fills the init slot, nothing renders):
    // @ts-expect-error initData must match the scene data type string[]
    void createQueryHook({ queryFn, initData: { wrong: true } });

    // Never invoked: the body exists only for the compiler.

    // negative case: hook invoked with mismatched args must fail types.
    const useWrongArgs = () => {
      // @ts-expect-error args must match the fetch's parameter tuple
      void useQ([1]);
    };
    void useWrongArgs;
  });
});

describe('bindQueryFn / getCache (fetch × cache pairing)', () => {
  it('getCache returns the bound cache; function identity unchanged; DEV rebinding to a different cache throws', () => {
    const fn = vi.fn(async () => ['v']);
    const first = createQueryCache<string[], []>('bind-first');
    const second = createQueryCache<string[], []>('bind-second');
    const queryFn = bindQueryFn(fn, first);

    // The pairing lives in a WeakMap: the function itself is untouched
    // (identity, fn.name, enumerable properties all unchanged).
    expect(queryFn).toBe(fn);
    expect(getCache(queryFn)).toBe(first);

    // DEV fails fast instead of the silent last-write-wins that would leave
    // the first hook reading the wrong cache (vitest runs with DEV=true).
    expect(() => bindQueryFn(fn, second)).toThrow(/bindQueryFn/);
    expect(getCache(queryFn)).toBe(first);
  });

  it('rebinding the same cache instance is idempotent', () => {
    const fn = vi.fn(async () => ['v']);
    const cache = createQueryCache<string[], []>('bind-same');
    const queryFn = bindQueryFn(fn, cache);
    expect(() => bindQueryFn(fn, cache)).not.toThrow();
    expect(getCache(queryFn)).toBe(cache);
  });

  it('non-DEV keeps last-write-wins (production semantics unchanged)', () => {
    vi.stubEnv('DEV', false);
    try {
      const fn = vi.fn(async () => ['v']);
      const first = createQueryCache<string[], []>('bind-prod-first');
      const second = createQueryCache<string[], []>('bind-prod-second');
      bindQueryFn(fn, first);
      expect(() => bindQueryFn(fn, second)).not.toThrow();
      expect(getCache(bindQueryFn(fn, second))).toBe(second);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('unbranded function throws with a message pointing at bindQueryFn', () => {
    // Simulates the brand constraint being bypassed by a cast.
    const plain = vi.fn(async () => ['v']) as unknown as ReturnType<
      typeof bindQueryFn<string[], []>
    >;
    expect(() => getCache(plain)).toThrow(/bindQueryFn/);
  });
});

describe('cache registry (clearAllCaches / resetAllCaches)', () => {
  it('clearAllCaches clears every registered cache', () => {
    const one = createQueryCache<string[], []>('registry-one');
    const two = createQueryCache<string[], []>('registry-two');
    one.set([], ['a']);
    two.set([], ['b']);

    clearAllCaches();

    expect(one.snapshot?.()).toEqual([]);
    expect(two.snapshot?.()).toEqual([]);
  });

  it('resetAllCaches unregisters temporary caches and restores the module baseline', () => {
    const temp = createQueryCache<string[], []>('registry-temp');

    resetAllCaches();

    // The registry is back to the module-load baseline — empty in this port:
    // entity caches live in the services layer (Wave 2), not in this module.
    expect(allCaches).toHaveLength(0);
    // Unregistered but still usable, and clearAllCaches no longer wipes it.
    temp.set([], ['kept']);
    clearAllCaches();
    expect(temp.peek?.([])?.value).toEqual(['kept']);
  });
});
