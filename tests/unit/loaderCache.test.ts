// withCache (the loader side of the dual-channel cache): fresh hit issues
// zero requests, a stale hit serves the old value first and refreshes the
// view through the set-event subscription, a miss goes through load
// (concurrent callers share the in-flight request), and createDataLoader's
// triplet shares the cache with the query channel plus its DEV identity
// check. Adapted from painless's loaderCache.test.ts / dataLoader.test.tsx
// to minimal local caches. `refresh` is partially mocked so assertions can
// see it while MemoryRouter keeps the real @native-router/core.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { Component, createElement, type ComponentType, type ReactNode } from 'react';
import { MemoryRouter, View, type Route } from '@native-router/react';

vi.mock('@native-router/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@native-router/core')>()),
  refresh: vi.fn(),
}));

import { refresh } from '@native-router/core';

import { clearAllCaches, createQueryCache, createQueryHook } from '@/util/useQuery';
import { withCache } from '@/util/loaderCache';
import { createDataLoader } from '@/util/dataLoader';

const refreshMock = vi.mocked(refresh);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

const fakeRouter = { history: {} };
// Route-shaped minimal ctx: addressing falls to params, refresh binding to
// ctx.router.
const ctx = { params: { slug: 'some-slug' }, router: fakeRouter };
const args = ['some-slug'] as [string];

beforeEach(() => {
  vi.resetAllMocks();
  refreshMock.mockReset();
  clearAllCaches();
});

describe('withCache', () => {
  it('fresh hit: returns the cached value synchronously, no request, no refresh', async () => {
    const entryCache = createQueryCache<{ v: string }, [string]>('fresh-hit');
    const fn = vi.fn();
    const cached = { v: 'cached' };
    entryCache.set(args, cached);
    const loader = withCache(entryCache, ({ params }: { params: { slug?: string } }): [string] => [
      params.slug ?? '',
    ], fn);

    await expect(loader(ctx)).resolves.toBe(cached);
    expect(fn).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('stale hit: serves the old value first, then refreshes the view after the background revalidation settles', async () => {
    // Fake only Date: staleness uses Date.now while waitFor keeps real
    // timers (fake timer ticks would push the revalidated entry stale again
    // before the second loader call).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    try {
      const entryCache = createQueryCache<{ v: string }, [string]>('stale-swr');
      const pending = deferred<{ v: string }>();
      const fn = vi.fn().mockReturnValue(pending.promise);
      const old = { v: 'old' };
      entryCache.set(args, old); // cachedAt = 1000
      const loader = withCache(
        entryCache,
        ({ params }: { params: { slug?: string } }): [string] => [params.slug ?? ''],
        fn,
        { staleTime: 10 },
      );
      vi.setSystemTime(2000); // past staleTime=10

      // Old value first: the loader resolves while fn is still pending.
      await expect(loader(ctx)).resolves.toBe(old);
      expect(fn).toHaveBeenCalledTimes(1);

      // Background revalidation settles → value reference changed → refresh
      // re-renders the view with ctx.router.
      pending.resolve({ v: 'new' });
      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
      expect(refreshMock).toHaveBeenCalledWith(fakeRouter);
      // The new value is cached and fresh (cachedAt = settle time = 2000):
      // the next loader call hits it without another request.
      await expect(loader(ctx)).resolves.toEqual({ v: 'new' });
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('miss: goes through load, writes the result back; failure rejects up to the error boundary', async () => {
    const entryCache = createQueryCache<{ v: string }, [string]>('miss');
    const pending = deferred<{ v: string }>();
    const fn = vi.fn().mockReturnValue(pending.promise);
    const loader = withCache(entryCache, ({ params }: { params: { slug?: string } }): [string] => [
      params.slug ?? '',
    ], fn);

    const promise = loader(ctx);
    expect(fn).toHaveBeenCalledTimes(1);
    pending.resolve({ v: 'fresh' });
    await expect(promise).resolves.toEqual({ v: 'fresh' });
    expect(entryCache.peek?.(args)?.value).toEqual({ v: 'fresh' });

    const failing = withCache(
      entryCache,
      ({ params }: { params: { slug?: string } }): [string] => [params.slug ?? ''],
      vi.fn().mockRejectedValue(new Error('404')),
    );
    await expect(
      failing({ params: { slug: 'other' }, router: fakeRouter }),
    ).rejects.toThrow('404');
  });

  it('concurrent miss: same-key calls share one in-flight request, fn runs once', async () => {
    const entryCache = createQueryCache<{ v: string }, [string]>('concurrent-miss');
    const pending = deferred<{ v: string }>();
    const fn = vi.fn().mockReturnValue(pending.promise);
    const loader = withCache(entryCache, ({ params }: { params: { slug?: string } }): [string] => [
      params.slug ?? '',
    ], fn);

    const first = loader(ctx);
    const second = loader(ctx);
    pending.resolve({ v: 'one' });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { v: 'one' },
      { v: 'one' },
    ]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('refetch chain: delete alone never refreshes, the following set with a new value does; clear starts a new generation', async () => {
    const entryCache = createQueryCache<{ v: string }, [string]>('refetch-chain');
    const fn = vi.fn(async (_ctx: { params?: unknown }) => ({ v: 'again' }));
    const loader = withCache(entryCache, ({ params }: { params: { slug?: string } }): [string] => [
      params.slug ?? '',
    ], fn);
    entryCache.set(args, { v: 'v1' });
    await loader(ctx); // establishes the binding and seeds seen = {key: v1}
    expect(refreshMock).not.toHaveBeenCalled();

    // refetch first half: entry delete — a delete event never refreshes.
    entryCache.delete(args);
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshMock).not.toHaveBeenCalled();

    // refetch second half: settle writes a new value — an already-seen key
    // changed its value → refresh fires.
    entryCache.set(args, { v: 'v2' });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(refreshMock).toHaveBeenCalledWith(fakeRouter);

    // Whole-entity clear resets the seen generation: a following set is
    // treated as a brand-new key and does not refresh (a logout-and-navigate
    // must not fire a refresh that supersedes the in-flight navigation).
    entryCache.clear();
    await new Promise((r) => setTimeout(r, 0));
    entryCache.set(args, { v: 'v3' });
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

// Per-test triple factory: fresh caches each time (the registry reset in the
// sibling useQuery tests is not used here, so nothing leaks between files).
type Triple = {
  fetchFn: ReturnType<typeof vi.fn>;
  loader: ReturnType<typeof createDataLoader<{ v: string }, [string]>>[0];
  useData: ReturnType<typeof createDataLoader<{ v: string }, [string]>>[1];
  queryFn: ReturnType<typeof createDataLoader<{ v: string }, [string]>>[2];
};

function makeTriple(name: string): Triple {
  const fetchFn = vi.fn(async (key: string, _signal?: AbortSignal) => ({ v: key }));
  const [loader, useData, queryFn] = createDataLoader({
    fetch: fetchFn,
    cache: createQueryCache<{ v: string }, [string]>(name),
    keyOf: ({ params }: { params: { slug?: string } }): [string] => [params.slug ?? ''],
  });
  return { fetchFn, loader, useData, queryFn };
}

describe('createDataLoader triplet', () => {
  it('loader and scenario hook share one cache: a loader-primed entry serves the hook fresh, no second fetch', async () => {
    const { fetchFn, loader, queryFn } = makeTriple('dual-channel');

    // Loader channel primes the entity cache under ['a'].
    await loader({ params: { slug: 'a' }, router: fakeRouter });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Query channel consumes the same args: fresh hit within the shared
    // staleTime, the underlying fetch does not run again.
    const useQ = createQueryHook({ queryFn });
    const { result } = renderHook(() => useQ(['a']));
    await waitFor(() => expect(result.current.data).toEqual({ v: 'a' }));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('hook fetches go through the same cache: entries written by the hook serve a later loader call', async () => {
    const { fetchFn, loader, queryFn } = makeTriple('dual-channel-back');
    const useQ = createQueryHook({ queryFn });
    const { unmount } = renderHook(() => useQ(['b']));
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    unmount();

    // Fresh within the shared staleTime → the loader resolves from the cache
    // without another fetch.
    await expect(loader({ params: { slug: 'b' }, router: fakeRouter })).resolves.toEqual({
      v: 'b',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

// DEV identity check throws during render: an error boundary is the only way
// to surface it (React has no function-component boundary), kept test-local.
class Catch extends Component<{ children: ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  render() {
    return this.state.err ? createElement('i', null, this.state.err.message) : this.props.children;
  }
}

function PageView({ useData }: { useData: Triple['useData'] }) {
  const d = useData();
  return createElement('b', null, `page:${d.v}`);
}

function renderApp(initial: string, routes: Route | Route[]) {
  return render(
    createElement(
      Catch,
      null,
      createElement(MemoryRouter, { routes, initialEntries: [initial] }, createElement(View)),
    ),
  );
}

describe('createDataLoader: DEV identity check', () => {
  it('matching loader: data reads out normally (check passes silently)', async () => {
    const triple = makeTriple('identity-ok');
    const routes = [
      {
        path: '/page/:slug',
        data: triple.loader,
        component: () => Promise.resolve(() => createElement(PageView, { useData: triple.useData })),
      },
    ];
    renderApp('/page/a', routes);
    expect(await screen.findByText('page:a')).toBeDefined();
    expect(screen.queryByText(/\[createDataLoader\]/)).toBeNull();
  });

  it('mismatched loader: DEV throws, message names the copied-view cause', async () => {
    const triple = makeTriple('identity-mismatch');
    const other = makeTriple('identity-other');
    const routes = [
      {
        path: '/mismatch',
        data: triple.loader,
        component: () =>
          Promise.resolve(() =>
            createElement('b', null, `other:${String(other.useData().v)}`),
          ),
      },
    ];
    renderApp('/mismatch', routes);
    const err = await screen.findByText(/\[createDataLoader\]/);
    expect(err.textContent).toContain('route.data');
    expect(err.textContent).toContain('copied view');
  });

  it('loader re-wrapped in an arrow: DEV throws, message names that cause', async () => {
    const triple = makeTriple('identity-wrapped');
    const routes = [
      {
        path: '/wrapped',
        data: (loaderCtx: Parameters<Triple['loader']>[0]) => triple.loader(loaderCtx),
        component: () => Promise.resolve(() => createElement(PageView, { useData: triple.useData })),
      },
    ];
    renderApp('/wrapped', routes);
    const err = await screen.findByText(/\[createDataLoader\]/);
    expect(err.textContent).toContain('re-wrapped in an arrow');
  });

  it('optional on a data-less route: legal, reads undefined', async () => {
    const triple = makeTriple('identity-optional');
    const OptionalView: ComponentType = () =>
      createElement('b', null, `plain:${String(triple.useData({ optional: true })?.v)}`);
    const routes = [
      {
        path: '/plain',
        component: () => Promise.resolve(OptionalView),
      },
    ];
    renderApp('/plain', routes);
    expect(await screen.findByText('plain:undefined')).toBeDefined();
  });

  it('non-optional on a data-less route: DEV throws (the strict dual of optional)', async () => {
    const triple = makeTriple('identity-strict');
    const routes = [
      {
        path: '/plain-strict',
        component: () => Promise.resolve(() => createElement(PageView, { useData: triple.useData })),
      },
    ];
    renderApp('/plain-strict', routes);
    expect(await screen.findByText(/\[createDataLoader\]/)).toBeDefined();
  });
});
