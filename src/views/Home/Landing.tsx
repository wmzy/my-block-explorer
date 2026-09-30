// Landing view for '/': resolves the entry chain dynamically instead of the
// old static /chain/1 redirect. Target order: the last chain the user
// actually viewed (persisted under LAST_CHAIN_STORAGE_KEY), else the
// preferred chain from the sorted chain config, else /chain/1 as the
// dead-last fallback (mainnet is always in the supported set).
//
// First-run exception: while discovery has settled with NO backend and the
// persistent onboarding flag is unset, the redirect is held and the
// GettingStarted guide renders instead (see ./GettingStarted.tsx).
//
// The remembered-chain resolution is deliberately scoped to this '/' entry
// point: it is the "reopen where I left off" behavior for the app root and
// nothing else. Recovery UIs (UnsupportedChainState) link straight to
// concrete /chain/:id destinations and must never bounce through this
// redirect, which would reopen the link viewer's remembered chain.
import { useCallback, useEffect, useState } from 'react';
import {
  commitReplace,
  preload,
  type BaseRoute,
  type RouterInstance,
} from '@native-router/core';
import { useMatched } from '@native-router/react';
import { useServiceDiscovery } from '@/hooks/ServiceDiscoveryContext';
import { getSortedChains, isChainSupported } from '@/config/chains';
import { LAST_CHAIN_STORAGE_KEY } from '@/util/storageKeys';
import {
  GettingStarted,
  backendConnectedFromStatus,
  readOnboardingDismissed,
  shouldShowGettingStarted,
  writeOnboardingDismissed,
} from './GettingStarted';

// Canonical literal lives in the manifest (util/storageKeys.ts);
// re-exported so existing consumers keep this import point.
export { LAST_CHAIN_STORAGE_KEY };

// Reader for the remembered chain: a valid supported id, or undefined when
// nothing valid is remembered (missing key, malformed value, unsupported
// chain). Shared by the landing redirect, the search context and the router
// error view's back link so they all agree on "the chain I was browsing".
export function readRememberedChainId(): number | undefined {
  // Guarded like themePreference/units: in storage-blocked contexts
  // (Safari private mode) the localStorage access itself throws, and this
  // reader runs at boot and on every watch-notification poll tick — it
  // must degrade to "nothing remembered", not crash the app.
  let raw: string | null;
  try {
    raw = localStorage.getItem(LAST_CHAIN_STORAGE_KEY);
  } catch {
    raw = null;
  }
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

// Landing target for the '/' route only: remembered valid chain ->
// preferred chain -> /chain/1. Nothing else consumes it — the
// unsupported-chain recovery CTAs link concrete /chain/:id paths directly.
export function resolveLandingChainPath(): string {
  const remembered = readRememberedChainId();
  return remembered !== undefined ? `/chain/${remembered}` : `/chain/${getPreferredChainId()}`;
}

// Persist the chain worth landing on next time. Callers only pass ids that
// already resolved to a supported chain.
export function rememberChainId(chainId: number): void {
  try {
    localStorage.setItem(LAST_CHAIN_STORAGE_KEY, String(chainId));
  } catch {
    // Quota/private mode — the choice lasts only for this session.
  }
}

// navigate() always pushes; replace semantics come from committing a
// preloaded entry with commitReplace (the composition the router documents
// for external consumers of preloaded entries).
export function redirectReplace<R extends BaseRoute>(
  router: RouterInstance<R>,
  to: string,
): Promise<void> {
  return preload(router, to).then(entry => commitReplace(router, entry.task, entry.location));
}

export default function Landing() {
  const { router } = useMatched();
  const { status } = useServiceDiscovery();
  const backendConnected = backendConnectedFromStatus(status);
  // Dismissal is persistent (localStorage flag): once the user closes
  // the first-run guide it never comes back, on any visit.
  const [dismissed, setDismissed] = useState(readOnboardingDismissed);
  const showGuide = shouldShowGettingStarted({ backendConnected, dismissed });

  useEffect(() => {
    // First-run guide hold: while the card is showing (discovery settled
    // with no backend + not dismissed) the entry redirect waits so the
    // guide is actually readable. Any dismissal — or a backend connecting
    // mid-session, matching the setup panel's auto-detect promise —
    // releases the redirect via this effect's dependency.
    if (showGuide) return;
    redirectReplace(router, resolveLandingChainPath()).catch(() => undefined);
  }, [router, showGuide]);

  const handleDismiss = useCallback(() => {
    writeOnboardingDismissed();
    setDismissed(true);
  }, []);

  if (showGuide) {
    return <GettingStarted onDismiss={handleDismiss} />;
  }

  // Otherwise redirect-only view: nothing to paint while the replace
  // commit runs.
  return null;
}
