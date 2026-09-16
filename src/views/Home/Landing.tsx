// Landing view for '/': resolves the entry chain dynamically instead of the
// old static /chain/1 redirect. Target order: the last chain the user
// actually viewed (persisted under LAST_CHAIN_STORAGE_KEY), else the
// preferred chain from the sorted chain config, else /chain/1 as the
// dead-last fallback (mainnet is always in the supported set).
import { useEffect } from 'react';
import {
  commitReplace,
  preload,
  type BaseRoute,
  type RouterInstance,
} from '@native-router/core';
import { useMatched } from '@native-router/react';
import { getSortedChains, isChainSupported } from '@/config/chains';

export const LAST_CHAIN_STORAGE_KEY = 'be:lastChainId';

// Preferred entry chain: mainnet when supported (the intuitive default for
// an Ethereum-family explorer), else the head of the sorted chain list.
// getSupportedChainIds()[0] would instead land on whatever chain viem's
// alphabetical export order puts first — an arbitrary chain, not a product
// default.
function getPreferredChainId(): number {
  if (isChainSupported(1)) return 1;
  return getSortedChains()[0]?.id ?? 1;
}

// Landing target shared by this view and Home's unknown-chain redirect:
// remembered valid chain -> preferred chain -> /chain/1.
export function resolveLandingChainPath(): string {
  const raw = localStorage.getItem(LAST_CHAIN_STORAGE_KEY);
  const remembered = raw !== null ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isInteger(remembered) && isChainSupported(remembered)) {
    return `/chain/${remembered}`;
  }
  return `/chain/${getPreferredChainId()}`;
}

// Persist the chain worth landing on next time. Callers only pass ids that
// already resolved to a supported chain.
export function rememberChainId(chainId: number): void {
  localStorage.setItem(LAST_CHAIN_STORAGE_KEY, String(chainId));
}

// navigate() always pushes; replace semantics come from committing a
// preloaded entry with commitReplace (the composition the router documents
// for external consumers of preloaded entries).
export function redirectReplace<R extends BaseRoute>(
  router: RouterInstance<R>,
  to: string,
): Promise<void> {
  return preload(router, to).then(entry =>
    commitReplace(router, entry.task, entry.location),
  );
}

export default function Landing() {
  const { router } = useMatched();

  useEffect(() => {
    redirectReplace(router, resolveLandingChainPath()).catch(() => undefined);
  }, [router]);

  // Redirect-only view: nothing to paint while the replace commit runs.
  return null;
}
