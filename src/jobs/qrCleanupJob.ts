import { Job } from 'bull';
import { JobData, queueService, QueueNames, JobNames } from '@/services/queueService';
import { Alias } from '@/models/Alias';
import { logger } from '@/utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface QRCleanupJobData extends JobData {
  batchSize?: number;
  dryRun?: boolean;
  qrStoragePath?: string;
}

/**
 * Process QR code cleanup for expired aliases
 * Requirements: 8.4 - Cleanup of expired QR code files
 */
export async function processQRCleanup(job: Job<QRCleanupJobData>): Promise<{
  processed: number;
  cleaned: number;
  errors: number;
}> {
  const { batchSize = 100, dryRun = false, qrStoragePath = './qr-codes' } = job.data;

  logger.info(`Starting QR code cleanup job (batchSize: ${batchSize}, dryRun: ${dryRun})`);

  let processed = 0;
  let cleaned = 0;
  let errors = 0;

  try {
    // Find expired aliases that have QR codes
    const expiredAliasesWithQR = await Alias.find({
      isActive: false,
      qrCodeUrl: { $exists: true, $ne: null },
    })
      .limit(batchSize)
      .select('_id shortCode qrCodeUrl expiresAt')
      .lean();

    logger.info(`Found ${expiredAliasesWithQR.length} expired aliases with QR codes to process`);

    for (const alias of expiredAliasesWithQR) {
      try {
        processed++;

        // Update job progress
        const progress = Math.floor((processed / expiredAliasesWithQR.length) * 100);
        await job.progress(progress);

        if (!alias.qrCodeUrl) {
          continue;
        }

        // Extract filename from QR code URL
        // Assuming QR code URL format: /qr-codes/{shortCode}.png or similar
        const qrFileName = path.basename(alias.qrCodeUrl);
        const qrFilePath = path.join(qrStoragePath, qrFileName);

        if (!dryRun) {
          try {
            // Check if file exists before attempting to delete
            await fs.access(qrFilePath);

            // Delete the QR code file
            await fs.unlink(qrFilePath);

            // Clear the QR code URL from the database
            await Alias.updateOne(
              { _id: alias._id },
              {
                $unset: { qrCodeUrl: 1 },
                $set: { updatedAt: new Date() },
              }
            );

            cleaned++;
            logger.debug(`Cleaned QR code file: ${qrFilePath} for alias: ${alias.shortCode}`);
          } catch (fileError: any) {
            if (fileError.code === 'ENOENT') {
              // File doesn't exist, just clear the URL from database
              await Alias.updateOne(
                { _id: alias._id },
                {
                  $unset: { qrCodeUrl: 1 },
                  $set: { updatedAt: new Date() },
                }
              );
              cleaned++;
              logger.debug(`QR code file not found, cleared URL for alias: ${alias.shortCode}`);
            } else {
              throw fileError;
            }
          }
        } else {
          // Dry run - just log what would be done
          logger.info(
            `[DRY RUN] Would delete QR code file: ${qrFilePath} for alias: ${alias.shortCode}`
          );
          cleaned++;
        }
      } catch (error) {
        errors++;
        logger.error(`Error processing QR cleanup for alias ${alias.shortCode}:`, error);
      }
    }

    const result = { processed, cleaned, errors };
    logger.info(`QR code cleanup job completed:`, result);
    return result;
  } catch (error) {
    logger.error('QR code cleanup job failed:', error);
    throw error;
  }
}

/**
 * Schedule daily QR code cleanup job
 */
export async function scheduleQRCleanupJob(): Promise<void> {
  try {
    // Schedule to run daily at 3 AM UTC (after alias expiration job)
    await queueService.addRecurringJob(
      QueueNames.QR_CLEANUP,
      JobNames.CLEANUP_QR_CODES,
      {
        batchSize: 100,
        dryRun: false,
        qrStoragePath: process.env.QR_STORAGE_PATH || './qr-codes',
      },
      '0 3 * * *', // Daily at 3 AM
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }
    );

    logger.info('Scheduled daily QR code cleanup job');
  } catch (error) {
    logger.error('Failed to schedule QR code cleanup job:', error);
    throw error;
  }
}

/**
 * Register the QR code cleanup job processor
 */
export function registerQRCleanupProcessor(): void {
  queueService.registerProcessor(
    QueueNames.QR_CLEANUP,
    JobNames.CLEANUP_QR_CODES,
    processQRCleanup as any,
    1 // Process one job at a time to avoid file system conflicts
  );

  logger.info('Registered QR code cleanup job processor');
}
