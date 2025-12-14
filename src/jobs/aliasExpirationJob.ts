import { Job } from 'bull';
import { JobData, queueService, QueueNames, JobNames } from '@/services/queueService';
import { Alias } from '@/models/Alias';
import { logger } from '@/utils/logger';
import { cacheService, CacheKeys } from '@/services/cacheService';

export interface AliasExpirationJobData extends JobData {
  batchSize?: number;
  dryRun?: boolean;
}

/**
 * Process expired aliases and deactivate them
 */
export async function processAliasExpiration(job: Job<AliasExpirationJobData>): Promise<{
  processed: number;
  deactivated: number;
  errors: number;
}> {
  const { batchSize = 100, dryRun = false } = job.data;

  logger.info(`Starting alias expiration job (batchSize: ${batchSize}, dryRun: ${dryRun})`);

  let processed = 0;
  let deactivated = 0;
  let errors = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      // Find expired aliases that are still active
      const expiredAliases = await Alias.find({
        isActive: true,
        expiresAt: { $lte: new Date() },
      })
        .limit(batchSize)
        .select('_id shortCode cardanoAddress expiresAt userEmail')
        .lean();

      if (expiredAliases.length === 0) {
        hasMore = false;
        break;
      }

      logger.info(`Found ${expiredAliases.length} expired aliases to process`);

      // Process each expired alias
      for (const alias of expiredAliases) {
        try {
          processed++;

          // Update job progress
          const progress = Math.floor((processed / (processed + expiredAliases.length)) * 100);
          await job.progress(progress);

          if (!dryRun) {
            // Deactivate the alias atomically
            const result = await Alias.updateOne(
              {
                _id: alias._id,
                isActive: true, // Ensure it's still active
                expiresAt: { $lte: new Date() }, // Double-check expiry
              },
              {
                $set: {
                  isActive: false,
                  updatedAt: new Date(),
                },
              }
            );

            if (result.modifiedCount > 0) {
              deactivated++;

              // Remove from cache
              await cacheService.delete(alias.shortCode, { prefix: CacheKeys.ALIAS });

              logger.debug(`Deactivated expired alias: ${alias.shortCode}`);

              // Schedule notification if user email exists
              if (alias.userEmail) {
                await queueService.addJob(
                  QueueNames.NOTIFICATION_DELIVERY,
                  JobNames.SEND_EXPIRY_NOTIFICATION,
                  {
                    aliasId: alias._id.toString(),
                    shortCode: alias.shortCode,
                    cardanoAddress: alias.cardanoAddress,
                    userEmail: alias.userEmail,
                    type: 'alias_expired',
                  },
                  {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 2000 },
                  }
                );
              }
            }
          } else {
            // Dry run - just log what would be done
            logger.info(
              `[DRY RUN] Would deactivate alias: ${alias.shortCode} (expired: ${alias.expiresAt})`
            );
            deactivated++;
          }
        } catch (error) {
          errors++;
          logger.error(`Error processing expired alias ${alias.shortCode}:`, error);
        }
      }

      // If we processed fewer than the batch size, we're done
      if (expiredAliases.length < batchSize) {
        hasMore = false;
      }
    }

    const result = { processed, deactivated, errors };
    logger.info(`Alias expiration job completed:`, result);
    return result;
  } catch (error) {
    logger.error('Alias expiration job failed:', error);
    throw error;
  }
}

/**
 * Schedule daily alias expiration job
 */
export async function scheduleAliasExpirationJob(): Promise<void> {
  try {
    // Schedule to run daily at 2 AM UTC
    await queueService.addRecurringJob(
      QueueNames.ALIAS_EXPIRATION,
      JobNames.EXPIRE_ALIASES,
      { batchSize: 100, dryRun: false },
      '0 2 * * *', // Daily at 2 AM
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }
    );

    logger.info('Scheduled daily alias expiration job');
  } catch (error) {
    logger.error('Failed to schedule alias expiration job:', error);
    throw error;
  }
}

/**
 * Register the alias expiration job processor
 */
export function registerAliasExpirationProcessor(): void {
  queueService.registerProcessor(
    QueueNames.ALIAS_EXPIRATION,
    JobNames.EXPIRE_ALIASES,
    processAliasExpiration,
    1 // Process one job at a time to avoid conflicts
  );

  logger.info('Registered alias expiration job processor');
}
