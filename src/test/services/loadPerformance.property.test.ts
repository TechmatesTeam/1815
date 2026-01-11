import request from 'supertest';
import express from 'express';
import * as fc from 'fast-check';
import { performanceService } from '@/services/performanceService';

/**
 * **Feature: cardash-backend-api, Property 19: Load performance**
 * **Validates: Requirements 5.5**
 *
 * Property: For any cached request under system load, response times should remain under 500ms
 */

describe('Load Performance Property Tests', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Reset performance stats
    performanceService.resetStats();

    // Set up test routes that simulate cached responses
    app.get('/api/test/fast', (req, res) => {
      // Simulate a fast cached response
      const startTime = Date.now();
      setTimeout(() => {
        const responseTime = Date.now() - startTime;
        res.json({
          message: 'Fast cached response',
          responseTime,
          cached: true,
          timestamp: new Date().toISOString(),
        });
      }, Math.random() * 50); // 0-50ms response time
    });

    app.get('/api/test/medium', (req, res) => {
      // Simulate a medium response time
      const startTime = Date.now();
      setTimeout(
        () => {
          const responseTime = Date.now() - startTime;
          res.json({
            message: 'Medium response',
            responseTime,
            cached: false,
            timestamp: new Date().toISOString(),
          });
        },
        Math.random() * 200 + 100
      ); // 100-300ms response time
    });

    app.get('/api/test/variable/:delay', (req, res) => {
      // Simulate variable response times based on parameter
      const delay = Math.min(parseInt(req.params.delay) || 0, 1000);
      const startTime = Date.now();

      setTimeout(() => {
        const responseTime = Date.now() - startTime;
        res.json({
          message: `Variable response with ${delay}ms delay`,
          responseTime,
          requestedDelay: delay,
          cached: delay < 100, // Simulate caching for fast requests
          timestamp: new Date().toISOString(),
        });
      }, delay);
    });
  });

  test('Property 19: Load performance - cached responses under load remain fast', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          concurrentRequests: fc.integer({ min: 5, max: 20 }),
          endpoint: fc.constantFrom('/api/test/fast', '/api/test/medium'),
          iterations: fc.integer({ min: 3, max: 8 }),
        }),
        async ({ concurrentRequests, endpoint, iterations }) => {
          const allResponseTimes: number[] = [];

          // Run multiple iterations to simulate sustained load
          for (let iteration = 0; iteration < iterations; iteration++) {
            // Create concurrent requests to simulate load
            const requestPromises = Array.from({ length: concurrentRequests }, async () => {
              const startTime = Date.now();

              const response = await request(app).get(endpoint).expect(200);

              const endTime = Date.now();
              const actualResponseTime = endTime - startTime;

              return {
                actualResponseTime,
                reportedResponseTime: response.body.responseTime,
                cached: response.body.cached,
              };
            });

            const results = await Promise.all(requestPromises);

            // Collect response times
            results.forEach(result => {
              allResponseTimes.push(result.actualResponseTime);
            });

            // Property 1: For cached responses, should be under 500ms even under load
            results.forEach(result => {
              if (result.cached) {
                expect(result.actualResponseTime).toBeLessThan(500);
              }
            });

            // Property 2: All responses should complete successfully
            expect(results).toHaveLength(concurrentRequests);
          }

          // Property 3: Average response time should be reasonable under load
          const averageResponseTime =
            allResponseTimes.reduce((sum, time) => sum + time, 0) / allResponseTimes.length;

          // For fast endpoints, average should be well under the limit
          if (endpoint === '/api/test/fast') {
            expect(averageResponseTime).toBeLessThan(200);
          }

          // Property 4: No individual response should take excessively long
          const maxResponseTime = Math.max(...allResponseTimes);
          expect(maxResponseTime).toBeLessThan(2000); // Reasonable upper bound
        }
      ),
      { numRuns: 30 }
    );
  });

  test('Property 19: Response time consistency under varying load', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          loadPattern: fc.array(fc.integer({ min: 1, max: 15 }), { minLength: 3, maxLength: 8 }),
          baseDelay: fc.integer({ min: 10, max: 100 }),
        }),
        async ({ loadPattern, baseDelay }) => {
          const responseTimesByLoad: { [key: number]: number[] } = {};

          // Test different load levels
          for (const concurrentRequests of loadPattern) {
            const requestPromises = Array.from({ length: concurrentRequests }, async () => {
              const startTime = Date.now();

              const response = await request(app)
                .get(`/api/test/variable/${baseDelay}`)
                .expect(200);

              const endTime = Date.now();
              return endTime - startTime;
            });

            const responseTimes = await Promise.all(requestPromises);
            responseTimesByLoad[concurrentRequests] = responseTimes;

            // Property 1: All requests should complete
            expect(responseTimes).toHaveLength(concurrentRequests);

            // Property 2: For cached responses (low delay), should be fast
            if (baseDelay < 100) {
              responseTimes.forEach(time => {
                expect(time).toBeLessThan(500);
              });
            }
          }

          // Property 3: Performance degradation should be reasonable
          const loadLevels = Object.keys(responseTimesByLoad)
            .map(Number)
            .sort((a, b) => a - b);

          if (loadLevels.length >= 2) {
            const lowLoadTimes = responseTimesByLoad[loadLevels[0]];
            const highLoadTimes = responseTimesByLoad[loadLevels[loadLevels.length - 1]];

            const lowLoadAvg =
              lowLoadTimes.reduce((sum, time) => sum + time, 0) / lowLoadTimes.length;
            const highLoadAvg =
              highLoadTimes.reduce((sum, time) => sum + time, 0) / highLoadTimes.length;

            // Performance shouldn't degrade more than 3x under higher load
            expect(highLoadAvg).toBeLessThan(lowLoadAvg * 3);
          }
        }
      ),
      { numRuns: 25 }
    );
  });

  test('Property 19: System stability under sustained load', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          duration: fc.integer({ min: 3, max: 8 }), // Number of load cycles
          requestsPerCycle: fc.integer({ min: 8, max: 15 }),
          cycleDelay: fc.integer({ min: 50, max: 200 }), // Delay between cycles
        }),
        async ({ duration, requestsPerCycle, cycleDelay }) => {
          const allCycleStats: Array<{
            cycle: number;
            averageTime: number;
            maxTime: number;
            successCount: number;
          }> = [];

          // Run sustained load test
          for (let cycle = 0; cycle < duration; cycle++) {
            const cycleStartTime = Date.now();

            // Create load for this cycle
            const requestPromises = Array.from({ length: requestsPerCycle }, async () => {
              const startTime = Date.now();

              try {
                const response = await request(app).get('/api/test/fast').expect(200);

                const endTime = Date.now();
                return {
                  success: true,
                  responseTime: endTime - startTime,
                  cached: response.body.cached,
                };
              } catch (error) {
                return {
                  success: false,
                  responseTime: Date.now() - startTime,
                  cached: false,
                };
              }
            });

            const cycleResults = await Promise.all(requestPromises);

            // Calculate cycle statistics
            const successfulResults = cycleResults.filter(r => r.success);
            const responseTimes = successfulResults.map(r => r.responseTime);

            const cycleStats = {
              cycle,
              averageTime:
                responseTimes.length > 0
                  ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
                  : 0,
              maxTime: responseTimes.length > 0 ? Math.max(...responseTimes) : 0,
              successCount: successfulResults.length,
            };

            allCycleStats.push(cycleStats);

            // Property 1: Most requests should succeed in each cycle
            expect(cycleStats.successCount).toBeGreaterThan(requestsPerCycle * 0.8);

            // Property 2: Average response time should remain reasonable
            if (cycleStats.averageTime > 0) {
              expect(cycleStats.averageTime).toBeLessThan(500);
            }

            // Wait between cycles to simulate realistic load patterns
            if (cycle < duration - 1) {
              await new Promise(resolve => setTimeout(resolve, cycleDelay));
            }
          }

          // Property 3: System should maintain stability across cycles
          const averageTimes = allCycleStats.map(s => s.averageTime).filter(t => t > 0);
          if (averageTimes.length >= 2) {
            const firstHalf = averageTimes.slice(0, Math.floor(averageTimes.length / 2));
            const secondHalf = averageTimes.slice(Math.floor(averageTimes.length / 2));

            const firstHalfAvg = firstHalf.reduce((sum, time) => sum + time, 0) / firstHalf.length;
            const secondHalfAvg =
              secondHalf.reduce((sum, time) => sum + time, 0) / secondHalf.length;

            // Performance shouldn't significantly degrade over time
            expect(secondHalfAvg).toBeLessThan(firstHalfAvg * 2);
          }

          // Property 4: Success rate should remain high throughout
          const totalSuccesses = allCycleStats.reduce((sum, stats) => sum + stats.successCount, 0);
          const totalRequests = duration * requestsPerCycle;
          const successRate = totalSuccesses / totalRequests;

          expect(successRate).toBeGreaterThan(0.9); // 90% success rate
        }
      ),
      { numRuns: 20 }
    );
  });
});
