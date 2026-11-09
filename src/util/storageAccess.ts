// Storage access that never throws.
//
// Browsers throw from localStorage/sessionStorage in states that are
// ordinary, not exotic: an opaque or sandboxed origin, storage blocked by
// policy, a private window with dom.storage disabled, a quota-exceeded
// write. A thrown read has exactly one honest answer ("nothing stored")
// and a thrown write exactly one honest outcome ("not persisted"), so
// every access goes through these helpers.
//
// This is the repo's established convention (themePreference, units,
// adminAuth, watchlist, searchHistory, chainReset, nftMetadata, the custom
// ABI panel, backupRestore) — the sites that grew guards one at a time are
// why the shared helper exists now: a bare `localStorage.getItem` on a boot
// or render path takes the app down with it (the backend-discovery gate
// hung on its full-screen "Scanning…" state because the stored-base read
// threw before the scan could start, and the chain a user was last on
// could not be read at all).
//
// Reads use the caller's own default — `null` for "a stored string", and
// the value itself when it is a valid one (so an existing
// validate-or-default pattern keeps its meaning).
//
// Every helper takes an optional injected storage object (privateNotes'
// `Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>` seam) defaulting
// to the real global — test doubles get the same guarding as production,
// and modules with an injectability contract migrate onto these helpers
// without losing it. The global is resolved INSIDE each try: in Safari
// private mode the `localStorage` property GET itself throws, so the
// default must be part of the guarded region, not a default parameter
// (which would evaluate at the call site, outside any try).

/** The three members the guarded helpers use (injectable for tests). */
export type GuardedStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Read one localStorage key; unavailable storage reads as `fallback`. */
export const readStorageItem = (
  key: string,
  fallback: null = null,
  storage?: GuardedStorage,
): string | null => {
  try {
    return (storage ?? globalThis.localStorage).getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

/** Read one sessionStorage key; unavailable storage reads as `fallback`. */
export const readSessionItem = (
  key: string,
  fallback: null = null,
  storage?: GuardedStorage,
): string | null => {
  try {
    return (storage ?? globalThis.sessionStorage).getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

/** Persist a localStorage entry; a failing write is reported, not thrown. */
export const writeStorageItem = (
  key: string,
  value: string,
  storage?: GuardedStorage,
): boolean => {
  try {
    (storage ?? globalThis.localStorage).setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

/** Remove a localStorage entry; a failing removal is reported, not thrown. */
export const removeStorageItem = (key: string, storage?: GuardedStorage): boolean => {
  try {
    (storage ?? globalThis.localStorage).removeItem(key);
    return true;
  } catch {
    return false;
  }
};

/** Remove a sessionStorage entry; a failing removal is reported, not thrown. */
export const removeSessionItem = (key: string, storage?: GuardedStorage): boolean => {
  try {
    (storage ?? globalThis.sessionStorage).removeItem(key);
    return true;
  } catch {
    return false;
  }
};
