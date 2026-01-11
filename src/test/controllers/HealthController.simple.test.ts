import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { HealthController } from '../../controllers/HealthController';
import { connectDatabase, disconnectDatabase } from '../../config/database';
import { asyncHandler } from '../../middlewares/errorHandler';
import { requestId } from '../../middlewares/validation';

describe('HealthController Simple Tests', () => {
  let app: express.Application;

  beforeAll(async () => {
    await connectDatabase();

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
    await disconnectDatabase();
  });

  describe('Basic Health Check', () => {
    it('should return health status with proper structure', async () => {
      const response = await request(app)
        .get('/health')
        .expect(res => {
          // Should return either 200 or 503, but not crash
          expect([200, 503]).toContain(res.status);
        });

      // Verify response structure
      expect(response.body).toHaveProperty('success');
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

      // Verify dependencies object contains required services
      const deps = healthData.dependencies;
      expect(deps).toHaveProperty('mongodb');
      expect(deps).toHaveProperty('redis');
      expect(deps).toHaveProperty('blockfrost');
      expect(deps).toHaveProperty('cache');
      expect(deps).toHaveProperty('system');

      // Verify MongoDB health check (should be healthy since we connected)
      expect(deps.mongodb).toHaveProperty('status');
      expect(['healthy', 'unhealthy']).toContain(deps.mongodb.status);

      // Verify system metrics are always present
      expect(deps.system).toHaveProperty('status', 'healthy');
      expect(deps.system).toHaveProperty('memory');
    });

    it('should return stats with proper structure', async () => {
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

      // Verify basic structure
      expect(stats).toHaveProperty('aliases');
      expect(stats).toHaveProperty('users');
      expect(stats).toHaveProperty('searches');
      expect(stats).toHaveProperty('system');

      // Verify numeric values
      expect(typeof stats.aliases.total).toBe('number');
      expect(typeof stats.users.total).toBe('number');
      expect(typeof statsData.responseTime).toBe('number');
      expect(statsData.responseTime).toBeGreaterThan(0);
    });

    it('should return metrics with proper structure', async () => {
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

      // Verify memory metrics
      expect(metrics).toHaveProperty('memory');
      expect(metrics.memory).toHaveProperty('rss');
      expect(metrics.memory).toHaveProperty('heapUsed');

      // Verify system metrics
      expect(metrics).toHaveProperty('system');
      expect(metrics.system).toHaveProperty('totalMemory');
      expect(metrics.system).toHaveProperty('cpus');

      // Verify database metrics
      expect(metrics).toHaveProperty('database');
      expect(metrics.database).toHaveProperty('connections');
      expect(metrics.database).toHaveProperty('readyState');

      // Verify numeric values are reasonable
      expect(typeof metrics.process.pid).toBe('number');
      expect(typeof metrics.process.uptime).toBe('number');
      expect(metrics.process.pid).toBeGreaterThan(0);
      expect(metrics.process.uptime).toBeGreaterThan(0);
    });
  });
});
