// Dual-channel shared cache: route loaders and scenario hooks share one cache
// per entity. Entries are reclaimed per-entry by lastUsedAt (react-toolroom);
// the router viewStack decides whether a loader runs, the cache decides
// whether a request is issued.
import type { CacheProvider } from 'react-toolroom/async';

import { refresh } from '@native-router/core';

// Shared staleTime default for both channels (single source of truth).
export const DEFAULT_STALE_TIME = 2000;
// Swallow background revalidation rejections (explicit return keeps the
// no-empty-function lint quiet).
const noop = () => undefined;

export type LoaderCtx = {
  search?: unknown;
  params?: unknown;
  router?: unknown;
  signal?: AbortSignal;
};

// Subscriptions remember the most recently used router; set events debounce
// into a refresh via microtask. The trigger is "a settled value's reference
// changed": a failed settle also emits set, so a snapshot diff filters it;
// delete/clear events are not subscribed to.
const bindings = new WeakMap<
  CacheProvider<unknown, unknown[]>,
  {
    router: unknown;
    scheduled: boolean;
    seen: Map<string, unknown>;
    warned?: boolean;
  }
>();

function snapshotValues(cache: CacheProvider<unknown, unknown[]>) {
  return new Map((cache.snapshot?.() ?? []).map((e) => [e.key, e.value]));
}

// Explicit rebinding: resets seen to the snapshot baseline at call time.
export function bindCacheRefresh<T, K extends unknown[]>(
  cache: CacheProvider<T, K>,
  router: unknown,
) {
  const wide = cache as unknown as CacheProvider<unknown, unknown[]>;
  bindRefresh(wide, router);
  bindings.set(wide, { router, scheduled: false, seen: snapshotValues(wide) });
}

// clear/delete emit indistinguishable events, so an explicit whole-entity
// clear resets the seen generation here.
export function resetRefreshSeen<T, K extends unknown[]>(
  cache: CacheProvider<T, K>,
) {
  const binding = bindings.get(
    cache as unknown as CacheProvider<unknown, unknown[]>,
  );
  if (binding) binding.seen = new Map();
}

function bindRefresh(cache: CacheProvider<unknown, unknown[]>, router: unknown) {
  let binding = bindings.get(cache);
  if (binding) {
    // DEV warning (once per cache): when several routers use one cache, the
    // refresh target silently switches to the last router that used it
    // (micro-frontend / multi-Router / concurrent test scenarios).
    if (
      import.meta.env.DEV &&
        binding.router !== router &&
        !binding.warned
    ) {
      binding.warned = true;
      console.warn(
        '[loaderCache] One cache is used by multiple routers: the refresh target has switched to the router that used it last. ' +
        'If this sharing is unintentional, check the cache-to-router pairing. Warned once per cache.',
      );
    }
    binding.router = router;
    return;
  }
  binding = { router, scheduled: false, seen: snapshotValues(cache) };
  bindings.set(cache, binding);
  cache.subscribe?.((e) => {
    const cur = bindings.get(cache);
    if (!cur) return;
    // Trigger is "an already-seen key changed its value": miss / in-flight /
    // failed settles never refresh.
    const next = snapshotValues(cache);
    let changed = false;
    if (e.type === 'set') {
      for (const [k, v] of next) {
        if (cur.seen.has(k) && cur.seen.get(k) !== v) {
          changed = true;
          break;
        }
      }
    }
    // Merge the seen writes (keep the last seen value); the generational
    // reset on clear lives in resetRefreshSeen.
    for (const [k, v] of next) cur.seen.set(k, v);
    if (!changed || !cur.router || cur.scheduled) return;
    cur.scheduled = true;
    queueMicrotask(() => {
      cur.scheduled = false;
      // Promise.resolve tolerates test doubles returning void.
      void Promise.resolve(
        refresh(cur.router as Parameters<typeof refresh>[0]),
      ).catch(noop);
    });
  });
}

// SWR: serve the stale value first + revalidate in the background (load
// shares in-flight requests, a failure keeps the old value); an entry older
// than maxAge counts as a miss; a miss failure throws up to the route's
// errorComponent. keyOf is the single place a key is defined.
export function withCache<
  T,
  K extends unknown[],
  C extends LoaderCtx = LoaderCtx,
  F extends (ctx: C) => Promise<unknown> = never,
>(
  cache: CacheProvider<T, K>,
  // Return widened to unknown[]: the cache is the contract source for K; the
  // key is normalized at runtime through the provider hash.
  keyOf: (ctx: C) => unknown[],
  fn: F,
  opts?: { staleTime?: number; maxAge?: number },
): F {
  const staleTime = opts?.staleTime ?? DEFAULT_STALE_TIME;
  // An entry past maxAge counts as a miss: stops "revalidation keeps failing
  // while the old value is served forever".
  const maxAge = opts?.maxAge;
  // peek/load are optional on the generic CacheProvider contract but always
  // present on createQueryCache products; fail early when missing.
  const peek = cache.peek?.bind(cache);
  const load = cache.load?.bind(cache);
  if (!peek || !load) {
    throw new Error(
      '[withCache] cache is missing peek/load members — create it via createQueryCache (createMemoryCacheProvider)',
    );
  }
  // F's return is only bounded by Promise<unknown>; the provider factory
  // needs the cache's own Promise<T>.
  const run = fn as (ctx: C) => Promise<T>;
  return (async (ctx: C): Promise<unknown> => {
    if (ctx.router !== undefined) {
      bindRefresh(cache as unknown as CacheProvider<unknown, unknown[]>, ctx.router);
    }
    const args = keyOf(ctx) as K;
    const entry = peek(args);
    if (entry) {
      const age = Date.now() - entry.cachedAt;
      if (age < staleTime) {
        return entry.value;
      }
      if (maxAge !== undefined && age > maxAge) {
        return load(args, () => run(ctx));
      }
      void load(args, () => run(ctx)).catch(noop);
      return entry.value;
    }
    return load(args, () => run(ctx));
  }) as F;
}
