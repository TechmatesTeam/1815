/**
 * Standalone Server Entry Point
 *
 * This file provides a standalone server implementation for users who
 * prefer to run 1815 as a separate service rather than integrating it
 * as a library into their application.
 *
 * For library usage, see src/lib/index.ts
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { initialize1815Service } from './lib';
import { logger } from './utils/logger';
import { requestLogger } from './middlewares/requestLogger';
import { errorHandler } from './middlewares/errorHandler';

async function startStandaloneServer() {
  try {
    const app = express();

    // Security middleware
    app.use(helmet());

    // CORS configuration
    const corsOrigin = process.env.CORS_ORIGIN?.split(',') || '*';
    app.use(
      cors({
        origin: corsOrigin,
        credentials: true,
      })
    );

    // Body parsing
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    app.use(requestLogger);

    // Root endpoint
    app.get('/', (req, res) => {
      res.json({
        name: '1815 Cardano Service',
        version: process.env.npm_package_version || '2.0.0',
        status: 'operational',
        mode: 'standalone',
        endpoints: {
          health: '/health',
          api: '/api/v1',
          docs: '/api/v1/docs',
        },
        timestamp: new Date().toISOString(),
      });
    });

    // Health check (before service initialization)
    app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.env.npm_package_version || '2.0.0',
      });
    });

    logger.info('🚀 Starting 1815 Cardano Service in standalone mode...');

    // Validate required environment variables
    const requiredEnvVars = ['BLOCKFROST_API_KEY'];
    const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);

    if (missingEnvVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
    }

    // Initialize the 1815 service
    const service = await initialize1815Service({
      mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/1815_prod',
      },
      redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        password: process.env.REDIS_PASSWORD,
      },
      blockfrost: {
        apiKey: process.env.BLOCKFROST_API_KEY!,
        network: (process.env.BLOCKFROST_NETWORK as any) || 'mainnet',
      },
      email: process.env.SENDGRID_API_KEY
        ? {
            provider: 'sendgrid',
            apiKey: process.env.SENDGRID_API_KEY,
            from: process.env.SENDGRID_FROM_EMAIL || 'noreply@1815.dev',
            fromName: process.env.SENDGRID_FROM_NAME || '1815',
          }
        : undefined,
      jwt: {
        secret: process.env.JWT_SECRET || 'change-me-in-production',
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      },
      aws: process.env.AWS_ACCESS_KEY_ID
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            region: process.env.AWS_REGION || 'us-east-1',
            bucket: process.env.AWS_S3_BUCKET || '1815-qr-codes',
          }
        : undefined,
      rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
        max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
      },
      jobs: {
        enabled: process.env.JOBS_ENABLED !== 'false',
        cacheWarming: process.env.CACHE_WARMING_ENABLED !== 'false',
        aliasExpiration: process.env.ALIAS_EXPIRATION_ENABLED !== 'false',
        notifications: process.env.NOTIFICATIONS_ENABLED !== 'false',
      },
      features: {
        explorer: process.env.FEATURE_EXPLORER !== 'false',
        notifications: process.env.FEATURE_NOTIFICATIONS !== 'false',
        payments: process.env.FEATURE_PAYMENTS !== 'false',
        qrCodes: process.env.FEATURE_QR_CODES !== 'false',
      },
    });

    // Mount service routes at /api/v1
    app.use('/api/v1', service.router);

    // Error handling
    app.use(errorHandler);

    // 404 handler
    app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Endpoint not found',
          path: req.originalUrl,
        },
        timestamp: new Date().toISOString(),
      });
    });

    // Start server
    const PORT = parseInt(process.env.PORT || '3000');
    const HOST = process.env.HOST || '0.0.0.0';

    app.listen(PORT, HOST, () => {
      logger.info('✅ Server started successfully');
      logger.info(`🌐 Server: http://${HOST}:${PORT}`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔗 API: http://${HOST}:${PORT}/api/v1`);
      logger.info(`🏥 Health: http://${HOST}:${PORT}/health`);
      logger.info(`📚 Mode: Standalone`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`);

      try {
        await service.shutdown();
        logger.info('✅ Service shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', error => {
      logger.error('Uncaught exception:', error);
      shutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      shutdown('UNHANDLED_REJECTION');
    });
  } catch (error) {
    logger.error('Failed to start standalone server:', error);
    process.exit(1);
  }
}

// Start the server
startStandaloneServer();
