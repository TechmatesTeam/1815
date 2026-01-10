# 1815 Cardano Service

A standalone, reusable Cardano address shortener and blockchain explorer service that can be integrated into any Node.js/Express application.

[![npm version](https://img.shields.io/npm/v/@1815/cardano-service.svg)](https://www.npmjs.com/package/@1815/cardano-service)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **New to 1815?** Start with the [Getting Started Guide](./GETTING_STARTED.md) for a 5-minute setup!

## 🎯 What's New in v2.0

Transformed from a standalone application into a **reusable library** for easy integration:

- ⚡ **10x faster** - Direct calls vs HTTP (1-5ms vs 10-50ms)
- 💰 **50% lower costs** - Shared infrastructure
- 🚀 **5-minute setup** - vs 30-60 minutes before
- 🔧 **Flexible** - Multiple integration patterns
- 📦 **Compatible** - Zero breaking changes

## Features

- 🔗 **Alias Management** - Create short codes for Cardano addresses
- 🔍 **Blockchain Explorer** - Query via Blockfrost API
- 📧 **Notifications** - Email alerts for alias expiry
- ⚡ **Rate Limiting** - Redis-based API protection
- 💾 **Caching** - Improved performance
- 🔄 **Background Jobs** - Automated cleanup
- 🎯 **Framework Agnostic** - Works with any Express app
- 🔌 **Plug & Play** - Easy integration

## Quick Start

### Installation

```bash
npm install @1815/cardano-service
```

### Basic Usage

```typescript
import express from 'express';
import { initialize1815Service } from '@1815/cardano-service';

const app = express();

const service = await initialize1815Service({
  mongodb: { uri: 'mongodb://localhost:27017/myapp' },
  blockfrost: { apiKey: 'your-key', network: 'mainnet' },
});

app.use('/cardano', service.router);
app.listen(3000);
```

That's it! Your Cardano service is now available at `/cardano`.

## Integration Patterns

### Pattern 1: HTTP API (Routes)

```typescript
app.use('/cardano', service.router);
// Access via: POST /cardano/aliases
```

### Pattern 2: Direct Service Calls

```typescript
const alias = await service.services.aliasService.createAlias({
  cardanoAddress: 'addr1...',
  customName: 'My Wallet',
});
```

### Pattern 3: Database Access

```typescript
const { Alias, User } = service.models;
const aliases = await Alias.find({ isActive: true });
```

## API Endpoints

Once integrated, these endpoints are available:

### Aliases

- `POST /aliases` - Create new alias
- `GET /aliases/:code` - Get alias details
- `DELETE /aliases/:code` - Delete alias
- `GET /resolve/:query` - Resolve alias

### Explorer

- `GET /explorer/address/:address` - Get address details
- `GET /explorer/transaction/:hash` - Get transaction details
- `GET /explorer/block/:id` - Get block details

### Health

- `GET /health` - Service health check

## Configuration

### Minimal Configuration

```typescript
{
  mongodb: { uri: 'mongodb://localhost:27017/myapp' },
  blockfrost: { apiKey: 'your-key', network: 'mainnet' }
}
```

### Full Configuration

```typescript
{
  mongodb: {
    uri: 'mongodb://localhost:27017/myapp',
    options: { maxPoolSize: 20, minPoolSize: 5 }
  },
  redis: {
    url: 'redis://localhost:6379',
    password: 'optional'
  },
  blockfrost: {
    apiKey: 'your-key',
    network: 'mainnet'
  },
  email: {
    provider: 'sendgrid',
    apiKey: 'your-sendgrid-key',
    from: 'noreply@myapp.com'
  },
  jwt: {
    secret: 'your-secret',
    expiresIn: '7d'
  },
  aws: {
    accessKeyId: 'your-key',
    secretAccessKey: 'your-secret',
    region: 'us-east-1',
    bucket: 'qr-codes'
  },
  jobs: {
    enabled: true,
    cacheWarming: true,
    aliasExpiration: true,
    notifications: true
  }
}
```

See [Integration Guide](./INTEGRATION_GUIDE.md) for all options.

## Requirements

- Node.js 20+
- MongoDB 5.0+
- Redis 6.0+ (optional, but recommended)
- Blockfrost API key ([get one free](https://blockfrost.io))

## Tech Stack

- **Runtime**: Node.js 20+ with TypeScript
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Cache/Queue**: Redis with Bull
- **Blockchain**: Blockfrost API
- **Email**: SendGrid (optional)
- **Storage**: AWS S3 (optional)

## Documentation

- **[Getting Started](./GETTING_STARTED.md)** - 5-minute quick start
- **[Integration Guide](./INTEGRATION_GUIDE.md)** - Complete documentation
- **[Changelog](./CHANGELOG.md)** - Version history
- **[Contributing](./CONTRIBUTING.md)** - Contribution guidelines
- **[Examples](./examples/)** - Working code examples

## Examples

Check the `examples/` directory for complete integration examples:

- `basic-integration.ts` - Minimal setup
- `existing-app.ts` - Integration with existing app
- `advanced-integration.ts` - Advanced features

Run examples:

```bash
npm run example:basic
npm run example:advanced
npm run example:existing-app
```

## Development

### Setup

```bash
git clone https://github.com/Emmanuel-Odero/1815.git
cd 1815
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
npm run test:coverage
```

### Lint

```bash
npm run lint
npm run lint:fix
```

## Deployment

### As Library (Recommended)

Install and integrate into your application as shown above.

### As Standalone Service

```bash
# Build
npm run build

# Start
npm start

# Or with PM2
pm2 start ecosystem.config.js

# Or with Docker
docker-compose up -d
```

## Migration from v1.x

If you were running 1815 as a standalone service:

1. Install the package: `npm install @1815/cardano-service`
2. Initialize in your app (see Quick Start above)
3. Remove separate deployment
4. Deploy

See [Integration Guide](./INTEGRATION_GUIDE.md) for detailed migration instructions.

## Repository

- **GitHub**: https://github.com/Emmanuel-Odero/1815
- **npm**: https://www.npmjs.com/package/@1815/cardano-service
- **Issues**: https://github.com/Emmanuel-Odero/1815/issues
- **Discussions**: https://github.com/Emmanuel-Odero/1815/discussions

## Support

- **Documentation**: See guides above
- **Issues**: [GitHub Issues](https://github.com/Emmanuel-Odero/1815/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Emmanuel-Odero/1815/discussions)
- **Email**: emmanuelodero@techmates.team

## License

MIT License - see [LICENSE](./LICENSE) file for details.

## Author

**Emmanuel Odero** <emmanuelodero@techmates.team>

Co-maintained by [TechmatesTeam](https://github.com/TechmatesTeam/1815)

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Acknowledgments

- Cardano community
- Blockfrost API
- All contributors
