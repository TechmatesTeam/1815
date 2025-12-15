# 1815 API

A powerful Cardano address shortener and blockchain explorer API service. 1815 provides alias management, blockchain exploration, and notification services for Cardano addresses.

## Features

- **Alias Management**: Create and resolve short aliases for Cardano addresses
- **Blockchain Explorer**: Query Cardano blockchain data via Blockfrost API
- **Notification System**: Email notifications for alias expiry warnings
- **Rate Limiting**: Redis-based rate limiting for API protection
- **Caching**: Redis caching for improved performance
- **Background Jobs**: Automated cleanup and notification processing

## Repository

- **Main Repository**: https://github.com/Emmanuel-Odero/1815.git
- **Developer**: Emmanuel Odero
- **Co-maintained by**: TechmatesTeam (https://github.com/TechmatesTeam/1815)

## Tech Stack

- **Runtime**: Node.js 18+ with TypeScript
- **Framework**: Express.js with middleware ecosystem
- **Database**: MongoDB with Mongoose ODM
- **Cache/Queue**: Redis with Bull queue system
- **External APIs**: Blockfrost for Cardano blockchain data
- **Email**: SendGrid for notification delivery
- **Storage**: AWS S3 for QR code images

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB
- Redis
- Docker (optional)

### Installation

1. Install dependencies:

```bash
npm install
```

2. Copy environment configuration:

```bash
cp .env.template .env
```

3. Update `.env` with your configuration values

4. Start development server:

```bash
npm run dev
```

### Docker Development

1. Start all services:

```bash
npm run docker:dev
```

2. Stop services:

```bash
npm run docker:down
```

#### Development Services

When running with Docker, the following services are available:

- **API**: http://localhost:3000 - Main API server
- **MongoDB**: localhost:27017 - Database
- **MongoDB Express**: http://localhost:8082 - MongoDB web viewer
  - Username: `admin`
  - Password: `admin123`
- **Redis**: localhost:6379 - Cache and queue storage
- **Redis Commander**: http://localhost:8081 - Redis web UI
  - Username: `admin`
  - Password: `admin123`
- **MailHog**: http://localhost:8025 - Email testing web UI (SMTP: localhost:1025)

#### MongoDB Schema Viewer

MongoDB Express is included for database inspection and management:

- **URL**: http://localhost:8082
- **Username**: `admin`
- **Password**: `admin123`
- **Features**:
  - View all collections (aliases, users, searchhistories, etc.)
  - Browse documents and their structure
  - Execute MongoDB queries
  - Monitor database statistics
  - Export/import data

#### Email Testing with MailHog

MailHog is included for local email testing. When `USE_MAILHOG=true` in your `.env` file:

- All emails are captured by MailHog instead of being sent via SendGrid
- View captured emails at http://localhost:8025
- No actual emails are sent to real email addresses
- Perfect for testing notification features during development

#### Alias Generation System

The application generates **16-digit unique numeric codes** as aliases:

- **Format**: 16-digit numbers (e.g., `1734271234567890`)
- **Uniqueness**: Timestamp-based generation ensures no duplicates
- **Structure**: 13-digit timestamp + 3 random digits
- **Validation**: Cardano addresses are validated before alias creation
- **Supported Addresses**:
  - Shelley mainnet: `addr1...`
  - Shelley testnet: `addr_test1...`
  - Stake addresses: `stake1...` / `stake_test1...`
  - Byron legacy: `Ae2...` / `DdzFF...`

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting

## API Endpoints

### Aliases

- `POST /api/v1/aliases` - Create new alias
- `GET /api/v1/aliases/:code` - Get alias details
- `DELETE /api/v1/aliases/:code` - Delete alias
- `GET /api/v1/resolve/:query` - Resolve alias or search

### Explorer

- `GET /api/v1/explorer/address/:address` - Get address details
- `GET /api/v1/explorer/transaction/:hash` - Get transaction details
- `GET /api/v1/explorer/block/:id` - Get block details
- `POST /api/v1/explorer/resolve/bulk` - Bulk resolution

### Notifications

- `POST /api/v1/notifications/subscribe` - Subscribe to notifications
- `PUT /api/v1/notifications/preferences` - Update preferences
- `POST /api/v1/notifications/unsubscribe/:token` - Unsubscribe

### Health

- `GET /api/v1/health` - Health check
- `GET /api/v1/health/stats` - System statistics

## Environment Variables

See `.env.template` for all available configuration options.

## Development

### Project Structure

```
src/
├── config/          # Configuration files
├── controllers/     # Route controllers
├── middlewares/     # Express middlewares
├── models/          # Database models
├── queues/          # Background job queues
├── routes/          # API routes
├── services/        # Business logic services
├── test/            # Test setup and utilities
├── types/           # TypeScript type definitions
├── utils/           # Utility functions
└── index.ts         # Application entry point
```

### Testing

The project uses Jest for testing with MongoDB Memory Server and Redis Memory Server for isolated test environments.

### Code Quality

- **ESLint**: Code linting with TypeScript rules
- **Prettier**: Code formatting
- **TypeScript**: Type safety and modern JavaScript features

## License

MIT
