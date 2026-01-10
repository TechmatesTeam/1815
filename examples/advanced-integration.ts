/**
 * Advanced Integration Example
 *
 * This example demonstrates advanced features including:
 * - Custom middleware
 * - Direct service usage
 * - Feature toggles
 * - Custom error handling
 */

import express from 'express';
import { initialize1815Service } from '../src/lib';

async function main() {
  const app = express();
  app.use(express.json());

  // Custom authentication middleware
  const authMiddleware = (req: any, res: any, next: any) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };

  // Initialize service with advanced configuration
  const cardanoService = await initialize1815Service({
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/myapp',
      options: {
        maxPoolSize: 20,
        minPoolSize: 5,
        maxIdleTimeMS: 30000,
      },
    },
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      password: process.env.REDIS_PASSWORD,
      maxRetries: 5,
      retryDelay: 200,
    },
    blockfrost: {
      apiKey: process.env.BLOCKFROST_API_KEY || 'your-key',
      network: 'mainnet',
    },
    email: {
      provider: 'sendgrid',
      apiKey: process.env.SENDGRID_API_KEY,
      from: 'noreply@myapp.com',
      fromName: 'My App',
    },
    jwt: {
      secret: process.env.JWT_SECRET || 'your-secret',
      expiresIn: '30d',
    },
    aws: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      region: process.env.AWS_REGION || 'us-east-1',
      bucket: process.env.AWS_S3_BUCKET || 'my-qr-codes',
    },
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 200, // 200 requests per window
    },
    jobs: {
      enabled: true,
      cacheWarming: true,
      aliasExpiration: true,
      notifications: true,
    },
    features: {
      explorer: true,
      notifications: true,
      payments: true,
      qrCodes: true,
    },
    cors: {
      origin: ['https://myapp.com', 'https://admin.myapp.com'],
      credentials: true,
    },
  });

  // Public routes (no auth required)
  app.get('/', (req, res) => {
    res.json({
      name: 'My Advanced App',
      version: '2.0.0',
      services: {
        cardano: '/api/cardano',
        admin: '/api/admin',
      },
    });
  });

  // Protected Cardano routes
  app.use('/api/cardano', authMiddleware, cardanoService.router);

  // Custom admin routes using service components
  app.get('/api/admin/stats', authMiddleware, async (req, res) => {
    try {
      const { Alias, User } = cardanoService.models;

      const stats = {
        totalAliases: await Alias.countDocuments(),
        activeAliases: await Alias.countDocuments({ isActive: true }),
        totalUsers: await User.countDocuments(),
        expiringAliases: await Alias.countDocuments({
          expiresAt: { $lt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
          isActive: true,
        }),
      };

      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Bulk alias creation endpoint
  app.post('/api/admin/aliases/bulk', authMiddleware, async (req, res) => {
    try {
      const { aliases } = req.body;

      if (!Array.isArray(aliases)) {
        return res.status(400).json({ error: 'aliases must be an array' });
      }

      const results = await Promise.allSettled(
        aliases.map(({ cardanoAddress, customName }) =>
          cardanoService.services.aliasService.createAlias({
            cardanoAddress,
            customName,
          })
        )
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      res.json({
        message: 'Bulk creation completed',
        successful,
        failed,
        results: results.map((r, i) => ({
          index: i,
          status: r.status,
          data: r.status === 'fulfilled' ? r.value : null,
          error: r.status === 'rejected' ? r.reason.message : null,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Custom search endpoint with caching
  app.get('/api/search/:query', async (req, res) => {
    try {
      const { query } = req.params;
      const cacheKey = `search:${query}`;

      // Try to get from cache
      const cached = await cardanoService.services.cacheService.get(cacheKey);
      if (cached) {
        return res.json({
          source: 'cache',
          data: cached,
        });
      }

      // Search using the service
      const { Alias } = cardanoService.models;
      const results = await Alias.find({
        $or: [
          { shortCode: { $regex: query, $options: 'i' } },
          { customName: { $regex: query, $options: 'i' } },
          { cardanoAddress: { $regex: query, $options: 'i' } },
        ],
        isActive: true,
      }).limit(10);

      // Cache the results
      await cardanoService.services.cacheService.set(cacheKey, results, 300); // 5 minutes

      res.json({
        source: 'database',
        data: results,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Webhook endpoint for Blockfrost events
  app.post(
    '/api/webhooks/blockfrost',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      try {
        // Verify webhook signature (implement your verification logic)
        const signature = req.headers['blockfrost-signature'];

        // Process the webhook
        const event = JSON.parse(req.body.toString());

        console.log('Received Blockfrost webhook:', event);

        // You can use the explorer service to process the event
        if (event.type === 'transaction') {
          const txDetails = await cardanoService.services.explorerService.getTransactionDetails(
            event.data.hash
          );
          console.log('Transaction details:', txDetails);
        }

        res.json({ received: true });
      } catch (error: any) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Health check with detailed status
  app.get('/health', async (req, res) => {
    const mongoStatus =
      cardanoService.connections.mongodb?.readyState === 1 ? 'connected' : 'disconnected';
    const redisStatus = cardanoService.connections.redis?.isOpen ? 'connected' : 'disconnected';

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        mongodb: mongoStatus,
        redis: redisStatus,
        cardano: 'operational',
      },
    });
  });

  // Start server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Advanced server running on http://localhost:${PORT}`);
    console.log(`📊 Cardano API: http://localhost:${PORT}/api/cardano`);
    console.log(`🔧 Admin API: http://localhost:${PORT}/api/admin`);
    console.log(`🏥 Health: http://localhost:${PORT}/health`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down gracefully...');
    await cardanoService.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(console.error);
