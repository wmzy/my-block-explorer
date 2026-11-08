// createTtlLruCache contract tests, against the exact semantics the scan
// services' response caches relied on: expiry computed at WRITE time and
// enforced lazily on read (a stale read deletes the entry), Map insertion
// order as LRU recency (reads and re-writes refresh it; oversize writes
// evict the oldest), and an injectable clock for deterministic TTLs.
import { describe, it, expect } from 'vitest';
import { createTtlLruCache } from '@/utils/ttlLruCache';

describe('createTtlLruCache', () => {
  it('expires entries on read (lazy stale deletion, write-time expiry)', () => {
    let t = 0;
    const cache = createTtlLruCache<number>({ ttlMs: 1_000, maxEntries: 10, now: () => t });

    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);

    // Expiry is computed at WRITE time: the entry dies 1s after its
    // write, however often it is read.
    t = 999;
    expect(cache.get('a')).toBe(1);
    t = 1_000; // exactly at the boundary: still live (strictly-greater rule)
    expect(cache.get('a')).toBe(1);
    t = 1_001;
    expect(cache.get('a')).toBeUndefined();
    // The stale read deleted the entry, not just hid it.
    expect(cache.size()).toBe(0);
  });

  it('refreshes recency on read and evicts the oldest entry beyond maxEntries', () => {
    const t = 0;
    const cache = createTtlLruCache<string>({ ttlMs: 10_000, maxEntries: 2, now: () => t });

    cache.set('a', 'A');
    cache.set('b', 'B');
    // Reading 'a' makes 'b' the least recently used.
    expect(cache.get('a')).toBe('A');
    cache.set('c', 'C'); // evicts 'b', not 'a'

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('A');
    expect(cache.get('c')).toBe('C');
    expect(cache.size()).toBe(2);
  });

  it('treats an overwrite as a re-write: newest recency, one entry', () => {
    let t = 0;
    const cache = createTtlLruCache<string>({ ttlMs: 10_000, maxEntries: 2, now: () => t });

    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('a', 'A2'); // delete-then-set: refreshes recency, no dupes
    cache.set('c', 'C'); // evicts 'b' (now the oldest)

    expect(cache.size()).toBe(2);
    expect(cache.get('a')).toBe('A2');
    expect(cache.get('b')).toBeUndefined();

    // The overwrite also restarts the TTL: 'a' expires from ITS write,
    // not from the original one.
    t = 5_000;
    cache.set('a', 'A3');
    t = 12_000; // past the original write's TTL, inside the overwrite's
    expect(cache.get('a')).toBe('A3');
  });

  it('supports delete, clear and size', () => {
    const t = 0;
    const cache = createTtlLruCache<number>({ ttlMs: 1_000, maxEntries: 5, now: () => t });

    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size()).toBe(2);

    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size()).toBe(1);
    // Deleting an absent key is a no-op.
    cache.delete('nope');
    expect(cache.size()).toBe(1);

    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get('b')).toBeUndefined();
  });

  it('defaults the clock to Date.now', () => {
    const cache = createTtlLruCache<number>({ ttlMs: 60_000, maxEntries: 1 });
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
  });
});
