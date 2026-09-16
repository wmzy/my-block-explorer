// Route data convergence factory: produces the loader / useData / queryFn
// triplet sharing one cache, with a DEV identity check tying the hook to its
// route's data declaration.
import { useData as useRouteData, useMatched } from '@native-router/react';

import { withCache, type LoaderCtx } from './loaderCache';
import { bindQueryFn, type EntityCache, type QueryFn } from './useQuery';

// Loose LoaderCtx: createRoutes Route members reject narrower ctx shapes.
type DataLoader<T> = (ctx: LoaderCtx) => Promise<T>;

type UseData<T> = {
  (opts?: { optional?: false }): T;
  (opts: { optional: true }): T | undefined;
};

export function createDataLoader<T, K extends unknown[], Ctx extends LoaderCtx = LoaderCtx>(
  spec: {
    fetch: (...args: [...K, signal?: AbortSignal]) => Promise<T>;
    cache: EntityCache<T, K>;
    // The single place a key is defined (keyOf's return is compile-checked
    // against K / the fetch parameter tuple).
    keyOf: (ctx: Ctx) => K;
    staleTime?: number;
  },
): [DataLoader<T>, UseData<T>, QueryFn<T, K>] {
  const { fetch, cache, keyOf, staleTime } = spec;

  const loader = withCache(
    cache,
    keyOf,
    (ctx: Ctx) => fetch(...keyOf(ctx), ctx.signal),
    staleTime !== undefined ? { staleTime } : undefined,
  ) as DataLoader<T>;

  // DEV identity check route.data === loader; useMatched is called
  // unconditionally (rules of hooks).
  const useDataHook = (opts?: { optional?: boolean }): T | undefined => {
    const value = useRouteData<T>();
    const matched = useMatched();
    if (import.meta.env.DEV) {
      const declared: unknown = (
        matched as ReturnType<typeof useMatched> | undefined
      )?.matched[matched.index]?.route.data;
      const ok =
        declared === loader ||
        (opts?.optional === true && declared === undefined);
      if (!ok) {
        throw new Error(
          '[createDataLoader] useXxxData does not match the route data declaration (route.data !== the loader that created it). ' +
          'Two common causes: ' +
          '1) a copied view kept the other route\'s data hook — this component reads a hook from a different route, or the route table still mounts a different loader; ' +
          '2) the loader was re-wrapped in an arrow — data: (ctx) => xxxLoader(ctx) creates a new function and breaks identity; write data: xxxLoader directly. ' +
          'If this route legitimately has no data (a shared component\'s create state), call the hook with {optional: true}.',
        );
      }
    }
    return value;
  };

  const queryFn = bindQueryFn(fetch, cache);

  return [loader, useDataHook as UseData<T>, queryFn];
}
