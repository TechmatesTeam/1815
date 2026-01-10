# Getting Started with 1815 Cardano Service

The fastest way to add Cardano functionality to your Node.js application.

## 5-Minute Quick Start

### 1. Install

```bash
npm install @1815/cardano-service
```

### 2. Initialize

```typescript
import express from 'express';
import { initialize1815Service } from '@1815/cardano-service';

const app = express();

const service = await initialize1815Service({
  mongodb: {
    uri: 'mongodb://localhost:27017/myapp',
  },
  blockfrost: {
    apiKey: 'your-blockfrost-api-key',
    network: 'mainnet',
  },
});

app.use('/cardano', service.router);
app.listen(3000);
```

### 3. Use

```bash
# Create an alias
curl -X POST http://localhost:3000/cardano/aliases \
  -H "Content-Type: application/json" \
  -d '{"cardanoAddress":"addr1..."}'

# Resolve an alias
curl http://localhost:3000/cardano/resolve/1234567890123456

# Get address details
curl http://localhost:3000/cardano/explorer/address/addr1...
```

That's it! 🎉

## Prerequisites

Before you start, make sure you have:

- ✅ Node.js 20 or higher
- ✅ MongoDB 5.0 or higher
- ✅ A Blockfrost API key ([get one free](https://blockfrost.io))
- ✅ Redis 6.0+ (optional, but recommended)

## Installation Options

### Option 1: Start from Scratch

```bash
# Create new project
mkdir my-cardano-app
cd my-cardano-app
npm init -y

# Install dependencies
npm install express @1815/cardano-service

# Install dev dependencies
npm install -D typescript @types/node @types/express ts-node

# Create tsconfig.json
npx tsc --init
```

### Option 2: Add to Existing Project

```bash
# Just install the package
npm install @1815/cardano-service
```

## Basic Setup

### Step 1: Get a Blockfrost API Key

1. Go to [blockfrost.io](https://blockfrost.io)
2. Sign up for free
3. Create a project
4. Copy your API key

### Step 2: Start MongoDB

```bash
# Using Docker
docker run -d -p 27017:27017 --name mongodb mongo:7.0

# Or install locally
# See: https://www.mongodb.com/docs/manual/installation/
```

### Step 3: Create Your App

Create `index.ts`:

```typescript
import express from 'express';
import { initialize1815Service } from '@1815/cardano-service';

async function main() {
  const app = express();
  app.use(express.json());

  // Initialize Cardano service
  const cardano = await initialize1815Service({
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/myapp',
    },
    blockfrost: {
      apiKey: process.env.BLOCKFROST_API_KEY || 'your-key-here',
      network: 'mainnet',
    },
  });

  // Mount Cardano routes
  app.use('/cardano', cardano.router);

  // Your other routes
  app.get('/', (req, res) => {
    res.json({ message: 'My Cardano App' });
  });

  // Start server
  const PORT = 3000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Cardano API: http://localhost:${PORT}/cardano`);
  });
}

main().catch(console.error);
```

### Step 4: Run

```bash
# Set environment variables
export BLOCKFROST_API_KEY=your_actual_key_here

# Run
npx ts-node index.ts
```

## What You Get

Once running, you have access to:

### Alias Management

```bash
# Create short code for Cardano address
POST /cardano/aliases
{
  "cardanoAddress": "addr1...",
  "customName": "My Wallet"
}

# Resolve short code
GET /cardano/resolve/1234567890123456

# Get alias details
GET /cardano/aliases/1234567890123456

# Delete alias
DELETE /cardano/aliases/1234567890123456
```

### Blockchain Explorer

```bash
# Get address details
GET /cardano/explorer/address/addr1...

# Get transaction details
GET /cardano/explorer/transaction/abc123...

# Get block details
GET /cardano/explorer/block/12345
```

### Health Check

```bash
GET /cardano/health
```

## Next Steps

### Add Redis (Recommended)

Redis enables caching and rate limiting:

```bash
# Start Redis
docker run -d -p 6379:6379 --name redis redis:7.2-alpine

# Update your code
const cardano = await initialize1815Service({
  mongodb: { uri: 'mongodb://localhost:27017/myapp' },
  redis: { url: 'redis://localhost:6379' }, // Add this
  blockfrost: { apiKey: 'your-key', network: 'mainnet' },
});
```

### Add Email Notifications

```typescript
const cardano = await initialize1815Service({
  mongodb: { uri: 'mongodb://localhost:27017/myapp' },
  blockfrost: { apiKey: 'your-key', network: 'mainnet' },
  email: {
    provider: 'sendgrid',
    apiKey: 'your-sendgrid-key',
    from: 'noreply@myapp.com',
  },
});
```

### Use Services Directly

Instead of HTTP API, call services directly:

```typescript
// Create alias programmatically
const alias = await cardano.services.aliasService.createAlias({
  cardanoAddress: 'addr1...',
  customName: 'My Wallet',
});

// Query blockchain
const addressInfo = await cardano.services.explorerService.getAddressDetails('addr1...');

// Access database models
const { Alias, User } = cardano.models;
const aliases = await Alias.find({ isActive: true });
```

### Add to Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - '3000:3000'
    environment:
      - MONGODB_URI=mongodb://mongodb:27017/myapp
      - REDIS_URL=redis://redis:6379
      - BLOCKFROST_API_KEY=${BLOCKFROST_API_KEY}
    depends_on:
      - mongodb
      - redis

  mongodb:
    image: mongo:7.0
    volumes:
      - mongodb_data:/data/db

  redis:
    image: redis:7.2-alpine
    volumes:
      - redis_data:/data

volumes:
  mongodb_data:
  redis_data:
```

## Common Use Cases

### Use Case 1: Wallet Application

```typescript
// Create alias for user's wallet
app.post('/users/:id/wallet', async (req, res) => {
  const { cardanoAddress } = req.body;

  const alias = await cardano.services.aliasService.createAlias({
    cardanoAddress,
    customName: `User ${req.params.id} Wallet`,
  });

  res.json({ shortCode: alias.shortCode });
});
```

### Use Case 2: Payment Processor

```typescript
// Check payment status
app.get('/payments/:address/status', async (req, res) => {
  const details = await cardano.services.explorerService.getAddressDetails(req.params.address);

  res.json({
    balance: details.amount,
    transactions: details.tx_count,
  });
});
```

### Use Case 3: Address Book

```typescript
// Store and resolve addresses
app.post('/contacts', async (req, res) => {
  const { name, cardanoAddress } = req.body;

  const alias = await cardano.services.aliasService.createAlias({
    cardanoAddress,
    customName: name,
  });

  res.json({ name, shortCode: alias.shortCode });
});
```

## Troubleshooting

### MongoDB Connection Failed

```bash
# Check if MongoDB is running
docker ps | grep mongodb

# Check connection string
echo $MONGODB_URI
```

### Blockfrost API Errors

```bash
# Verify API key
curl -H "project_id: your_key" https://cardano-mainnet.blockfrost.io/api/v0/health

# Check network matches key
# mainnet key → network: 'mainnet'
# testnet key → network: 'testnet'
```

### Port Already in Use

```typescript
// Change port
const PORT = process.env.PORT || 3001;
app.listen(PORT);
```

## Learn More

- **[Integration Guide](./INTEGRATION_GUIDE.md)** - Detailed integration instructions
- **[Quick Reference](./QUICK_REFERENCE.md)** - API cheat sheet
- **[Examples](./examples/)** - Working code examples
- **[API Documentation](./docs/API.md)** - Complete API reference

## Get Help

- **Issues**: [GitHub Issues](https://github.com/Emmanuel-Odero/1815/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Emmanuel-Odero/1815/discussions)
- **Email**: emmanuelodero@techmates.team

## What's Next?

Now that you have the basics working:

1. ✅ Explore the [examples](./examples/)
2. ✅ Read the [Integration Guide](./INTEGRATION_GUIDE.md)
3. ✅ Check out [advanced features](./examples/advanced-integration.ts)
4. ✅ Deploy to production
5. ✅ Build something awesome!

Happy coding! 🚀
