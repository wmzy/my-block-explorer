import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LRUCache } from '@/utils/cache';

describe('LRUCache', () => {
  let cache: LRUCache<string, any>;

  beforeEach(() => {
    cache = new LRUCache({
      ttl: 1000, // 1秒TTL
      maxSize: 3,
    });
  });

  describe('基本缓存操作', () => {
    it('应该能设置和获取缓存值', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('应该在TTL过期后返回undefined', async () => {
      cache.set('key1', 'value1', 100); // 100ms TTL
      expect(cache.get('key1')).toBe('value1');

      // 等待TTL过期
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(cache.get('key1')).toBeUndefined();
    });

    it('应该正确报告缓存是否存在', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('应该能删除缓存条目', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);

      cache.delete('key1');
      expect(cache.has('key1')).toBe(false);
    });

    it('应该能清空所有缓存', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);

      cache.clear();
      expect(cache.size()).toBe(0);
    });
  });

  describe('LRU淘汰机制', () => {
    it('应该在达到最大容量时淘汰最少使用的条目', () => {
      // 填满缓存
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      expect(cache.size()).toBe(3);

      // 添加第4个条目，应该淘汰最少使用的
      cache.set('key4', 'value4');
      expect(cache.size()).toBe(3);
      expect(cache.has('key4')).toBe(true);
    });

    it('应该更新访问统计', () => {
      cache.set('key1', 'value1');

      // 多次访问应该更新统计
      cache.get('key1');
      cache.get('key1');
      cache.get('key1');

      const stats = cache.getStats();
      expect(stats.size).toBe(1);
    });
  });

  describe('getOrSet方法', () => {
    it('应该在缓存未命中时调用工厂函数', async () => {
      const factory = vi.fn().mockResolvedValue('computed_value');

      const result = await cache.getOrSet('key1', factory);

      expect(result).toBe('computed_value');
      expect(factory).toHaveBeenCalledOnce();
      expect(cache.get('key1')).toBe('computed_value');
    });

    it('应该在缓存命中时不调用工厂函数', async () => {
      const factory = vi.fn().mockResolvedValue('computed_value');

      // 先设置缓存
      cache.set('key1', 'cached_value');

      const result = await cache.getOrSet('key1', factory);

      expect(result).toBe('cached_value');
      expect(factory).not.toHaveBeenCalled();
    });
  });

  describe('缓存清理', () => {
    it('应该能清理过期的条目', async () => {
      cache.set('key1', 'value1', 100); // 100ms TTL
      cache.set('key2', 'value2', 2000); // 2s TTL

      expect(cache.size()).toBe(2);

      // 等待第一个条目过期
      await new Promise(resolve => setTimeout(resolve, 150));

      cache.cleanup();
      expect(cache.size()).toBe(1);
      expect(cache.has('key2')).toBe(true);
    });
  });

  describe('缓存统计', () => {
    it('应该提供正确的统计信息', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(3);
      expect(typeof stats.hitRate).toBe('number');
    });
  });
});
