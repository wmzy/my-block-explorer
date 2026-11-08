import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LRUCache, blockCache } from '@/utils/cache';

describe('LRUCache', () => {
  let cache: LRUCache<string, string>;

  beforeEach(() => {
    cache = new LRUCache({
      ttl: 1000,
      maxSize: 3,
    });
  });

  describe('basic operations', () => {
    it('sets and gets a value', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('returns undefined after the TTL expires', async () => {
      cache.set('key1', 'value1', 100);
      expect(cache.get('key1')).toBe('value1');

      await new Promise(resolve => setTimeout(resolve, 150));
      expect(cache.get('key1')).toBeUndefined();
    });

    it('reports key existence and drops expired keys', async () => {
      cache.set('key1', 'value1', 100);
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);

      await new Promise(resolve => setTimeout(resolve, 150));
      expect(cache.has('key1')).toBe(false);
    });

    it('deletes and clears entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);

      expect(cache.delete('key1')).toBe(true);
      expect(cache.has('key1')).toBe(false);

      cache.clear();
      expect(cache.size()).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    it('evicts the least-used entry at max capacity', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      expect(cache.size()).toBe(3);

      // Touch key1 so key2 becomes the least-used entry
      cache.get('key1');

      cache.set('key4', 'value4');
      expect(cache.size()).toBe(3);
      expect(cache.has('key4')).toBe(true);
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(true);
    });

    it('replaces an existing key without evicting others', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      cache.set('key2', 'updated');
      expect(cache.size()).toBe(3);
      expect(cache.get('key2')).toBe('updated');
    });
  });

  describe('getOrSet', () => {
    it('populates on miss and reuses the entry on hit', async () => {
      const factory = vi.fn().mockResolvedValue('computed');

      await expect(cache.getOrSet('key1', factory)).resolves.toBe('computed');
      expect(factory).toHaveBeenCalledOnce();
      expect(cache.get('key1')).toBe('computed');

      await expect(cache.getOrSet('key1', factory)).resolves.toBe('computed');
      expect(factory).toHaveBeenCalledOnce();
    });
  });

  describe('cleanup', () => {
    it('removes only expired entries', async () => {
      cache.set('key1', 'value1', 100);
      cache.set('key2', 'value2', 2000);
      expect(cache.size()).toBe(2);

      await new Promise(resolve => setTimeout(resolve, 150));

      cache.cleanup();
      expect(cache.size()).toBe(1);
      expect(cache.has('key2')).toBe(true);
    });
  });
});

describe('blockCache', () => {
  beforeEach(() => {
    blockCache.clear();
  });

  it('stores and returns block entries without re-fetching', async () => {
    const block = { number: 100n, hash: '0xabc' };
    const factory = vi.fn().mockResolvedValue(block);

    await expect(blockCache.getOrSet('blocks:100', factory)).resolves.toBe(block);
    expect(factory).toHaveBeenCalledOnce();

    await expect(blockCache.getOrSet('blocks:100', factory)).resolves.toBe(block);
    expect(factory).toHaveBeenCalledOnce();
  });

  it('honors per-entry TTL overrides', async () => {
    blockCache.set('blocks:1', { number: 1n }, 100);
    expect(blockCache.get('blocks:1')).toEqual({ number: 1n });

    await new Promise(resolve => setTimeout(resolve, 150));
    expect(blockCache.get('blocks:1')).toBeUndefined();
  });

  it('caps entries at its configured max size', () => {
    for (let i = 0; i <= 500; i++) {
      blockCache.set(`blocks:${i}`, { number: BigInt(i) });
    }
    expect(blockCache.size()).toBe(500);
    // The most recently inserted key survives eviction
    expect(blockCache.has('blocks:500')).toBe(true);
  });
});
