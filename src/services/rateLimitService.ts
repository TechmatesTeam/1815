import { Request } from 'express';
import { cacheService, CacheKeys, CacheTTL } from './cacheService';
import { logger } from '@/utils/logger';
import { config } from '@/config/environment';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  total: number;
}

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export class RateLimitService {
  private defaultOptions: Required<Omit<RateLimitOptions, 'keyGenerator'>> & {
    keyGenerator: (req: Request) => string;
  };

  constructor() {
    this.defaultOptions = {
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      keyGenerator: (req: Request) => this.getClientIP(req),
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
    };
  }

  /**
   * Extract client IP address from request
   */
  private getClientIP(req: Request): string {
    return (
      req.ip ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      (req.connection as any)?.socket?.remoteAddress ||
      'unknown'
    );
  }

  /**
   * Check if request is within rate limit
   */
  async checkRateLimit(req: Request, options: RateLimitOptions = {}): Promise<RateLimitResult> {
    const opts = { ...this.defaultOptions, ...options };
    const key = opts.keyGenerator(req);
    const windowMs = opts.windowMs;
    const maxRequests = opts.max;

    try {
      // Create rate limit key with timestamp window
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
      const rateLimitKey = `${key}:${windowStart}`;

      // Get current count
      const currentCount =
        (await cacheService.get<number>(rateLimitKey, {
          prefix: CacheKeys.RATE_LIMIT,
        })) || 0;

      const remaining = Math.max(0, maxRequests - currentCount - 1);
      const resetTime = windowStart + windowMs;

      if (currentCount >= maxRequests) {
        logger.warn(`Rate limit exceeded for ${key}: ${currentCount}/${maxRequests}`);
        return {
          allowed: false,
          remaining: 0,
          resetTime,
          total: maxRequests,
        };
      }

      // Increment counter
      await cacheService.increment(rateLimitKey, {
        prefix: CacheKeys.RATE_LIMIT,
        ttl: Math.ceil(windowMs / 1000), // Convert to seconds
      });

      return {
        allowed: true,
        remaining,
        resetTime,
        total: maxRequests,
      };
    } catch (error) {
      logger.error('Rate limit check error:', error);
      // On error, allow the request (fail open)
      return {
        allowed: true,
        remaining: opts.max - 1,
        resetTime: Date.now() + opts.windowMs,
        total: opts.max,
      };
    }
  }

  /**
   * Reset rate limit for a specific key
   */
  async resetRateLimit(req: Request, options: RateLimitOptions = {}): Promise<boolean> {
    const opts = { ...this.defaultOptions, ...options };
    const key = opts.keyGenerator(req);

    try {
      // Clear all rate limit entries for this key
      const cleared = await cacheService.clearByPrefix(`${CacheKeys.RATE_LIMIT}:${key}`);
      logger.info(`Reset rate limit for ${key}: ${cleared} entries cleared`);
      return cleared > 0;
    } catch (error) {
      logger.error('Rate limit reset error:', error);
      return false;
    }
  }

  /**
   * Get current rate limit status
   */
  async getRateLimitStatus(req: Request, options: RateLimitOptions = {}): Promise<RateLimitResult> {
    const opts = { ...this.defaultOptions, ...options };
    const key = opts.keyGenerator(req);
    const windowMs = opts.windowMs;
    const maxRequests = opts.max;

    try {
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
      const rateLimitKey = `${key}:${windowStart}`;

      const currentCount =
        (await cacheService.get<number>(rateLimitKey, {
          prefix: CacheKeys.RATE_LIMIT,
        })) || 0;

      const remaining = Math.max(0, maxRequests - currentCount);
      const resetTime = windowStart + windowMs;

      return {
        allowed: currentCount < maxRequests,
        remaining,
        resetTime,
        total: maxRequests,
      };
    } catch (error) {
      logger.error('Rate limit status error:', error);
      return {
        allowed: true,
        remaining: opts.max,
        resetTime: Date.now() + opts.windowMs,
        total: opts.max,
      };
    }
  }

  /**
   * Create rate limit middleware
   */
  createMiddleware(options: RateLimitOptions = {}) {
    return async (req: Request, res: any, next: any) => {
      try {
        const result = await this.checkRateLimit(req, options);

        // Set rate limit headers
        res.set({
          'X-RateLimit-Limit': result.total.toString(),
          'X-RateLimit-Remaining': result.remaining.toString(),
          'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
        });

        if (!result.allowed) {
          return res.status(429).json({
            success: false,
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Too many requests, please try again later',
              details: {
                limit: result.total,
                remaining: result.remaining,
                resetTime: result.resetTime,
              },
            },
            metadata: {
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
              version: '1.0.0',
            },
          });
        }

        next();
      } catch (error) {
        logger.error('Rate limit middleware error:', error);
        // On error, allow the request to proceed
        next();
      }
    };
  }
}

// Create singleton instance
export const rateLimitService = new RateLimitService();
