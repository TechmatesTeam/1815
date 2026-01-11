import * as fc from 'fast-check';
import { Job } from 'bull';
import { jobFailureService, JobFailureEvent } from '@/services/jobFailureService';
import { emailService } from '@/services/emailService';

// Mock email service
jest.mock('@/services/emailService');
const mockEmailService = emailService as jest.Mocked<typeof emailService>;

/**
 * **Feature: cardash-backend-api, Property 33: Job failure logging**
 * **Validates: Requirements 8.5**
 *
 * Property: When job processing fails, the system should log errors and alert system administrators
 */

describe('Job Failure Logging Property Tests', () => {
  beforeAll(() => {
    // Set admin emails for testing
    process.env.ADMIN_EMAILS = 'admin@test.com,ops@test.com';
  });

  beforeEach(() => {
    // Clear failure history and reset mocks
    jobFailureService.clearHistory();
    jest.clearAllMocks();
    jest.resetAllMocks();
    mockEmailService.sendEmail.mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Clean up
    jobFailureService.clearHistory();
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  afterAll(() => {
    // Final cleanup
    jobFailureService.clearHistory();
    delete process.env.ADMIN_EMAILS;
  });

  test('Property 33: Job failure events are logged with complete information', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          jobId: fc.string({ minLength: 1, maxLength: 10 }),
          jobName: fc.constantFrom(
            'expire-aliases',
            'send-expiry-notification',
            'cleanup-qr-codes'
          ),
          queueName: fc.constantFrom('alias-expiration', 'notification-delivery', 'qr-cleanup'),
          attemptsMade: fc.integer({ min: 1, max: 3 }),
          maxAttempts: fc.integer({ min: 1, max: 3 }),
          errorMessage: fc.string({ minLength: 5, maxLength: 50 }),
        }),
        async ({ jobId, jobName, queueName, attemptsMade, maxAttempts, errorMessage }) => {
          // Clear history at start of each property test iteration
          jobFailureService.clearHistory();
          jest.clearAllMocks();

          // Ensure attemptsMade doesn't exceed maxAttempts
          const actualAttemptsMade = Math.min(attemptsMade, maxAttempts);

          // Create mock job
          const mockJob = {
            id: jobId,
            name: jobName,
            queue: { name: queueName },
            attemptsMade: actualAttemptsMade,
            opts: { attempts: maxAttempts },
            data: { testData: 'test-value', password: 'should-be-redacted' },
          } as unknown as Job;

          const error = new Error(errorMessage);
          error.stack = `Error: ${errorMessage}\n    at test location`;

          // Log the job failure
          await jobFailureService.logJobFailure(mockJob, error);

          // Property 1: Failure should be recorded in history
          const allFailures = jobFailureService.getAllFailures();
          expect(allFailures).toHaveLength(1);

          const loggedFailure = allFailures[0];

          // Property 2: All required fields should be present and correct
          expect(loggedFailure.jobId).toBe(jobId);
          expect(loggedFailure.jobName).toBe(jobName);
          expect(loggedFailure.queueName).toBe(queueName);
          expect(loggedFailure.error.message).toBe(errorMessage);
          expect(loggedFailure.attemptsMade).toBe(actualAttemptsMade);
          expect(loggedFailure.maxAttempts).toBe(maxAttempts);
          expect(loggedFailure.isFinalFailure).toBe(actualAttemptsMade >= maxAttempts);
          expect(loggedFailure.timestamp).toBeInstanceOf(Date);
          expect(loggedFailure.stackTrace).toContain(errorMessage);

          // Property 3: Sensitive data should be sanitized
          expect(loggedFailure.jobData.testData).toBe('test-value');
          expect(loggedFailure.jobData.password).toBe('[REDACTED]');

          // Property 4: Statistics should be updated correctly
          const stats = jobFailureService.getFailureStats();
          expect(stats.totalFailures).toBe(1);
          expect(stats.failuresByQueue[queueName]).toBe(1);
          expect(stats.failuresByJob[jobName]).toBe(1);
          expect(stats.recentFailures).toHaveLength(1);
        }
      ),
      { numRuns: 10 }
    );
  });

  test('Property 33: Critical job failures trigger immediate alerts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          jobId: fc.string({ minLength: 1, maxLength: 10 }),
          criticalJobName: fc.constantFrom(
            'expire-aliases',
            'send-expiry-notification',
            'cleanup-qr-codes'
          ),
          queueName: fc.constantFrom('alias-expiration', 'notification-delivery', 'qr-cleanup'),
          errorMessage: fc.string({ minLength: 5, maxLength: 50 }),
        }),
        async ({ jobId, criticalJobName, queueName, errorMessage }) => {
          // Clear history at start of each property test iteration
          jobFailureService.clearHistory();
          jest.clearAllMocks();

          // Create mock job that will be a final failure
          const mockJob = {
            id: jobId,
            name: criticalJobName,
            queue: { name: queueName },
            attemptsMade: 3,
            opts: { attempts: 3 },
            data: { testData: 'critical-job-data' },
          } as unknown as Job;

          const error = new Error(errorMessage);

          // Log the critical job failure
          await jobFailureService.logJobFailure(mockJob, error);

          // Property 1: Alert email should be sent for critical job failures
          expect(mockEmailService.sendEmail).toHaveBeenCalled();

          // Property 2: Alert should be sent to all admin emails
          const emailCalls = mockEmailService.sendEmail.mock.calls;
          expect(emailCalls).toHaveLength(2); // Two admin emails configured

          // Property 3: Alert emails should contain critical job information
          for (const call of emailCalls) {
            const emailData = call[0];
            expect(emailData.subject).toContain('Critical Job Failure');
            expect(emailData.subject).toContain(criticalJobName);
            expect(emailData.text).toContain(jobId);
            expect(emailData.text).toContain(errorMessage);
            expect(emailData.text).toContain(queueName);
          }

          // Property 4: Failure should be marked as critical in statistics
          const stats = jobFailureService.getFailureStats();
          expect(stats.criticalFailures).toHaveLength(1);
          expect(stats.criticalFailures[0].jobName).toBe(criticalJobName);
        }
      ),
      { numRuns: 5 }
    );
  });

  test('Property 33: Non-final failures are logged but do not trigger critical alerts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          jobName: fc.constantFrom(
            'expire-aliases',
            'send-expiry-notification',
            'cleanup-qr-codes'
          ),
          queueName: fc.constantFrom('alias-expiration', 'notification-delivery', 'qr-cleanup'),
          attemptsMade: fc.integer({ min: 1, max: 2 }),
          maxAttempts: fc.integer({ min: 3, max: 5 }),
        }),
        async ({ jobName, queueName, attemptsMade, maxAttempts }) => {
          // Clear history at start of each property test iteration
          jobFailureService.clearHistory();
          jest.clearAllMocks();

          // Ensure this is not a final failure
          const actualAttemptsMade = Math.min(attemptsMade, maxAttempts - 1);

          const mockJob = {
            id: 'retry-job',
            name: jobName,
            queue: { name: queueName },
            attemptsMade: actualAttemptsMade,
            opts: { attempts: maxAttempts },
            data: { willRetry: true },
          } as unknown as Job;

          const error = new Error('Temporary failure');
          await jobFailureService.logJobFailure(mockJob, error);

          // Property 1: Failure should be logged
          const allFailures = jobFailureService.getAllFailures();
          expect(allFailures).toHaveLength(1);
          expect(allFailures[0].isFinalFailure).toBe(false);

          // Property 2: No critical alerts should be sent for non-final failures
          const emailCalls = mockEmailService.sendEmail.mock.calls;
          const criticalAlerts = emailCalls.filter(call =>
            call[0].subject.includes('Critical Job Failure')
          );
          expect(criticalAlerts).toHaveLength(0);

          // Property 3: Statistics should still be updated
          const stats = jobFailureService.getFailureStats();
          expect(stats.totalFailures).toBe(1);
          expect(stats.criticalFailures).toHaveLength(0); // Not critical since not final
        }
      ),
      { numRuns: 5 }
    );
  });
});
