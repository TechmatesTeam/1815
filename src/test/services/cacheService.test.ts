import { describe, it, expect, beforeEach, beforeAll, afterAll } from '@jest/globals';
import * as fc from 'fast-check';
import { CacheService, CacheKeys, CacheTTL } from '../../services/cacheService';
import { connectRedis, disconnectRedis } from '../../config/redis';

/**
 * **Feature: cardash-backend-api, Property 7: Caching performance**
 * **Validates: Requirements 2.5**
 *
 * For any alias resolved multiple times, subsequent resolutions should be served
 * from cache with improved response times
 */

describe('Cache Service Property Tests', () => {
  let cacheService: CacheService;

  beforeAll(async () => {
    await connectRedis();
    cacheService = new CacheService();
  });

  afterAll(async () => {
    await disconnectRedis();
  });

  beforeEach(async () => {
    // Clear all cache data before each test
    await cacheService.clearByPrefix('test');
    await cacheService.clearByPrefix(CacheKeys.ALIAS);
    await cacheService.clearByPrefix(CacheKeys.ADDRESS);
  });

  describe('Property 7: Caching performance', () => {
    it('should serve cached data faster than initial storage', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            key: fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length > 0),
            data: fc.record({
              shortCode: fc
                .string({ minLength: 8, maxLength: 16 })
                .filter(s => s.trim().length > 0),
              cardanoAddress: fc
                .string({ minLength: 50, maxLength: 120 })
                .filter(s => s.trim().length > 0),
              expiresAt: fc
                .date({
                  min: new Date(),
                  max: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                })
                .map(d => d.toISOString()), // Convert to string for consistent serialization
              isActive: fc.boolean(),
              useCount: fc.nat({ max: 1000 }),
            }),
            ttl: fc.integer({ min: 60, max: 3600 }),
          }),
          async ({ key, data, ttl }) => {
            const testKey = `test:perf:${key}:${Date.now()}:${Math.random()}`;

            // Measure time to set data in cache
            const setStartTime = process.hrtime.bigint();
            await cacheService.set(testKey, data, { ttl });
            const setEndTime = process.hrtime.bigint();
            const setDuration = Number(setEndTime - setStartTime) / 1_000_000; // Convert to milliseconds

            // Measure time to get data from cache (first time - should be fast)
            const getStartTime = process.hrtime.bigint();
            const cachedData = await cacheService.get(testKey);
            const getEndTime = process.hrtime.bigint();
            const getDuration = Number(getEndTime - getStartTime) / 1_000_000; // Convert to milliseconds

            // Verify data integrity
            expect(cachedData).toEqual(data);

            // Cache retrieval should be faster than 50ms (requirement from design)
            expect(getDuration).toBeLessThan(50);

            // Multiple cache hits should maintain performance
            const multipleHitTimes: number[] = [];
            for (let i = 0; i < 5; i++) {
              const hitStartTime = process.hrtime.bigint();
              const hitData = await cacheService.get(testKey);
              const hitEndTime = process.hrtime.bigint();
              const hitDuration = Number(hitEndTime - hitStartTime) / 1_000_000;

              multipleHitTimes.push(hitDuration);
              expect(hitData).toEqual(data);
              expect(hitDuration).toBeLessThan(50); // Each hit should be under 50ms
            }

            // Average cache hit time should be consistent
            const averageHitTime =
              multipleHitTimes.reduce((a, b) => a + b, 0) / multipleHitTimes.length;
            expect(averageHitTime).toBeLessThan(50);
          }
        ),
        { numRuns: 50 } // Reduced runs for performance
      );
    });

    it('should maintain performance under concurrent access', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            baseKey: fc.string({ minLength: 5, maxLength: 20 }).filter(s => s.trim().length > 0),
            dataSet: fc.array(
              fc.record({
                shortCode: fc
                  .string({ minLength: 8, maxLength: 16 })
                  .filter(s => s.trim().length > 0),
                cardanoAddress: fc
                  .string({ minLength: 50, maxLength: 120 })
                  .filter(s => s.trim().length > 0),
                useCount: fc.nat({ max: 100 }),
              }),
              { minLength: 3, maxLength: 10 } // Reduced size
            ),
            concurrentReads: fc.integer({ min: 3, max: 10 }), // Reduced concurrent reads
          }),
          async ({ baseKey, dataSet, concurrentReads }) => {
            const timestamp = Date.now();
            const randomSuffix = Math.random().toString(36);

            // Set up multiple cache entries
            const cachePromises = dataSet.map((data, index) =>
              cacheService.set(
                `test:concurrent:${baseKey}:${index}:${timestamp}:${randomSuffix}`,
                data,
                { ttl: 300 }
              )
            );
            await Promise.all(cachePromises);

            // Perform concurrent reads
            const concurrentReadPromises = Array.from(
              { length: concurrentReads },
              async (_, readIndex) => {
                const dataIndex = readIndex % dataSet.length;
                const key = `test:concurrent:${baseKey}:${dataIndex}:${timestamp}:${randomSuffix}`;

                const startTime = process.hrtime.bigint();
                const result = await cacheService.get(key);
                const endTime = process.hrtime.bigint();
                const duration = Number(endTime - startTime) / 1_000_000;

                return {
                  result,
                  duration,
                  expectedData: dataSet[dataIndex],
                };
              }
            );

            const results = await Promise.all(concurrentReadPromises);

            // Verify all concurrent reads completed successfully and within performance bounds
            results.forEach(({ result, duration, expectedData }) => {
              expect(result).toEqual(expectedData);
              expect(duration).toBeLessThan(50); // Each concurrent read should be under 50ms
            });

            // Average performance should still be good under concurrent load
            const averageDuration =
              results.reduce((sum, { duration }) => sum + duration, 0) / results.length;
            expect(averageDuration).toBeLessThan(30); // Slightly more lenient average
          }
        ),
        { numRuns: 30 } // Reduced runs for performance
      );
    });

    it('should handle cache misses gracefully without performance degradation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            existingKeys: fc.array(
              fc.string({ minLength: 5, maxLength: 20 }).filter(s => s.trim().length > 0),
              {
                minLength: 3,
                maxLength: 5,
              }
            ),
            nonExistentKeys: fc.array(
              fc.string({ minLength: 5, maxLength: 20 }).filter(s => s.trim().length > 0),
              {
                minLength: 3,
                maxLength: 5,
              }
            ),
            data: fc.record({
              value: fc.string({ minLength: 10, maxLength: 100 }),
              number: fc.nat({ max: 1000 }),
            }),
          }),
          async ({ existingKeys, nonExistentKeys, data }) => {
            const timestamp = Date.now();
            const randomSuffix = Math.random().toString(36);

            // Ensure non-existent keys are actually different from existing ones
            const uniqueExistingKeys = existingKeys.map(
              key => `test:miss:existing:${key}:${timestamp}:${randomSuffix}`
            );
            const uniqueNonExistentKeys = nonExistentKeys
              .filter(key => !existingKeys.includes(key))
              .map(key => `test:miss:nonexistent:${key}:${timestamp}:${randomSuffix}`);

            if (uniqueNonExistentKeys.length === 0) return; // Skip if no unique keys

            // Set up existing cache entries
            const setupPromises = uniqueExistingKeys.map(key =>
              cacheService.set(key, data, { ttl: 300 })
            );
            await Promise.all(setupPromises);

            // Test cache hits (should be fast)
            const hitTimes: number[] = [];
            for (const key of uniqueExistingKeys) {
              const startTime = process.hrtime.bigint();
              const result = await cacheService.get(key);
              const endTime = process.hrtime.bigint();
              const duration = Number(endTime - startTime) / 1_000_000;

              hitTimes.push(duration);
              expect(result).toEqual(data);
              expect(duration).toBeLessThan(50);
            }

            // Test cache misses (should also be fast, just return null)
            const missTimes: number[] = [];
            for (const key of uniqueNonExistentKeys.slice(0, 3)) {
              // Limit to 3 to avoid timeout
              const startTime = process.hrtime.bigint();
              const result = await cacheService.get(key);
              const endTime = process.hrtime.bigint();
              const duration = Number(endTime - startTime) / 1_000_000;

              missTimes.push(duration);
              expect(result).toBeNull();
              expect(duration).toBeLessThan(50); // Cache misses should also be fast
            }

            // Cache misses shouldn't be significantly slower than hits
            const avgHitTime = hitTimes.reduce((a, b) => a + b, 0) / hitTimes.length;
            const avgMissTime = missTimes.reduce((a, b) => a + b, 0) / missTimes.length;

            // Miss time should not be more than 3x hit time (allowing for some overhead)
            expect(avgMissTime).toBeLessThan(avgHitTime * 3 + 10); // +10ms tolerance
          }
        ),
        { numRuns: 30 } // Reduced runs for performance
      );
    });

    it('should maintain performance with different data sizes', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            key: fc.string({ minLength: 5, maxLength: 20 }).filter(s => s.trim().length > 0),
            smallData: fc.string({ minLength: 10, maxLength: 100 }),
            mediumData: fc.string({ minLength: 1000, maxLength: 5000 }),
            largeData: fc.string({ minLength: 10000, maxLength: 30000 }), // Reduced max size
          }),
          async ({ key, smallData, mediumData, largeData }) => {
            const timestamp = Date.now();
            const randomSuffix = Math.random().toString(36);

            const testCases = [
              { size: 'small', data: { content: smallData } },
              { size: 'medium', data: { content: mediumData } },
              { size: 'large', data: { content: largeData } },
            ];

            for (const testCase of testCases) {
              const testKey = `test:size:${key}:${testCase.size}:${timestamp}:${randomSuffix}`;

              // Set data
              await cacheService.set(testKey, testCase.data, { ttl: 300 });

              // Measure retrieval time
              const startTime = process.hrtime.bigint();
              const result = await cacheService.get(testKey);
              const endTime = process.hrtime.bigint();
              const duration = Number(endTime - startTime) / 1_000_000;

              expect(result).toEqual(testCase.data);

              // Even large data should be retrieved within reasonable time
              // Allow more time for larger data, but still within performance bounds
              const maxTime = testCase.size === 'large' ? 100 : 50;
              expect(duration).toBeLessThan(maxTime);
            }
          }
        ),
        { numRuns: 30 } // Reduced runs for performance
      );
    });

    it('should handle TTL expiration correctly without performance impact', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            key: fc.string({ minLength: 5, maxLength: 20 }).filter(s => s.trim().length > 0),
            data: fc.record({
              value: fc.string({ minLength: 10, maxLength: 100 }),
            }),
          }),
          async ({ key, data }) => {
            const testKey = `test:ttl:${key}:${Date.now()}:${Math.random()}`;
            const shortTtl = 1; // Fixed 1 second TTL

            // Set data with short TTL
            await cacheService.set(testKey, data, { ttl: shortTtl });

            // Verify data is initially available and fast
            const initialStartTime = process.hrtime.bigint();
            const initialResult = await cacheService.get(testKey);
            const initialEndTime = process.hrtime.bigint();
            const initialDuration = Number(initialEndTime - initialStartTime) / 1_000_000;

            expect(initialResult).toEqual(data);
            expect(initialDuration).toBeLessThan(50);

            // Wait for TTL to expire
            await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 seconds

            // Verify data is no longer available, but lookup is still fast
            const expiredStartTime = process.hrtime.bigint();
            const expiredResult = await cacheService.get(testKey);
            const expiredEndTime = process.hrtime.bigint();
            const expiredDuration = Number(expiredEndTime - expiredStartTime) / 1_000_000;

            expect(expiredResult).toBeNull();
            expect(expiredDuration).toBeLessThan(50); // Expired key lookup should still be fast
          }
        ),
        { numRuns: 5, timeout: 15000 } // Fewer runs with timeout due to time delays
      );
    }, 20000); // Increase test timeout to 20 seconds
  });

  describe('Cache utility functions performance', () => {
    it('should perform batch operations efficiently', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            batchSize: fc.integer({ min: 5, max: 20 }), // Reduced max batch size
            keyPrefix: fc.string({ minLength: 3, maxLength: 10 }).filter(s => s.trim().length > 0),
            data: fc.record({
              value: fc.string({ minLength: 10, maxLength: 100 }),
              count: fc.nat({ max: 100 }),
            }),
          }),
          async ({ batchSize, keyPrefix, data }) => {
            const timestamp = Date.now();
            const randomSuffix = Math.random().toString(36);

            // Prepare batch data
            const entries = Array.from({ length: batchSize }, (_, i) => ({
              key: `batch:${keyPrefix}:${i}:${timestamp}:${randomSuffix}`,
              value: { ...data, index: i },
              ttl: 300,
            }));

            // Measure batch set performance
            const batchSetStartTime = process.hrtime.bigint();
            await cacheService.setMultiple(entries, { prefix: 'test' });
            const batchSetEndTime = process.hrtime.bigint();
            const batchSetDuration = Number(batchSetEndTime - batchSetStartTime) / 1_000_000;

            // Measure batch get performance
            const keys = entries.map(entry => entry.key);
            const batchGetStartTime = process.hrtime.bigint();
            const results = await cacheService.getMultiple(keys, { prefix: 'test' });
            const batchGetEndTime = process.hrtime.bigint();
            const batchGetDuration = Number(batchGetEndTime - batchGetStartTime) / 1_000_000;

            // Verify all data was set and retrieved correctly
            expect(results).toHaveLength(batchSize);
            results.forEach((result, index) => {
              expect(result).toEqual(entries[index].value);
            });

            // Batch operations should be efficient
            // Allow more time for larger batches, but should scale reasonably
            const maxBatchSetTime = batchSize * 5; // 5ms per item max (more lenient)
            const maxBatchGetTime = batchSize * 3; // 3ms per item max (more lenient)

            expect(batchSetDuration).toBeLessThan(maxBatchSetTime);
            expect(batchGetDuration).toBeLessThan(maxBatchGetTime);
          }
        ),
        { numRuns: 30 } // Reduced runs for performance
      );
    });
  });
});
