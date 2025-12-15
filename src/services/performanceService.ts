import { cacheService, CacheKeys, CacheTTL } from './cacheService';
import { Alias } from '@/models/Alias';
import { SearchHistory } from '@/models/SearchHistory';
import { logger } from '@/utils/logger';

/**
 * Performance optimization service for database queries and caching
 * Requirements: 5.2, 5.5 - Query optimization and cache warming strategies
 */

export interface CacheWarmingOptions {
  batchSize?: number;
  maxItems?: number;
  ttl?: number;
}

export interface QueryOptimizationStats {
  totalQueries: number;
  cachedQueries: number;
  cacheHitRatio: number;
  averageResponseTime: number;
}

export class PerformanceService {
  private queryStats = {
    totalQueries: 0,
    cachedQueries: 0,
    totalResponseTime: 0,
  };

  /**
   * Warm up cache with frequently accessed aliases
   */
  async warmAliasCache(options: CacheWarmingOptions = {}): Promise<number> {
    const { batchSize = 100, maxItems = 1000, ttl = CacheTTL.ALIAS } = options;

    try {
      logger.info('Starting alias cache warming...');

      // Get most frequently used aliases
      const frequentAliases = await Alias.aggregate([
        { $match: { isActive: true, expiresAt: { $gt: new Date() } } },
        { $sort: { useCount: -1, lastUsedAt: -1 } },
        { $limit: maxItems },
      ]);

      let warmedCount = 0;

      // Process in batches to avoid memory issues
      for (let i = 0; i < frequentAliases.length; i += batchSize) {
        const batch = frequentAliases.slice(i, i + batchSize);

        const cacheEntries = batch.map(alias => ({
          key: alias.shortCode,
          value: {
            cardanoAddress: alias.cardanoAddress,
            customName: alias.customName,
            expiresAt: alias.expiresAt.toISOString(),
            isActive: alias.isActive,
            useCount: alias.useCount,
          },
          ttl,
        }));

        await cacheService.setMultiple(cacheEntries, { prefix: CacheKeys.ALIAS });
        warmedCount += batch.length;

        logger.debug(`Warmed ${warmedCount}/${frequentAliases.length} aliases`);
      }

      logger.info(`Cache warming completed: ${warmedCount} aliases cached`);
      return warmedCount;
    } catch (error) {
      logger.error('Cache warming failed:', error);
      return 0;
    }
  }

  /**
   * Warm up cache with popular search queries
   */
  async warmSearchCache(options: CacheWarmingOptions = {}): Promise<number> {
    const { batchSize = 50, maxItems = 500, ttl = CacheTTL.SEARCH } = options;

    try {
      logger.info('Starting search cache warming...');

      // Get most frequent search queries from the last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const popularQueries = await SearchHistory.aggregate([
        { $match: { timestamp: { $gte: sevenDaysAgo }, resultFound: true } },
        { $group: { _id: '$query', count: { $sum: 1 }, lastSearched: { $max: '$timestamp' } } },
        { $sort: { count: -1, lastSearched: -1 } },
        { $limit: maxItems },
      ]);

      let warmedCount = 0;

      // For search cache warming, we would need to re-execute searches
      // This is a placeholder for the actual implementation
      for (let i = 0; i < popularQueries.length; i += batchSize) {
        const batch = popularQueries.slice(i, i + batchSize);

        // In a real implementation, you would:
        // 1. Execute the search query
        // 2. Cache the results
        // For now, we'll just log the popular queries

        batch.forEach(query => {
          logger.debug(`Popular search query: ${query._id} (${query.count} searches)`);
        });

        warmedCount += batch.length;
      }

      logger.info(`Search cache analysis completed: ${warmedCount} popular queries identified`);
      return warmedCount;
    } catch (error) {
      logger.error('Search cache warming failed:', error);
      return 0;
    }
  }

  /**
   * Optimize database queries by adding proper indexes
   */
  async optimizeIndexes(): Promise<void> {
    try {
      logger.info('Optimizing database indexes...');

      // Ensure compound indexes for frequently used queries
      await Alias.collection.createIndex(
        { shortCode: 1, isActive: 1 },
        { name: 'shortCode_isActive_compound' }
      );

      await Alias.collection.createIndex(
        { cardanoAddress: 1, isActive: 1, expiresAt: 1 },
        { name: 'cardanoAddress_active_expiry_compound' }
      );

      await Alias.collection.createIndex(
        { useCount: -1, lastUsedAt: -1 },
        { name: 'usage_frequency_compound' }
      );

      await Alias.collection.createIndex(
        { expiresAt: 1, isActive: 1 },
        { name: 'expiry_cleanup_compound' }
      );

      // Search history indexes
      await SearchHistory.collection.createIndex({ timestamp: -1 }, { name: 'timestamp_desc' });

      await SearchHistory.collection.createIndex(
        { query: 1, timestamp: -1 },
        { name: 'query_timestamp_compound' }
      );

      logger.info('Database indexes optimized successfully');
    } catch (error) {
      logger.error('Index optimization failed:', error);
      throw error;
    }
  }

  /**
   * Batch resolve multiple aliases with optimized caching
   */
  async batchResolveAliases(shortCodes: string[]): Promise<Map<string, any>> {
    const startTime = Date.now();
    this.queryStats.totalQueries++;

    try {
      const results = new Map();
      const uncachedCodes: string[] = [];

      // Try to get all from cache first
      const cachedResults = await cacheService.getMultiple<{
        cardanoAddress: string;
        customName?: string;
        expiresAt: string;
        isActive: boolean;
        useCount: number;
      }>(shortCodes, { prefix: CacheKeys.ALIAS });

      // Separate cached and uncached results
      shortCodes.forEach((code, index) => {
        const cached = cachedResults[index];
        if (cached && cached.isActive && new Date(cached.expiresAt) > new Date()) {
          results.set(code, cached);
          this.queryStats.cachedQueries++;
        } else {
          uncachedCodes.push(code);
        }
      });

      // Batch fetch uncached aliases from database
      if (uncachedCodes.length > 0) {
        const dbAliases = await Alias.find({
          shortCode: { $in: uncachedCodes },
          isActive: true,
          expiresAt: { $gt: new Date() },
        });

        // Cache the database results and add to results
        const cacheEntries = dbAliases.map(alias => ({
          key: alias.shortCode,
          value: {
            cardanoAddress: alias.cardanoAddress,
            customName: alias.customName,
            expiresAt: alias.expiresAt.toISOString(),
            isActive: alias.isActive,
            useCount: alias.useCount,
          },
          ttl: CacheTTL.ALIAS,
        }));

        if (cacheEntries.length > 0) {
          await cacheService.setMultiple(cacheEntries, { prefix: CacheKeys.ALIAS });
        }

        dbAliases.forEach(alias => {
          results.set(alias.shortCode, {
            cardanoAddress: alias.cardanoAddress,
            customName: alias.customName,
            expiresAt: alias.expiresAt.toISOString(),
            isActive: alias.isActive,
            useCount: alias.useCount,
          });
        });
      }

      const responseTime = Date.now() - startTime;
      this.queryStats.totalResponseTime += responseTime;

      logger.debug(
        `Batch resolved ${shortCodes.length} aliases in ${responseTime}ms (${results.size} found, ${this.queryStats.cachedQueries}/${this.queryStats.totalQueries} from cache)`
      );

      return results;
    } catch (error) {
      logger.error('Batch resolve failed:', error);
      throw error;
    }
  }

  /**
   * Preload frequently accessed data into cache
   */
  async preloadFrequentData(): Promise<void> {
    try {
      logger.info('Starting frequent data preload...');

      // Preload top 100 most used aliases
      await this.warmAliasCache({ maxItems: 100, batchSize: 20 });

      // Preload recent search patterns
      await this.warmSearchCache({ maxItems: 50, batchSize: 10 });

      logger.info('Frequent data preload completed');
    } catch (error) {
      logger.error('Frequent data preload failed:', error);
    }
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupExpiredCache(): Promise<number> {
    try {
      logger.info('Starting cache cleanup...');

      let cleanedCount = 0;

      // Clean up expired aliases from cache
      // Note: Redis handles TTL automatically, so we'll rely on that for now
      const aliasKeys: string[] = [];

      for (const key of aliasKeys) {
        const ttl = await cacheService.getTTL(key.replace(`${CacheKeys.ALIAS}:`, ''), {
          prefix: CacheKeys.ALIAS,
        });
        if (ttl <= 0) {
          await cacheService.delete(key.replace(`${CacheKeys.ALIAS}:`, ''), {
            prefix: CacheKeys.ALIAS,
          });
          cleanedCount++;
        }
      }

      logger.info(`Cache cleanup completed: ${cleanedCount} expired entries removed`);
      return cleanedCount;
    } catch (error) {
      logger.error('Cache cleanup failed:', error);
      return 0;
    }
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(): QueryOptimizationStats {
    const cacheHitRatio =
      this.queryStats.totalQueries > 0
        ? (this.queryStats.cachedQueries / this.queryStats.totalQueries) * 100
        : 0;

    const averageResponseTime =
      this.queryStats.totalQueries > 0
        ? this.queryStats.totalResponseTime / this.queryStats.totalQueries
        : 0;

    return {
      totalQueries: this.queryStats.totalQueries,
      cachedQueries: this.queryStats.cachedQueries,
      cacheHitRatio: Math.round(cacheHitRatio * 100) / 100,
      averageResponseTime: Math.round(averageResponseTime * 100) / 100,
    };
  }

  /**
   * Reset performance statistics
   */
  resetStats(): void {
    this.queryStats = {
      totalQueries: 0,
      cachedQueries: 0,
      totalResponseTime: 0,
    };
  }

  /**
   * Optimize query execution with caching strategy
   */
  async optimizedQuery<T>(
    cacheKey: string,
    queryFn: () => Promise<T>,
    options: { ttl?: number; prefix?: string } = {}
  ): Promise<T> {
    const startTime = Date.now();
    this.queryStats.totalQueries++;

    try {
      // Try cache first
      const cached = await cacheService.get<T>(cacheKey, options);
      if (cached !== null) {
        this.queryStats.cachedQueries++;
        const responseTime = Date.now() - startTime;
        this.queryStats.totalResponseTime += responseTime;
        return cached;
      }

      // Execute query
      const result = await queryFn();

      // Cache the result
      await cacheService.set(cacheKey, result, options);

      const responseTime = Date.now() - startTime;
      this.queryStats.totalResponseTime += responseTime;

      return result;
    } catch (error) {
      logger.error('Optimized query failed:', error);
      throw error;
    }
  }
}

// Create singleton instance
export const performanceService = new PerformanceService();
