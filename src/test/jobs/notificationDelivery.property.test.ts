import * as fc from 'fast-check';
import { processNotification } from '@/jobs/notificationJob';
import { queueService } from '@/services/queueService';
import { Job } from 'bull';

// Mock dependencies
jest.mock('@/services/queueService', () => ({
  queueService: {
    addJob: jest.fn(),
  },
  QueueNames: {
    EMAIL_QUEUE: 'email-queue',
  },
  JobNames: {
    SEND_EMAIL: 'send-email',
  },
}));

jest.mock('@/services/cacheService', () => ({
  cacheService: {
    exists: jest.fn().mockResolvedValue(false),
    set: jest.fn().mockResolvedValue(undefined),
  },
  CacheKeys: {
    NOTIFICATION: 'notification',
  },
}));

jest.mock('@/models/Alias', () => ({
  Alias: {
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  },
}));

/**
 * **Feature: cardash-backend-api, Property 31: Email delivery retry logic**
 * **Validates: Requirements 8.3**
 *
 * Property: For any failed email delivery, the system should retry exactly 3 times before marking as failed
 */

describe('Notification Delivery Property Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Property 31: Email delivery retry logic configuration', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          aliasId: fc.string({ minLength: 24, maxLength: 24 }), // MongoDB ObjectId length
          shortCode: fc.string({ minLength: 6, maxLength: 12 }),
          userEmail: fc.emailAddress(),
          notificationType: fc.constantFrom('expiry_warning', 'alias_expired', 'feature_update'),
        }),
        async ({ aliasId, shortCode, userEmail, notificationType }) => {
          const mockJob = {
            data: {
              aliasId,
              shortCode,
              cardanoAddress:
                'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj0vs2qd4a',
              userEmail,
              type: notificationType,
              templateData: {},
            },
          } as Job<any>;

          // Process the notification
          const result = await processNotification(mockJob);

          // Property 1: Notification processing should succeed
          expect(result.success).toBe(true);
          expect(result.emailSent).toBe(true);

          // Property 2: Email should be queued with exactly 3 retry attempts
          expect(queueService.addJob).toHaveBeenCalledWith(
            'email-queue',
            'send-email',
            expect.any(Object),
            expect.objectContaining({
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
            })
          );

          // Property 3: Retry configuration should use exponential backoff
          const queueCall = (queueService.addJob as jest.Mock).mock.calls[0];
          const retryOptions = queueCall[3];
          expect(retryOptions.attempts).toBe(3);
          expect(retryOptions.backoff.type).toBe('exponential');
          expect(retryOptions.backoff.delay).toBe(2000);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 31: Retry logic consistency across notification types', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          notifications: fc.array(
            fc.record({
              aliasId: fc.string({ minLength: 24, maxLength: 24 }),
              shortCode: fc.string({ minLength: 6, maxLength: 12 }),
              userEmail: fc.emailAddress(),
              type: fc.constantFrom('expiry_warning', 'alias_expired', 'feature_update'),
            }),
            { minLength: 1, maxLength: 5 }
          ),
        }),
        async ({ notifications }) => {
          // Clear mocks for this iteration
          jest.clearAllMocks();
          const retryConfigurations: any[] = [];

          // Process all notifications
          for (const notification of notifications) {
            const mockJob = {
              data: {
                ...notification,
                cardanoAddress:
                  'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj0vs2qd4a',
                templateData: {},
              },
            } as Job<any>;

            await processNotification(mockJob);
          }

          // Extract retry configurations from all queue calls
          const queueCalls = (queueService.addJob as jest.Mock).mock.calls;
          for (const call of queueCalls) {
            const retryOptions = call[3];
            retryConfigurations.push(retryOptions);
          }

          // Property 1: All notifications should have the same retry configuration
          expect(retryConfigurations).toHaveLength(notifications.length);

          // Property 2: Every retry configuration should be identical
          for (const config of retryConfigurations) {
            expect(config.attempts).toBe(3);
            expect(config.backoff.type).toBe('exponential');
            expect(config.backoff.delay).toBe(2000);
          }

          // Property 3: Retry configuration should be consistent regardless of notification type
          const uniqueConfigs = new Set(
            retryConfigurations.map(config =>
              JSON.stringify({
                attempts: config.attempts,
                backoff: config.backoff,
              })
            )
          );
          expect(uniqueConfigs.size).toBe(1); // All configurations should be identical
        }
      ),
      { numRuns: 50 }
    );
  });
});
