# Changelog

All notable changes to the 1815 Cardano Service will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2024-01-10

### 🎉 Major Release: Library Transformation

This release transforms 1815 from a standalone application into a reusable library while maintaining full backward compatibility.

### Added

#### Library Features

- **New library entry point** (`src/lib/index.ts`) for easy integration
- **`initialize1815Service()` function** - Main initialization function
- **Service instance API** - Access to models, services, and connections
- **Graceful shutdown support** - `service.shutdown()` method
- **Job control** - `service.stopJobs()` method
- **Test utilities** - `createTestService()` for testing
- **TypeScript types** - Full type definitions for configuration

#### Documentation

- **Integration Guide** - Complete guide for integrating into existing apps
- **Migration Guide** - Step-by-step migration from standalone to library
- **Quick Reference** - Cheat sheet for common operations
- **Library vs Standalone** - Comparison and decision guide
- **Standalone Deployment Guide** - For users who prefer separate service
- **Refactoring Summary** - Overview of changes

#### Examples

- **Basic Integration** - Minimal setup example
- **Existing App Integration** - Integration with existing MongoDB/Redis
- **Advanced Integration** - Full-featured example with custom routes
- **Docker Compose Example** - How to add to existing docker-compose.yml

#### Configuration

- **Flexible initialization** - Support for existing connections or new ones
- **Optional dependencies** - Redis, email, AWS S3 are all optional
- **Feature toggles** - Enable/disable features as needed
- **Environment variable support** - Auto-read from env vars
- **Job configuration** - Control background jobs

### Changed

#### Package Structure

- **Package name**: `1815-api` → `@1815/cardano-service`
- **Main entry point**: `dist/index.js` → `dist/lib/index.js`
- **Version**: `1.0.0` → `2.0.0`
- **Package scope**: Added `@1815` scope for better organization

#### Scripts

- **Removed**: Docker, PM2, and deployment scripts (users manage their own)
- **Added**: Example scripts for testing integration patterns
- **Added**: `start` and `start:dev` for standalone mode
- **Simplified**: Build and test scripts

#### Documentation

- **Updated README** - Focus on library usage
- **Reorganized docs** - Clearer structure for different use cases
- **Added examples** - Working code examples for common scenarios

### Maintained (Backward Compatible)

All existing functionality remains intact:

#### Core Features

- ✅ Alias management (create, resolve, delete)
- ✅ Blockchain explorer (address, transaction, block queries)
- ✅ Notification system (email alerts)
- ✅ Rate limiting (Redis-based)
- ✅ Caching (Redis-based)
- ✅ Background jobs (expiration, notifications, cache warming)
- ✅ QR code generation (AWS S3)
- ✅ Payment tracking
- ✅ User management

#### API Endpoints

- ✅ All `/api/v1/*` endpoints unchanged
- ✅ Request/response formats unchanged
- ✅ Authentication unchanged
- ✅ Validation unchanged

#### Database

- ✅ All models unchanged
- ✅ Schema unchanged
- ✅ Migrations not required

#### Dependencies

- ✅ All dependencies maintained
- ✅ Node.js 20+ requirement unchanged
- ✅ MongoDB 5.0+ requirement unchanged
- ✅ Redis 6.0+ requirement unchanged

### Deprecated

#### Deployment Files (Still Available)

- `docker-compose.yml` - Users should use their own
- `docker-compose.prod.yml` - Users should use their own
- `Dockerfile` - Users should use their own
- `ecosystem.config.js` - PM2 config not needed for library
- `scripts/deploy.sh` - Deployment handled by users
- `nginx/nginx.conf` - Routing handled by users

These files remain in the repository for reference but are not published to npm.

### Migration Path

#### For Existing Standalone Users

1. **Option A: Migrate to Library (Recommended)**
   - Install: `npm install @1815/cardano-service`
   - Update code to use `initialize1815Service()`
   - Remove separate deployment
   - See [Migration Guide](./MIGRATION_GUIDE.md)

2. **Option B: Continue Standalone**
   - Use `src/standalone.ts` entry point
   - Keep existing deployment
   - See [Standalone Deployment Guide](./docs/STANDALONE_DEPLOYMENT.md)

#### For New Users

- Install: `npm install @1815/cardano-service`
- Follow [Integration Guide](./INTEGRATION_GUIDE.md)
- See [Examples](./examples/)

### Breaking Changes

⚠️ **For npm package users only** (not for existing deployments):

1. **Package name changed**: `1815-api` → `@1815/cardano-service`

   ```bash
   # Old
   npm install 1815-api

   # New
   npm install @1815/cardano-service
   ```

2. **Import path changed**:

   ```typescript
   // Old (if you were importing directly)
   import { something } from '1815-api';

   // New
   import { initialize1815Service } from '@1815/cardano-service';
   ```

3. **Initialization changed**:

   ```typescript
   // Old (standalone app)
   // Just run the server

   // New (library)
   const service = await initialize1815Service(config);
   app.use('/cardano', service.router);
   ```

**Note**: If you're running 1815 as a standalone service (not as an npm package), there are NO breaking changes. Everything works as before.

### Performance Improvements

- **Faster integration** - Direct function calls instead of HTTP
- **Lower latency** - No network overhead for internal calls
- **Better resource usage** - Shared connection pools
- **Reduced memory** - Single application instead of multiple

### Security

- ✅ All existing security features maintained
- ✅ Helmet.js for HTTP security
- ✅ Rate limiting
- ✅ Input validation
- ✅ JWT authentication
- ✅ Encryption for sensitive data

### Testing

- ✅ All existing tests pass
- ✅ New test utilities for integration testing
- ✅ In-memory database support for tests
- ✅ Example test patterns

## [1.0.0] - 2023-12-15

### Initial Release

- Cardano address aliasing
- Blockchain explorer via Blockfrost
- Email notifications
- Rate limiting
- Caching
- Background jobs
- QR code generation
- Payment tracking
- User management
- Docker deployment
- PM2 support
- Comprehensive testing

## Upgrade Guide

### From 1.x to 2.x

#### If Using as Standalone Service

**No changes required!** Continue using as before.

#### If Integrating as Library

1. **Install new package**:

   ```bash
   npm install @1815/cardano-service
   ```

2. **Update imports**:

   ```typescript
   import { initialize1815Service } from '@1815/cardano-service';
   ```

3. **Initialize service**:

   ```typescript
   const service = await initialize1815Service({
     mongodb: { uri: process.env.MONGODB_URI },
     blockfrost: { apiKey: process.env.BLOCKFROST_API_KEY, network: 'mainnet' },
   });
   ```

4. **Mount routes**:

   ```typescript
   app.use('/cardano', service.router);
   ```

5. **Update deployment** (if needed):
   - Remove separate 1815 service from docker-compose
   - Update environment variables
   - Redeploy

See [Migration Guide](./MIGRATION_GUIDE.md) for detailed instructions.

## Support

- **Documentation**: See [Integration Guide](./INTEGRATION_GUIDE.md)
- **Examples**: See [examples/](./examples/)
- **Issues**: [GitHub Issues](https://github.com/Emmanuel-Odero/1815/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Emmanuel-Odero/1815/discussions)

## Contributors

- Emmanuel Odero (@Emmanuel-Odero)
- TechmatesTeam (@TechmatesTeam)

## License

MIT License - see [LICENSE](./LICENSE) file for details
