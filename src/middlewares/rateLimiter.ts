import rateLimit from 'express-rate-limit';
import { Request } from 'express';
import { getRedisClient } from '@/config/redis';
import { config } from '@/config/environment';
import { logger } from '@/utils/logger';

export const rateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
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
    // Use IP address as the key
    return `rate_limit:${req.ip}`;
  },
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url,
      method: req.method,
    });

    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this IP, please try again later.',
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: res.locals.requestId || 'rate-limit',
        version: process.env.npm_package_version || '1.0.0',
      },
    });
  },
});
