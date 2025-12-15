import Queue, { Job, JobOptions, QueueOptions } from 'bull';
import { config } from '@/config/environment';
import { logger } from '@/utils/logger';
import { jobFailureService } from '@/services/jobFailureService';

export interface JobData {
  [key: string]: any;
}

export interface QueueJobOptions extends JobOptions {
  attempts?: number;
  backoff?: {
    type: 'fixed' | 'exponential';
    delay: number;
  };
  delay?: number;
}

export class QueueService {
  private queues: Map<string, Queue.Queue> = new Map();
  private processors: Map<string, (job: Job<JobData>) => Promise<any>> = new Map();

  private getQueueOptions(): QueueOptions {
    return {
      redis: {
        host: new URL(config.redis.url).hostname,
        port: parseInt(new URL(config.redis.url).port) || 6379,
        password: new URL(config.redis.url).password || undefined,
        maxRetriesPerRequest: config.redis.options.maxRetriesPerRequest,
      },
      defaultJobOptions: {
        removeOnComplete: 10, // Keep last 10 completed jobs
        removeOnFail: 50, // Keep last 50 failed jobs
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    };
  }

  /**
   * Create or get a queue
   */
  getQueue(name: string): Queue.Queue {
    if (!this.queues.has(name)) {
      const queue = new Queue(name, this.getQueueOptions());

      // Set up event listeners
      queue.on('ready', () => {
        logger.info(`Queue ${name} is ready`);
      });

      queue.on('error', error => {
        logger.error(`Queue ${name} error:`, error);
      });

      queue.on('waiting', jobId => {
        logger.debug(`Job ${jobId} is waiting in queue ${name}`);
      });

      queue.on('active', job => {
        logger.info(`Job ${job.id} started processing in queue ${name}`);
      });

      queue.on('completed', (job, result) => {
        logger.info(`Job ${job.id} completed in queue ${name}:`, result);
      });

      queue.on('failed', (job, error) => {
        logger.error(`Job ${job.id} failed in queue ${name}:`, error);
        // Log failure for alerting and monitoring
        jobFailureService.logJobFailure(job, error).catch(alertError => {
          logger.error('Failed to log job failure for alerting:', alertError);
        });
      });

      queue.on('stalled', job => {
        logger.warn(`Job ${job.id} stalled in queue ${name}`);
      });

      this.queues.set(name, queue);
    }

    return this.queues.get(name)!;
  }

  /**
   * Add a job to a queue
   */
  async addJob(
    queueName: string,
    jobName: string,
    data: JobData,
    options: QueueJobOptions = {}
  ): Promise<Job<JobData>> {
    try {
      const queue = this.getQueue(queueName);
      const job = await queue.add(jobName, data, options);

      logger.info(`Job ${job.id} (${jobName}) added to queue ${queueName}`);
      return job;
    } catch (error) {
      logger.error(`Failed to add job ${jobName} to queue ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Add a delayed job to a queue
   */
  async addDelayedJob(
    queueName: string,
    jobName: string,
    data: JobData,
    delay: number,
    options: QueueJobOptions = {}
  ): Promise<Job<JobData>> {
    return this.addJob(queueName, jobName, data, { ...options, delay });
  }

  /**
   * Add a recurring job to a queue
   */
  async addRecurringJob(
    queueName: string,
    jobName: string,
    data: JobData,
    cronExpression: string,
    options: QueueJobOptions = {}
  ): Promise<Job<JobData>> {
    try {
      const queue = this.getQueue(queueName);
      const job = await queue.add(jobName, data, {
        ...options,
        repeat: { cron: cronExpression },
      });

      logger.info(
        `Recurring job ${job.id} (${jobName}) scheduled in queue ${queueName} with cron: ${cronExpression}`
      );
      return job;
    } catch (error) {
      logger.error(`Failed to add recurring job ${jobName} to queue ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Register a job processor
   */
  registerProcessor(
    queueName: string,
    jobName: string,
    processor: (job: Job<JobData>) => Promise<any>,
    concurrency: number = 1
  ): void {
    const queue = this.getQueue(queueName);
    const processorKey = `${queueName}:${jobName}`;

    this.processors.set(processorKey, processor);

    queue.process(jobName, concurrency, async (job: Job<JobData>) => {
      try {
        logger.info(`Processing job ${job.id} (${jobName}) in queue ${queueName}`);
        const result = await processor(job);
        logger.info(`Job ${job.id} (${jobName}) completed successfully`);
        return result;
      } catch (error) {
        logger.error(`Job ${job.id} (${jobName}) failed:`, error);
        throw error;
      }
    });

    logger.info(
      `Registered processor for ${jobName} in queue ${queueName} with concurrency ${concurrency}`
    );
  }

  /**
   * Get job by ID
   */
  async getJob(queueName: string, jobId: string): Promise<Job<JobData> | null> {
    try {
      const queue = this.getQueue(queueName);
      return await queue.getJob(jobId);
    } catch (error) {
      logger.error(`Failed to get job ${jobId} from queue ${queueName}:`, error);
      return null;
    }
  }

  /**
   * Remove a job from queue
   */
  async removeJob(queueName: string, jobId: string): Promise<boolean> {
    try {
      const job = await this.getJob(queueName, jobId);
      if (job) {
        await job.remove();
        logger.info(`Job ${jobId} removed from queue ${queueName}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Failed to remove job ${jobId} from queue ${queueName}:`, error);
      return false;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: string): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    try {
      const queue = this.getQueue(queueName);
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed(),
        queue.getDelayed(),
      ]);

      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
      };
    } catch (error) {
      logger.error(`Failed to get stats for queue ${queueName}:`, error);
      return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    }
  }

  /**
   * Pause a queue
   */
  async pauseQueue(queueName: string): Promise<void> {
    try {
      const queue = this.getQueue(queueName);
      await queue.pause();
      logger.info(`Queue ${queueName} paused`);
    } catch (error) {
      logger.error(`Failed to pause queue ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Resume a queue
   */
  async resumeQueue(queueName: string): Promise<void> {
    try {
      const queue = this.getQueue(queueName);
      await queue.resume();
      logger.info(`Queue ${queueName} resumed`);
    } catch (error) {
      logger.error(`Failed to resume queue ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Clean old jobs from queue
   */
  async cleanQueue(
    queueName: string,
    grace: number = 24 * 60 * 60 * 1000, // 24 hours
    status: 'completed' | 'failed' = 'completed'
  ): Promise<number> {
    try {
      const queue = this.getQueue(queueName);
      const jobs = await queue.clean(grace, status);
      logger.info(`Cleaned ${jobs.length} ${status} jobs from queue ${queueName}`);
      return jobs.length;
    } catch (error) {
      logger.error(`Failed to clean queue ${queueName}:`, error);
      return 0;
    }
  }

  /**
   * Close all queues
   */
  async closeAll(): Promise<void> {
    try {
      const closePromises = Array.from(this.queues.values()).map(queue => queue.close());
      await Promise.all(closePromises);
      this.queues.clear();
      this.processors.clear();
      logger.info('All queues closed');
    } catch (error) {
      logger.error('Error closing queues:', error);
      throw error;
    }
  }
}

// Queue names constants
export const QueueNames = {
  ALIAS_EXPIRATION: 'alias-expiration',
  NOTIFICATION_DELIVERY: 'notification-delivery',
  QR_CLEANUP: 'qr-cleanup',
  EMAIL_QUEUE: 'email-queue',
} as const;

// Job names constants
export const JobNames = {
  EXPIRE_ALIASES: 'expire-aliases',
  SEND_EXPIRY_NOTIFICATION: 'send-expiry-notification',
  CLEANUP_QR_CODES: 'cleanup-qr-codes',
  SEND_EMAIL: 'send-email',
  PROCESS_BULK_NOTIFICATIONS: 'process-bulk-notifications',
} as const;

// Create singleton instance
export const queueService = new QueueService();
