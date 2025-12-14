import { createClient, RedisClientOptions } from 'redis';
import { config } from './environment';
import { logger } from '@/utils/logger';

let redisClient: any;
let isConnecting = false;
let connectionRetries = 0;
const maxRetries = 5;
const retryDelay = 2000; // 2 seconds

export async function connectRedis(): Promise<void> {
  if (isConnecting) {
    logger.info('Redis connection already in progress...');
    return;
  }

  if (redisClient?.isReady) {
    logger.info('Redis already connected');
    return;
  }

  isConnecting = true;

  try {
    const redisOptions: RedisClientOptions = {
      url: config.redis.url,
      socket: {
        connectTimeout: 10000, // 10 seconds
        reconnectStrategy: retries => {
          if (retries > maxRetries) {
            logger.error(`Redis max retries (${maxRetries}) exceeded`);
            return false;
          }
          const delay = Math.min(retryDelay * Math.pow(2, retries), 30000); // Exponential backoff, max 30s
          logger.info(`Redis reconnecting in ${delay}ms (attempt ${retries + 1})`);
          return delay;
        },
      },
    };

    redisClient = createClient(redisOptions);

    // Event handlers
    redisClient.on('error', (error: any) => {
      logger.error('Redis connection error:', error);
      connectionRetries++;
    });

    redisClient.on('connect', () => {
      logger.info('✅ Connected to Redis');
      connectionRetries = 0;
    });

    redisClient.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });

    redisClient.on('ready', () => {
      logger.info('Redis ready for commands');
      isConnecting = false;
    });

    redisClient.on('end', () => {
      logger.info('Redis connection ended');
    });

    await redisClient.connect();
  } catch (error) {
    isConnecting = false;
    logger.error('Failed to connect to Redis:', error);
    throw error;
  }
}

export function getRedisClient(): any {
  if (!redisClient) {
    throw new Error('Redis client not initialized. Call connectRedis() first.');
  }
  return redisClient;
}

export async function disconnectRedis(): Promise<void> {
  try {
    if (redisClient) {
      await redisClient.quit();
      logger.info('Disconnected from Redis');
    }
  } catch (error) {
    logger.error('Error disconnecting from Redis:', error);
    throw error;
  }
}

/**
 * Check Redis connection health
 */
export async function checkRedisHealth(): Promise<{
  status: 'healthy' | 'unhealthy';
  latency?: number;
  error?: string;
}> {
  try {
    if (!redisClient || !redisClient.isReady) {
      return { status: 'unhealthy', error: 'Redis client not ready' };
    }

    const start = Date.now();
    await redisClient.ping();
    const latency = Date.now() - start;

    return { status: 'healthy', latency };
  } catch (error) {
    logger.error('Redis health check failed:', error);
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get Redis connection info
 */
export async function getRedisInfo(): Promise<{
  connected: boolean;
  ready: boolean;
  retries: number;
}> {
  return {
    connected: redisClient?.isOpen || false,
    ready: redisClient?.isReady || false,
    retries: connectionRetries,
  };
}
