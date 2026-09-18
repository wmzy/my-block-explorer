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

// Reader for the remembered chain: a valid supported id, or undefined when
// nothing valid is remembered (missing key, malformed value, unsupported
// chain). Shared by the landing redirect, the search context and the router
// error view's back link so they all agree on "the chain I was browsing".
export function readRememberedChainId(): number | undefined {
  const raw = localStorage.getItem(LAST_CHAIN_STORAGE_KEY);
  const remembered = raw !== null ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(remembered) && isChainSupported(remembered) ? remembered : undefined;
}

// Preferred entry chain: mainnet when supported (the intuitive default for
// an Ethereum-family explorer), else the head of the sorted chain list.
// getSupportedChainIds()[0] would instead land on whatever chain viem's
// alphabetical export order puts first — an arbitrary chain, not a product
// default. Exported for the unsupported-chain recovery CTAs: unlike
// resolveLandingChainPath they must NOT fall back to the viewer's
// remembered chain (a shared /chain/999 link must offer a deterministic
// destination, not the link opener's last-browsed chain).
export function getPreferredChainId(): number {
  if (isChainSupported(1)) return 1;
  return getSortedChains()[0]?.id ?? 1;
}

// Landing target shared by this view and Home's unknown-chain redirect:
// remembered valid chain -> preferred chain -> /chain/1.
export function resolveLandingChainPath(): string {
  const remembered = readRememberedChainId();
  return remembered !== undefined
    ? `/chain/${remembered}`
    : `/chain/${getPreferredChainId()}`;
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
