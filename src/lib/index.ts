/**
 * 1815 Cardano Service - Standalone Library
 *
 * A reusable service for Cardano address aliasing and blockchain exploration
 * that can be integrated into any Node.js/Express application.
 */

import { Router } from 'express';
import mongoose from 'mongoose';
import { RedisClientType } from 'redis';
import { logger } from '@/utils/logger';
import { connectDatabase } from '@/config/database';
import { connectRedis, getRedisClient } from '@/config/redis';
import { apiRoutes } from '@/routes';
import {
  scheduleAliasExpirationJob,
  registerAliasExpirationProcessor,
} from '@/jobs/aliasExpirationJob';
import { cacheWarmingJob } from '@/jobs/cacheWarmingJob';
import { scheduleExpiryWarningJob, registerNotificationProcessors } from '@/jobs/notificationJob';

// Export models
export * from '@/models';

// Export services
export { aliasService } from '@/services/aliasService';
export { explorerService } from '@/services/explorerService';
export { notificationService } from '@/services/notificationService';
export { cacheService } from '@/services/cacheService';
export { emailService } from '@/services/emailService';

// Export middlewares
export { rateLimiter } from '@/middlewares/rateLimiter';
export { errorHandler } from '@/middlewares/errorHandler';
export { requestLogger } from '@/middlewares/requestLogger';
export { compressionMiddleware } from '@/middlewares/compression';

// Export utilities
export { logger } from '@/utils/logger';
export { isValidCardanoAddress } from '@/utils/cardanoValidation';

/**
 * Configuration interface for the 1815 service
 */
export interface ServiceConfig {
  mongodb: {
    uri?: string;
    connection?: mongoose.Connection;
    options?: {
      maxPoolSize?: number;
      minPoolSize?: number;
      maxIdleTimeMS?: number;
      serverSelectionTimeoutMS?: number;
    };
  };
  redis?: {
    url?: string;
    client?: RedisClientType;
    password?: string;
    maxRetries?: number;
    retryDelay?: number;
  };
  blockfrost: {
    apiKey: string;
    network: 'mainnet' | 'testnet' | 'preprod' | 'preview';
    baseUrl?: string;
  };
  email?: {
    provider: 'sendgrid' | 'smtp' | 'mailhog';
    apiKey?: string;
    smtp?: {
      host: string;
      port: number;
      user?: string;
      pass?: string;
    };
    from: string;
    fromName?: string;
  };
  jwt?: {
    secret: string;
    expiresIn?: string;
  };
  aws?: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    bucket: string;
  };
  rateLimit?: {
    windowMs?: number;
    max?: number;
  };
  jobs?: {
    enabled?: boolean;
    cacheWarming?: boolean;
    aliasExpiration?: boolean;
    notifications?: boolean;
  };
  routePrefix?: string;
  features?: {
    explorer?: boolean;
    notifications?: boolean;
    payments?: boolean;
    qrCodes?: boolean;
  };
  cors?: {
    origin?: string | string[];
    credentials?: boolean;
  };
}

/**
 * Service instance returned by initialize1815Service
 */
export interface Service1815 {
  router: Router;
  models: typeof import('@/models');
  services: {
    aliasService: typeof import('@/services/aliasService').aliasService;
    explorerService: typeof import('@/services/explorerService').explorerService;
    notificationService: typeof import('@/services/notificationService').notificationService;
    cacheService: typeof import('@/services/cacheService').cacheService;
  };
  connections: {
    mongodb?: mongoose.Connection;
    redis?: RedisClientType;
  };
  stopJobs: () => Promise<void>;
  shutdown: () => Promise<void>;
}

/**
 * Initialize the 1815 Cardano service
 *
 * @param config - Service configuration
 * @returns Service instance with router and utilities
 *
 * @example
 * ```typescript
 * const service = await initialize1815Service({
 *   mongodb: { uri: 'mongodb://localhost:27017/myapp' },
 *   blockfrost: { apiKey: 'your-key', network: 'mainnet' }
 * });
 *
 * app.use('/cardano', service.router);
 * ```
 */
export async function initialize1815Service(config: ServiceConfig): Promise<Service1815> {
  logger.info('🚀 Initializing 1815 Cardano Service...');

  // Set environment variables from config
  if (config.blockfrost) {
    process.env.BLOCKFROST_API_KEY = config.blockfrost.apiKey;
    process.env.BLOCKFROST_NETWORK = config.blockfrost.network;
    if (config.blockfrost.baseUrl) {
      process.env.BLOCKFROST_BASE_URL = config.blockfrost.baseUrl;
    }
  }

  if (config.jwt) {
    process.env.JWT_SECRET = config.jwt.secret;
    if (config.jwt.expiresIn) {
      process.env.JWT_EXPIRES_IN = config.jwt.expiresIn;
    }
  }

  if (config.email) {
    if (config.email.provider === 'sendgrid' && config.email.apiKey) {
      process.env.SENDGRID_API_KEY = config.email.apiKey;
    }
    process.env.SENDGRID_FROM_EMAIL = config.email.from;
    if (config.email.fromName) {
      process.env.SENDGRID_FROM_NAME = config.email.fromName;
    }
    if (config.email.provider === 'mailhog') {
      process.env.USE_MAILHOG = 'true';
    }
  }

  if (config.aws) {
    process.env.AWS_ACCESS_KEY_ID = config.aws.accessKeyId;
    process.env.AWS_SECRET_ACCESS_KEY = config.aws.secretAccessKey;
    process.env.AWS_REGION = config.aws.region;
    process.env.AWS_S3_BUCKET = config.aws.bucket;
  }

  if (config.rateLimit) {
    if (config.rateLimit.windowMs) {
      process.env.RATE_LIMIT_WINDOW_MS = config.rateLimit.windowMs.toString();
    }
    if (config.rateLimit.max) {
      process.env.RATE_LIMIT_MAX = config.rateLimit.max.toString();
    }
  }

  if (config.cors) {
    if (config.cors.origin) {
      process.env.CORS_ORIGIN = Array.isArray(config.cors.origin)
        ? config.cors.origin.join(',')
        : config.cors.origin;
    }
  }

  // Initialize MongoDB
  let mongoConnection: mongoose.Connection | undefined;
  try {
    if (config.mongodb.connection) {
      mongoConnection = config.mongodb.connection;
      logger.info('✅ Using existing MongoDB connection');
    } else if (config.mongodb.uri) {
      process.env.MONGODB_URI = config.mongodb.uri;
      if (config.mongodb.options) {
        if (config.mongodb.options.maxPoolSize) {
          process.env.MONGODB_MAX_POOL_SIZE = config.mongodb.options.maxPoolSize.toString();
        }
        if (config.mongodb.options.minPoolSize) {
          process.env.MONGODB_MIN_POOL_SIZE = config.mongodb.options.minPoolSize.toString();
        }
      }
      await connectDatabase();
      mongoConnection = mongoose.connection;
      logger.info('✅ MongoDB connected');
    } else {
      throw new Error('MongoDB configuration required: provide either uri or connection');
    }
  } catch (error) {
    logger.error('❌ MongoDB connection failed:', error);
    throw error;
  }

  // Initialize Redis (optional)
  let redisClient: RedisClientType | undefined;
  try {
    if (config.redis?.client) {
      redisClient = config.redis.client;
      logger.info('✅ Using existing Redis connection');
    } else if (config.redis?.url) {
      process.env.REDIS_URL = config.redis.url;
      if (config.redis.password) {
        process.env.REDIS_PASSWORD = config.redis.password;
      }
      await connectRedis();
      redisClient = getRedisClient();
      logger.info('✅ Redis connected');
    } else {
      logger.warn('⚠️  Redis not configured, caching and rate limiting will be limited');
    }
  } catch (error) {
    logger.warn('⚠️  Redis connection failed, running without cache:', error);
  }

  // Start background jobs if enabled
  const jobsEnabled = config.jobs?.enabled !== false;
  if (jobsEnabled) {
    // Register job processors
    if (config.jobs?.cacheWarming !== false && redisClient) {
      cacheWarmingJob.start(60); // Run every 60 minutes
      logger.info('✅ Cache warming job started');
    }
    if (config.jobs?.aliasExpiration !== false) {
      registerAliasExpirationProcessor();
      await scheduleAliasExpirationJob();
      logger.info('✅ Alias expiration job scheduled');
    }
    if (config.jobs?.notifications !== false) {
      registerNotificationProcessors();
      await scheduleExpiryWarningJob();
      logger.info('✅ Notification job scheduled');
    }
  }

  // Create router
  const router = Router();
  router.use(apiRoutes);

  // Import models and services
  const models = await import('@/models');
  const { aliasService } = await import('@/services/aliasService');
  const { explorerService } = await import('@/services/explorerService');
  const { notificationService } = await import('@/services/notificationService');
  const { cacheService } = await import('@/services/cacheService');

  logger.info('✅ 1815 Cardano Service initialized successfully');

  return {
    router,
    models,
    services: {
      aliasService,
      explorerService,
      notificationService,
      cacheService,
    },
    connections: {
      mongodb: mongoConnection,
      redis: redisClient,
    },
    stopJobs: async () => {
      cacheWarmingJob.stop();
      const { queueService } = await import('@/services/queueService');
      await queueService.closeAll();
      logger.info('🛑 Background jobs stopped');
    },
    shutdown: async () => {
      logger.info('🛑 Shutting down 1815 service...');

      // Stop all jobs
      cacheWarmingJob.stop();
      const { queueService } = await import('@/services/queueService');
      await queueService.closeAll();

      if (redisClient && !config.redis?.client) {
        await redisClient.quit();
        logger.info('✅ Redis disconnected');
      }

      if (mongoConnection && !config.mongodb.connection) {
        await mongoConnection.close();
        logger.info('✅ MongoDB disconnected');
      }

      logger.info('✅ 1815 service shutdown complete');
    },
  };
}

/**
 * Create a test instance of the service with in-memory databases
 * Useful for testing integrations
 */
export async function createTestService(config?: Partial<ServiceConfig>): Promise<Service1815> {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const { RedisMemoryServer } = await import('redis-memory-server');

  const mongoServer = await MongoMemoryServer.create();
  const redisServer = await RedisMemoryServer.create();

  return initialize1815Service({
    mongodb: {
      uri: mongoServer.getUri(),
    },
    redis: {
      url: `redis://localhost:${await redisServer.getPort()}`,
    },
    blockfrost: {
      apiKey: config?.blockfrost?.apiKey || 'test-key',
      network: config?.blockfrost?.network || 'testnet',
    },
    ...config,
  });
}
