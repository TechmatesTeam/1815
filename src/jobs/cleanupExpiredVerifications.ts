import { Job } from 'bull';
import { subscriptionService } from '@/services/subscriptionService';
import { logger } from '@/utils/logger';

export interface CleanupExpiredVerificationsJobData {
  // No specific data needed for this job
}

export async function processCleanupExpiredVerifications(
  job: Job<CleanupExpiredVerificationsJobData>
): Promise<void> {
  try {
    logger.info('Starting cleanup of expired verification tokens', {
      jobId: job.id,
    });

    await subscriptionService.cleanupExpiredVerifications();

    logger.info('Completed cleanup of expired verification tokens', {
      jobId: job.id,
    });
  } catch (error) {
    logger.error('Failed to cleanup expired verification tokens', {
      error: error instanceof Error ? error.message : 'Unknown error',
      jobId: job.id,
    });
    throw error;
  }
}
