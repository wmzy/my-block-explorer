// One home for the chain-switch navigation every view wires into
// TopNavigation's onChainChange: the `/chain/:chainId` prefix, the
// view-relative suffix and the fire-and-forget error swallow live here,
// never as another per-view closure copy.
//
// Two history semantics, both real:
// - `replace: true` (redirectReplace — preload + commitReplace) for pages
//   that re-render themselves on the new chain (address, contract, token,
//   tx detail, the lists): Back from the switched view must never resurface
//   the same entity on the previous chain.
// - the default push (navigate) for surfaces that hop elsewhere (chain-less
//   pages landing on the new chain's home, pages whose target is a
//   different view): the origin entry stays in history.
import { navigate, type BaseRoute, type RouterInstance } from '@native-router/core';
import { redirectReplace } from '@/views/Home/Landing';

/**
 * Navigate to `/chain/${chainId}${path}` as a fire-and-forget navigation.
 * `path` is the view-relative suffix (`'/blocks'`, `'/tx/0x…'`, …) or `''`
 * for the chain home; navigation errors are swallowed (a chain hop beaten
 * by an unmount must not surface as an unhandled rejection).
 */
export function chainRedirect<R extends BaseRoute>(
  router: RouterInstance<R>,
  chainId: number,
  path = '',
  { replace = false }: { replace?: boolean } = {},
): void {
  const to = `/chain/${chainId}${path}`;
  void (replace ? redirectReplace(router, to) : navigate(router, to)).catch(() => undefined);
}
