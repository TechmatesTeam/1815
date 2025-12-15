import { logger } from '@/utils/logger';
import { queueService, QueueNames } from '@/services/queueService';
import { registerAliasExpirationProcessor, scheduleAliasExpirationJob } from './aliasExpirationJob';
import { registerNotificationProcessors, scheduleExpiryWarningJob } from './notificationJob';
import { registerQRCleanupProcessor, scheduleQRCleanupJob } from './qrCleanupJob';

export class JobManager {
  private isInitialized = false;

  /**
   * Initialize all job processors and scheduled jobs
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Job manager already initialized');
      return;
    }

    try {
      logger.info('Initializing job manager...');

      // Register all job processors
      this.registerProcessors();

      // Schedule recurring jobs
      await this.scheduleRecurringJobs();

      // Clean up old jobs
      await this.cleanupOldJobs();

      this.isInitialized = true;
      logger.info('✅ Job manager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize job manager:', error);
      throw error;
    }
  }

  /**
   * Register all job processors
   */
  private registerProcessors(): void {
    logger.info('Registering job processors...');

    // Register alias expiration processor
    registerAliasExpirationProcessor();

    // Register notification processors
    registerNotificationProcessors();

    // Register QR cleanup processor
    registerQRCleanupProcessor();

    logger.info('All job processors registered');
  }

  /**
   * Schedule all recurring jobs
   */
  private async scheduleRecurringJobs(): Promise<void> {
    logger.info('Scheduling recurring jobs...');

    try {
      // Schedule alias expiration job (daily at 2 AM UTC)
      await scheduleAliasExpirationJob();

      // Schedule expiry warning notifications (daily at 9 AM UTC)
      await scheduleExpiryWarningJob();

      // Schedule QR code cleanup job (daily at 3 AM UTC)
      await scheduleQRCleanupJob();

      logger.info('All recurring jobs scheduled');
    } catch (error) {
      logger.error('Failed to schedule recurring jobs:', error);
      throw error;
    }
  }

  /**
   * Clean up old completed and failed jobs
   */
  private async cleanupOldJobs(): Promise<void> {
    logger.info('Cleaning up old jobs...');

    try {
      const queues = [
        QueueNames.ALIAS_EXPIRATION,
        QueueNames.NOTIFICATION_DELIVERY,
        QueueNames.QR_CLEANUP,
        QueueNames.EMAIL_QUEUE,
      ];

      const cleanupPromises = queues.map(async queueName => {
        try {
          // Clean completed jobs older than 24 hours
          const completedCleaned = await queueService.cleanQueue(
            queueName,
            24 * 60 * 60 * 1000, // 24 hours
            'completed'
          );

          // Clean failed jobs older than 7 days
          const failedCleaned = await queueService.cleanQueue(
            queueName,
            7 * 24 * 60 * 60 * 1000, // 7 days
            'failed'
          );

          logger.info(
            `Cleaned queue ${queueName}: ${completedCleaned} completed, ${failedCleaned} failed jobs`
          );
        } catch (error) {
          logger.error(`Failed to clean queue ${queueName}:`, error);
        }
      });

      await Promise.all(cleanupPromises);
      logger.info('Job cleanup completed');
    } catch (error) {
      logger.error('Failed to cleanup old jobs:', error);
    }
  }

  /**
   * Get status of all queues
   */
  async getStatus(): Promise<Record<string, any>> {
    try {
      const queues = [
        QueueNames.ALIAS_EXPIRATION,
        QueueNames.NOTIFICATION_DELIVERY,
        QueueNames.QR_CLEANUP,
        QueueNames.EMAIL_QUEUE,
      ];

      const statusPromises = queues.map(async queueName => {
        try {
          const stats = await queueService.getQueueStats(queueName);
          return { [queueName]: stats };
        } catch (error) {
          logger.error(`Failed to get stats for queue ${queueName}:`, error);
          return { [queueName]: { error: 'Failed to get stats' } };
        }
      });

      const results = await Promise.all(statusPromises);
      return results.reduce(
        (acc: Record<string, any>, result: Record<string, any>) => ({ ...acc, ...result }),
        {} as Record<string, any>
      );
    } catch (error) {
      logger.error('Failed to get job manager status:', error);
      return { error: 'Failed to get status' };
    }
  }

  /**
   * Pause all queues
   */
  async pauseAll(): Promise<void> {
    try {
      const queues = [
        QueueNames.ALIAS_EXPIRATION,
        QueueNames.NOTIFICATION_DELIVERY,
        QueueNames.QR_CLEANUP,
        QueueNames.EMAIL_QUEUE,
      ];

      const pausePromises = queues.map(queueName =>
        queueService
          .pauseQueue(queueName)
          .catch(error => logger.error(`Failed to pause queue ${queueName}:`, error))
      );

      await Promise.all(pausePromises);
      logger.info('All queues paused');
    } catch (error) {
      logger.error('Failed to pause all queues:', error);
      throw error;
    }
  }

  /**
   * Resume all queues
   */
  async resumeAll(): Promise<void> {
    try {
      const queues = [
        QueueNames.ALIAS_EXPIRATION,
        QueueNames.NOTIFICATION_DELIVERY,
        QueueNames.QR_CLEANUP,
        QueueNames.EMAIL_QUEUE,
      ];

      const resumePromises = queues.map(queueName =>
        queueService
          .resumeQueue(queueName)
          .catch(error => logger.error(`Failed to resume queue ${queueName}:`, error))
      );

      await Promise.all(resumePromises);
      logger.info('All queues resumed');
    } catch (error) {
      logger.error('Failed to resume all queues:', error);
      throw error;
    }
  }

  /**
   * Shutdown job manager gracefully
   */
  async shutdown(): Promise<void> {
    try {
      logger.info('Shutting down job manager...');

      // Pause all queues first
      await this.pauseAll();

      // Close all queue connections
      await queueService.closeAll();

      this.isInitialized = false;
      logger.info('Job manager shutdown completed');
    } catch (error) {
      logger.error('Error during job manager shutdown:', error);
      throw error;
    }
  }

  /**
   * Check if job manager is initialized
   */
  get initialized(): boolean {
    return this.isInitialized;
  }
}

// Create singleton instance
export const jobManager = new JobManager();
