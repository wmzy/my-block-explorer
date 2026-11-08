/**
 * Simple in-memory cache
 */

export type CacheOptions = {
  ttl: number; // time to live (ms)
  maxSize?: number; // maximum number of entries
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  accessCount: number;
  lastAccessed: number;
};

/**
 * LRU cache implementation
 */
export class LRUCache<K, V> {
  private cache = new Map<K, CacheEntry<V>>();
  private readonly maxSize: number;
  private readonly defaultTtl: number;

  constructor(options: CacheOptions) {
    this.maxSize = options.maxSize ?? 1000;
    this.defaultTtl = options.ttl;
  }

  /**
   * Get a cached value
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Check whether the entry expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Update access statistics
    entry.accessCount++;
    entry.lastAccessed = Date.now();

    return entry.value;
  }

  /**
   * Set a cached value
   */
  set(key: K, value: V, ttl?: number): void {
    const now = Date.now();
    const expiresAt = now + (ttl ?? this.defaultTtl);

    // When full, evict the least-used entry
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLeastUsed();
    }

    this.cache.set(key, {
      value,
      expiresAt,
      accessCount: 1,
      lastAccessed: now,
    });
  }

  /**
   * Delete a cache entry
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Check whether a key exists
   */
  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check whether the entry expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Get a value or populate it
   */
  async getOrSet<T extends V>(key: K, factory: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached as T;
    }

    const value = await factory();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Evict the least-used entry
   */
  private evictLeastUsed(): void {
    let leastUsedKey: K | undefined;
    let leastUsedScore = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      // Score usage (access count + recency weight)
      const score = entry.accessCount + (Date.now() - entry.lastAccessed) / 1000;

      if (score < leastUsedScore) {
        leastUsedScore = score;
        leastUsedKey = key;
      }
    }

    if (leastUsedKey !== undefined) {
      this.cache.delete(leastUsedKey);
    }
  }
}

// Block cache used by BlockService (30s TTL matches the RPC freshness window)
export const blockCache = new LRUCache({
  ttl: 30 * 1000, // 30 seconds
  maxSize: 500,
});
