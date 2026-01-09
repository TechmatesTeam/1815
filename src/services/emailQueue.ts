import Queue from 'bull';
import { config } from '@/config/environment';
import { logger } from '@/utils/logger';

const redisUrl = process.env.REDIS_URL || config.redis.url || 'redis://127.0.0.1:6379';

export type EmailJobPayload = {
  type: 'honored' | 'rejected';
  to: string;
  payment: any;
  reason?: string | null;
};

const emailQueue = new Queue<EmailJobPayload>('emailQueue', redisUrl);

emailQueue.on('failed', (job, err) => {
  logger.warn('Email job failed', { id: job.id, err: err && (err as Error).message });
});

emailQueue.on('completed', job => {
  logger.info('Email job completed', { id: job.id });
});

export async function addEmailJob(payload: EmailJobPayload) {
  // attempts with exponential backoff
  await emailQueue.add(payload, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false,
  });
}

export default emailQueue;
