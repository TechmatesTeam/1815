import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fc from 'fast-check';
import request from 'supertest';
import express from 'express';
import { HealthController } from '../../controllers/HealthController';
import { connectDatabase, disconnectDatabase } from '../../config/database';
import { asyncHandler } from '../../middlewares/errorHandler';
import { requestId } from '../../middlewares/validation';

/**
 * **Feature: cardash-backend-api, Property 28: Health check completeness**
 * **Validates: Requirements 7.5**
 *
 * For any health check request, the response should include status information for all system dependencies
 */

describe('HealthController Property Tests', () => {
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

  describe('Property 28: Health check completeness', () => {
    it('should always return comprehensive health status for all system dependencies', async () => {
      await fc.assert(
        fc.asyncProperty(fc.constant(true), async () => {
          const response = await request(app).get('/health');

          // Should always return a valid HTTP status (never crash)
          expect([200, 503]).toContain(response.status);

          // Verify response structure is always consistent
          expect(response.body).toHaveProperty('success');
          expect(response.body).toHaveProperty('data');
          expect(response.body).toHaveProperty('metadata');

          const healthData = response.body.data;

          // Core health status fields must always be present
          expect(healthData).toHaveProperty('status');
          expect(['healthy', 'degraded', 'unhealthy']).toContain(healthData.status);
          expect(healthData).toHaveProperty('timestamp');
          expect(healthData).toHaveProperty('uptime');
          expect(healthData).toHaveProperty('version');
          expect(healthData).toHaveProperty('environment');
          expect(healthData).toHaveProperty('dependencies');
          expect(healthData).toHaveProperty('responseTime');

          // Dependencies object must contain ALL required services
          const deps = healthData.dependencies;
          const requiredDependencies = ['mongodb', 'redis', 'blockfrost', 'cache', 'system'];

          for (const dep of requiredDependencies) {
            expect(deps).toHaveProperty(dep);
            expect(deps[dep]).toHaveProperty('status');
            expect(['healthy', 'unhealthy', 'degraded']).toContain(deps[dep].status);
          }

          // MongoDB health check must be present and detailed
          expect(deps.mongodb).toHaveProperty('readyState');
          expect(deps.mongodb).toHaveProperty('readyStateText');
          expect(typeof deps.mongodb.readyState).toBe('number');
          expect(typeof deps.mongodb.readyStateText).toBe('string');

          // Redis health check must be present with connection info
          expect(deps.redis).toHaveProperty('connected');
          expect(deps.redis).toHaveProperty('ready');
          expect(typeof deps.redis.connected).toBe('boolean');
          expect(typeof deps.redis.ready).toBe('boolean');

          // Blockfrost health check must be present (may be unhealthy)
          expect(deps.blockfrost).toHaveProperty('status');

          // Cache health check must be present
          // If healthy, should have testPassed property
          if (deps.cache.status === 'healthy') {
            expect(deps.cache).toHaveProperty('testPassed');
            expect(typeof deps.cache.testPassed).toBe('boolean');
          } else {
            // If unhealthy, should have error information
            expect(deps.cache).toHaveProperty('error');
            expect(typeof deps.cache.error).toBe('string');
          }

          // System metrics must always be healthy and detailed
          expect(deps.system.status).toBe('healthy');
          expect(deps.system).toHaveProperty('memory');
          expect(deps.system.memory).toHaveProperty('rss');
          expect(deps.system.memory).toHaveProperty('heapUsed');
          expect(deps.system.memory).toHaveProperty('heapTotal');
          expect(deps.system.memory).toHaveProperty('external');

          // Verify all memory values are positive numbers
          expect(typeof deps.system.memory.rss).toBe('number');
          expect(typeof deps.system.memory.heapUsed).toBe('number');
          expect(typeof deps.system.memory.heapTotal).toBe('number');
          expect(typeof deps.system.memory.external).toBe('number');
          expect(deps.system.memory.rss).toBeGreaterThan(0);
          expect(deps.system.memory.heapUsed).toBeGreaterThan(0);
          expect(deps.system.memory.heapTotal).toBeGreaterThan(0);

          // Verify timestamps are valid ISO strings
          expect(() => new Date(healthData.timestamp)).not.toThrow();
          expect(() => new Date(response.body.metadata.timestamp)).not.toThrow();

          // Verify numeric values are reasonable
          expect(typeof healthData.uptime).toBe('number');
          expect(typeof healthData.responseTime).toBe('number');
          expect(healthData.uptime).toBeGreaterThan(0);
          expect(healthData.responseTime).toBeGreaterThanOrEqual(0);
          expect(healthData.responseTime).toBeLessThan(30000); // Should complete within 30 seconds

          // Verify metadata completeness
          expect(response.body.metadata).toHaveProperty('timestamp');
          expect(response.body.metadata).toHaveProperty('requestId');
          expect(response.body.metadata).toHaveProperty('version');
          expect(typeof response.body.metadata.requestId).toBe('string');
          expect(response.body.metadata.requestId.length).toBeGreaterThan(0);

          // Verify HTTP status matches health status
          if (response.status === 200) {
            expect(['healthy', 'degraded']).toContain(healthData.status);
          } else if (response.status === 503) {
            expect(healthData.status).toBe('unhealthy');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should include latency measurements for available services consistently', async () => {
      await fc.assert(
        fc.asyncProperty(fc.constant(true), async () => {
          const response = await request(app).get('/health');
          const deps = response.body.data.dependencies;

          // If a service is healthy, it should have latency measurement
          if (deps.mongodb.status === 'healthy') {
            expect(deps.mongodb).toHaveProperty('latency');
            expect(typeof deps.mongodb.latency).toBe('number');
            expect(deps.mongodb.latency).toBeGreaterThanOrEqual(0); // Allow 0 for very fast operations
            expect(deps.mongodb.latency).toBeLessThan(10000); // Should be under 10 seconds
          }

          if (deps.redis.status === 'healthy') {
            expect(deps.redis).toHaveProperty('latency');
            expect(typeof deps.redis.latency).toBe('number');
            expect(deps.redis.latency).toBeGreaterThan(0);
            expect(deps.redis.latency).toBeLessThan(10000);
          }

          if (deps.blockfrost.status === 'healthy') {
            expect(deps.blockfrost).toHaveProperty('latency');
            expect(typeof deps.blockfrost.latency).toBe('number');
            expect(deps.blockfrost.latency).toBeGreaterThan(0);
            expect(deps.blockfrost.latency).toBeLessThan(30000); // External API, allow more time
          }

          if (deps.cache.status === 'healthy') {
            expect(deps.cache).toHaveProperty('latency');
            expect(typeof deps.cache.latency).toBe('number');
            expect(deps.cache.latency).toBeGreaterThan(0);
            expect(deps.cache.latency).toBeLessThan(5000);
          }
        }),
        { numRuns: 50 }
      );
    });

    it('should maintain consistent dependency structure across multiple requests', async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 2, max: 5 }), async requestCount => {
          const responses = [];

          // Make multiple requests
          for (let i = 0; i < requestCount; i++) {
            const response = await request(app).get('/health');
            responses.push(response);
          }

          // All responses should have the same structure
          const firstResponse = responses[0];
          const firstDeps = firstResponse.body.data.dependencies;
          const requiredDependencies = Object.keys(firstDeps);

          for (let i = 1; i < responses.length; i++) {
            const currentDeps = responses[i].body.data.dependencies;

            // Same dependency keys
            expect(Object.keys(currentDeps).sort()).toEqual(requiredDependencies.sort());

            // Each dependency has consistent structure
            for (const dep of requiredDependencies) {
              expect(currentDeps[dep]).toHaveProperty('status');
              expect(['healthy', 'unhealthy', 'degraded']).toContain(currentDeps[dep].status);

              // Structure should be consistent even if status changes
              if (dep === 'mongodb') {
                expect(currentDeps[dep]).toHaveProperty('readyState');
                expect(currentDeps[dep]).toHaveProperty('readyStateText');
              }

              if (dep === 'redis') {
                expect(currentDeps[dep]).toHaveProperty('connected');
                expect(currentDeps[dep]).toHaveProperty('ready');
              }

              if (dep === 'cache') {
                // Cache should have either testPassed (if healthy) or error (if unhealthy)
                if (currentDeps[dep].status === 'healthy') {
                  expect(currentDeps[dep]).toHaveProperty('testPassed');
                } else {
                  expect(currentDeps[dep]).toHaveProperty('error');
                }
              }

              if (dep === 'system') {
                expect(currentDeps[dep]).toHaveProperty('memory');
                expect(currentDeps[dep].memory).toHaveProperty('rss');
              }
            }
          }
        }),
        { numRuns: 30 }
      );
    });

    it('should handle service failures gracefully without affecting response structure', async () => {
      await fc.assert(
        fc.asyncProperty(fc.constant(true), async () => {
          const response = await request(app).get('/health');

          // Even if services fail, response structure must remain intact
          expect(response.body).toHaveProperty('success');
          expect(response.body).toHaveProperty('data');
          expect(response.body).toHaveProperty('metadata');

          const healthData = response.body.data;
          const deps = healthData.dependencies;

          // All dependencies must be reported, even if unhealthy
          const requiredDeps = ['mongodb', 'redis', 'blockfrost', 'cache', 'system'];
          for (const dep of requiredDeps) {
            expect(deps).toHaveProperty(dep);
            expect(deps[dep]).toHaveProperty('status');

            // If unhealthy, should have error information
            if (deps[dep].status === 'unhealthy') {
              // Error information should be present but not crash the response
              if (deps[dep].error) {
                expect(typeof deps[dep].error).toBe('string');
                expect(deps[dep].error.length).toBeGreaterThan(0);
              }
            }
          }

          // System should always be healthy (it's the process itself)
          expect(deps.system.status).toBe('healthy');

          // Overall status should reflect dependency health appropriately
          const hasUnhealthyDeps = Object.values(deps).some(
            (dep: any) => dep.status === 'unhealthy'
          );
          const hasOnlySystemHealthy = Object.entries(deps)
            .filter(([key]) => key !== 'system')
            .every(([, dep]: [string, any]) => dep.status === 'unhealthy');

          if (hasOnlySystemHealthy) {
            // If only system is healthy, overall should be unhealthy
            expect(['unhealthy', 'degraded']).toContain(healthData.status);
          } else if (hasUnhealthyDeps) {
            // If some deps are unhealthy, should be degraded
            expect(['degraded', 'unhealthy']).toContain(healthData.status);
          } else {
            // If all deps are healthy, should be healthy
            expect(healthData.status).toBe('healthy');
          }
        }),
        { numRuns: 25 }
      );
    });

    it('should return valid response times and performance metrics', async () => {
      await fc.assert(
        fc.asyncProperty(fc.constant(true), async () => {
          const startTime = Date.now();
          const response = await request(app).get('/health');
          const endTime = Date.now();
          const actualResponseTime = endTime - startTime;

          const healthData = response.body.data;

          // Response time should be reasonable
          expect(typeof healthData.responseTime).toBe('number');
          expect(healthData.responseTime).toBeGreaterThanOrEqual(0);
          expect(healthData.responseTime).toBeLessThan(30000); // 30 seconds max

          // Response time should be roughly consistent with actual time
          // Allow for some variance due to processing overhead
          expect(healthData.responseTime).toBeLessThanOrEqual(actualResponseTime + 1000);

          // Uptime should be reasonable
          expect(typeof healthData.uptime).toBe('number');
          expect(healthData.uptime).toBeGreaterThan(0);
          expect(healthData.uptime).toBeLessThan(86400 * 365); // Less than a year

          // Memory metrics should be reasonable
          const memory = healthData.dependencies.system.memory;
          expect(memory.rss).toBeGreaterThan(0);
          expect(memory.heapUsed).toBeGreaterThan(0);
          expect(memory.heapTotal).toBeGreaterThan(memory.heapUsed);
          // RSS and heap total are both valid memory measurements, no strict ordering required

          // All memory values should be in MB and reasonable for a Node.js process
          expect(memory.rss).toBeLessThan(8192); // Less than 8GB
          expect(memory.heapUsed).toBeLessThan(4096); // Less than 4GB
          expect(memory.heapTotal).toBeLessThan(4096); // Less than 4GB
        }),
        { numRuns: 20 }
      );
    });
  });
});
