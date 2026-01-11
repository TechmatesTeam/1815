import { Job } from 'bull';
import { JobData, queueService, QueueNames, JobNames } from '@/services/queueService';
import { PaymentRequest } from '@/models/PaymentRequest';
import { logger } from '@/utils/logger';

export interface PaymentExpirationJobData extends JobData {
  batchSize?: number;
  dryRun?: boolean;
}

export async function processPaymentExpiration(job: Job<PaymentExpirationJobData>): Promise<{
  processed: number;
  expired: number;
  errors: number;
}> {
  const { batchSize = 100, dryRun = false } = job.data;

  logger.info(`Starting payment expiration job (batchSize: ${batchSize}, dryRun: ${dryRun})`);

  let processed = 0;
  let expired = 0;
  let errors = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      const payments = await PaymentRequest.find({
        status: 'pending',
        expiresAt: { $lte: new Date() },
      })
        .limit(batchSize)
        .select('_id jti cardanoAddress expiresAt')
        .lean();

      if (payments.length === 0) {
        hasMore = false;
        break;
      }

      for (const p of payments) {
        try {
          processed++;

          if (!dryRun) {
            const result = await PaymentRequest.updateOne(
              { _id: p._id, status: 'pending' },
              { $set: { status: 'expired', updatedAt: new Date() } }
            );

            if (result.modifiedCount > 0) {
              expired++;
              logger.debug(`Expired payment: ${p.jti}`);
            }
          } else {
            logger.info(`[DRY RUN] Would expire payment: ${p.jti}`);
            expired++;
          }
        } catch (error) {
          errors++;
          logger.error(`Error processing payment ${p.jti}:`, error);
        }
      }

      if (payments.length < batchSize) {
        hasMore = false;
      }
    }

    const result = { processed, expired, errors };
    logger.info('Payment expiration job completed:', result);
    return result;
  } catch (error) {
    logger.error('Payment expiration job failed:', error);
    throw error;
  }
}

export async function schedulePaymentExpirationJob(): Promise<void> {
  try {
    // Schedule to run hourly
    await queueService.addRecurringJob(
      QueueNames.PAYMENT_EXPIRATION,
      JobNames.EXPIRE_PAYMENTS,
      { batchSize: 100, dryRun: false },
      '0 * * * *', // top of each hour
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }
    );

    logger.info('Scheduled payment expiration job');
  } catch (error) {
    logger.error('Failed to schedule payment expiration job:', error);
    throw error;
  }
}

export function registerPaymentExpirationProcessor(): void {
  queueService.registerProcessor(
    QueueNames.PAYMENT_EXPIRATION,
    JobNames.EXPIRE_PAYMENTS,
    processPaymentExpiration,
    1
  );

  logger.info('Registered payment expiration job processor');
}
