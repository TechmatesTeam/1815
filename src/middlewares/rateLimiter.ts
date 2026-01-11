import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { Request } from 'express';
import { getRedisClient } from '@/config/redis';
import { config } from '@/config/environment';
import { logger } from '@/utils/logger';
import { securityService } from '@/services/securityService';

// Create Redis store for rate limiting
const createRedisStore = () => {
  try {
    const redisClient = getRedisClient();
    return new RedisStore({
      sendCommand: (...args: string[]) => redisClient.sendCommand(args),
    });
  } catch (error) {
    logger.warn('Failed to create Redis store for rate limiting, falling back to memory store', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return undefined; // Fall back to memory store
  }
};

export const rateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs, // 15 minutes
  max: config.rateLimit.max, // 100 requests per windowMs
  store: createRedisStore(),
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again later.',
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: 'rate-limit',
      version: process.env.npm_package_version || '1.0.0',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Use IP address as the key with proper prefix
    return `rate_limit:${req.ip}`;
  },
  handler: (req, res) => {
    // Log rate limit violation using SecurityService
    const requestId = res.locals.requestId || 'rate-limit';
    securityService.logRateLimitViolation(req, requestId);

    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url,
      method: req.method,
      windowMs: config.rateLimit.windowMs,
      maxRequests: config.rateLimit.max,
    });

    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this IP, please try again later.',
        details: {
          windowMs: config.rateLimit.windowMs,
          maxRequests: config.rateLimit.max,
        },
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: requestId,
        version: process.env.npm_package_version || '1.0.0',
      },
    });
  },
  skip: req => {
    // Skip rate limiting for health checks
    return req.path === '/api/v1/health';
  },
});
