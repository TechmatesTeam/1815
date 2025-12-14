import { MongoMemoryServer } from 'mongodb-memory-server';
import { RedisMemoryServer } from 'redis-memory-server';
import mongoose from 'mongoose';
import { createClient, RedisClientType } from 'redis';

// Global test setup
let mongoServer: MongoMemoryServer;
let redisServer: RedisMemoryServer;
let redisClient: RedisClientType;

beforeAll(async () => {
  // Start MongoDB Memory Server
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  // Connect to MongoDB
  await mongoose.connect(mongoUri);

  // Start Redis Memory Server
  redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();

  // Connect to Redis
  redisClient = createClient({
    url: `redis://${redisHost}:${redisPort}`,
  });
  await redisClient.connect();

  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = mongoUri;
  process.env.REDIS_URL = `redis://${redisHost}:${redisPort}`;
  process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters';
  process.env.BLOCKFROST_API_KEY = 'test-blockfrost-key';
  process.env.SENDGRID_API_KEY = 'test-sendgrid-key';
});

afterAll(async () => {
  // Cleanup connections
  await mongoose.disconnect();
  await redisClient.quit();

  // Stop servers
  await mongoServer.stop();
  await redisServer.stop();
});

beforeEach(async () => {
  // Clear all collections before each test
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }

  // Clear Redis data
  await redisClient.flushAll();
});

// Increase timeout for tests
jest.setTimeout(30000);
