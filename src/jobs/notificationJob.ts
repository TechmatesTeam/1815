import { Job } from 'bull';
import { JobData, queueService, QueueNames, JobNames } from '@/services/queueService';
import { Alias } from '@/models/Alias';
import { logger } from '@/utils/logger';
import { cacheService, CacheKeys } from '@/services/cacheService';

export interface NotificationJobData extends JobData {
  aliasId?: string;
  shortCode?: string;
  cardanoAddress?: string;
  userEmail?: string;
  type: 'expiry_warning' | 'alias_expired' | 'feature_update';
  templateData?: Record<string, any>;
}

export interface BulkNotificationJobData extends JobData {
  batchSize?: number;
  dryRun?: boolean;
  notificationType: 'expiry_warning';
  daysBeforeExpiry?: number;
}

/**
 * Send individual notification
 */
export async function processNotification(job: Job<NotificationJobData>): Promise<{
  success: boolean;
  emailSent: boolean;
  error?: string;
}> {
  const { aliasId, shortCode, cardanoAddress, userEmail, type, templateData } = job.data;

  logger.info(`Processing notification: ${type} for alias ${shortCode}`);

  try {
    // Validate required data
    if (!userEmail) {
      throw new Error('User email is required for notification');
    }

    if (!shortCode || !cardanoAddress) {
      throw new Error('Alias details are required for notification');
    }

    // Check if notification was already sent (deduplication)
    if (aliasId) {
      const notificationKey = `${aliasId}:${type}`;
      const alreadySent = await cacheService.exists(notificationKey, {
        prefix: CacheKeys.NOTIFICATION,
      });

      if (alreadySent) {
        logger.info(`Notification ${type} already sent for alias ${shortCode}`);
        return { success: true, emailSent: false };
      }
    }

    // Prepare email data based on notification type
    let emailData: any = {
      to: userEmail,
      shortCode,
      cardanoAddress,
      ...templateData,
    };

    switch (type) {
      case 'expiry_warning':
        emailData = {
          ...emailData,
          subject: `Your Cardano alias ${shortCode} expires soon`,
          template: 'expiry-warning',
          expiryDate: templateData?.expiryDate,
          daysRemaining: templateData?.daysRemaining,
        };
        break;

      case 'alias_expired':
        emailData = {
          ...emailData,
          subject: `Your Cardano alias ${shortCode} has expired`,
          template: 'alias-expired',
          expiredDate: templateData?.expiredDate || new Date().toISOString(),
        };
        break;

      case 'feature_update':
        emailData = {
          ...emailData,
          subject: templateData?.subject || 'New features available on 1815.dev',
          template: 'feature-update',
          features: templateData?.features || [],
        };
        break;

      default:
        throw new Error(`Unknown notification type: ${type}`);
    }

    // Add email to email queue for actual sending
    await queueService.addJob(QueueNames.EMAIL_QUEUE, JobNames.SEND_EMAIL, emailData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    // Mark notification as sent (deduplication)
    if (aliasId) {
      const notificationKey = `${aliasId}:${type}`;
      await cacheService.set(
        notificationKey,
        { sentAt: new Date().toISOString(), type },
        {
          prefix: CacheKeys.NOTIFICATION,
          ttl: 7 * 24 * 60 * 60, // 7 days
        }
      );

      // Update alias notification flag if it's an expiry notification
      if (type === 'expiry_warning' || type === 'alias_expired') {
        await Alias.updateOne(
          { _id: aliasId },
          { $set: { notificationSent: true, updatedAt: new Date() } }
        );
      }
    }

    logger.info(`Notification ${type} queued for sending to ${userEmail}`);
    return { success: true, emailSent: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to process notification ${type} for alias ${shortCode}:`, error);
    return { success: false, emailSent: false, error: errorMessage };
  }
}

/**
 * Process bulk expiry warning notifications
 */
export async function processBulkNotifications(job: Job<BulkNotificationJobData>): Promise<{
  processed: number;
  queued: number;
  errors: number;
}> {
  const { batchSize = 100, dryRun = false, notificationType, daysBeforeExpiry = 3 } = job.data;

  logger.info(
    `Starting bulk notification job: ${notificationType} (${daysBeforeExpiry} days before expiry)`
  );

  let processed = 0;
  let queued = 0;
  let errors = 0;

  try {
    // Calculate the target date (3 days from now)
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysBeforeExpiry);
    targetDate.setHours(0, 0, 0, 0); // Start of day

    const endOfTargetDate = new Date(targetDate);
    endOfTargetDate.setHours(23, 59, 59, 999); // End of day

    // Find aliases expiring in the target timeframe that haven't been notified
    const aliasesToNotify = await Alias.find({
      isActive: true,
      userEmail: { $exists: true, $ne: null },
      notificationSent: { $ne: true },
      expiresAt: {
        $gte: targetDate,
        $lte: endOfTargetDate,
      },
    })
      .limit(batchSize)
      .select('_id shortCode cardanoAddress userEmail expiresAt')
      .lean();

    logger.info(
      `Found ${aliasesToNotify.length} aliases requiring ${notificationType} notifications`
    );

    // Process each alias
    for (const alias of aliasesToNotify) {
      try {
        processed++;

        // Update job progress
        const progress = Math.floor((processed / aliasesToNotify.length) * 100);
        await job.progress(progress);

        const daysRemaining = Math.ceil(
          (alias.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );

        if (!dryRun) {
          // Queue individual notification
          await queueService.addJob(
            QueueNames.NOTIFICATION_DELIVERY,
            JobNames.SEND_EXPIRY_NOTIFICATION,
            {
              aliasId: alias._id.toString(),
              shortCode: alias.shortCode,
              cardanoAddress: alias.cardanoAddress,
              userEmail: alias.userEmail,
              type: 'expiry_warning',
              templateData: {
                expiryDate: alias.expiresAt.toISOString(),
                daysRemaining,
              },
            },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
            }
          );

          queued++;
          logger.debug(
            `Queued expiry warning for alias: ${alias.shortCode} (${daysRemaining} days remaining)`
          );
        } else {
          // Dry run - just log what would be done
          logger.info(
            `[DRY RUN] Would send expiry warning for alias: ${alias.shortCode} (expires: ${alias.expiresAt})`
          );
          queued++;
        }
      } catch (error) {
        errors++;
        logger.error(`Error processing notification for alias ${alias.shortCode}:`, error);
      }
    }

    const result = { processed, queued, errors };
    logger.info(`Bulk notification job completed:`, result);
    return result;
  } catch (error) {
    logger.error('Bulk notification job failed:', error);
    throw error;
  }
}

/**
 * Schedule daily expiry warning notifications
 */
export async function scheduleExpiryWarningJob(): Promise<void> {
  try {
    // Schedule to run daily at 9 AM UTC (good time for most timezones)
    await queueService.addRecurringJob(
      QueueNames.NOTIFICATION_DELIVERY,
      JobNames.PROCESS_BULK_NOTIFICATIONS,
      {
        batchSize: 100,
        dryRun: false,
        notificationType: 'expiry_warning',
        daysBeforeExpiry: 3,
      },
      '0 9 * * *', // Daily at 9 AM
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }
    );

    logger.info('Scheduled daily expiry warning notification job');
  } catch (error) {
    logger.error('Failed to schedule expiry warning job:', error);
    throw error;
  }
}

/**
 * Register notification job processors
 */
export function registerNotificationProcessors(): void {
  // Register individual notification processor
  queueService.registerProcessor(
    QueueNames.NOTIFICATION_DELIVERY,
    JobNames.SEND_EXPIRY_NOTIFICATION,
    processNotification as any,
    5 // Process up to 5 notifications concurrently
  );

  // Register bulk notification processor
  queueService.registerProcessor(
    QueueNames.NOTIFICATION_DELIVERY,
    JobNames.PROCESS_BULK_NOTIFICATIONS,
    processBulkNotifications as any,
    1 // Process one bulk job at a time
  );

  logger.info('Registered notification job processors');
}
