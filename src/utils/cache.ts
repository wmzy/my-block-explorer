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
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
  } {
    let totalAccess = 0;
    for (const entry of this.cache.values()) {
      totalAccess += entry.accessCount;
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: totalAccess > 0 ? this.cache.size / totalAccess : 0,
    };
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

/**
 * Cache manager
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCache = LRUCache<any, any>;

export class CacheManager {
  private caches = new Map<string, AnyCache>();

  /**
   * Get or create a cache instance
   */
  getCache<K, V>(name: string, options?: CacheOptions): LRUCache<K, V> {
    if (!this.caches.has(name)) {
      const defaultOptions: CacheOptions = {
        ttl: 5 * 60 * 1000, // 5-minute default TTL
        maxSize: 1000,
      };
      this.caches.set(name, new LRUCache({ ...defaultOptions, ...options }));
    }
    return this.caches.get(name)!;
  }

  /**
   * Clean up expired entries in all caches
   */
  cleanupAll(): void {
    for (const cache of this.caches.values()) {
      cache.cleanup();
    }
  }

  /**
   * Get statistics for all caches
   */
  getAllStats(): Record<string, unknown> {
    const stats: Record<string, unknown> = {};
    for (const [name, cache] of this.caches.entries()) {
      stats[name] = cache.getStats();
    }
    return stats;
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
  }
}

// Global cache manager instance
export const cacheManager = new CacheManager();

// Predefined cache instances
export const blockCache = cacheManager.getCache('blocks', {
  ttl: 30 * 1000, // 30 seconds
  maxSize: 500,
});

export const transactionCache = cacheManager.getCache('transactions', {
  ttl: 60 * 1000, // 1 minute
  maxSize: 1000,
});

export const addressCache = cacheManager.getCache('addresses', {
  ttl: 2 * 60 * 1000, // 2 minutes
  maxSize: 500,
});

export const searchCache = cacheManager.getCache('search', {
  ttl: 5 * 60 * 1000, // 5 minutes
  maxSize: 200,
});

// Periodically clean up expired cache entries
setInterval(() => {
  cacheManager.cleanupAll();
}, 60 * 1000); // clean up once per minute
