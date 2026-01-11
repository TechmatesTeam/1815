import { Job } from 'bull';
import emailQueue from '@/services/emailQueue';
import { sendPaymentHonored, sendPaymentRejected } from '@/services/emailService';
import { logger } from '@/utils/logger';

export function startEmailWorker() {
  emailQueue.process(async (job: Job) => {
    const data = job.data;
    try {
      if (data.type === 'honored') {
        await sendPaymentHonored(data.to, data.payment);
      } else if (data.type === 'rejected') {
        await sendPaymentRejected(data.to, data.payment, data.reason || undefined);
      }
      return Promise.resolve();
    } catch (err) {
      logger.error('Error processing email job', err);
      throw err;
    }
  });

  logger.info('Email worker started');
}
