// MongoDB initialization script for Docker
db = db.getSiblingDB('1815_dev');

// Create collections with indexes
db.createCollection('aliases');
db.aliases.createIndex({ shortCode: 1 }, { unique: true });
db.aliases.createIndex({ cardanoAddress: 1 });
db.aliases.createIndex({ expiresAt: 1, isActive: 1 });
db.aliases.createIndex({ shortCode: 1, isActive: 1 });

db.createCollection('users');
db.users.createIndex({ email: 1 }, { unique: true });

db.createCollection('searchhistories');
db.searchhistories.createIndex({ timestamp: -1 });
db.searchhistories.createIndex({ query: 1, timestamp: -1 });

db.createCollection('featuresubscriptions');
db.featuresubscriptions.createIndex({ email: 1 });

print('Database initialized successfully');