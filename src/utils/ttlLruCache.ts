// TTL + LRU cache: one canonical value per key for a bounded time and a
// bounded memory footprint. Extracted from the scan services' response
// caches (transfers / approvals / address tx-search), which all needed
// the same three properties:
// - entries carry an expiresAt computed at WRITE time (a value served
//   late in its TTL is not reborn);
// - stale entries are deleted lazily on read (no sweeping timer);
// - recency matters: Map preserves insertion order, so reads re-insert to
//   refresh recency and oversize inserts evict the oldest key first.
// `now` is injectable for deterministic TTL tests.

export type TtlLruCache<T> = {
  /** The live value, or undefined when absent or expired (a stale entry is deleted). */
  get(key: string): T | undefined;
  /** Writes the value as the newest entry; evicts oldest keys beyond maxEntries. */
  set(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
  size(): number;
};

type Entry<T> = {
  expiresAt: number;
  value: T;
};

export function createTtlLruCache<T>(options: {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}): TtlLruCache<T> {
  const { ttlMs, maxEntries } = options;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry<T>>();

  const get = (key: string): T | undefined => {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (now() > entry.expiresAt) {
      entries.delete(key);
      return undefined;
    }
    // LRU refresh: re-insert at the newest end of the insertion order.
    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  };

  const set = (key: string, value: T): void => {
    // Delete-then-set so a re-written key lands at the newest end.
    entries.delete(key);
    entries.set(key, { expiresAt: now() + ttlMs, value });
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  return {
    get,
    set,
    delete: key => entries.delete(key),
    clear: () => entries.clear(),
    size: () => entries.size,
  };
}
