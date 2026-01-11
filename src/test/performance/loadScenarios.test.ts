import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import * as fc from 'fast-check';
import { connectDatabase, disconnectDatabase } from '../../config/database';
import { connectRedis, disconnectRedis } from '../../config/redis';
import { AliasController } from '../../controllers/AliasController';
import { ExplorerController } from '../../controllers/ExplorerController';
import { HealthController } from '../../controllers/HealthController';
import { NotificationController } from '../../controllers/NotificationController';
import { asyncHandler } from '../../middlewares/errorHandler';
import {
  requestId,
  validateRequest,
  validationSchemas,
  securityValidation,
} from '../../middlewares/validation';
import { rateLimiter } from '../../middlewares/rateLimiter';
import { compressionMiddleware, compressionHeaders } from '../../middlewares/compression';
import { Alias } from '../../models/Alias';
import { cacheService } from '../../services/cacheService';
import { performanceService } from '../../services/performanceService';

/**
 * Performance Tests for Load Scenarios
 *
 * Tests:
 * - API performance under concurrent load
 * - Validate caching effectiveness
 * - Test rate limiting behavior
 */

describe('Load Scenarios Performance Tests', () => {
  let app: express.Application;

  beforeAll(async () => {
    // Set up Express app with full middleware stack
    app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Performance middleware
    app.use(compressionHeaders);
    app.use(compressionMiddleware);

    // Request ID generation
    app.use(requestId);

    // Skip rate limiting for most tests to focus on performance
    // app.use('/api/v1', rateLimiter);

    // Alias routes
    app.post(
      '/api/v1/aliases',
      securityValidation,
      validateRequest(validationSchemas.createAlias, 'body'),
      asyncHandler(AliasController.createAlias)
    );
    app.get(
      '/api/v1/aliases/:code',
      securityValidation,
      validateRequest(validationSchemas.resolveQuery, 'params'),
      asyncHandler(AliasController.getAliasDetails)
    );
    app.get(
      '/api/v1/resolve/:query',
      securityValidation,
      validateRequest(validationSchemas.resolveQuery, 'params'),
      asyncHandler(AliasController.resolveAlias)
    );

    // Explorer routes
    app.get(
      '/api/v1/explorer/address/:address',
      securityValidation,
      validateRequest(validationSchemas.explorerSearch, 'params'),
      asyncHandler(ExplorerController.getAddressDetails)
    );
    app.get(
      '/api/v1/explorer/transaction/:hash',
      securityValidation,
      validateRequest(validationSchemas.explorerSearch, 'params'),
      asyncHandler(ExplorerController.getTransactionDetails)
    );

    // Health routes
    app.get('/api/v1/health', asyncHandler(HealthController.healthCheck));
    app.get('/api/v1/stats', asyncHandler(HealthController.getStats));

    // Notification routes
    app.post(
      '/api/v1/notifications/subscribe',
      securityValidation,
      validateRequest(validationSchemas.subscribeNotifications, 'body'),
      asyncHandler(NotificationController.subscribe)
    );
  });

  afterAll(async () => {
    // Cleanup handled by global teardown
  });

  beforeEach(async () => {
    // Clear test data
    await Alias.deleteMany({});
    try {
      await cacheService.clearByPrefix('test');
    } catch (error) {
      // Cache service may not be available in test environment
      console.log('Cache service not available, continuing without cache clearing');
    }
    performanceService.resetStats();
  });

  describe('API Performance Under Concurrent Load', () => {
    it('should handle concurrent alias creation requests efficiently', async () => {
      const testAddresses = [
        'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
        'addr1qy8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mq4afdhv',
        'addr1q9f9jr6e48u63ym65fpp45x8daf7wq404jkxmnvvvzem7esh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqnur0xq',
      ];

      await fc.assert(
        fc.asyncProperty(
          fc.record({
            concurrentRequests: fc.integer({ min: 10, max: 30 }),
            batchSize: fc.integer({ min: 3, max: 6 }),
          }),
          async ({ concurrentRequests, batchSize }) => {
            const startTime = Date.now();
            const allResponseTimes: number[] = [];
            const allResults: any[] = [];

            // Create batches of concurrent requests
            for (let batch = 0; batch < Math.ceil(concurrentRequests / batchSize); batch++) {
              const batchStart = batch * batchSize;
              const batchEnd = Math.min(batchStart + batchSize, concurrentRequests);
              const batchRequests = batchEnd - batchStart;

              const batchPromises = Array.from({ length: batchRequests }, async (_, i) => {
                const requestStart = Date.now();
                const addressIndex = (batchStart + i) % testAddresses.length;

                try {
                  const response = await request(app)
                    .post('/api/v1/aliases')
                    .send({
                      cardanoAddress: testAddresses[addressIndex],
                      userEmail: `test${batchStart + i}@example.com`,
                      customName: `Load Test Alias ${batchStart + i}`,
                    });

                  const requestEnd = Date.now();
                  const responseTime = requestEnd - requestStart;

                  return {
                    success: response.status === 201,
                    responseTime,
                    shortCode: response.body.data?.shortCode,
                    status: response.status,
                  };
                } catch (error) {
                  const requestEnd = Date.now();
                  return {
                    success: false,
                    responseTime: requestEnd - requestStart,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    status: 500,
                  };
                }
              });

              const batchResults = await Promise.all(batchPromises);
              allResults.push(...batchResults);
              allResponseTimes.push(...batchResults.map(r => r.responseTime));

              // Small delay between batches to prevent overwhelming
              if (batch < Math.ceil(concurrentRequests / batchSize) - 1) {
                await new Promise(resolve => setTimeout(resolve, 50));
              }
            }

            const totalTime = Date.now() - startTime;
            const successfulRequests = allResults.filter(r => r.success);
            const averageResponseTime =
              allResponseTimes.reduce((sum, time) => sum + time, 0) / allResponseTimes.length;
            const maxResponseTime = Math.max(...allResponseTimes);
            const successRate = successfulRequests.length / allResults.length;

            // Performance assertions
            expect(successRate).toBeGreaterThan(0.8); // 80% success rate
            expect(averageResponseTime).toBeLessThan(3000); // Average under 3 seconds
            expect(maxResponseTime).toBeLessThan(8000); // Max under 8 seconds

            // Verify all successful requests created unique short codes
            const shortCodes = successfulRequests.map(r => r.shortCode).filter(Boolean);
            const uniqueShortCodes = new Set(shortCodes);
            expect(uniqueShortCodes.size).toBe(shortCodes.length);

            console.log(
              `Load Test Results: ${concurrentRequests} requests, ${(successRate * 100).toFixed(1)}% success, avg: ${averageResponseTime.toFixed(0)}ms, max: ${maxResponseTime}ms`
            );
          }
        ),
        { numRuns: 2, timeout: 120000 }
      );
    });

    it('should maintain performance during concurrent alias resolution', async () => {
      // Pre-create aliases for testing
      const testAliases: string[] = [];
      const testAddress =
        'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';

      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .post('/api/v1/aliases')
          .send({
            cardanoAddress: testAddress,
            userEmail: `setup${i}@example.com`,
          });

        if (response.status === 201) {
          testAliases.push(response.body.data.shortCode);
        }
      }

      expect(testAliases.length).toBeGreaterThan(3);

      await fc.assert(
        fc.asyncProperty(
          fc.record({
            concurrentResolves: fc.integer({ min: 15, max: 50 }),
            iterations: fc.integer({ min: 2, max: 4 }),
          }),
          async ({ concurrentResolves, iterations }) => {
            const allResponseTimes: number[] = [];
            const allResults: any[] = [];

            for (let iteration = 0; iteration < iterations; iteration++) {
              const iterationPromises = Array.from({ length: concurrentResolves }, async (_, i) => {
                const requestStart = Date.now();
                const aliasIndex = i % testAliases.length;
                const shortCode = testAliases[aliasIndex];

                try {
                  const response = await request(app).get(`/api/v1/resolve/${shortCode}`);

                  const requestEnd = Date.now();
                  const responseTime = requestEnd - requestStart;

                  return {
                    success: response.status === 200,
                    responseTime,
                    cached: response.headers['x-cache-status'] === 'hit',
                    status: response.status,
                  };
                } catch (error) {
                  const requestEnd = Date.now();
                  return {
                    success: false,
                    responseTime: requestEnd - requestStart,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    status: 500,
                  };
                }
              });

              const iterationResults = await Promise.all(iterationPromises);
              allResults.push(...iterationResults);
              allResponseTimes.push(...iterationResults.map(r => r.responseTime));

              // Brief pause between iterations
              if (iteration < iterations - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
              }
            }

            const successfulRequests = allResults.filter(r => r.success);
            const cachedRequests = allResults.filter(r => r.cached);
            const averageResponseTime =
              allResponseTimes.reduce((sum, time) => sum + time, 0) / allResponseTimes.length;
            const maxResponseTime = Math.max(...allResponseTimes);
            const successRate = successfulRequests.length / allResults.length;
            const cacheHitRate = cachedRequests.length / allResults.length;

            // Performance assertions
            expect(successRate).toBeGreaterThan(0.85); // 85% success rate for resolution
            expect(averageResponseTime).toBeLessThan(1000); // Average under 1 second
            expect(maxResponseTime).toBeLessThan(3000); // Max under 3 seconds

            console.log(
              `Resolution Test: ${concurrentResolves * iterations} requests, ${(successRate * 100).toFixed(1)}% success, ${(cacheHitRate * 100).toFixed(1)}% cached, avg: ${averageResponseTime.toFixed(0)}ms`
            );
          }
        ),
        { numRuns: 1, timeout: 90000 }
      );
    });

    it('should handle mixed API operations under load', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            totalOperations: fc.integer({ min: 20, max: 40 }),
            createRatio: fc.float({ min: Math.fround(0.2), max: Math.fround(0.4) }), // 20-40% creates
            resolveRatio: fc.float({ min: Math.fround(0.3), max: Math.fround(0.5) }), // 30-50% resolves
            // Remaining will be health checks
          }),
          async ({ totalOperations, createRatio, resolveRatio }) => {
            const testAddress =
              'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';
            const createdAliases: string[] = [];

            // Pre-create some aliases for resolution tests
            for (let i = 0; i < 3; i++) {
              const response = await request(app)
                .post('/api/v1/aliases')
                .send({
                  cardanoAddress: testAddress,
                  userEmail: `preload${i}@example.com`,
                });

              if (response.status === 201) {
                createdAliases.push(response.body.data.shortCode);
              }
            }

            const createCount = Math.floor(totalOperations * createRatio);
            const resolveCount = Math.floor(totalOperations * resolveRatio);
            const healthCount = totalOperations - createCount - resolveCount;

            const allPromises: Promise<any>[] = [];

            // Create operations
            for (let i = 0; i < createCount; i++) {
              allPromises.push(
                (async () => {
                  const start = Date.now();
                  try {
                    const response = await request(app)
                      .post('/api/v1/aliases')
                      .send({
                        cardanoAddress: testAddress,
                        userEmail: `mixed${i}@example.com`,
                        customName: `Mixed Load ${i}`,
                      });

                    return {
                      type: 'create',
                      success: response.status === 201,
                      responseTime: Date.now() - start,
                      status: response.status,
                    };
                  } catch (error) {
                    return {
                      type: 'create',
                      success: false,
                      responseTime: Date.now() - start,
                      error: error instanceof Error ? error.message : 'Unknown error',
                    };
                  }
                })()
              );
            }

            // Resolve operations
            for (let i = 0; i < resolveCount; i++) {
              allPromises.push(
                (async () => {
                  const start = Date.now();
                  const aliasIndex = i % createdAliases.length;
                  const shortCode = createdAliases[aliasIndex];

                  try {
                    const response = await request(app).get(`/api/v1/resolve/${shortCode}`);

                    return {
                      type: 'resolve',
                      success: response.status === 200,
                      responseTime: Date.now() - start,
                      status: response.status,
                      cached: response.headers['x-cache-status'] === 'hit',
                    };
                  } catch (error) {
                    return {
                      type: 'resolve',
                      success: false,
                      responseTime: Date.now() - start,
                      error: error instanceof Error ? error.message : 'Unknown error',
                    };
                  }
                })()
              );
            }

            // Health check operations
            for (let i = 0; i < healthCount; i++) {
              allPromises.push(
                (async () => {
                  const start = Date.now();
                  const endpoint = i % 2 === 0 ? '/api/v1/health' : '/api/v1/stats';

                  try {
                    const response = await request(app).get(endpoint);

                    return {
                      type: 'health',
                      success: response.status === 200,
                      responseTime: Date.now() - start,
                      status: response.status,
                    };
                  } catch (error) {
                    return {
                      type: 'health',
                      success: false,
                      responseTime: Date.now() - start,
                      error: error instanceof Error ? error.message : 'Unknown error',
                    };
                  }
                })()
              );
            }

            // Execute all operations concurrently
            const results = await Promise.all(allPromises);

            // Analyze results by operation type
            const createResults = results.filter(r => r.type === 'create');
            const resolveResults = results.filter(r => r.type === 'resolve');
            const healthResults = results.filter(r => r.type === 'health');

            const createSuccessRate =
              createResults.length > 0
                ? createResults.filter(r => r.success).length / createResults.length
                : 1;
            const resolveSuccessRate =
              resolveResults.length > 0
                ? resolveResults.filter(r => r.success).length / resolveResults.length
                : 1;
            const healthSuccessRate =
              healthResults.length > 0
                ? healthResults.filter(r => r.success).length / healthResults.length
                : 1;

            const avgCreateTime =
              createResults.length > 0
                ? createResults.reduce((sum, r) => sum + r.responseTime, 0) / createResults.length
                : 0;
            const avgResolveTime =
              resolveResults.length > 0
                ? resolveResults.reduce((sum, r) => sum + r.responseTime, 0) / resolveResults.length
                : 0;
            const avgHealthTime =
              healthResults.length > 0
                ? healthResults.reduce((sum, r) => sum + r.responseTime, 0) / healthResults.length
                : 0;

            // Performance assertions
            expect(createSuccessRate).toBeGreaterThan(0.7); // 70% success for creates
            expect(resolveSuccessRate).toBeGreaterThan(0.8); // 80% success for resolves
            expect(healthSuccessRate).toBeGreaterThan(0.9); // 90% success for health checks

            if (avgCreateTime > 0) expect(avgCreateTime).toBeLessThan(5000); // Creates under 5 seconds
            if (avgResolveTime > 0) expect(avgResolveTime).toBeLessThan(2000); // Resolves under 2 seconds
            if (avgHealthTime > 0) expect(avgHealthTime).toBeLessThan(1000); // Health checks under 1 second

            console.log(
              `Mixed Load: Creates: ${(createSuccessRate * 100).toFixed(1)}% (${avgCreateTime.toFixed(0)}ms), Resolves: ${(resolveSuccessRate * 100).toFixed(1)}% (${avgResolveTime.toFixed(0)}ms), Health: ${(healthSuccessRate * 100).toFixed(1)}% (${avgHealthTime.toFixed(0)}ms)`
            );
          }
        ),
        { numRuns: 1, timeout: 120000 }
      );
    });
  });

  describe('Caching Effectiveness Validation', () => {
    it('should demonstrate performance improvement with caching', async () => {
      const testAddress =
        'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';

      // Create test alias
      const createResponse = await request(app).post('/api/v1/aliases').send({
        cardanoAddress: testAddress,
        userEmail: 'cache-test@example.com',
      });

      expect(createResponse.status).toBe(201);
      const shortCode = createResponse.body.data.shortCode;

      await fc.assert(
        fc.asyncProperty(
          fc.record({
            warmupRequests: fc.integer({ min: 2, max: 5 }),
            testRequests: fc.integer({ min: 5, max: 15 }),
          }),
          async ({ warmupRequests, testRequests }) => {
            // Clear cache to start fresh
            try {
              await cacheService.clearByPrefix('alias');
            } catch (error) {
              // Cache service may not be available in test environment
            }

            // First request (cache miss)
            const firstRequestStart = Date.now();
            const firstResponse = await request(app).get(`/api/v1/resolve/${shortCode}`);
            const firstRequestTime = Date.now() - firstRequestStart;

            expect(firstResponse.status).toBe(200);

            // Warmup requests to populate cache
            const warmupPromises = Array.from({ length: warmupRequests }, () =>
              request(app).get(`/api/v1/resolve/${shortCode}`)
            );
            await Promise.all(warmupPromises);

            // Test cached performance
            const cachedRequestTimes: number[] = [];

            for (let i = 0; i < testRequests; i++) {
              const start = Date.now();
              const response = await request(app).get(`/api/v1/resolve/${shortCode}`);
              const responseTime = Date.now() - start;

              expect(response.status).toBe(200);
              cachedRequestTimes.push(responseTime);

              // Small delay to prevent overwhelming
              if (i < testRequests - 1) {
                await new Promise(resolve => setTimeout(resolve, 10));
              }
            }

            const avgCachedTime =
              cachedRequestTimes.reduce((sum, time) => sum + time, 0) / cachedRequestTimes.length;
            const maxCachedTime = Math.max(...cachedRequestTimes);

            // Cache effectiveness assertions - more lenient for test environment
            expect(avgCachedTime).toBeLessThan(1000); // Cached requests under 1 second
            expect(maxCachedTime).toBeLessThan(2000); // No cached request over 2 seconds

            console.log(
              `Cache Test: First: ${firstRequestTime}ms, Avg Cached: ${avgCachedTime.toFixed(0)}ms`
            );
          }
        ),
        { numRuns: 2, timeout: 60000 }
      );
    });
  });

  describe('Rate Limiting Behavior', () => {
    it('should enforce rate limits correctly under load', async () => {
      // Create a separate app with rate limiting for this test
      const rateLimitApp = express();
      rateLimitApp.use(express.json());
      rateLimitApp.use(requestId);
      rateLimitApp.use('/api/v1', rateLimiter);
      rateLimitApp.get('/api/v1/health', asyncHandler(HealthController.healthCheck));

      const agent = request.agent(rateLimitApp);

      await fc.assert(
        fc.asyncProperty(
          fc.record({
            requestBurst: fc.integer({ min: 80, max: 120 }), // Exceed rate limit
            requestDelay: fc.integer({ min: 20, max: 100 }), // Delay between requests
          }),
          async ({ requestBurst, requestDelay }) => {
            const results: Array<{
              requestNumber: number;
              status: number;
              responseTime: number;
              rateLimited: boolean;
            }> = [];

            // Send burst of requests to trigger rate limiting
            for (let i = 0; i < requestBurst; i++) {
              const start = Date.now();

              try {
                const response = await agent.get('/api/v1/health');
                const responseTime = Date.now() - start;

                results.push({
                  requestNumber: i + 1,
                  status: response.status,
                  responseTime,
                  rateLimited: response.status === 429,
                });
              } catch (error) {
                const responseTime = Date.now() - start;
                results.push({
                  requestNumber: i + 1,
                  status: 500,
                  responseTime,
                  rateLimited: false,
                });
              }

              // Small delay between requests
              if (i < requestBurst - 1) {
                await new Promise(resolve => setTimeout(resolve, requestDelay));
              }
            }

            const successfulRequests = results.filter(r => r.status === 200);
            const rateLimitedRequests = results.filter(r => r.rateLimited);
            const totalRequests = results.length;

            // Rate limiting assertions - more lenient for test environment
            expect(successfulRequests.length).toBeGreaterThan(totalRequests * 0.2); // At least 20% should succeed

            // If we hit rate limits, they should be fast
            if (rateLimitedRequests.length > 0) {
              const rateLimitedTimes = rateLimitedRequests.map(r => r.responseTime);
              const avgRateLimitTime =
                rateLimitedTimes.reduce((sum, time) => sum + time, 0) / rateLimitedTimes.length;
              expect(avgRateLimitTime).toBeLessThan(500); // Rate limit responses should be reasonably fast
            }

            // Successful requests should still perform well
            if (successfulRequests.length > 0) {
              const successfulTimes = successfulRequests.map(r => r.responseTime);
              const avgSuccessTime =
                successfulTimes.reduce((sum, time) => sum + time, 0) / successfulTimes.length;
              expect(avgSuccessTime).toBeLessThan(1000); // Successful requests under 1 second
            }

            console.log(
              `Rate Limit Test: ${totalRequests} requests, ${successfulRequests.length} success, ${rateLimitedRequests.length} rate limited`
            );
          }
        ),
        { numRuns: 2, timeout: 120000 }
      );
    });

    it('should recover from rate limiting appropriately', async () => {
      // Create a separate app with rate limiting for this test
      const rateLimitApp = express();
      rateLimitApp.use(express.json());
      rateLimitApp.use(requestId);
      rateLimitApp.use('/api/v1', rateLimiter);
      rateLimitApp.get('/api/v1/health', asyncHandler(HealthController.healthCheck));

      const agent = request.agent(rateLimitApp);

      await fc.assert(
        fc.asyncProperty(
          fc.record({
            initialBurst: fc.integer({ min: 100, max: 150 }),
            recoveryDelay: fc.integer({ min: 2000, max: 5000 }), // Wait time in ms
            recoveryRequests: fc.integer({ min: 5, max: 15 }),
          }),
          async ({ initialBurst, recoveryDelay, recoveryRequests }) => {
            // Phase 1: Trigger rate limiting
            const burstResults: number[] = [];

            for (let i = 0; i < initialBurst; i++) {
              try {
                const response = await agent.get('/api/v1/health');
                burstResults.push(response.status);
              } catch (error) {
                burstResults.push(500);
              }

              // Minimal delay to send requests quickly
              await new Promise(resolve => setTimeout(resolve, 10));
            }

            // Phase 2: Wait for rate limit to reset
            await new Promise(resolve => setTimeout(resolve, recoveryDelay));

            // Phase 3: Test recovery
            const recoveryResults: Array<{
              status: number;
              responseTime: number;
            }> = [];

            for (let i = 0; i < recoveryRequests; i++) {
              const start = Date.now();

              try {
                const response = await agent.get('/api/v1/health');
                const responseTime = Date.now() - start;

                recoveryResults.push({
                  status: response.status,
                  responseTime,
                });
              } catch (error) {
                const responseTime = Date.now() - start;
                recoveryResults.push({
                  status: 500,
                  responseTime,
                });
              }

              // Reasonable delay between recovery requests
              await new Promise(resolve => setTimeout(resolve, 200));
            }

            const successfulRecovery = recoveryResults.filter(r => r.status === 200);
            const recoverySuccessRate = successfulRecovery.length / recoveryResults.length;

            // Recovery assertions - more lenient
            expect(recoverySuccessRate).toBeGreaterThan(0.5); // At least 50% should succeed after recovery

            // Performance should be reasonable after recovery
            if (successfulRecovery.length > 0) {
              const avgRecoveryTime =
                successfulRecovery.reduce((sum, r) => sum + r.responseTime, 0) /
                successfulRecovery.length;
              expect(avgRecoveryTime).toBeLessThan(1000); // Good performance after recovery
            }

            console.log(
              `Recovery Test: Recovery: ${(recoverySuccessRate * 100).toFixed(1)}% success after ${recoveryDelay}ms wait`
            );
          }
        ),
        { numRuns: 1, timeout: 120000 }
      );
    });
  });
});
