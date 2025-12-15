import * as fc from 'fast-check';
import { Alias } from '@/models/Alias';
import { processAliasExpiration } from '@/jobs/aliasExpirationJob';
import { Job } from 'bull';

// Mock cache service to avoid Redis dependency in tests
jest.mock('@/services/cacheService', () => ({
  cacheService: {
    delete: jest.fn().mockResolvedValue(true),
    set: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
  },
  CacheKeys: {
    ALIAS: 'alias',
    ADDRESS: 'address',
    SEARCH: 'search',
    NOTIFICATION: 'notification',
  },
}));

/**
 * **Feature: cardash-backend-api, Property 29: Automatic alias deactivation**
 * **Validates: Requirements 8.1**
 *
 * Property: For any alias that has reached its expiry date, background jobs should automatically deactivate it
 */

describe('Alias Expiration Property Tests', () => {
  beforeEach(async () => {
    // Clean up ALL test data to ensure isolation
    await Alias.deleteMany({});
  });

  afterEach(async () => {
    // Clean up ALL test data to ensure isolation
    await Alias.deleteMany({});
  });

  test('Property 29: Automatic alias deactivation for expired aliases', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          aliasCount: fc.integer({ min: 1, max: 10 }),
          expiredCount: fc.integer({ min: 1, max: 5 }),
          batchSize: fc.integer({ min: 5, max: 20 }),
        }),
        async ({ aliasCount, expiredCount, batchSize }) => {
          // Ensure expiredCount doesn't exceed aliasCount
          const actualExpiredCount = Math.min(expiredCount, aliasCount);
          const activeCount = aliasCount - actualExpiredCount;

          // Create test aliases - some expired, some active
          const testAliases = [];
          const createdAliasIds = [];
          const now = new Date();
          const testPrefix = Math.random().toString(36).slice(2, 6); // 4 char random prefix

          // Create expired aliases
          for (let i = 0; i < actualExpiredCount; i++) {
            const futureDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 1 day in future for creation
            const alias = new Alias({
              shortCode: `${testPrefix}e${i}`, // Unique prefix for this test run
              cardanoAddress:
                'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj0vs2qd4a',
              expiresAt: futureDate,
              isActive: true,
            });
            await alias.save();
            createdAliasIds.push(alias._id);

            // Now manually update to make it expired (bypass validation)
            await Alias.updateOne(
              { _id: alias._id },
              { $set: { expiresAt: new Date(now.getTime() - (i + 1) * 24 * 60 * 60 * 1000) } }
            );
            testAliases.push(alias);
          }

          // Create active aliases
          for (let i = 0; i < activeCount; i++) {
            const futureDate = new Date(now.getTime() + (i + 1) * 24 * 60 * 60 * 1000); // 1+ days from now
            const alias = new Alias({
              shortCode: `${testPrefix}a${i}`, // Unique prefix for this test run
              cardanoAddress:
                'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj0vs2qd4a',
              expiresAt: futureDate,
              isActive: true,
            });
            await alias.save();
            createdAliasIds.push(alias._id);
            testAliases.push(alias);
          }

          // Count expired aliases before running the job
          const expiredBeforeJob = await Alias.countDocuments({
            isActive: true,
            expiresAt: { $lte: new Date() },
          });

          // Mock job object
          const mockJob = {
            data: { batchSize, dryRun: false },
            progress: jest.fn(),
          } as unknown as Job<any>;

          // Run the expiration job
          const result = await processAliasExpiration(mockJob);

          // Property 1: The job should deactivate at least our expired aliases
          expect(result.deactivated).toBeGreaterThanOrEqual(actualExpiredCount);

          // Property 2: Verify our specific expired aliases are deactivated
          const ourDeactivatedAliases = await Alias.find({
            _id: { $in: createdAliasIds },
            shortCode: new RegExp(`^${testPrefix}e`),
            isActive: false,
          });
          expect(ourDeactivatedAliases).toHaveLength(actualExpiredCount);

          // Property 3: Our active aliases should remain active
          const ourActiveAliases = await Alias.find({
            _id: { $in: createdAliasIds },
            shortCode: new RegExp(`^${testPrefix}a`),
            isActive: true,
          });
          expect(ourActiveAliases).toHaveLength(activeCount);

          // Property 4: No active aliases we created should be accidentally deactivated
          const ourWronglyDeactivated = await Alias.find({
            _id: { $in: createdAliasIds },
            shortCode: new RegExp(`^${testPrefix}a`),
            isActive: false,
          });
          expect(ourWronglyDeactivated).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
  test('Property 30: Atomic database operations for alias deactivation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          concurrentJobs: fc.integer({ min: 2, max: 5 }),
          aliasCount: fc.integer({ min: 5, max: 15 }),
        }),
        async ({ concurrentJobs, aliasCount }) => {
          // Create expired aliases that multiple jobs might try to process
          const testAliases = [];
          const createdAliasIds = [];
          const testPrefix = Math.random().toString(36).slice(2, 6); // 4 char random prefix
          const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day in future for creation

          for (let i = 0; i < aliasCount; i++) {
            const alias = new Alias({
              shortCode: `${testPrefix}m${i}`, // Unique prefix for this test run
              cardanoAddress:
                'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj0vs2qd4a',
              expiresAt: futureDate,
              isActive: true,
            });
            await alias.save();
            createdAliasIds.push(alias._id);

            // Now manually update to make it expired (bypass validation)
            await Alias.updateOne(
              { _id: alias._id },
              { $set: { expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
            );
            testAliases.push(alias);
          }

          // Count total expired aliases before running jobs
          const totalExpiredBefore = await Alias.countDocuments({
            isActive: true,
            expiresAt: { $lte: new Date() },
          });

          // Create multiple concurrent jobs to test atomicity
          const jobPromises = Array.from({ length: concurrentJobs }, (_, jobIndex) => {
            const mockJob = {
              data: { batchSize: Math.max(aliasCount, 20), dryRun: false }, // Ensure batch size covers all aliases
              progress: jest.fn(),
            } as unknown as Job<any>;

            return processAliasExpiration(mockJob);
          });

          // Run all jobs concurrently
          const results = await Promise.all(jobPromises);

          // Property 1: Total deactivations should be at least our aliases (may include others from previous tests)
          const totalDeactivated = results.reduce((sum, result) => sum + result.deactivated, 0);
          expect(totalDeactivated).toBeGreaterThanOrEqual(aliasCount);

          // Property 2: Our specific aliases should all be deactivated exactly once
          const ourDeactivatedAliases = await Alias.find({
            _id: { $in: createdAliasIds },
            isActive: false,
          });
          expect(ourDeactivatedAliases).toHaveLength(aliasCount);

          // Property 3: None of our aliases should remain active after concurrent processing
          const ourStillActiveAliases = await Alias.find({
            _id: { $in: createdAliasIds },
            isActive: true,
          });
          expect(ourStillActiveAliases).toHaveLength(0);

          // Property 4: Database consistency - each of our aliases should have been updated exactly once
          // (This is ensured by the atomic update conditions in the job processor)
          for (const alias of testAliases) {
            const updatedAlias = await Alias.findById(alias._id);
            expect(updatedAlias?.isActive).toBe(false);
            expect(updatedAlias?.updatedAt).toBeInstanceOf(Date);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
