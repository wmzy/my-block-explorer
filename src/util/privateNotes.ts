// Private notes: the user's per-address scratchpad that NEVER leaves the
// browser. Where the Label row persists to the backend (shared, backed
// up server-side), a private note is this-browser-only — the editor says
// so explicitly and no network code path touches this module. Same
// storage family as the watchlist (be:-prefixed localStorage, best-effort
// degradation), with the same two-tier address validity so a malformed
// address performs NO write and every stored key carries the EIP-55
// checksummed form.
//
// Key grammar (single source of truth for the writer, the reader AND the
// backup layer): `be:privateNote:<chainId>:<checksummed address>`. The
// regex below is what the exporter scans for and what the restore's
// write plan is pinned to — a hostile backup file cannot reach any other
// localStorage key through private notes.
import { getAddress } from 'viem';
import { checkAddressValidity } from '@/views/Address/addressValidity';

export const PRIVATE_NOTE_KEY_PREFIX = 'be:privateNote:';

/** Hard cap enforced on save (the editor mirrors it with a live counter). */
export const PRIVATE_NOTE_MAX_CHARS = 280;

// Written keys are always checksummed, but the regex must also match what
// a hand-edited storage can hold (any hex case) so the backup scan sees
// the entry and the restore normalizes it.
export const PRIVATE_NOTE_KEY_RE = /^be:privateNote:\d+:0x[0-9a-fA-F]{40}$/;

/** The three localStorage calls this store needs (injectable for tests). */
export type PrivateNoteStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type PrivateNoteSaveRejection =
  | 'malformed-address' // failed the two-tier validity check — NO write happened
  | 'empty' // nothing after trimming — clearing is clearPrivateNote's job
  | 'too-long' // over the 280-char cap — rejected, never silently truncated
  | 'storage-unavailable'; // localStorage threw (quota/private mode)

export type PrivateNoteSaveResult =
  | { ok: true; note: string }
  | { ok: false; reason: PrivateNoteSaveRejection };

/**
 * Checksum a raw address through the same two tiers every address surface
 * uses (shape, then EIP-55 — all-lower/all-upper pass through). Null for
 * anything the explorer would refuse to render as an address. Shared with
 * the Address QR modal (one canonical checksum-or-reject helper).
 */
export function checksummedAddressOrNull(raw: string): string | null {
  const trimmed = raw.trim();
  if (!checkAddressValidity(trimmed).valid) return null;
  return getAddress(trimmed);
}

/**
 * The storage key for one (chainId, address), or null when either part is
 * unusable (malformed address / non-positive chain id). Every caller that
 * gets null MUST treat it as "no read, no write" — that is the
 * malformed-input-performs-no-write rule.
 */
export function privateNoteStorageKey(chainId: number, address: string): string | null {
  if (!Number.isInteger(chainId) || chainId <= 0) return null;
  const checksummed = checksummedAddressOrNull(address);
  if (checksummed === null) return null;
  return `${PRIVATE_NOTE_KEY_PREFIX}${chainId}:${checksummed}`;
}

/** Split a scanned storage key back into its parts; null when off-grammar. */
export function parsePrivateNoteKey(
  key: string,
): { chainId: number; address: string } | null {
  if (!PRIVATE_NOTE_KEY_RE.test(key)) return null;
  const rest = key.slice(PRIVATE_NOTE_KEY_PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator <= 0) return null;
  const chainId = Number.parseInt(rest.slice(0, separator), 10);
  const address = rest.slice(separator + 1);
  if (!Number.isInteger(chainId) || chainId <= 0) return null;
  // The regex shape-checked the address; the two-tier check additionally
  // rejects a wrong-checksum spelling, and getAddress canonicalizes.
  if (!checkAddressValidity(address).valid) return null;
  return { chainId, address: getAddress(address) };
}

/**
 * Stored-payload guard (pure): a note the app itself would have written
 * is a non-empty string within the cap. Absent, blank, or oversized
 * (hand-corrupted) reads as null — degrade, never crash the page.
 */
export function parseStoredPrivateNote(raw: string | null): string | null {
  if (raw === null || raw.length === 0 || raw.length > PRIVATE_NOTE_MAX_CHARS) return null;
  return raw;
}

// Accessing the global can itself throw in fully sandboxed contexts.
const browserStorage = (): PrivateNoteStorage | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

/** The saved note, or null when absent/malformed-address/storage-off. */
export function readPrivateNote(
  chainId: number,
  address: string,
  storage?: PrivateNoteStorage,
): string | null {
  const key = privateNoteStorageKey(chainId, address);
  if (key === null) return null;
  const store = storage ?? browserStorage();
  if (store === null) return null;
  try {
    return parseStoredPrivateNote(store.getItem(key));
  } catch {
    return null;
  }
}

/**
 * Save a note (trimmed). Validation failures reject BEFORE any storage
 * touch — a malformed address or an over-cap note performs no write, and
 * nothing is ever silently truncated. A setItem that throws reports
 * storage-unavailable instead of pretending the note saved.
 */
export function savePrivateNote(
  chainId: number,
  address: string,
  note: string,
  storage?: PrivateNoteStorage,
): PrivateNoteSaveResult {
  const trimmed = note.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  if (trimmed.length > PRIVATE_NOTE_MAX_CHARS) return { ok: false, reason: 'too-long' };
  const key = privateNoteStorageKey(chainId, address);
  if (key === null) return { ok: false, reason: 'malformed-address' };
  const store = storage ?? browserStorage();
  if (store === null) return { ok: false, reason: 'storage-unavailable' };
  try {
    store.setItem(key, trimmed);
    return { ok: true, note: trimmed };
  } catch {
    return { ok: false, reason: 'storage-unavailable' };
  }
}

/** Remove the note. Returns false when nothing was stored (or no write ran). */
export function clearPrivateNote(
  chainId: number,
  address: string,
  storage?: PrivateNoteStorage,
): boolean {
  const key = privateNoteStorageKey(chainId, address);
  if (key === null) return false;
  const store = storage ?? browserStorage();
  if (store === null) return false;
  try {
    const existed = parseStoredPrivateNote(store.getItem(key)) !== null;
    store.removeItem(key);
    return existed;
  } catch {
    return false;
  }
}
