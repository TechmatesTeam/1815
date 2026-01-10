# 1815 Service Integration Guide

A standalone Cardano address shortener and blockchain explorer service that can be integrated into any Node.js/Express application.

## Overview

The 1815 service provides:

- Cardano address aliasing (short codes for long addresses)
- Blockchain explorer functionality via Blockfrost
- Email notifications for alias expiry
- Rate limiting and caching
- Background job processing

## Installation

```bash
npm install @1815/cardano-service
```

Or if using this as a local package:

```bash
npm install /path/to/1815-service
```

## Quick Start

### 1. Basic Integration

```typescript
import express from 'express';
import { initialize1815Service } from '@1815/cardano-service';

const app = express();

// Initialize the service with your configuration
const service = await initialize1815Service({
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/myapp',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  blockfrost: {
    apiKey: process.env.BLOCKFROST_API_KEY,
    network: 'mainnet',
  },
  email: {
    provider: 'sendgrid',
    apiKey: process.env.SENDGRID_API_KEY,
    from: 'noreply@myapp.com',
  },
});

// Mount the service routes
app.use('/cardano', service.router);

// Start your server
app.listen(3000);
```

### 2. With Existing Docker Compose

If you already have a `docker-compose.yml`, just add MongoDB and Redis if you don't have them:

```yaml
services:
  # Your existing services...

  mongodb:
    image: mongo:7.0
    ports:
      - '27017:27017'
    volumes:
      - mongodb_data:/data/db

  redis:
    image: redis:7.2-alpine
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data

volumes:
  mongodb_data:
  redis_data:
```

### 3. Using Existing Database Connections

If you already have MongoDB and Redis connections:

```typescript
import { initialize1815Service } from '@1815/cardano-service';
import mongoose from 'mongoose';
import { createClient } from 'redis';

// Your existing connections
const mongoConnection = mongoose.connection;
const redisClient = createClient({ url: 'redis://localhost:6379' });
await redisClient.connect();

// Pass existing connections
const service = await initialize1815Service({
  mongodb: {
    connection: mongoConnection,
  },
  redis: {
    client: redisClient,
  },
  blockfrost: {
    apiKey: process.env.BLOCKFROST_API_KEY,
    network: 'mainnet',
  },
});

app.use('/cardano', service.router);
```

## Configuration Options

### Full Configuration

```typescript
interface ServiceConfig {
  // MongoDB - provide either uri or existing connection
  mongodb: {
    uri?: string;
    connection?: mongoose.Connection;
    options?: {
      maxPoolSize?: number;
      minPoolSize?: number;
    };
  };

  // Redis - provide either url or existing client
  redis: {
    url?: string;
    client?: RedisClient;
    password?: string;
  };

  // Blockfrost API for Cardano blockchain data
  blockfrost: {
    apiKey: string;
    network: 'mainnet' | 'testnet' | 'preprod' | 'preview';
    baseUrl?: string; // Optional custom endpoint
  };

  // Email configuration (optional)
  email?: {
    provider: 'sendgrid' | 'smtp' | 'mailhog';
    apiKey?: string; // For SendGrid
    smtp?: {
      host: string;
      port: number;
      user?: string;
      pass?: string;
    };
    from: string;
    fromName?: string;
  };

  // JWT for authentication (optional)
  jwt?: {
    secret: string;
    expiresIn?: string;
  };

  // AWS S3 for QR codes (optional)
  aws?: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    bucket: string;
  };

  // Rate limiting (optional)
  rateLimit?: {
    windowMs?: number;
    max?: number;
  };

  // Background jobs (optional)
  jobs?: {
    enabled?: boolean;
    cacheWarming?: boolean;
    aliasExpiration?: boolean;
    notifications?: boolean;
  };

  // Custom route prefix (default: '/')
  routePrefix?: string;

  // Enable/disable features
  features?: {
    explorer?: boolean;
    notifications?: boolean;
    payments?: boolean;
    qrCodes?: boolean;
  };
}
```

### Minimal Configuration

```typescript
// Minimum required configuration
const service = await initialize1815Service({
  mongodb: {
    uri: 'mongodb://localhost:27017/myapp',
  },
  blockfrost: {
    apiKey: 'your-blockfrost-key',
    network: 'mainnet',
  },
});
```

## API Endpoints

Once integrated, the service exposes these endpoints:

### Aliases

- `POST /aliases` - Create new alias
- `GET /aliases/:code` - Get alias details
- `DELETE /aliases/:code` - Delete alias
- `GET /resolve/:query` - Resolve alias or search

### Explorer (if enabled)

- `GET /explorer/address/:address` - Get address details
- `GET /explorer/transaction/:hash` - Get transaction details
- `GET /explorer/block/:id` - Get block details

### Notifications (if enabled)

- `POST /notifications/subscribe` - Subscribe to notifications
- `PUT /notifications/preferences` - Update preferences

### Health

- `GET /health` - Service health check

## Advanced Usage

### Custom Middleware

```typescript
const service = await initialize1815Service(config);

// Add custom middleware before service routes
app.use('/cardano', yourAuthMiddleware);
app.use('/cardano', service.router);
```

### Access Service Components

```typescript
const service = await initialize1815Service(config);

// Access models
const { Alias, User } = service.models;

// Access services
const { aliasService, explorerService } = service.services;

// Use services in your own routes
app.get('/my-custom-route', async (req, res) => {
  const alias = await aliasService.createAlias({
    cardanoAddress: 'addr1...',
    customName: 'My Wallet',
  });
  res.json(alias);
});
```

### Background Jobs

```typescript
const service = await initialize1815Service({
  ...config,
  jobs: {
    enabled: true,
    cacheWarming: true,
    aliasExpiration: true,
    notifications: true,
  },
});

// Jobs start automatically
// Stop jobs when shutting down
process.on('SIGTERM', () => {
  service.stopJobs();
});
```

### Graceful Shutdown

```typescript
const service = await initialize1815Service(config);

process.on('SIGTERM', async () => {
  await service.shutdown();
  process.exit(0);
});
```

## Environment Variables

The service can read from environment variables if you don't provide configuration:

```bash
# MongoDB
MONGODB_URI=mongodb://localhost:27017/myapp

# Redis
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=optional_password

# Blockfrost
BLOCKFROST_API_KEY=your_key
BLOCKFROST_NETWORK=mainnet

# Email (optional)
SENDGRID_API_KEY=your_key
SENDGRID_FROM_EMAIL=noreply@myapp.com

# JWT (optional)
JWT_SECRET=your_secret

# AWS (optional)
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1
AWS_S3_BUCKET=your_bucket
```

## Examples

### Example 1: Minimal Integration

```typescript
import express from 'express';
import { initialize1815Service } from '@1815/cardano-service';

const app = express();
app.use(express.json());

const service = await initialize1815Service({
  mongodb: { uri: 'mongodb://localhost:27017/myapp' },
  blockfrost: { apiKey: 'your-key', network: 'mainnet' },
});

app.use('/cardano', service.router);
app.listen(3000);
```

### Example 2: Full Integration with Existing App

```typescript
import express from 'express';
import mongoose from 'mongoose';
import { initialize1815Service } from '@1815/cardano-service';

const app = express();
app.use(express.json());

// Your existing routes
app.get('/', (req, res) => res.json({ message: 'My App' }));

// Connect to your database
await mongoose.connect('mongodb://localhost:27017/myapp');

// Initialize 1815 service with existing connection
const service = await initialize1815Service({
  mongodb: { connection: mongoose.connection },
  redis: { url: 'redis://localhost:6379' },
  blockfrost: { apiKey: process.env.BLOCKFROST_API_KEY, network: 'mainnet' },
  email: {
    provider: 'sendgrid',
    apiKey: process.env.SENDGRID_API_KEY,
    from: 'noreply@myapp.com',
  },
  routePrefix: '/api/cardano',
});

// Mount service routes
app.use('/api/cardano', service.router);

// Your other routes
app.get('/api/users', (req, res) => {
  // Your user logic
});

app.listen(3000);
```

### Example 3: Microservice Architecture

```typescript
// cardano-service.ts
import { initialize1815Service } from '@1815/cardano-service';

export async function startCardanoService() {
  const service = await initialize1815Service({
    mongodb: { uri: process.env.MONGODB_URI },
    redis: { url: process.env.REDIS_URL },
    blockfrost: {
      apiKey: process.env.BLOCKFROST_API_KEY,
      network: 'mainnet',
    },
  });

  return service;
}

// main.ts
import express from 'express';
import { startCardanoService } from './cardano-service';

const app = express();
const cardanoService = await startCardanoService();

app.use('/cardano', cardanoService.router);
app.listen(3000);
```

## Testing

The service includes test utilities:

```typescript
import { createTestService } from '@1815/cardano-service/testing';

describe('My Integration Tests', () => {
  let service;

  beforeAll(async () => {
    service = await createTestService();
  });

  afterAll(async () => {
    await service.shutdown();
  });

  it('should create an alias', async () => {
    const alias = await service.services.aliasService.createAlias({
      cardanoAddress: 'addr1...',
    });
    expect(alias).toBeDefined();
  });
});
```

## Troubleshooting

### MongoDB Connection Issues

If MongoDB is not available, the service will log warnings but continue to run in a degraded mode.

### Redis Connection Issues

If Redis is not available, rate limiting and caching will be disabled, but the service will continue to function.

### Blockfrost API Issues

Ensure your API key is valid and has sufficient quota. The service includes circuit breakers to handle API failures gracefully.

## Migration from Standalone Deployment

If you were running 1815 as a standalone service:

1. Remove Docker Compose files (or integrate into your existing setup)
2. Remove PM2 configuration
3. Update your code to use the initialization function
4. Keep your environment variables
5. Mount the router in your Express app

## Support

For issues and questions:

- GitHub: https://github.com/Emmanuel-Odero/1815
- Documentation: https://1815.dev/docs
