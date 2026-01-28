/**
 * Upstash Redis cache implementation for serverless environments
 */

import { Redis } from '@upstash/redis';
import { config } from '@/config';
import { type CacheEntry, type CacheStats } from '@/types';
import { generateCacheKey, determineTTL, CacheTTL } from './strategies';
import { getLogger } from '@/utils/logger';

const logger = getLogger('kv-cache');

export class KVCache {
  private redis: Redis | null = null;
  private localCache: Map<string, CacheEntry> = new Map();
  private readonly MAX_LOCAL_ENTRIES = 100;

  constructor() {
    this.initRedis();
  }

  private initRedis(): void {
    if (config.upstashRedisUrl && config.upstashRedisToken) {
      try {
        this.redis = new Redis({
          url: config.upstashRedisUrl,
          token: config.upstashRedisToken,
        });
        logger.info('Upstash Redis cache initialized');
      } catch (error) {
        logger.warn('Failed to initialize Upstash Redis, falling back to local cache', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.redis = null;
      }
    } else {
      logger.info('Upstash Redis not configured, using local memory cache');
    }
  }

  /**
   * Get cached content
   */
  async get(
    framework: string,
    path: string = '',
    sourceType: string = 'docs'
  ): Promise<string | null> {
    const cacheKey = generateCacheKey(framework, path, sourceType);

    // Check local cache first
    const localEntry = this.localCache.get(cacheKey);
    if (localEntry && !this.isExpired(localEntry)) {
      logger.debug('Cache hit (local)', { framework, path });
      return localEntry.content;
    }

    // Check Redis if available
    if (this.redis) {
      try {
        const entry = await this.redis.get<CacheEntry>(cacheKey);
        if (entry && !this.isExpired(entry)) {
          // Promote to local cache
          this.addToLocalCache(cacheKey, entry);
          logger.debug('Cache hit (redis)', { framework, path });
          return entry.content;
        }
      } catch (error) {
        logger.warn('Redis get error', {
          key: cacheKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.debug('Cache miss', { framework, path });
    return null;
  }

  /**
   * Store content in cache
   */
  async set(
    framework: string,
    content: string,
    path: string = '',
    sourceType: string = 'docs',
    version: string = 'latest',
    branch: string = 'main'
  ): Promise<void> {
    const cacheKey = generateCacheKey(framework, path, sourceType);
    const ttl = determineTTL(version, branch);

    const entry: CacheEntry = {
      content,
      cached_at: Date.now(),
      ttl,
      version,
      framework,
      source_type: sourceType,
    };

    // Store in local cache
    this.addToLocalCache(cacheKey, entry);

    // Store in Redis if available
    if (this.redis) {
      try {
        await this.redis.set(cacheKey, entry, { ex: ttl });
        logger.debug('Content cached', {
          framework,
          path,
          ttl,
          size: content.length,
        });
      } catch (error) {
        logger.warn('Redis set error', {
          key: cacheKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Invalidate specific cached content
   */
  async invalidate(
    framework: string,
    path: string = '',
    sourceType: string = 'docs'
  ): Promise<void> {
    const cacheKey = generateCacheKey(framework, path, sourceType);

    // Remove from local cache
    this.localCache.delete(cacheKey);

    // Remove from Redis if available
    if (this.redis) {
      try {
        await this.redis.del(cacheKey);
        logger.debug('Cache invalidated', { framework, path });
      } catch (error) {
        logger.warn('Redis delete error', {
          key: cacheKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Clear all cache for a specific framework
   */
  async clearFramework(framework: string): Promise<number> {
    let cleared = 0;

    // Clear from local cache
    for (const [key, entry] of this.localCache.entries()) {
      if (entry.framework === framework) {
        this.localCache.delete(key);
        cleared++;
      }
    }

    // Clear from Redis if available
    if (this.redis) {
      try {
        const pattern = `augments:*:${framework}:*`;
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
          cleared += keys.length;
        }
      } catch (error) {
        logger.warn('Redis clear framework error', {
          framework,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Framework cache cleared', { framework, count: cleared });
    return cleared;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return {
      memory_entries: this.localCache.size,
      memory_max_entries: this.MAX_LOCAL_ENTRIES,
      memory_utilization_pct: Math.round((this.localCache.size / this.MAX_LOCAL_ENTRIES) * 100),
      indexed_frameworks: this.getIndexedFrameworkCount(),
      ttl_strategies: { ...CacheTTL },
    };
  }

  /**
   * Get framework cache info
   */
  async getFrameworkCacheInfo(framework: string): Promise<{
    framework: string;
    memory_entries: number;
    total_size_bytes: number;
    last_cached_at: number | null;
  }> {
    let memoryEntries = 0;
    let totalSize = 0;
    let lastCachedAt: number | null = null;

    for (const [key, entry] of this.localCache.entries()) {
      if (entry.framework === framework) {
        memoryEntries++;
        totalSize += entry.content.length;
        // Track the most recent cache timestamp for this framework
        if (lastCachedAt === null || entry.cached_at > lastCachedAt) {
          lastCachedAt = entry.cached_at;
        }
      }
    }

    return {
      framework,
      memory_entries: memoryEntries,
      total_size_bytes: totalSize,
      last_cached_at: lastCachedAt,
    };
  }

  /**
   * Get cache timestamps for all entries
   */
  getCacheTimestamps(): { oldest: number | null; newest: number | null; all: number[] } {
    if (this.localCache.size === 0) {
      return { oldest: null, newest: null, all: [] };
    }

    const timestamps = Array.from(this.localCache.values()).map((e) => e.cached_at);
    return {
      oldest: Math.min(...timestamps),
      newest: Math.max(...timestamps),
      all: timestamps,
    };
  }

  private isExpired(entry: CacheEntry): boolean {
    const now = Date.now();
    const expiresAt = entry.cached_at + entry.ttl * 1000;
    return now > expiresAt;
  }

  private addToLocalCache(key: string, entry: CacheEntry): void {
    // Remove oldest entries if at capacity
    while (this.localCache.size >= this.MAX_LOCAL_ENTRIES) {
      const firstKey = this.localCache.keys().next().value;
      if (firstKey) {
        this.localCache.delete(firstKey);
      }
    }

    this.localCache.set(key, entry);
  }

  private getIndexedFrameworkCount(): number {
    const frameworks = new Set<string>();
    for (const entry of this.localCache.values()) {
      frameworks.add(entry.framework);
    }
    return frameworks.size;
  }
}

// Singleton instance for serverless environments
let cacheInstance: KVCache | null = null;

export function getCache(): KVCache {
  if (!cacheInstance) {
    cacheInstance = new KVCache();
  }
  return cacheInstance;
}
