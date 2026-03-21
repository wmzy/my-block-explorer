/**
 * 简单的内存缓存实现
 */

export type CacheOptions = {
  ttl: number; // 生存时间（毫秒）
  maxSize?: number; // 最大缓存条目数
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  accessCount: number;
  lastAccessed: number;
};

/**
 * LRU缓存实现
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
   * 获取缓存值
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // 更新访问统计
    entry.accessCount++;
    entry.lastAccessed = Date.now();

    return entry.value;
  }

  /**
   * 设置缓存值
   */
  set(key: K, value: V, ttl?: number): void {
    const now = Date.now();
    const expiresAt = now + (ttl ?? this.defaultTtl);

    // 如果缓存已满，删除最少使用的条目
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
   * 删除缓存条目
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 检查是否存在
   */
  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 获取或设置缓存值
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
   * 清理过期条目
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
   * 获取缓存统计
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
   * 驱逐最少使用的条目
   */
  private evictLeastUsed(): void {
    let leastUsedKey: K | undefined;
    let leastUsedScore = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      // 计算使用分数（访问次数 + 最近访问时间权重）
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
 * 缓存管理器
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCache = LRUCache<any, any>;

export class CacheManager {
  private caches = new Map<string, AnyCache>();

  /**
   * 获取或创建缓存实例
   */
  getCache<K, V>(name: string, options?: CacheOptions): LRUCache<K, V> {
    if (!this.caches.has(name)) {
      const defaultOptions: CacheOptions = {
        ttl: 5 * 60 * 1000, // 5分钟默认TTL
        maxSize: 1000,
      };
      this.caches.set(name, new LRUCache({ ...defaultOptions, ...options }));
    }
    return this.caches.get(name)!;
  }

  /**
   * 清理所有缓存的过期条目
   */
  cleanupAll(): void {
    for (const cache of this.caches.values()) {
      cache.cleanup();
    }
  }

  /**
   * 获取所有缓存统计
   */
  getAllStats(): Record<string, unknown> {
    const stats: Record<string, unknown> = {};
    for (const [name, cache] of this.caches.entries()) {
      stats[name] = cache.getStats();
    }
    return stats;
  }

  /**
   * 清空所有缓存
   */
  clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
  }
}

// 全局缓存管理器实例
export const cacheManager = new CacheManager();

// 预定义的缓存实例
export const blockCache = cacheManager.getCache('blocks', {
  ttl: 30 * 1000, // 30秒
  maxSize: 500,
});

export const transactionCache = cacheManager.getCache('transactions', {
  ttl: 60 * 1000, // 1分钟
  maxSize: 1000,
});

export const addressCache = cacheManager.getCache('addresses', {
  ttl: 2 * 60 * 1000, // 2分钟
  maxSize: 500,
});

export const searchCache = cacheManager.getCache('search', {
  ttl: 5 * 60 * 1000, // 5分钟
  maxSize: 200,
});

// 定期清理过期缓存
setInterval(() => {
  cacheManager.cleanupAll();
}, 60 * 1000); // 每分钟清理一次
