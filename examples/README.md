# Integration Examples

This directory contains working examples of how to integrate the 1815 Cardano Service into your application.

## Examples

### 1. Basic Integration (`basic-integration.ts`)

The simplest possible integration. Perfect for getting started.

```bash
npm run example:basic
```

**What it shows:**

- Minimal configuration
- Mounting routes
- Basic setup

### 2. Existing App Integration (`existing-app.ts`)

Shows how to integrate into an app that already has MongoDB and Redis.

```bash
npm run example:existing-app
```

**What it shows:**

- Reusing existing connections
- Combining with your own routes
- Using services directly in custom endpoints

### 3. Advanced Integration (`advanced-integration.ts`)

Demonstrates advanced features and patterns.

```bash
npm run example:advanced
```

**What it shows:**

- Full configuration options
- Custom middleware
- Direct service usage
- Bulk operations
- Caching patterns
- Webhook handling

## Running Examples

### Prerequisites

```bash
# MongoDB
docker run -d -p 27017:27017 mongo:7.0

# Redis
docker run -d -p 6379:6379 redis:7.2-alpine
```

### Environment Variables

Create `.env` in this directory:

```bash
MONGODB_URI=mongodb://localhost:27017/examples
REDIS_URL=redis://localhost:6379
BLOCKFROST_API_KEY=your_key_here
BLOCKFROST_NETWORK=mainnet
```

### Run

```bash
cd examples
npm install
npm run basic
```

## Docker Compose Example

See `docker-compose.example.yml` for how to add MongoDB and Redis to your existing setup.

## Learn More

- [Integration Guide](../INTEGRATION_GUIDE.md)
- [Quick Reference](../QUICK_REFERENCE.md)
- [API Documentation](../docs/API.md)
