import { performanceService } from '@/services/performanceService';
import { logger } from '@/utils/logger';

/**
 * Background job for cache warming and performance optimization
 * Requirements: 5.2, 5.5 - Cache warming strategies and performance optimization
 */

export class CacheWarmingJob {
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;

  /**
   * Start the cache warming job
   */
  start(intervalMinutes: number = 60): void {
    if (this.intervalId) {
      logger.warn('Cache warming job is already running');
      return;
    }

    logger.info(`Starting cache warming job (interval: ${intervalMinutes} minutes)`);

    // Run immediately on start
    this.runCacheWarming();

    // Schedule periodic runs
    this.intervalId = setInterval(
      () => {
        this.runCacheWarming();
      },
      intervalMinutes * 60 * 1000
    );
  }

  /**
   * Stop the cache warming job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Cache warming job stopped');
    }
  }

  /**
   * Run cache warming process
   */
  private async runCacheWarming(): Promise<void> {
    if (this.isRunning) {
      logger.debug('Cache warming already in progress, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info('Starting cache warming process...');

      // Optimize database indexes
      await performanceService.optimizeIndexes();

      // Warm up frequently accessed data
      await performanceService.preloadFrequentData();

      // Clean up expired cache entries
      const cleanedCount = await performanceService.cleanupExpiredCache();

      const duration = Date.now() - startTime;
      const stats = performanceService.getPerformanceStats();

      logger.info(`Cache warming completed in ${duration}ms`, {
        cleanedEntries: cleanedCount,
        cacheHitRatio: stats.cacheHitRatio,
        averageResponseTime: stats.averageResponseTime,
      });
    } catch (error) {
      logger.error('Cache warming process failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get job status
   */
  getStatus(): { isRunning: boolean; hasSchedule: boolean } {
    return {
      isRunning: this.isRunning,
      hasSchedule: this.intervalId !== null,
    };
  }
}

// Create singleton instance
export const cacheWarmingJob = new CacheWarmingJob();
