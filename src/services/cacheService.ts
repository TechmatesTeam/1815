import { getRedisClient } from '@/config/redis';
import { logger } from '@/utils/logger';

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  prefix?: string;
}

export class CacheService {
  private client: any;
  private defaultTTL: number = 3600; // 1 hour default

  constructor() {
    // Client will be initialized lazily
  }

  private getClient(): any {
    if (!this.client) {
      this.client = getRedisClient();
    }
    return this.client;
  }

  /**
   * Generate cache key with optional prefix
   */
  private generateKey(key: string, prefix?: string): string {
    return prefix ? `${prefix}:${key}` : key;
  }

  /**
   * Set a value in cache with TTL
   */
  async set(key: string, value: any, options: CacheOptions = {}): Promise<void> {
    try {
      const cacheKey = this.generateKey(key, options.prefix);
      const ttl = options.ttl || this.defaultTTL;
      const serializedValue = JSON.stringify(value);

      await this.getClient().setEx(cacheKey, ttl, serializedValue);
      logger.debug(`Cache SET: ${cacheKey} (TTL: ${ttl}s)`);
    } catch (error) {
      logger.error('Cache SET error:', error);
      throw error;
    }
  }

  /**
   * Set a value in cache only if it doesn't exist (atomic operation)
   * Returns true if the value was set, false if key already existed
   */
  async setIfNotExists(key: string, value: any, options: CacheOptions = {}): Promise<boolean> {
    try {
      const cacheKey = this.generateKey(key, options.prefix);
      const ttl = options.ttl || this.defaultTTL;
      const serializedValue = JSON.stringify(value);

      // Use SET with NX (only set if not exists) and EX (set expiry)
      const result = await this.getClient().set(cacheKey, serializedValue, 'EX', ttl, 'NX');

      const wasSet = result === 'OK';
      if (wasSet) {
        logger.debug(`Cache SET_IF_NOT_EXISTS: ${cacheKey} (TTL: ${ttl}s) - SUCCESS`);
      } else {
        logger.debug(`Cache SET_IF_NOT_EXISTS: ${cacheKey} - KEY_EXISTS`);
      }

      return wasSet;
    } catch (error) {
      logger.error('Cache SET_IF_NOT_EXISTS error:', error);
      return false;
    }
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    try {
      const cacheKey = this.generateKey(key, options.prefix);
      const value = await this.getClient().get(cacheKey);

      if (value === null) {
        logger.debug(`Cache MISS: ${cacheKey}`);
        return null;
      }

      logger.debug(`Cache HIT: ${cacheKey}`);
      return JSON.parse(value) as T;
    } catch (error) {
      logger.error('Cache GET error:', error);
      return null; // Return null on error to allow fallback
    }
  }

  /**
   * Delete a value from cache
   */
  async delete(key: string, options: CacheOptions = {}): Promise<boolean> {
    try {
      const cacheKey = this.generateKey(key, options.prefix);
      const result = await this.getClient().del(cacheKey);
      logger.debug(`Cache DELETE: ${cacheKey}`);
      return result > 0;
    } catch (error) {
      logger.error('Cache DELETE error:', error);
      return false;
    }
  }

  /**
   * Check if a key exists in cache
   */
  async exists(key: string, options: CacheOptions = {}): Promise<boolean> {
    try {
      const cacheKey = this.generateKey(key, options.prefix);
      const result = await this.getClient().exists(cacheKey);
      return result > 0;
    } catch (error) {
      logger.error('Cache EXISTS error:', error);
      return false;
    }
  }

  /**
   * Get TTL for a key
   */
  async getTTL(key: string, options: CacheOptions = {}): Promise<number> {
    try {
      const cacheKey = this.generateKey(key, options.prefix);
      return await this.getClient().ttl(cacheKey);
    } catch (error) {
      logger.error('Cache TTL error:', error);
      return -1;
    }
  }

  /**
   * Increment a counter in cache
   */
  async increment(key: string, options: CacheOptions = {}): Promise<number> {
    try {
      const cacheKey = this.generateKey(key, options.prefix);
      const result = await this.getClient().incr(cacheKey);

      // Set TTL if this is a new key
      if (result === 1 && options.ttl) {
        await this.getClient().expire(cacheKey, options.ttl);
      }

      return result;
    } catch (error) {
      logger.error('Cache INCREMENT error:', error);
      throw error;
    }
  }

  /**
   * Get multiple keys at once
   */
  async getMultiple<T>(keys: string[], options: CacheOptions = {}): Promise<(T | null)[]> {
    try {
      const cacheKeys = keys.map(key => this.generateKey(key, options.prefix));
      const values = await this.getClient().mGet(cacheKeys);

      return values.map((value: string | null, index: number) => {
        if (value === null) {
          logger.debug(`Cache MISS: ${cacheKeys[index]}`);
          return null;
        }
        logger.debug(`Cache HIT: ${cacheKeys[index]}`);
        return JSON.parse(value) as T;
      });
    } catch (error) {
      logger.error('Cache GET_MULTIPLE error:', error);
      return keys.map(() => null);
    }
  }

  /**
   * Set multiple key-value pairs
   */
  async setMultiple(
    entries: Array<{ key: string; value: any; ttl?: number }>,
    options: CacheOptions = {}
  ): Promise<void> {
    try {
      const pipeline = this.getClient().multi();

      for (const entry of entries) {
        const cacheKey = this.generateKey(entry.key, options.prefix);
        const serializedValue = JSON.stringify(entry.value);
        const ttl = entry.ttl || options.ttl || this.defaultTTL;

        pipeline.setEx(cacheKey, ttl, serializedValue);
      }

      await pipeline.exec();
      logger.debug(`Cache SET_MULTIPLE: ${entries.length} keys`);
    } catch (error) {
      logger.error('Cache SET_MULTIPLE error:', error);
      throw error;
    }
  }

  /**
   * Clear all keys with a specific prefix
   */
  async clearByPrefix(prefix: string): Promise<number> {
    try {
      const pattern = `${prefix}:*`;
      const keys = await this.getClient().keys(pattern);

      if (keys.length === 0) {
        return 0;
      }

      const result = await this.getClient().del(keys);
      logger.debug(`Cache CLEAR_PREFIX: ${prefix} (${result} keys deleted)`);
      return result;
    } catch (error) {
      logger.error('Cache CLEAR_PREFIX error:', error);
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ hits: number; misses: number; keys: number }> {
    try {
      const info = await this.getClient().info('stats');
      const lines = info.split('\r\n');

      let hits = 0;
      let misses = 0;

      for (const line of lines) {
        if (line.startsWith('keyspace_hits:')) {
          hits = parseInt(line.split(':')[1], 10);
        } else if (line.startsWith('keyspace_misses:')) {
          misses = parseInt(line.split(':')[1], 10);
        }
      }

      const keys = await this.getClient().dbSize();

      return { hits, misses, keys };
    } catch (error) {
      logger.error('Cache STATS error:', error);
      return { hits: 0, misses: 0, keys: 0 };
    }
  }
}

// Cache key prefixes for different data types
export const CacheKeys = {
  ALIAS: 'alias',
  ADDRESS: 'address',
  SEARCH: 'search',
  RATE_LIMIT: 'rate_limit',
  NOTIFICATION: 'notification',
  BLOCKFROST: 'blockfrost',
} as const;

// TTL constants (in seconds)
export const CacheTTL = {
  ALIAS: 3600, // 1 hour
  ADDRESS: 600, // 10 minutes
  SEARCH: 300, // 5 minutes
  RATE_LIMIT: 900, // 15 minutes
  NOTIFICATION: 1800, // 30 minutes
  BLOCKFROST: 300, // 5 minutes
} as const;

// Create singleton instance
export const cacheService = new CacheService();
