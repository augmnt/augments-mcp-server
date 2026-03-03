import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnifiedCache } from './unified-cache';

describe('UnifiedCache', () => {
  let cache: UnifiedCache<string>;

  beforeEach(() => {
    cache = new UnifiedCache<string>({
      maxSize: 5,
      defaultTTL: 60000, // 60 seconds
      name: 'test-cache',
    });
  });

  describe('basic get/set', () => {
    it('returns undefined for missing keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('stores and retrieves values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('overwrites existing keys', () => {
      cache.set('key1', 'value1');
      cache.set('key1', 'value2');
      expect(cache.get('key1')).toBe('value2');
      expect(cache.size).toBe(1);
    });

    it('stores multiple keys', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      expect(cache.get('a')).toBe('1');
      expect(cache.get('b')).toBe('2');
      expect(cache.get('c')).toBe('3');
      expect(cache.size).toBe(3);
    });
  });

  describe('LRU eviction', () => {
    it('evicts the least recently used entry when at capacity', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      cache.set('d', '4');
      cache.set('e', '5');

      // Cache is full (5 entries). Adding a 6th should evict 'a' (oldest)
      cache.set('f', '6');

      expect(cache.get('a')).toBeUndefined(); // evicted
      expect(cache.get('b')).toBe('2');
      expect(cache.get('f')).toBe('6');
      expect(cache.size).toBe(5);
    });

    it('promotes accessed entries (LRU reorder)', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      cache.set('d', '4');
      cache.set('e', '5');

      // Access 'a' to promote it — now 'b' is the LRU
      cache.get('a');

      // Add new entry — should evict 'b' (now LRU), not 'a'
      cache.set('f', '6');

      expect(cache.get('a')).toBe('1'); // promoted, still here
      expect(cache.get('b')).toBeUndefined(); // evicted
      expect(cache.get('f')).toBe('6');
    });

    it('set of existing key promotes it', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      cache.set('d', '4');
      cache.set('e', '5');

      // Re-set 'a' to promote it
      cache.set('a', 'updated');

      // Add new entry — should evict 'b' (LRU), not 'a'
      cache.set('f', '6');

      expect(cache.get('a')).toBe('updated');
      expect(cache.get('b')).toBeUndefined();
    });
  });

  describe('TTL expiry', () => {
    it('returns undefined for expired entries', () => {
      vi.useFakeTimers();
      try {
        cache.set('key1', 'value1', 1000); // 1 second TTL

        expect(cache.get('key1')).toBe('value1');

        // Advance time past TTL
        vi.advanceTimersByTime(1500);

        expect(cache.get('key1')).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('has() returns false for expired entries', () => {
      vi.useFakeTimers();
      try {
        cache.set('key1', 'value1', 500);

        expect(cache.has('key1')).toBe(true);

        vi.advanceTimersByTime(600);

        expect(cache.has('key1')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('uses default TTL when no custom TTL provided', () => {
      vi.useFakeTimers();
      try {
        cache.set('key1', 'value1'); // uses defaultTTL = 60000

        vi.advanceTimersByTime(59000);
        expect(cache.get('key1')).toBe('value1');

        vi.advanceTimersByTime(2000); // now at 61000ms
        expect(cache.get('key1')).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('supports per-entry custom TTL', () => {
      vi.useFakeTimers();
      try {
        cache.set('short', 'a', 1000);
        cache.set('long', 'b', 10000);

        vi.advanceTimersByTime(2000);

        expect(cache.get('short')).toBeUndefined(); // expired
        expect(cache.get('long')).toBe('b'); // still valid
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('delete and clear', () => {
    it('deletes a specific key', () => {
      cache.set('a', '1');
      cache.set('b', '2');

      expect(cache.delete('a')).toBe(true);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe('2');
      expect(cache.size).toBe(1);
    });

    it('returns false when deleting nonexistent key', () => {
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('clears all entries', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });
  });

  describe('metrics', () => {
    it('tracks hits and misses', () => {
      cache.set('a', '1');

      cache.get('a'); // hit
      cache.get('b'); // miss
      cache.get('a'); // hit
      cache.get('c'); // miss

      const metrics = cache.getMetrics();
      expect(metrics.hits).toBe(2);
      expect(metrics.misses).toBe(2);
      expect(metrics.hitRate).toBe(0.5);
    });

    it('counts expired entries as misses', () => {
      vi.useFakeTimers();
      try {
        cache.set('a', '1', 100);

        cache.get('a'); // hit
        vi.advanceTimersByTime(200);
        cache.get('a'); // miss (expired)

        const metrics = cache.getMetrics();
        expect(metrics.hits).toBe(1);
        expect(metrics.misses).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('tracks evictions', () => {
      // Fill cache
      for (let i = 0; i < 5; i++) {
        cache.set(`key${i}`, `val${i}`);
      }
      // Trigger 3 evictions
      cache.set('new1', 'v1');
      cache.set('new2', 'v2');
      cache.set('new3', 'v3');

      const metrics = cache.getMetrics();
      expect(metrics.evictions).toBe(3);
      expect(metrics.size).toBe(5);
      expect(metrics.maxSize).toBe(5);
    });

    it('returns 0 hit rate when no accesses', () => {
      const metrics = cache.getMetrics();
      expect(metrics.hitRate).toBe(0);
    });

    it('includes cache name in metrics', () => {
      const metrics = cache.getMetrics();
      expect(metrics.name).toBe('test-cache');
    });
  });

  describe('size bounds', () => {
    it('never exceeds maxSize', () => {
      for (let i = 0; i < 20; i++) {
        cache.set(`key${i}`, `val${i}`);
        expect(cache.size).toBeLessThanOrEqual(5);
      }
      expect(cache.size).toBe(5);
    });

    it('respects maxSize of 1', () => {
      const tinyCache = new UnifiedCache<string>({
        maxSize: 1,
        defaultTTL: 60000,
        name: 'tiny',
      });

      tinyCache.set('a', '1');
      tinyCache.set('b', '2');

      expect(tinyCache.size).toBe(1);
      expect(tinyCache.get('a')).toBeUndefined();
      expect(tinyCache.get('b')).toBe('2');
    });
  });

  describe('type safety', () => {
    it('works with object values', () => {
      const objCache = new UnifiedCache<{ name: string; count: number }>({
        maxSize: 10,
        defaultTTL: 60000,
        name: 'obj-cache',
      });

      objCache.set('item', { name: 'test', count: 42 });
      const val = objCache.get('item');
      expect(val).toEqual({ name: 'test', count: 42 });
    });

    it('works with array values', () => {
      const arrCache = new UnifiedCache<number[]>({
        maxSize: 10,
        defaultTTL: 60000,
        name: 'arr-cache',
      });

      arrCache.set('nums', [1, 2, 3]);
      expect(arrCache.get('nums')).toEqual([1, 2, 3]);
    });
  });

  describe('concurrent access patterns', () => {
    it('last write wins for multiple rapid sets to the same key', () => {
      for (let i = 0; i < 1000; i++) {
        cache.set('race-key', `value-${i}`);
      }

      expect(cache.get('race-key')).toBe('value-999');
      expect(cache.size).toBe(1);
    });

    it('rapid alternating get/set operations maintain consistency', () => {
      cache.set('alt-key', 'initial');

      for (let i = 0; i < 500; i++) {
        const current = cache.get('alt-key');
        expect(current).toBeDefined();
        cache.set('alt-key', `updated-${i}`);
      }

      expect(cache.get('alt-key')).toBe('updated-499');
      expect(cache.size).toBeLessThanOrEqual(5);
    });

    it('setting entries while iterating does not cause errors', () => {
      expect(() => {
        for (let i = 0; i < 100; i++) {
          cache.set(`rapid-${i}`, `value-${i}`);
        }
      }).not.toThrow();

      // Cache should still respect maxSize
      expect(cache.size).toBeLessThanOrEqual(5);

      // The most recently inserted entries should be present
      expect(cache.get('rapid-99')).toBe('value-99');
    });
  });

  describe('edge case keys and values', () => {
    it('empty string as key works correctly', () => {
      cache.set('', 'empty-key-value');

      expect(cache.get('')).toBe('empty-key-value');
      expect(cache.has('')).toBe(true);
      expect(cache.delete('')).toBe(true);
      expect(cache.get('')).toBeUndefined();
    });

    it('very long key (10000 chars) works correctly', () => {
      const longKey = 'x'.repeat(10000);

      cache.set(longKey, 'long-key-value');

      expect(cache.get(longKey)).toBe('long-key-value');
      expect(cache.has(longKey)).toBe(true);
      expect(cache.delete(longKey)).toBe(true);
      expect(cache.get(longKey)).toBeUndefined();
    });

    it('undefined-ish key names work correctly', () => {
      const trickyKeys = ['undefined', 'null', 'constructor', '__proto__'];

      trickyKeys.forEach((key, i) => {
        cache.set(key, `tricky-${i}`);
      });

      trickyKeys.forEach((key, i) => {
        expect(cache.get(key)).toBe(`tricky-${i}`);
        expect(cache.has(key)).toBe(true);
      });
    });

    it('special characters in keys work correctly', () => {
      const specialKeys = [
        'key with spaces',
        'key\nwith\nnewlines',
        'key\twith\ttabs',
        'emoji-xF0x9Fx94x91-key',
        'path/to/resource',
        'query?param=value&other=1',
        'unicode-xC3xA9xC3xA0xC3xBC-key',
      ];

      specialKeys.forEach((key, i) => {
        cache.set(key, `special-${i}`);
      });

      // Only last maxSize entries should remain
      expect(cache.size).toBeLessThanOrEqual(5);

      // The most recently set keys should be retrievable
      const lastKeys = specialKeys.slice(-5);
      lastKeys.forEach((key, i) => {
        const idx = specialKeys.length - 5 + i;
        expect(cache.get(key)).toBe(`special-${idx}`);
      });
    });
  });
});
