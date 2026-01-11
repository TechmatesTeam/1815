import { describe, it, expect, beforeEach, beforeAll, afterAll, jest } from '@jest/globals';
import * as fc from 'fast-check';
import request from 'supertest';
import express from 'express';
import { HealthController } from '../../controllers/HealthController';
import { connectDatabase, disconnectDatabase } from '../../config/database';
import { connectRedis, disconnectRedis } from '../../config/redis';
import { Alias } from '../../models/Alias';
import { User } from '../../models/User';
import { SearchHistory } from '../../models/SearchHistory';
import { asyncHandler } from '../../middlewares/errorHandler';
import { requestId } from '../../middlewares/validation';

/**
 * **Feature: cardash-backend-api, Property 28: Health check completeness**
 * **Validates: Requirements 7.5**
 *
 * For any health check request, the response should include status information for all system dependencies
 */

describe('HealthController Tests', () => {
  let app: express.Application;

  beforeAll(async () => {
    // Database and Redis connections are handled by global test setup
    // Set up Express app for testing
    app = express();
    app.use(express.json());
    app.use(requestId);

    // Health routes
    app.get('/health', asyncHandler(HealthController.healthCheck));
    app.get('/stats', asyncHandler(HealthController.getStats));
    app.get('/metrics', asyncHandler(HealthController.getMetrics));
  });

  afterAll(async () => {
    // Database and Redis disconnections are handled by global test teardown
  });

  beforeEach(async () => {
    // Clear test data before each test
    await Alias.deleteMany({});
    await User.deleteMany({});
    await SearchHistory.deleteMany({});
  });

  describe('Property 28: Health check completeness', () => {
    it('should return comprehensive health status for all system dependencies', async () => {
      const response = await request(app).get('/health').expect(200);

      // Verify response structure
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('metadata');

      const healthData = response.body.data;

      // Verify core health status fields
      expect(healthData).toHaveProperty('status');
      expect(['healthy', 'degraded', 'unhealthy']).toContain(healthData.status);
      expect(healthData).toHaveProperty('timestamp');
      expect(healthData).toHaveProperty('uptime');
      expect(healthData).toHaveProperty('version');
      expect(healthData).toHaveProperty('environment');
      expect(healthData).toHaveProperty('dependencies');
      expect(healthData).toHaveProperty('responseTime');

      // Verify dependencies object contains all required services
      const deps = healthData.dependencies;
      expect(deps).toHaveProperty('mongodb');
      expect(deps).toHaveProperty('redis');
      expect(deps).toHaveProperty('blockfrost');
      expect(deps).toHaveProperty('cache');
      expect(deps).toHaveProperty('system');

      // Verify MongoDB health check
      expect(deps.mongodb).toHaveProperty('status');
      expect(['healthy', 'unhealthy']).toContain(deps.mongodb.status);
      expect(deps.mongodb).toHaveProperty('readyState');
      expect(deps.mongodb).toHaveProperty('readyStateText');

      // Verify Redis health check
      expect(deps.redis).toHaveProperty('status');
      expect(['healthy', 'unhealthy']).toContain(deps.redis.status);
      expect(deps.redis).toHaveProperty('connected');
      expect(deps.redis).toHaveProperty('ready');

      // Verify Blockfrost health check (may be unhealthy, that's ok)
      expect(deps.blockfrost).toHaveProperty('status');
      expect(['healthy', 'unhealthy']).toContain(deps.blockfrost.status);

      // Verify cache health check
      expect(deps.cache).toHaveProperty('status');
      expect(['healthy', 'unhealthy']).toContain(deps.cache.status);
      expect(deps.cache).toHaveProperty('testPassed');

      // Verify system metrics
      expect(deps.system).toHaveProperty('status', 'healthy');
      expect(deps.system).toHaveProperty('memory');
      expect(deps.system.memory).toHaveProperty('rss');
      expect(deps.system.memory).toHaveProperty('heapUsed');
      expect(deps.system.memory).toHaveProperty('heapTotal');

      // Verify metadata
      expect(response.body.metadata).toHaveProperty('timestamp');
      expect(response.body.metadata).toHaveProperty('requestId');
      expect(response.body.metadata).toHaveProperty('version');

      // Verify timestamps are valid
      expect(() => new Date(healthData.timestamp)).not.toThrow();
      expect(() => new Date(response.body.metadata.timestamp)).not.toThrow();

      // Verify numeric values are reasonable
      expect(typeof healthData.uptime).toBe('number');
      expect(healthData.uptime).toBeGreaterThan(0);
      expect(typeof healthData.responseTime).toBe('number');
      expect(healthData.responseTime).toBeGreaterThan(0);
    });

    it('should return appropriate HTTP status codes based on health status', async () => {
      // Test multiple times to account for potential service fluctuations
      await fc.assert(
        fc.asyncProperty(fc.constant(true), async () => {
          const response = await request(app).get('/health');

          // Should return 200 for healthy or degraded, 503 for unhealthy
          expect([200, 503]).toContain(response.status);

          if (response.status === 200) {
            expect(['healthy', 'degraded']).toContain(response.body.data.status);
          } else if (response.status === 503) {
            expect(response.body.data.status).toBe('unhealthy');
          }
        }),
        { numRuns: 5 }
      );
    });

    it('should include latency measurements for available services', async () => {
      const response = await request(app).get('/health').expect(200);

      const deps = response.body.data.dependencies;

      // MongoDB should have latency if healthy
      if (deps.mongodb.status === 'healthy') {
        expect(deps.mongodb).toHaveProperty('latency');
        expect(typeof deps.mongodb.latency).toBe('number');
        expect(deps.mongodb.latency).toBeGreaterThan(0);
      }

      // Redis should have latency if healthy
      if (deps.redis.status === 'healthy') {
        expect(deps.redis).toHaveProperty('latency');
        expect(typeof deps.redis.latency).toBe('number');
        expect(deps.redis.latency).toBeGreaterThan(0);
      }

      // Blockfrost should have latency if healthy
      if (deps.blockfrost.status === 'healthy') {
        expect(deps.blockfrost).toHaveProperty('latency');
        expect(typeof deps.blockfrost.latency).toBe('number');
        expect(deps.blockfrost.latency).toBeGreaterThan(0);
      }

      // Cache should have latency if healthy
      if (deps.cache.status === 'healthy') {
        expect(deps.cache).toHaveProperty('latency');
        expect(typeof deps.cache.latency).toBe('number');
        expect(deps.cache.latency).toBeGreaterThan(0);
      }
    });

    it('should handle service failures gracefully without crashing', async () => {
      // This test verifies the health check doesn't crash even if services are down
      // We can't easily simulate service failures in tests, but we can verify
      // the endpoint always returns a valid response structure

      await fc.assert(
        fc.asyncProperty(fc.constant(true), async () => {
          const response = await request(app).get('/health');

          // Should always return a valid response, never crash
          expect(response.body).toHaveProperty('success');
          expect(response.body).toHaveProperty('data');
          expect(response.body).toHaveProperty('metadata');

          // Should always have the required structure
          expect(response.body.data).toHaveProperty('status');
          expect(response.body.data).toHaveProperty('dependencies');
          expect(response.body.data.dependencies).toHaveProperty('mongodb');
          expect(response.body.data.dependencies).toHaveProperty('redis');
          expect(response.body.data.dependencies).toHaveProperty('blockfrost');
          expect(response.body.data.dependencies).toHaveProperty('cache');
          expect(response.body.data.dependencies).toHaveProperty('system');
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('Statistics Endpoint Tests', () => {
    it('should return comprehensive system statistics', async () => {
      // Create some test data first
      const testAlias = new Alias({
        shortCode: 'TEST1234',
        cardanoAddress:
          'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isActive: true,
        useCount: 5,
      });
      await testAlias.save();

      const testUser = new User({
        email: 'test@example.com',
        notificationPreferences: {
          aliasExpiry: true,
          featureUpdates: false,
          ecosystemNews: false,
        },
      });
      await testUser.save();

      const testSearch = new SearchHistory({
        query: 'test-query',
        queryType: 'address',
        resultType: 'address',
        ipAddress: '127.0.0.1',
        responseTime: 100,
        wasSuccessful: true,
        cacheHit: false,
      });
      await testSearch.save();

      const response = await request(app).get('/stats').expect(200);

      // Verify response structure
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('metadata');

      const statsData = response.body.data;
      expect(statsData).toHaveProperty('statistics');
      expect(statsData).toHaveProperty('generatedAt');
      expect(statsData).toHaveProperty('responseTime');

      const stats = statsData.statistics;

      // Verify alias statistics
      expect(stats).toHaveProperty('aliases');
      expect(stats.aliases).toHaveProperty('total');
      expect(stats.aliases).toHaveProperty('active');
      expect(stats.aliases).toHaveProperty('expired');
      expect(stats.aliases).toHaveProperty('totalUsage');
      expect(stats.aliases.total).toBeGreaterThanOrEqual(1);
      expect(stats.aliases.active).toBeGreaterThanOrEqual(1);
      expect(stats.aliases.totalUsage).toBeGreaterThanOrEqual(5);

      // Verify user statistics
      expect(stats).toHaveProperty('users');
      expect(stats.users).toHaveProperty('total');
      expect(stats.users).toHaveProperty('subscribed');
      expect(stats.users.total).toBeGreaterThanOrEqual(1);
      expect(stats.users.subscribed).toBeGreaterThanOrEqual(1);

      // Verify search statistics
      expect(stats).toHaveProperty('searches');
      expect(stats.searches).toHaveProperty('total');
      expect(stats.searches).toHaveProperty('successful');
      expect(stats.searches).toHaveProperty('cacheHitRate');
      expect(stats.searches).toHaveProperty('avgResponseTime');

      // Verify system statistics
      expect(stats).toHaveProperty('system');
      expect(stats.system).toHaveProperty('uptime');
      expect(stats.system).toHaveProperty('version');
      expect(stats.system).toHaveProperty('environment');

      // Verify numeric values are reasonable
      expect(typeof stats.aliases.total).toBe('number');
      expect(typeof stats.users.total).toBe('number');
      expect(typeof stats.searches.cacheHitRate).toBe('number');
      expect(typeof statsData.responseTime).toBe('number');
      expect(statsData.responseTime).toBeGreaterThan(0);
    });

    it('should handle empty database gracefully', async () => {
      // Ensure database is empty
      await Alias.deleteMany({});
      await User.deleteMany({});
      await SearchHistory.deleteMany({});

      const response = await request(app).get('/stats').expect(200);

      const stats = response.body.data.statistics;

      // Should return zero values, not crash
      expect(stats.aliases.total).toBe(0);
      expect(stats.aliases.active).toBe(0);
      expect(stats.aliases.expired).toBe(0);
      expect(stats.aliases.totalUsage).toBe(0);
      expect(stats.users.total).toBe(0);
      expect(stats.users.subscribed).toBe(0);
      expect(stats.searches.total).toBe(0);
      expect(stats.searches.successful).toBe(0);
    });

    it('should return consistent statistics across multiple requests', async () => {
      // Create stable test data
      const testAlias = new Alias({
        shortCode: 'STABLE01',
        cardanoAddress:
          'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isActive: true,
        useCount: 10,
      });
      await testAlias.save();

      // Make multiple requests
      const response1 = await request(app).get('/stats').expect(200);
      const response2 = await request(app).get('/stats').expect(200);

      const stats1 = response1.body.data.statistics;
      const stats2 = response2.body.data.statistics;

      // Core statistics should be consistent (allowing for minor timing differences)
      expect(stats1.aliases.total).toBe(stats2.aliases.total);
      expect(stats1.aliases.active).toBe(stats2.aliases.active);
      expect(stats1.aliases.totalUsage).toBe(stats2.aliases.totalUsage);
      expect(stats1.system.version).toBe(stats2.system.version);
      expect(stats1.system.environment).toBe(stats2.system.environment);
    });
  });

  describe('Metrics Endpoint Tests', () => {
    it('should return detailed system metrics', async () => {
      const response = await request(app).get('/metrics').expect(200);

      // Verify response structure
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('metadata');

      const metricsData = response.body.data;
      expect(metricsData).toHaveProperty('metrics');
      expect(metricsData).toHaveProperty('timestamp');

      const metrics = metricsData.metrics;

      // Verify process metrics
      expect(metrics).toHaveProperty('process');
      expect(metrics.process).toHaveProperty('pid');
      expect(metrics.process).toHaveProperty('uptime');
      expect(metrics.process).toHaveProperty('version');
      expect(metrics.process).toHaveProperty('platform');
      expect(metrics.process).toHaveProperty('arch');

      // Verify memory metrics
      expect(metrics).toHaveProperty('memory');
      expect(metrics.memory).toHaveProperty('rss');
      expect(metrics.memory).toHaveProperty('heapUsed');
      expect(metrics.memory).toHaveProperty('heapTotal');
      expect(metrics.memory).toHaveProperty('external');

      // Verify CPU metrics
      expect(metrics).toHaveProperty('cpu');
      expect(metrics.cpu).toHaveProperty('user');
      expect(metrics.cpu).toHaveProperty('system');

      // Verify system metrics
      expect(metrics).toHaveProperty('system');
      expect(metrics.system).toHaveProperty('loadAverage');
      expect(metrics.system).toHaveProperty('totalMemory');
      expect(metrics.system).toHaveProperty('freeMemory');
      expect(metrics.system).toHaveProperty('cpus');

      // Verify database metrics
      expect(metrics).toHaveProperty('database');
      expect(metrics.database).toHaveProperty('connections');
      expect(metrics.database).toHaveProperty('readyState');

      // Verify numeric values are reasonable
      expect(typeof metrics.process.pid).toBe('number');
      expect(typeof metrics.process.uptime).toBe('number');
      expect(typeof metrics.memory.rss).toBe('number');
      expect(typeof metrics.system.totalMemory).toBe('number');
      expect(typeof metrics.system.cpus).toBe('number');

      expect(metrics.process.pid).toBeGreaterThan(0);
      expect(metrics.process.uptime).toBeGreaterThan(0);
      expect(metrics.memory.rss).toBeGreaterThan(0);
      expect(metrics.system.totalMemory).toBeGreaterThan(0);
      expect(metrics.system.cpus).toBeGreaterThan(0);
    });

    it('should return consistent process information', async () => {
      const response1 = await request(app).get('/metrics').expect(200);
      const response2 = await request(app).get('/metrics').expect(200);

      const metrics1 = response1.body.data.metrics;
      const metrics2 = response2.body.data.metrics;

      // Process info should be consistent
      expect(metrics1.process.pid).toBe(metrics2.process.pid);
      expect(metrics1.process.version).toBe(metrics2.process.version);
      expect(metrics1.process.platform).toBe(metrics2.process.platform);
      expect(metrics1.process.arch).toBe(metrics2.process.arch);

      // System info should be consistent
      expect(metrics1.system.totalMemory).toBe(metrics2.system.totalMemory);
      expect(metrics1.system.cpus).toBe(metrics2.system.cpus);

      // Uptime should increase (allowing for small timing differences)
      expect(metrics2.process.uptime).toBeGreaterThanOrEqual(metrics1.process.uptime);
    });
  });

  describe('Error Handling Tests', () => {
    it('should handle malformed requests gracefully', async () => {
      // Test with invalid paths
      await request(app).get('/health/invalid').expect(404);

      // Test with invalid methods
      await request(app).post('/health').expect(404);

      await request(app).put('/stats').expect(404);
    });

    it('should include proper error metadata in responses', async () => {
      const response = await request(app).get('/health').expect(200);

      // Verify metadata is always present
      expect(response.body.metadata).toHaveProperty('timestamp');
      expect(response.body.metadata).toHaveProperty('requestId');
      expect(response.body.metadata).toHaveProperty('version');

      // Verify timestamp format
      expect(() => new Date(response.body.metadata.timestamp)).not.toThrow();

      // Verify request ID is a string
      expect(typeof response.body.metadata.requestId).toBe('string');
      expect(response.body.metadata.requestId.length).toBeGreaterThan(0);
    });
  });
});
