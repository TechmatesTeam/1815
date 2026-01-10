/**
 * Existing Application Integration Example
 *
 * This example shows how to integrate the 1815 service into
 * an existing application that already has MongoDB and Redis connections.
 */

import express from 'express';
import mongoose from 'mongoose';
import { createClient } from 'redis';
import { initialize1815Service } from '../src/lib';

async function main() {
  const app = express();
  app.use(express.json());

  // Your existing MongoDB connection
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/myapp');
  console.log('✅ MongoDB connected');

  // Your existing Redis connection
  console.log('Connecting to Redis...');
  const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  });
  await redisClient.connect();
  console.log('✅ Redis connected');

  // Your existing models
  const UserSchema = new mongoose.Schema({
    name: String,
    email: String,
  });
  const User = mongoose.model('User', UserSchema);

  // Your existing routes
  app.get('/', (req, res) => {
    res.json({ message: 'My Existing App' });
  });

  app.get('/api/users', async (req, res) => {
    const users = await User.find();
    res.json(users);
  });

  // Initialize 1815 service with existing connections
  const cardanoService = await initialize1815Service({
    mongodb: {
      connection: mongoose.connection, // Reuse existing connection
    },
    redis: {
      client: redisClient, // Reuse existing connection
    },
    blockfrost: {
      apiKey: process.env.BLOCKFROST_API_KEY || 'your-key',
      network: 'mainnet',
    },
    email: {
      provider: 'sendgrid',
      apiKey: process.env.SENDGRID_API_KEY,
      from: 'noreply@myapp.com',
    },
    jobs: {
      enabled: true,
      cacheWarming: true,
      aliasExpiration: true,
      notifications: true,
    },
  });

  // Mount Cardano service
  app.use('/api/cardano', cardanoService.router);

  // You can also use the service components directly
  app.post('/api/users/:userId/cardano-alias', async (req, res) => {
    try {
      const { userId } = req.params;
      const { cardanoAddress, customName } = req.body;

      // Use your existing User model
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Use the Cardano service to create an alias
      const alias = await cardanoService.services.aliasService.createAlias({
        cardanoAddress,
        customName,
        userId,
      });

      res.json({
        message: 'Alias created for user',
        user,
        alias,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Start server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Your API: http://localhost:${PORT}/api`);
    console.log(`🔗 Cardano API: http://localhost:${PORT}/api/cardano`);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await cardanoService.shutdown();
    await redisClient.quit();
    await mongoose.connection.close();
    process.exit(0);
  });
}

main().catch(console.error);
