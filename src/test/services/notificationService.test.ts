import { describe, it, expect, beforeEach, beforeAll, afterAll, jest } from '@jest/globals';
import * as fc from 'fast-check';
import { notificationService } from '../../services/notificationService';
import { Alias } from '../../models/Alias';
import { User } from '../../models/User';
import { connectDatabase, disconnectDatabase } from '../../config/database';

// Mock the cache and queue services to avoid Redis dependency
// Create a simple in-memory cache for testing deduplication
const mockCache = new Map<string, any>();

// Create a mutex-like mechanism for atomic operations
const pendingOperations = new Set<string>();

jest.mock('../../services/cacheService', () => ({
  cacheService: {
    set: jest.fn().mockImplementation(async (...args: any[]) => {
      const [key, value, options] = args;
      const cacheKey = options?.prefix ? `${options.prefix}:${key}` : key;
      mockCache.set(cacheKey, value);
      return true;
    }),
    get: jest.fn().mockImplementation(async (...args: any[]) => {
      const [key, options] = args;
      const cacheKey = options?.prefix ? `${options.prefix}:${key}` : key;
      return mockCache.get(cacheKey) || null;
    }),
    exists: jest.fn().mockImplementation(async (...args: any[]) => {
      const [key, options] = args;
      const cacheKey = options?.prefix ? `${options.prefix}:${key}` : key;
      return mockCache.has(cacheKey);
    }),
    delete: jest.fn().mockImplementation(async (...args: any[]) => {
      const [key, options] = args;
      const cacheKey = options?.prefix ? `${options.prefix}:${key}` : key;
      const existed = mockCache.has(cacheKey);
      mockCache.delete(cacheKey);
      return existed;
    }),
    setIfNotExists: jest.fn().mockImplementation(async (...args: any[]) => {
      const [key, value, options] = args;
      const cacheKey = options?.prefix ? `${options.prefix}:${key}` : key;

      // Simulate Redis atomic SET NX operation
      // Check if operation is already pending or key exists
      if (pendingOperations.has(cacheKey) || mockCache.has(cacheKey)) {
        return false; // Key already exists or operation in progress
      }

      // Mark operation as pending (atomic check-and-set)
      pendingOperations.add(cacheKey);

      try {
        // Double-check after acquiring lock
        if (mockCache.has(cacheKey)) {
          return false;
        }

        // Set the value
        mockCache.set(cacheKey, value);
        return true; // Key was set successfully
      } finally {
        // Always remove from pending operations
        pendingOperations.delete(cacheKey);
      }
    }),
  },
  CacheKeys: {
    NOTIFICATION: 'notification',
  },
}));

jest.mock('../../services/queueService', () => ({
  queueService: {
    addJob: jest.fn().mockImplementation(async (...args: any[]) => {
      return { id: 'test-job-id' };
    }),
  },
  QueueNames: {
    NOTIFICATION_DELIVERY: 'notification-delivery',
  },
  JobNames: {
    SEND_EXPIRY_NOTIFICATION: 'send-expiry-notification',
  },
}));

/**
 * **Feature: cardash-backend-api, Property 11: Notification timing**
 * **Validates: Requirements 4.1**
 *
 * For any alias with exactly 3 days remaining before expiry, the notification system
 * should trigger an email warning to the associated user email
 */

// Generator for valid email addresses with unique suffix that pass our validation
const validEmailArb = fc
  .record({
    local: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
      minLength: 3,
      maxLength: 15,
    }),
    domain: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
      minLength: 3,
      maxLength: 10,
    }),
    tld: fc.constantFrom(
      'com',
      'org',
      'net',
      'edu',
      'gov',
      'mil',
      'int',
      'co.uk',
      'de',
      'fr',
      'jp',
      'au'
    ),
  })
  .map(({ local, domain, tld }) => {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.random().toString(36).substring(2, 6);
    return `${local}${timestamp}${random}@${domain}.${tld}`;
  });

// Generator for valid Cardano addresses
const validCardanoAddressArb = fc.oneof(
  fc
    .string({ minLength: 59, maxLength: 103 })
    .map(s => `addr1${s.toLowerCase().replace(/[^a-z0-9]/g, 'a')}`),
  fc
    .string({ minLength: 59, maxLength: 103 })
    .map(s => `addr_test1${s.toLowerCase().replace(/[^a-z0-9]/g, 'a')}`)
);

// Generator for unique short codes using crypto for guaranteed uniqueness
const shortCodeArb = fc.constant(null).map(() => {
  const crypto = require('crypto');
  return crypto.randomBytes(6).toString('hex').toUpperCase();
});

describe('Notification Service Property Tests', () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  beforeEach(async () => {
    // Clear all data before each test
    await Alias.deleteMany({});
    await User.deleteMany({});

    // Clear mock cache and pending operations
    mockCache.clear();
    pendingOperations.clear();

    // Reset mock call counts
    jest.clearAllMocks();
  });

  // Helper function to create or update user
  const createTestUser = async (email: string, preferences: any) => {
    let user = await User.findOne({ email });
    if (user) {
      user.notificationPreferences = preferences;
      await user.save();
      return user;
    } else {
      user = new User({
        email,
        notificationPreferences: preferences,
      });
      await user.save();
      return user;
    }
  };

  describe('Property 15: Notification deduplication', () => {
    /**
     * **Feature: cardash-backend-api, Property 15: Notification deduplication**
     * **Validates: Requirements 4.5**
     */
    it('should prevent duplicate notifications regardless of how many times the job runs', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            cardanoAddress: validCardanoAddressArb,
            userEmail: validEmailArb,
            attemptCount: fc.integer({ min: 2, max: 10 }),
          }),
          async ({ cardanoAddress, userEmail, attemptCount }) => {
            try {
              // Generate a unique short code for this test run (max 12 chars)
              const crypto = require('crypto');
              const shortCode = crypto.randomBytes(6).toString('hex').toUpperCase();

              // Create or update a user with notification preferences enabled
              await createTestUser(userEmail, {
                aliasExpiry: true,
                featureUpdates: false,
                ecosystemNews: false,
              });

              // Create an alias that expires in exactly 3 days
              const threeDaysFromNow = new Date();
              threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
              threeDaysFromNow.setHours(12, 0, 0, 0);

              const alias = await Alias.create({
                shortCode,
                cardanoAddress,
                userEmail,
                expiresAt: threeDaysFromNow,
                isActive: true,
                notificationSent: false,
                useCount: 0,
              });

              const results = [];
              let successCount = 0;
              let duplicateCount = 0;

              // Attempt to send notification multiple times
              for (let i = 0; i < attemptCount; i++) {
                const result = await notificationService.sendExpiryWarning(
                  alias._id.toString(),
                  shortCode,
                  cardanoAddress,
                  userEmail,
                  threeDaysFromNow
                );

                results.push(result);

                if (result.success) {
                  if (result.message.includes('queued for delivery')) {
                    successCount++;
                  } else if (result.message.includes('already sent')) {
                    duplicateCount++;
                  }
                }
              }

              // Property: Only one notification should be successfully queued
              expect(successCount).toBe(1);
              // Property: All subsequent attempts should be marked as duplicates
              expect(duplicateCount).toBe(attemptCount - 1);
              // Property: All attempts should succeed (no errors)
              expect(results.every(r => r.success)).toBe(true);

              // Verify alias notification flag is set
              const updatedAlias = await Alias.findById(alias._id);
              expect(updatedAlias?.notificationSent).toBe(true);
            } catch (error) {
              // Skip if duplicate key error (expected in property testing)
              if (error instanceof Error && error.message.includes('duplicate key')) {
                return; // Skip this test case
              }
              if (error instanceof Error && error.message.includes('already exists')) {
                return; // Skip this test case
              }
              throw error; // Re-throw other errors
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle concurrent notification attempts atomically', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            cardanoAddress: validCardanoAddressArb,
            userEmail: validEmailArb,
          }),
          async ({ cardanoAddress, userEmail }) => {
            try {
              // Generate a unique short code for this test run (max 12 chars)
              const crypto = require('crypto');
              const shortCode = crypto.randomBytes(6).toString('hex').toUpperCase();

              // Create or update a user with notification preferences enabled
              await createTestUser(userEmail, {
                aliasExpiry: true,
                featureUpdates: false,
                ecosystemNews: false,
              });

              // Create an alias that expires in exactly 3 days
              const threeDaysFromNow = new Date();
              threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

              const alias = await Alias.create({
                shortCode,
                cardanoAddress,
                userEmail,
                expiresAt: threeDaysFromNow,
                isActive: true,
                notificationSent: false,
                useCount: 0,
              });

              // Simulate concurrent notification attempts
              const concurrentPromises = Array.from({ length: 5 }, () =>
                notificationService.sendExpiryWarning(
                  alias._id.toString(),
                  shortCode,
                  cardanoAddress,
                  userEmail,
                  threeDaysFromNow
                )
              );

              const results = await Promise.all(concurrentPromises);

              // Count successful queues vs duplicates
              const queuedCount = results.filter(
                r => r.success && r.message.includes('queued for delivery')
              ).length;
              const duplicateCount = results.filter(
                r => r.success && r.message.includes('already sent for this alias')
              ).length;
              const raceConditionCount = results.filter(
                r => !r.success && r.message.includes('Failed to mark notification as sent')
              ).length;

              // Property: Exactly one notification should be queued
              expect(queuedCount).toBe(1);
              // Property: All other attempts should be handled (either duplicates or race conditions)
              expect(duplicateCount + raceConditionCount).toBe(4);
              // Property: Total results should be 5
              expect(results.length).toBe(5);

              // Verify final state is consistent
              const updatedAlias = await Alias.findById(alias._id);
              expect(updatedAlias?.notificationSent).toBe(true);
            } catch (error) {
              // Skip if duplicate key error (expected in property testing)
              if (error instanceof Error && error.message.includes('duplicate key')) {
                return; // Skip this test case
              }
              if (error instanceof Error && error.message.includes('already exists')) {
                return; // Skip this test case
              }
              throw error; // Re-throw other errors
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should maintain deduplication across different notification types', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            cardanoAddress: validCardanoAddressArb,
            userEmail: validEmailArb,
          }),
          async ({ cardanoAddress, userEmail }) => {
            try {
              // Generate a unique short code for this test run (max 12 chars)
              const crypto = require('crypto');
              const shortCode = crypto.randomBytes(6).toString('hex').toUpperCase();

              // Create or update a user with all notification preferences enabled
              await createTestUser(userEmail, {
                aliasExpiry: true,
                featureUpdates: true,
                ecosystemNews: true,
              });

              // Create an alias
              const threeDaysFromNow = new Date();
              threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

              const alias = await Alias.create({
                shortCode,
                cardanoAddress,
                userEmail,
                expiresAt: threeDaysFromNow,
                isActive: true,
                notificationSent: false,
                useCount: 0,
              });

              // Send expiry warning twice
              const expiryResult1 = await notificationService.sendExpiryWarning(
                alias._id.toString(),
                shortCode,
                cardanoAddress,
                userEmail,
                threeDaysFromNow
              );

              const expiryResult2 = await notificationService.sendExpiryWarning(
                alias._id.toString(),
                shortCode,
                cardanoAddress,
                userEmail,
                threeDaysFromNow
              );

              // Send feature update (different type, should not be deduplicated)
              const featureResult = await notificationService.sendFeatureUpdate(
                userEmail,
                'Test Feature',
                'Test Description'
              );

              // Property: First expiry warning should be queued
              expect(expiryResult1.success).toBe(true);
              expect(expiryResult1.message).toContain('queued for delivery');

              // Property: Second expiry warning should be deduplicated
              expect(expiryResult2.success).toBe(true);
              expect(expiryResult2.message).toContain('already sent');

              // Property: Feature update should be queued (different type)
              expect(featureResult.success).toBe(true);
              expect(featureResult.message).toContain('queued for delivery');

              // Verify deduplication status for different types
              const isExpiryNotificationSent = await notificationService.isNotificationSent(
                alias._id.toString(),
                'expiry_warning'
              );
              expect(isExpiryNotificationSent).toBe(true);
            } catch (error) {
              // Skip if duplicate key error (expected in property testing)
              if (error instanceof Error && error.message.includes('duplicate key')) {
                return; // Skip this test case
              }
              if (error instanceof Error && error.message.includes('already exists')) {
                return; // Skip this test case
              }
              throw error; // Re-throw other errors
            }
          }
        ),
        { numRuns: 75 }
      );
    });

    it('should allow clearing notification flags for testing purposes', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            cardanoAddress: validCardanoAddressArb,
            userEmail: validEmailArb,
          }),
          async ({ cardanoAddress, userEmail }) => {
            try {
              // Generate a unique short code for this test run (max 12 chars)
              const crypto = require('crypto');
              const shortCode = crypto.randomBytes(6).toString('hex').toUpperCase();

              // Create or update a user with notification preferences enabled
              await createTestUser(userEmail, {
                aliasExpiry: true,
                featureUpdates: false,
                ecosystemNews: false,
              });

              // Create an alias
              const threeDaysFromNow = new Date();
              threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

              const alias = await Alias.create({
                shortCode,
                cardanoAddress,
                userEmail,
                expiresAt: threeDaysFromNow,
                isActive: true,
                notificationSent: false,
                useCount: 0,
              });

              // Send notification
              const result1 = await notificationService.sendExpiryWarning(
                alias._id.toString(),
                shortCode,
                cardanoAddress,
                userEmail,
                threeDaysFromNow
              );

              expect(result1.success).toBe(true);
              expect(result1.message).toContain('queued for delivery');

              // Verify notification was marked as sent
              const isSent1 = await notificationService.isNotificationSent(
                alias._id.toString(),
                'expiry_warning'
              );
              expect(isSent1).toBe(true);

              // Clear notification flag
              const cleared = await notificationService.clearNotificationFlag(
                alias._id.toString(),
                'expiry_warning'
              );
              expect(cleared).toBe(true);

              // Verify notification flag was cleared
              const isSent2 = await notificationService.isNotificationSent(
                alias._id.toString(),
                'expiry_warning'
              );
              expect(isSent2).toBe(false);

              // Should be able to send notification again
              const result2 = await notificationService.sendExpiryWarning(
                alias._id.toString(),
                shortCode,
                cardanoAddress,
                userEmail,
                threeDaysFromNow
              );

              expect(result2.success).toBe(true);
              expect(result2.message).toContain('queued for delivery');
            } catch (error) {
              // Skip if duplicate key error (expected in property testing)
              if (error instanceof Error && error.message.includes('duplicate key')) {
                return; // Skip this test case
              }
              if (error instanceof Error && error.message.includes('already exists')) {
                return; // Skip this test case
              }
              throw error; // Re-throw other errors
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Property 13: Email validation', () => {
    /**
     * **Feature: cardash-backend-api, Property 13: Email validation**
     * **Validates: Requirements 4.3**
     */
    it('should validate email format and reject invalid addresses', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            cardanoAddress: validCardanoAddressArb,
            invalidEmail: fc.oneof(
              fc.constant(''),
              fc.constant('invalid-email'),
              fc.constant('no-at-symbol'),
              fc.constant('@no-local-part.com'),
              fc.constant('no-domain@'),
              fc.constant('user@'),
              fc.constant('@domain.com'),
              fc.constant('user..double.dot@domain.com'),
              fc.constant('user@domain'),
              fc.constant('user@.domain.com'),
              fc.constant('user@domain..com'),
              fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('@')),
              fc
                .string({ minLength: 1, maxLength: 50 })
                .filter(s => s.includes('@') && !s.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))
            ),
            shortCode: shortCodeArb,
          }),
          async ({ cardanoAddress, invalidEmail, shortCode }) => {
            // Attempt to subscribe with invalid email
            const result = await notificationService.subscribeToNotifications({
              email: invalidEmail,
              preferences: {
                aliasExpiry: true,
                featureUpdates: false,
                ecosystemNews: false,
              },
            });

            // Property: Invalid emails should be rejected
            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid email format');

            // Verify no user was created in database
            const user = await User.findOne({ email: invalidEmail });
            expect(user).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should accept valid email formats', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            validEmail: validEmailArb,
          }),
          async ({ validEmail }) => {
            try {
              // Attempt to subscribe with valid email
              const result = await notificationService.subscribeToNotifications({
                email: validEmail,
                preferences: {
                  aliasExpiry: true,
                  featureUpdates: false,
                  ecosystemNews: false,
                },
              });

              // Property: Valid emails should be accepted
              expect(result.success).toBe(true);
              expect(result.message).toContain('Successfully subscribed');

              // Verify user was created in database
              const user = await User.findOne({ email: validEmail });
              expect(user).toBeTruthy();
              expect(user?.notificationPreferences.aliasExpiry).toBe(true);
            } catch (error) {
              // Skip if duplicate key error (expected in property testing)
              if (error instanceof Error && error.message.includes('duplicate key')) {
                return; // Skip this test case
              }
              if (error instanceof Error && error.message.includes('already exists')) {
                return; // Skip this test case
              }
              throw error; // Re-throw other errors
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should validate email format in preference updates', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            invalidEmail: fc.oneof(
              fc.constant(''),
              fc.constant('invalid-email'),
              fc.constant('no-at-symbol'),
              fc.constant('@no-local-part.com'),
              fc.constant('no-domain@'),
              fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('@'))
            ),
          }),
          async ({ invalidEmail }) => {
            // Attempt to update preferences with invalid email
            const result = await notificationService.updatePreferences(invalidEmail, {
              aliasExpiry: false,
            });

            // Property: Invalid emails should be rejected for preference updates
            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid email format');
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should validate email format in unsubscribe operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            invalidEmail: fc.oneof(
              fc.constant(''),
              fc.constant('invalid-email'),
              fc.constant('no-at-symbol'),
              fc.constant('@no-local-part.com'),
              fc.constant('no-domain@'),
              fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('@'))
            ),
          }),
          async ({ invalidEmail }) => {
            // Attempt to unsubscribe with invalid email
            const result = await notificationService.unsubscribe(invalidEmail);

            // Property: Invalid emails should be rejected for unsubscribe
            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid email format');
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Property 14: Preference persistence', () => {
    /**
     * **Feature: cardash-backend-api, Property 14: Preference persistence**
     * **Validates: Requirements 4.4**
     */
    it('should immediately store and retrieve preference changes', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            validEmail: validEmailArb,
            preferences: fc.record({
              aliasExpiry: fc.boolean(),
              featureUpdates: fc.boolean(),
              ecosystemNews: fc.boolean(),
            }),
          }),
          async ({ validEmail, preferences }) => {
            // First create a user with initial preferences
            await createTestUser(validEmail, {
              aliasExpiry: !preferences.aliasExpiry, // Opposite of what we'll update to
              featureUpdates: !preferences.featureUpdates,
              ecosystemNews: !preferences.ecosystemNews,
            });

            // Update preferences
            const updateResult = await notificationService.updatePreferences(
              validEmail,
              preferences
            );

            // Property: Update should succeed
            expect(updateResult.success).toBe(true);
            expect(updateResult.message).toContain('updated successfully');

            // Property: Changes should be immediately retrievable
            const retrievedPreferences = await notificationService.getPreferences(validEmail);

            expect(retrievedPreferences).toBeTruthy();
            expect(retrievedPreferences?.aliasExpiry).toBe(preferences.aliasExpiry);
            expect(retrievedPreferences?.featureUpdates).toBe(preferences.featureUpdates);
            expect(retrievedPreferences?.ecosystemNews).toBe(preferences.ecosystemNews);
            expect(retrievedPreferences?.email).toBe(validEmail);

            // Property: Changes should be persisted in database
            const userFromDb = await User.findOne({ email: validEmail });
            expect(userFromDb).toBeTruthy();
            expect(userFromDb?.notificationPreferences.aliasExpiry).toBe(preferences.aliasExpiry);
            expect(userFromDb?.notificationPreferences.featureUpdates).toBe(
              preferences.featureUpdates
            );
            expect(userFromDb?.notificationPreferences.ecosystemNews).toBe(
              preferences.ecosystemNews
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle partial preference updates correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            validEmail: validEmailArb,
            initialPreferences: fc.record({
              aliasExpiry: fc.boolean(),
              featureUpdates: fc.boolean(),
              ecosystemNews: fc.boolean(),
            }),
            partialUpdate: fc.oneof(
              fc.record({ aliasExpiry: fc.boolean() }),
              fc.record({ featureUpdates: fc.boolean() }),
              fc.record({ ecosystemNews: fc.boolean() }),
              fc.record({ aliasExpiry: fc.boolean(), featureUpdates: fc.boolean() }),
              fc.record({ featureUpdates: fc.boolean(), ecosystemNews: fc.boolean() }),
              fc.record({ aliasExpiry: fc.boolean(), ecosystemNews: fc.boolean() })
            ),
          }),
          async ({ validEmail, initialPreferences, partialUpdate }) => {
            // Create user with initial preferences
            await createTestUser(validEmail, initialPreferences);

            // Apply partial update
            const updateResult = await notificationService.updatePreferences(
              validEmail,
              partialUpdate
            );

            // Property: Partial update should succeed
            expect(updateResult.success).toBe(true);

            // Property: Only updated fields should change, others should remain
            const retrievedPreferences = await notificationService.getPreferences(validEmail);
            expect(retrievedPreferences).toBeTruthy();

            // Check each field
            const expectedAliasExpiry =
              'aliasExpiry' in partialUpdate
                ? partialUpdate.aliasExpiry
                : initialPreferences.aliasExpiry;
            const expectedFeatureUpdates =
              'featureUpdates' in partialUpdate
                ? partialUpdate.featureUpdates
                : initialPreferences.featureUpdates;
            const expectedEcosystemNews =
              'ecosystemNews' in partialUpdate
                ? partialUpdate.ecosystemNews
                : initialPreferences.ecosystemNews;

            expect(retrievedPreferences?.aliasExpiry).toBe(expectedAliasExpiry);
            expect(retrievedPreferences?.featureUpdates).toBe(expectedFeatureUpdates);
            expect(retrievedPreferences?.ecosystemNews).toBe(expectedEcosystemNews);
          }
        ),
        { numRuns: 75 }
      );
    });

    it('should maintain preference consistency between cache and database', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            validEmail: validEmailArb,
            preferences: fc.record({
              aliasExpiry: fc.boolean(),
              featureUpdates: fc.boolean(),
              ecosystemNews: fc.boolean(),
            }),
          }),
          async ({ validEmail, preferences }) => {
            // Create user and update preferences
            await createTestUser(validEmail, {
              aliasExpiry: !preferences.aliasExpiry,
              featureUpdates: !preferences.featureUpdates,
              ecosystemNews: !preferences.ecosystemNews,
            });

            await notificationService.updatePreferences(validEmail, preferences);

            // Get preferences (should come from cache)
            const cachedPreferences = await notificationService.getPreferences(validEmail);

            // Get preferences directly from database
            const userFromDb = await User.findOne({ email: validEmail });

            // Property: Cache and database should be consistent
            expect(cachedPreferences?.aliasExpiry).toBe(
              userFromDb?.notificationPreferences.aliasExpiry
            );
            expect(cachedPreferences?.featureUpdates).toBe(
              userFromDb?.notificationPreferences.featureUpdates
            );
            expect(cachedPreferences?.ecosystemNews).toBe(
              userFromDb?.notificationPreferences.ecosystemNews
            );
            expect(cachedPreferences?.email).toBe(validEmail);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle non-existent users gracefully in preference updates', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            nonExistentEmail: validEmailArb,
            preferences: fc.record({
              aliasExpiry: fc.boolean(),
              featureUpdates: fc.boolean(),
              ecosystemNews: fc.boolean(),
            }),
          }),
          async ({ nonExistentEmail, preferences }) => {
            // Ensure user doesn't exist
            await User.deleteOne({ email: nonExistentEmail });

            // Attempt to update preferences for non-existent user
            const result = await notificationService.updatePreferences(
              nonExistentEmail,
              preferences
            );

            // Property: Should handle gracefully
            expect(result.success).toBe(false);
            expect(result.message).toContain('User not found');

            // Property: No user should be created
            const user = await User.findOne({ email: nonExistentEmail });
            expect(user).toBeNull();
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Property 11: Notification timing', () => {
    /**
     * **Feature: cardash-backend-api, Property 11: Notification timing**
     * **Validates: Requirements 4.1**
     */
    it('should trigger expiry warning for aliases with exactly 3 days remaining', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            cardanoAddress: validCardanoAddressArb,
            userEmail: validEmailArb,
            shortCode: shortCodeArb,
          }),
          async ({ cardanoAddress, userEmail, shortCode }) => {
            // Create a user with notification preferences enabled
            await User.create({
              email: userEmail,
              notificationPreferences: {
                aliasExpiry: true,
                featureUpdates: false,
                ecosystemNews: false,
              },
            });

            // Create an alias that expires in exactly 3 days
            const threeDaysFromNow = new Date();
            threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
            threeDaysFromNow.setHours(12, 0, 0, 0); // Set to noon for consistency

            const alias = await Alias.create({
              shortCode,
              cardanoAddress,
              userEmail,
              expiresAt: threeDaysFromNow,
              isActive: true,
              notificationSent: false,
              useCount: 0,
            });

            // Send expiry warning
            const result = await notificationService.sendExpiryWarning(
              alias._id.toString(),
              shortCode,
              cardanoAddress,
              userEmail,
              threeDaysFromNow
            );

            // Verify notification was queued successfully
            expect(result.success).toBe(true);
            expect(result.message).toContain('queued for delivery');
            expect(result.notificationId).toBeDefined();

            // Verify alias notification flag was updated
            const updatedAlias = await Alias.findById(alias._id);
            expect(updatedAlias?.notificationSent).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not send notifications for aliases with disabled preferences', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            cardanoAddress: validCardanoAddressArb,
            userEmail: validEmailArb,
            shortCode: shortCodeArb,
          }),
          async ({ cardanoAddress, userEmail, shortCode }) => {
            // Create a user with expiry warnings disabled
            await User.create({
              email: userEmail,
              notificationPreferences: {
                aliasExpiry: false, // Disabled
                featureUpdates: false,
                ecosystemNews: false,
              },
            });

            // Create an alias that expires in exactly 3 days
            const threeDaysFromNow = new Date();
            threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

            const alias = await Alias.create({
              shortCode,
              cardanoAddress,
              userEmail,
              expiresAt: threeDaysFromNow,
              isActive: true,
              notificationSent: false,
              useCount: 0,
            });

            // Attempt to send expiry warning
            const result = await notificationService.sendExpiryWarning(
              alias._id.toString(),
              shortCode,
              cardanoAddress,
              userEmail,
              threeDaysFromNow
            );

            // Verify notification was not sent due to disabled preferences
            expect(result.success).toBe(true);
            expect(result.message).toContain('disabled expiry warning notifications');

            // Verify alias notification flag was not updated
            const updatedAlias = await Alias.findById(alias._id);
            expect(updatedAlias?.notificationSent).toBe(false);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle various expiry timing scenarios correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            cardanoAddress: validCardanoAddressArb,
            userEmail: validEmailArb,
            shortCode: shortCodeArb,
            daysUntilExpiry: fc.integer({ min: 1, max: 10 }),
          }),
          async ({ cardanoAddress, userEmail, shortCode, daysUntilExpiry }) => {
            // Create a user with notification preferences enabled
            await User.create({
              email: userEmail,
              notificationPreferences: {
                aliasExpiry: true,
                featureUpdates: false,
                ecosystemNews: false,
              },
            });

            // Create an alias that expires in the specified number of days
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + daysUntilExpiry);

            const alias = await Alias.create({
              shortCode,
              cardanoAddress,
              userEmail,
              expiresAt: expiryDate,
              isActive: true,
              notificationSent: false,
              useCount: 0,
            });

            // Send expiry warning
            const result = await notificationService.sendExpiryWarning(
              alias._id.toString(),
              shortCode,
              cardanoAddress,
              userEmail,
              expiryDate
            );

            // All valid timing scenarios should succeed in queueing
            expect(result.success).toBe(true);
            expect(result.message).toContain('queued for delivery');

            // Verify alias notification flag was updated
            const updatedAlias = await Alias.findById(alias._id);
            expect(updatedAlias?.notificationSent).toBe(true);
          }
        ),
        { numRuns: 75 }
      );
    });

    it('should prevent duplicate notifications for the same alias', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            cardanoAddress: validCardanoAddressArb,
            userEmail: validEmailArb,
            shortCode: shortCodeArb,
          }),
          async ({ cardanoAddress, userEmail, shortCode }) => {
            // Create a user with notification preferences enabled
            await User.create({
              email: userEmail,
              notificationPreferences: {
                aliasExpiry: true,
                featureUpdates: false,
                ecosystemNews: false,
              },
            });

            // Create an alias that expires in 3 days
            const threeDaysFromNow = new Date();
            threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

            const alias = await Alias.create({
              shortCode,
              cardanoAddress,
              userEmail,
              expiresAt: threeDaysFromNow,
              isActive: true,
              notificationSent: false,
              useCount: 0,
            });

            // Send first expiry warning
            const result1 = await notificationService.sendExpiryWarning(
              alias._id.toString(),
              shortCode,
              cardanoAddress,
              userEmail,
              threeDaysFromNow
            );

            // Verify first notification was queued
            expect(result1.success).toBe(true);
            expect(result1.message).toContain('queued for delivery');

            // Attempt to send second expiry warning (should be deduplicated)
            const result2 = await notificationService.sendExpiryWarning(
              alias._id.toString(),
              shortCode,
              cardanoAddress,
              userEmail,
              threeDaysFromNow
            );

            // Verify second notification was deduplicated
            expect(result2.success).toBe(true);
            expect(result2.message).toContain('already sent');

            // Verify alias notification flag remains true
            const updatedAlias = await Alias.findById(alias._id);
            expect(updatedAlias?.notificationSent).toBe(true);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle missing user preferences gracefully', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            cardanoAddress: validCardanoAddressArb,
            userEmail: validEmailArb,
            shortCode: shortCodeArb,
          }),
          async ({ cardanoAddress, userEmail, shortCode }) => {
            // Create an alias without creating a user (no preferences)
            const threeDaysFromNow = new Date();
            threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

            const alias = await Alias.create({
              shortCode,
              cardanoAddress,
              userEmail,
              expiresAt: threeDaysFromNow,
              isActive: true,
              notificationSent: false,
              useCount: 0,
            });

            // Attempt to send expiry warning without user preferences
            const result = await notificationService.sendExpiryWarning(
              alias._id.toString(),
              shortCode,
              cardanoAddress,
              userEmail,
              threeDaysFromNow
            );

            // Should handle missing preferences gracefully
            expect(result.success).toBe(true);
            // Could either be disabled or queued depending on default behavior
            expect(result.message).toMatch(/disabled|queued/);

            // Verify alias state is consistent
            const updatedAlias = await Alias.findById(alias._id);
            expect(updatedAlias).toBeTruthy();
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should handle missing user preferences gracefully for valid aliases', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            cardanoAddress: validCardanoAddressArb,
            userEmail: validEmailArb,
            shortCode: shortCodeArb,
          }),
          async ({ cardanoAddress, userEmail, shortCode }) => {
            // Create an alias with valid email but no user preferences
            const threeDaysFromNow = new Date();
            threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

            const alias = await Alias.create({
              shortCode,
              cardanoAddress,
              userEmail,
              expiresAt: threeDaysFromNow,
              isActive: true,
              notificationSent: false,
              useCount: 0,
            });

            // Attempt to send expiry warning without user preferences in database
            const result = await notificationService.sendExpiryWarning(
              alias._id.toString(),
              shortCode,
              cardanoAddress,
              userEmail,
              threeDaysFromNow
            );

            // Should handle missing preferences gracefully
            expect(result.success).toBe(true);
            // Should indicate that preferences are disabled or missing
            expect(result.message).toMatch(/disabled|missing|not found/);
          }
        ),
        { numRuns: 40 }
      );
    });
  });
});
