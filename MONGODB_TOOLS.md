# MongoDB Tools & Viewers

## Available Tools

### 1. Interactive MongoDB Viewer

```bash
npm run mongodb:viewer
```

**Features:**

- Interactive command-line interface
- Real-time database queries
- Commands: `list`, `aliases`, `users`, `stats`, `search <code>`, `active`, `expired`, `clear`, `exit`

**Usage:**

```
mongodb> aliases          # Show all aliases
mongodb> search 6273358125001101  # Search specific alias
mongodb> active           # Show only active aliases
mongodb> stats            # Database statistics
mongodb> exit             # Exit viewer
```

### 2. Quick Database Overview

```bash
npm run mongodb:quick
```

**Features:**

- Fast, non-interactive overview
- Shows collections, aliases, and stats
- Perfect for quick checks

### 3. Database Health Check

```bash
npm run mongodb:check
```

**Features:**

- Comprehensive database analysis
- Connection verification
- Sample data display

### 4. MongoDB Express Verification

```bash
npm run mongodb:verify
```

**Features:**

- Verifies web interface connectivity
- Tests database access
- Provides access instructions

## Web-Based MongoDB Admin

### MongoDB Express

- **URL**: http://localhost:8082
- **Username**: admin
- **Password**: admin123
- **Database**: 1815_dev

**Navigation:**

1. Open http://localhost:8082
2. Login with admin/admin123
3. Click on `1815_dev` database
4. Browse collections: `aliases`, `users`, `searchhistories`

## Current Database State

### Collections

- **aliases**: 3 documents (active wallet aliases)
- **users**: 0 documents (user accounts)
- **searchhistories**: 0 documents (search logs)

### Live Aliases

1. **4243178751001758** → Testnet address (0 uses)
2. **1760414018001297** → Mainnet address (1 use)
3. **6273358125001101** → "Test Wallet" (4 uses)

### Schema Structure

```javascript
// Aliases Collection
{
  _id: ObjectId,
  shortCode: String,        // 16-digit alias code
  cardanoAddress: String,   // Full Cardano address
  customName: String,       // Optional display name
  userEmail: String,        // Optional user email
  isActive: Boolean,        // Active status
  useCount: Number,         // Resolution counter
  expiresAt: Date,         // Expiration date
  createdAt: Date,         // Creation timestamp
  updatedAt: Date,         // Last update
  lastUsedAt: Date,        // Last resolution
  qrCodeUrl: String,       // QR code data
  notificationSent: Boolean // Email status
}
```

## Troubleshooting

### If scripts fail:

```bash
# Check if MongoDB is running
lsof -ti:27017

# Check backend connection
curl http://localhost:3000/api/v1/health

# Restart MongoDB Express
docker compose restart mongo-express
```

### If data appears empty:

1. Verify you're looking at `1815_dev` database
2. Check the `aliases` collection specifically
3. Run `npm run mongodb:quick` to verify data exists

## Docker Services

### Check running services:

```bash
docker ps
```

### View MongoDB Express logs:

```bash
docker logs 1815-api-mongo-express-1
```

### Restart services:

```bash
docker compose restart mongo-express
docker compose restart mongodb
```

## Quick Commands Reference

```bash
# View database quickly
npm run mongodb:quick

# Interactive viewer
npm run mongodb:viewer

# Check database health
npm run mongodb:check

# Verify web interface
npm run mongodb:verify

# Web admin interface
open http://localhost:8082
```

All tools are now properly configured and working with your live database containing 3 active aliases!
