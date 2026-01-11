import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { checkRedisHealth, getRedisInfo } from '@/config/redis';
import { cacheService } from '@/services/cacheService';
import { Alias } from '@/models/Alias';
import { User } from '@/models/User';
import { SearchHistory } from '@/models/SearchHistory';
import { createError } from '@/middlewares/errorHandler';
import { logger } from '@/utils/logger';
import { config } from '@/config/environment';
import { explorerService } from '@/services/explorerService';
import { serviceDegradationManager } from '@/utils/serviceDegradation';
import { jobFailureService } from '@/services/jobFailureService';
import { jobManager } from '@/jobs/jobManager';
import { securityService } from '@/services/securityService';

export class HealthController {
  /**
   * Health check endpoint with dependency checks
   * GET /api/v1/health
   * Requirements: 7.5
   */
  static async healthCheck(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      logger.debug('Performing health check', {
        requestId: res.locals.requestId,
      });

      const startTime = Date.now();
      const healthStatus = {
        status: 'healthy' as 'healthy' | 'degraded' | 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        environment: config.nodeEnv,
        dependencies: {} as Record<string, any>,
      };

      // Check MongoDB connection
      try {
        const mongoStatus = mongoose.connection.readyState;
        const mongoHealth = {
          status: mongoStatus === 1 ? 'healthy' : 'unhealthy',
          readyState: mongoStatus,
          readyStateText:
            ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoStatus] || 'unknown',
        };

        // Test database operation
        if (mongoStatus === 1 && mongoose.connection.db) {
          const dbStart = Date.now();
          await mongoose.connection.db.admin().ping();
          (mongoHealth as any).latency = Date.now() - dbStart;
        }

        healthStatus.dependencies.mongodb = mongoHealth;
      } catch (error) {
        healthStatus.dependencies.mongodb = {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        healthStatus.status = 'degraded';
      }

      // Check Redis connection
      try {
        const redisHealth = await checkRedisHealth();
        const redisInfo = await getRedisInfo();

        healthStatus.dependencies.redis = {
          ...redisHealth,
          connected: redisInfo.connected,
          ready: redisInfo.ready,
          retries: redisInfo.retries,
        };

        if (redisHealth.status === 'unhealthy') {
          healthStatus.status = 'degraded';
        }
      } catch (error) {
        healthStatus.dependencies.redis = {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        healthStatus.status = 'degraded';
      }

      // Check Blockfrost API with circuit breaker status
      try {
        const blockfrostHealth = await explorerService.healthCheck();
        healthStatus.dependencies.blockfrost = blockfrostHealth;

        // Mark as degraded if Blockfrost is unhealthy or degraded
        if (blockfrostHealth.status === 'unhealthy' || blockfrostHealth.status === 'degraded') {
          healthStatus.status = 'degraded';
        }
      } catch (error) {
        healthStatus.dependencies.blockfrost = {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        healthStatus.status = 'degraded';
      }

      // Check cache service
      try {
        const cacheStart = Date.now();
        const testKey = `health_check_${Date.now()}`;
        const testValue = { test: true, timestamp: Date.now() };

        await cacheService.set(testKey, testValue, { ttl: 60 });
        const retrieved = await cacheService.get(testKey);
        await cacheService.delete(testKey);

        const cacheWorking = retrieved && (retrieved as any).test === true;

        healthStatus.dependencies.cache = {
          status: cacheWorking ? 'healthy' : 'unhealthy',
          latency: Date.now() - cacheStart,
          testPassed: cacheWorking,
        };

        if (!cacheWorking) {
          healthStatus.status = 'degraded';
        }
      } catch (error) {
        healthStatus.dependencies.cache = {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        healthStatus.status = 'degraded';
      }

      // Add system metrics and service degradation status
      const memUsage = process.memoryUsage();
      const degradationSummary = serviceDegradationManager.getDegradationSummary();

      healthStatus.dependencies.system = {
        status: 'healthy',
        memory: {
          rss: Math.round(memUsage.rss / 1024 / 1024), // MB
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
          external: Math.round(memUsage.external / 1024 / 1024), // MB
        },
        cpu: {
          loadAverage: process.platform !== 'win32' ? require('os').loadavg() : [0, 0, 0],
        },
      };

      // Add service degradation information
      healthStatus.dependencies.serviceDegradation = {
        status: degradationSummary.degraded ? 'degraded' : 'healthy',
        summary: degradationSummary,
        services: serviceDegradationManager.getAllServiceStatuses(),
      };

      // Update overall status if any services are degraded
      if (degradationSummary.degraded && healthStatus.status === 'healthy') {
        healthStatus.status = 'degraded';
      }

      const totalLatency = Date.now() - startTime;

      logger.info('Health check completed', {
        status: healthStatus.status,
        totalLatency,
        requestId: res.locals.requestId,
      });

      const httpStatus =
        healthStatus.status === 'healthy' ? 200 : healthStatus.status === 'degraded' ? 200 : 503;

      res.status(httpStatus).json({
        success: healthStatus.status !== 'unhealthy',
        data: {
          ...healthStatus,
          responseTime: totalLatency,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      next(createError('Health check failed', 500, 'HEALTH_CHECK_FAILED'));
    }
  }

  /**
   * Public statistics endpoint
   * GET /api/v1/stats
   * Requirements: 7.5
   */
  static async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      logger.debug('Getting public statistics', {
        requestId: res.locals.requestId,
      });

      const startTime = Date.now();
      const stats = {
        aliases: {
          total: 0,
          active: 0,
          expired: 0,
          totalUsage: 0,
        },
        users: {
          total: 0,
          subscribed: 0,
        },
        searches: {
          total: 0,
          successful: 0,
          cacheHitRate: 0,
          avgResponseTime: 0,
        },
        system: {
          uptime: process.uptime(),
          version: process.env.npm_package_version || '1.0.0',
          environment: config.nodeEnv,
        },
      };

      // Get alias statistics
      try {
        const aliasStats = await Alias.aggregate([
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: {
                $sum: {
                  $cond: [
                    { $and: [{ $eq: ['$isActive', true] }, { $gt: ['$expiresAt', new Date()] }] },
                    1,
                    0,
                  ],
                },
              },
              expired: {
                $sum: {
                  $cond: [
                    { $or: [{ $eq: ['$isActive', false] }, { $lte: ['$expiresAt', new Date()] }] },
                    1,
                    0,
                  ],
                },
              },
              totalUsage: { $sum: '$useCount' },
            },
          },
        ]);

        if (aliasStats.length > 0) {
          stats.aliases = {
            total: aliasStats[0].total || 0,
            active: aliasStats[0].active || 0,
            expired: aliasStats[0].expired || 0,
            totalUsage: aliasStats[0].totalUsage || 0,
          };
        }
      } catch (error) {
        logger.warn('Failed to get alias statistics', {
          error: error instanceof Error ? error.message : 'Unknown error',
          requestId: res.locals.requestId,
        });
      }

      // Get user statistics
      try {
        const userStats = await User.aggregate([
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              subscribed: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$isActive', true] },
                        { $eq: ['$notificationPreferences.aliasExpiry', true] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]);

        if (userStats.length > 0) {
          stats.users = {
            total: userStats[0].total || 0,
            subscribed: userStats[0].subscribed || 0,
          };
        }
      } catch (error) {
        logger.warn('Failed to get user statistics', {
          error: error instanceof Error ? error.message : 'Unknown error',
          requestId: res.locals.requestId,
        });
      }

      // Get search statistics (last 30 days)
      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const searchStats = await SearchHistory.aggregate([
          {
            $match: {
              createdAt: { $gte: thirtyDaysAgo },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              successful: {
                $sum: { $cond: ['$wasSuccessful', 1, 0] },
              },
              cacheHits: {
                $sum: { $cond: ['$cacheHit', 1, 0] },
              },
              avgResponseTime: { $avg: '$responseTime' },
            },
          },
        ]);

        if (searchStats.length > 0) {
          const searchData = searchStats[0];
          stats.searches = {
            total: searchData.total || 0,
            successful: searchData.successful || 0,
            cacheHitRate:
              searchData.total > 0
                ? Math.round((searchData.cacheHits / searchData.total) * 100)
                : 0,
            avgResponseTime: Math.round(searchData.avgResponseTime || 0),
          };
        }
      } catch (error) {
        logger.warn('Failed to get search statistics', {
          error: error instanceof Error ? error.message : 'Unknown error',
          requestId: res.locals.requestId,
        });
      }

      // Get cache statistics
      try {
        const cacheStats = await cacheService.getStats();
        (stats.system as any).cache = {
          hits: cacheStats.hits,
          misses: cacheStats.misses,
          keys: cacheStats.keys,
          hitRate:
            cacheStats.hits + cacheStats.misses > 0
              ? Math.round((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100)
              : 0,
        };
      } catch (error) {
        logger.warn('Failed to get cache statistics', {
          error: error instanceof Error ? error.message : 'Unknown error',
          requestId: res.locals.requestId,
        });
      }

      const responseTime = Date.now() - startTime;

      logger.info('Statistics retrieved successfully', {
        responseTime,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          statistics: stats,
          generatedAt: new Date().toISOString(),
          responseTime,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to get statistics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      next(createError('Failed to retrieve statistics', 500, 'STATS_RETRIEVAL_FAILED'));
    }
  }

  /**
   * Job failure statistics (admin endpoint)
   * GET /api/v1/health/jobs
   * Requirements: 8.5
   */
  static async getJobStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      logger.debug('Getting job failure statistics', {
        requestId: res.locals.requestId,
      });

      const startTime = Date.now();

      // Get job failure statistics
      const failureStats = jobFailureService.getFailureStats();

      // Get job manager status
      const jobManagerStatus = await jobManager.getStatus();

      const jobStats = {
        failures: failureStats,
        queues: jobManagerStatus,
        manager: {
          initialized: jobManager.initialized,
          uptime: process.uptime(),
        },
        timestamp: new Date().toISOString(),
        responseTime: Date.now() - startTime,
      };

      logger.info('Job statistics retrieved', {
        totalFailures: failureStats.totalFailures,
        criticalFailures: failureStats.criticalFailures.length,
        responseTime: jobStats.responseTime,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: jobStats,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to get job statistics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      next(createError('Failed to retrieve job statistics', 500, 'JOB_STATS_RETRIEVAL_FAILED'));
    }
  }

  /**
   * Security monitoring endpoint (admin endpoint)
   * GET /api/v1/health/security
   * Requirements: 6.4
   */
  static async getSecurityStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      logger.debug('Getting security statistics', {
        requestId: res.locals.requestId,
      });

      const startTime = Date.now();

      // Get security event statistics
      const eventStats = securityService.getEventStatistics();

      // Get recent security events (last 100)
      const recentEvents = securityService.getRecentEvents(100);

      // Calculate security metrics
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const recentEventsLastHour = recentEvents.filter(event => event.timestamp >= oneHourAgo);
      const recentEventsLastDay = recentEvents.filter(event => event.timestamp >= oneDayAgo);

      const securityStats = {
        overview: {
          totalEvents: recentEvents.length,
          eventsLastHour: recentEventsLastHour.length,
          eventsLastDay: recentEventsLastDay.length,
          highSeverityEvents: recentEvents.filter(
            e => e.severity === 'HIGH' || e.severity === 'CRITICAL'
          ).length,
        },
        eventsByType: eventStats,
        recentEvents: recentEvents.slice(-20).map(event => ({
          type: event.type,
          severity: event.severity,
          source: event.source,
          description: event.description,
          timestamp: event.timestamp,
          ip: event.metadata.ip,
          path: event.metadata.path,
        })),
        trends: {
          suspiciousRequests: recentEventsLastDay.filter(e => e.type === 'SUSPICIOUS_REQUEST')
            .length,
          rateLimitViolations: recentEventsLastDay.filter(e => e.type === 'RATE_LIMIT_EXCEEDED')
            .length,
          corsViolations: recentEventsLastDay.filter(e => e.type === 'CORS_VIOLATION').length,
          injectionAttempts: recentEventsLastDay.filter(e => e.type === 'INJECTION_ATTEMPT').length,
        },
        timestamp: new Date().toISOString(),
        responseTime: Date.now() - startTime,
      };

      logger.info('Security statistics retrieved', {
        totalEvents: securityStats.overview.totalEvents,
        eventsLastHour: securityStats.overview.eventsLastHour,
        highSeverityEvents: securityStats.overview.highSeverityEvents,
        responseTime: securityStats.responseTime,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: securityStats,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to get security statistics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      next(
        createError(
          'Failed to retrieve security statistics',
          500,
          'SECURITY_STATS_RETRIEVAL_FAILED'
        )
      );
    }
  }

  /**
   * Detailed system metrics (admin endpoint)
   * GET /api/v1/health/metrics
   */
  static async getMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      logger.debug('Getting detailed system metrics', {
        requestId: res.locals.requestId,
      });

      const metrics = {
        process: {
          pid: process.pid,
          uptime: process.uptime(),
          version: process.version,
          platform: process.platform,
          arch: process.arch,
        },
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        system: {
          loadAverage: process.platform !== 'win32' ? require('os').loadavg() : [0, 0, 0],
          totalMemory: require('os').totalmem(),
          freeMemory: require('os').freemem(),
          cpus: require('os').cpus().length,
        },
        database: {
          connections: mongoose.connections.length,
          readyState: mongoose.connection.readyState,
        },
      };

      logger.info('System metrics retrieved', {
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          metrics,
          timestamp: new Date().toISOString(),
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to get system metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      next(createError('Failed to retrieve system metrics', 500, 'METRICS_RETRIEVAL_FAILED'));
    }
  }
}
