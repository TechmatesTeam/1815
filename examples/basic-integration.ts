/**
 * Basic Integration Example
 *
 * This example shows the minimal setup required to integrate
 * the 1815 Cardano service into your Express application.
 */

import express from 'express';
import { initialize1815Service } from '../src/lib';

async function main() {
  const app = express();

  // Basic Express middleware
  app.use(express.json());

  // Your existing routes
  app.get('/', (req, res) => {
    res.json({
      message: 'Welcome to My App',
      cardanoService: 'Available at /cardano',
    });
  });

  // Initialize the 1815 Cardano service
  const cardanoService = await initialize1815Service({
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/myapp',
    },
    blockfrost: {
      apiKey: process.env.BLOCKFROST_API_KEY || 'your-blockfrost-api-key',
      network: 'mainnet',
    },
    // Optional: Email notifications
    email: {
      provider: 'sendgrid',
      apiKey: process.env.SENDGRID_API_KEY,
      from: 'noreply@myapp.com',
    },
  });

  // Mount the Cardano service routes
  app.use('/cardano', cardanoService.router);

  // Start the server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Cardano service available at http://localhost:${PORT}/cardano`);
    console.log(`🏥 Health check: http://localhost:${PORT}/cardano/health`);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Shutting down gracefully...');
    await cardanoService.shutdown();
    process.exit(0);
  });
}

main().catch(console.error);
