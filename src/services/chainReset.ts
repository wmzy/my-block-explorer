// Dev-chain reset detection (PM-review P0). An anvil/hardhat `reset`
// keeps the chain id but rewinds the head to (near) zero — every
// chain-scoped cache the explorer keeps for that id (contract sources,
// storage layouts) instantly goes stale with no signal from the RPC.
// This module detects that regression client-side and offers the
// one-click clear of the backend's chain-scoped caches.
//
// Detection model: per-chain high-water head mark in localStorage
// ('be:lastHead:{chainId}' = {blockNumber, updatedAt}, same be: prefix
// family as be:theme / be:searchHistory). The mark only ever moves UP —
// a sub-threshold regression is a reorg and is ignored; a head ≥5 blocks
// BELOW the mark means the chain itself was reset. While a reset is
// suspected the mark stays frozen so the banner keeps firing (and its
// dismissal key stays stable) until the user acknowledges it by clearing
// the caches. Storage is best-effort like themePreference: a full or
// private-mode localStorage degrades to "no baseline" and detection
// simply stays quiet.
import { useEffect, useState } from 'react';
import { del } from '@/util/http';

/** Heads at or beyond this distance below the mark read as a reset. */
export const CHAIN_RESET_THRESHOLD_BLOCKS = 5;

export const LAST_HEAD_STORAGE_PREFIX = 'be:lastHead:';
export const CHAIN_RESET_DISMISSED_PREFIX = 'be:chainResetDismissed:';

/** The stored high-water head for one chain (blockNumber + when seen). */
export type StoredChainHead = { blockNumber: number; updatedAt: number };

/**
 * Pure reset verdict: true only when a stored baseline exists AND the
 * observed head sits at least CHAIN_RESET_THRESHOLD_BLOCKS below it.
 * No baseline (first visit, unreadable storage) and no head yet (feeds
 * still loading) both read as "no reset" — detection never fabricates a
 * suspicion. A head ABOVE the baseline is plain progression (false), and
 * a small dip below it is a reorg (false) — only the threshold crossing
 * says "reset".
 */
export function detectChainReset(
  stored: StoredChainHead | null,
  current: number | null,
): boolean {
  if (stored === null || current === null) return false;
  return stored.blockNumber - current >= CHAIN_RESET_THRESHOLD_BLOCKS;
}

export function lastHeadStorageKey(chainId: number): string {
  return `${LAST_HEAD_STORAGE_PREFIX}${chainId}`;
}

/**
 * The stored baseline, or null when absent/malformed. Every field must
 * earn its type; anything else degrades to "no baseline" rather than a
 * guessed number.
 */
export function readStoredHead(chainId: number): StoredChainHead | null {
  try {
    const raw = localStorage.getItem(lastHeadStorageKey(chainId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { blockNumber, updatedAt } = parsed as Record<string, unknown>;
    if (
      typeof blockNumber !== 'number'
      || !Number.isFinite(blockNumber)
      || blockNumber < 0
      || typeof updatedAt !== 'number'
      || !Number.isFinite(updatedAt)
    ) {
      return null;
    }
    return { blockNumber, updatedAt };
  }
  catch {
    return null;
  }
}

/** Advance the baseline (best-effort — see module header). */
export function storeHead(chainId: number, blockNumber: number): void {
  try {
    localStorage.setItem(
      lastHeadStorageKey(chainId),
      JSON.stringify({ blockNumber, updatedAt: Date.now() }),
    );
  }
  catch {
    // Quota/private mode — the baseline lasts only for this session.
  }
}

// Dismissal is keyed by the STORED head the regression was measured
// against (not the current head): while the mark stays frozen the key is
// stable across every re-render, and once the chain recovers and climbs
// to a new high-water mark, any LATER regression keys a different value
// — a new reset re-arms the banner.
export function dismissalStorageKey(chainId: number, storedBlockNumber: number): string {
  return `${CHAIN_RESET_DISMISSED_PREFIX}${chainId}:${storedBlockNumber}`;
}

export function isResetDismissed(chainId: number, storedBlockNumber: number): boolean {
  try {
    return localStorage.getItem(dismissalStorageKey(chainId, storedBlockNumber)) !== null;
  }
  catch {
    return false;
  }
}

export function dismissChainReset(chainId: number, storedBlockNumber: number): void {
  try {
    localStorage.setItem(dismissalStorageKey(chainId, storedBlockNumber), '1');
  }
  catch {
    // Best-effort: this session's banner state still hides the notice.
  }
}

/**
 * Acknowledge a reset after a successful cache clear: re-baseline the
 * stored head to the post-reset head so detection stops firing for this
 * regression (and the next climb to a new high-water mark re-arms the
 * banner for any FUTURE reset).
 */
export function acknowledgeChainReset(chainId: number, currentBlockNumber: number): void {
  storeHead(chainId, currentBlockNumber);
}

/** Honest counts from DELETE /api/chains/:chainId/cached-data. */
export type ClearedChainCacheData = {
  contractSources: number;
  storageLayouts: number;
};

/**
 * Clear the chain's cached-immutable data through the backend. Rejects
 * with ApiError (403 = admin token missing/wrong while the server has
 * ADMIN_TOKEN configured — util/http attaches the browser's token
 * automatically). A 200 body without honest numeric counts is an error,
 * never fabricated zeros.
 */
export async function clearChainCachedData(chainId: number): Promise<ClearedChainCacheData> {
  const body = await del<unknown>(`/api/chains/${chainId}/cached-data`);
  const cleared
    = typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).cleared
      : undefined;
  if (typeof cleared !== 'object' || cleared === null) {
    throw new Error('The cache-clear endpoint answered without a cleared-counts object.');
  }
  const { contractSources, storageLayouts } = cleared as Record<string, unknown>;
  if (
    typeof contractSources !== 'number'
    || typeof storageLayouts !== 'number'
  ) {
    throw new Error('The cache-clear endpoint answered without honest numeric counts.');
  }
  return { contractSources, storageLayouts };
}

/** What useChainResetDetection reports for the observed head. */
export type ChainResetState = {
  suspected: boolean;
  storedHead: StoredChainHead | null;
};

/**
 * Observe a chain's head and maintain the reset verdict. Feed it the
 * page's live head (bigint | null — null while feeds load observes
 * nothing). The stored mark only advances (never downgrades on reorgs);
 * while a regression is suspected it freezes so the banner's dismissal
 * key stays stable until acknowledged.
 */
export function useChainResetDetection(chainId: number, head: bigint | null): ChainResetState {
  const [state, setState] = useState<ChainResetState>({
    suspected: false,
    storedHead: null,
  });

  useEffect(() => {
    if (head === null) return;
    const current = Number(head);
    const stored = readStoredHead(chainId);

    if (detectChainReset(stored, current)) {
      // Suspected: keep the frozen high-water mark (stable dismissal
      // key; the banner re-fires on every observation until cleared).
      setState({ suspected: true, storedHead: stored });
      return;
    }

    if (stored === null || current > stored.blockNumber) {
      storeHead(chainId, current);
      setState({
        suspected: false,
        storedHead: { blockNumber: current, updatedAt: Date.now() },
      });
      return;
    }

    // Progression at/below the mark or a sub-threshold reorg: no reset,
    // and the high-water mark stays put.
    setState({ suspected: false, storedHead: stored });
  }, [chainId, head]);

  return state;
}
