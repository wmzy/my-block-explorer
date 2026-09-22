// Watchlist storage model: addresses this browser wants activity alerts
// for on the Home page. Per-browser localStorage (the be:searchHistory
// precedent — server-side storage would leak every visitor's interests to
// everyone), validated through the same two-tier address validity util
// the address pages use, stored checksummed, deduped case-insensitively,
// and capped.
//
// This module is storage ONLY: what the watchlist does while the page is
// open (per-block matching against the live stream) lives in
// views/Home/Watchlist.tsx — there deliberately is no background service.
import { getAddress } from 'viem';
import { checkAddressValidity } from '@/views/Address/addressValidity';

export const WATCHLIST_STORAGE_KEY = 'be:watchlist';

export const WATCHLIST_MAX_ENTRIES = 25;

// Shape both the writer guarantees and the reader re-verifies (storage is
// user-editable; a hand-corrupted key must degrade, not crash the page).
const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export type WatchlistAddRejection =
  | 'format' // not 0x + 40 hex chars
  | 'checksum' // mixed-case but wrong EIP-55 checksum
  | 'duplicate' // already watched (case-insensitive)
  | 'full'; // at the cap

export type WatchlistAddResult =
  | { ok: true; entries: string[] }
  | { ok: false; reason: WatchlistAddRejection; entries: string[] };

// Storage is best-effort (searchHistory precedent): a corrupt payload or
// a full/private-mode localStorage must never break the page — reads
// degrade to [] and writes are swallowed while the returned list still
// reflects the attempted change.
const persist = (entries: string[]): string[] => {
  try {
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota/private mode — the watchlist silently stops persisting.
  }
  return entries;
};

/** Watched addresses, checksum-preserved, insertion order, never past the cap. */
export function readWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string' && HEX_ADDRESS_RE.test(entry))
      .slice(0, WATCHLIST_MAX_ENTRIES);
  } catch {
    return [];
  }
}

/**
 * Add an address. The input passes the same two tiers as the address
 * pages (shape, then EIP-55 checksum — all-lower/all-upper inputs are the
 * checksum-less convention and normalize through), is stored as its
 * checksummed form, and dedupes case-insensitively. A full watchlist is
 * an explicit rejection (never a silent drop of an older entry).
 */
export function addWatchlistEntry(raw: string): WatchlistAddResult {
  const trimmed = raw.trim();
  const validity = checkAddressValidity(trimmed);
  if (!validity.valid) {
    return { ok: false, reason: validity.tier, entries: readWatchlist() };
  }
  const checksummed = getAddress(trimmed);
  const entries = readWatchlist();
  if (entries.some(entry => entry.toLowerCase() === checksummed.toLowerCase())) {
    return { ok: false, reason: 'duplicate', entries };
  }
  if (entries.length >= WATCHLIST_MAX_ENTRIES) {
    return { ok: false, reason: 'full', entries };
  }
  return { ok: true, entries: persist([...entries, checksummed]) };
}

/** Remove a watched address (case-insensitive match against the stored form). */
export function removeWatchlistEntry(address: string): string[] {
  const target = address.trim().toLowerCase();
  return persist(readWatchlist().filter(entry => entry.toLowerCase() !== target));
}
