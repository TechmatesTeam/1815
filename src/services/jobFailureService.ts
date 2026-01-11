import { Job } from 'bull';
import { logger } from '@/utils/logger';
import { emailService } from '@/services/emailService';
import { config } from '@/config/environment';

export interface JobFailureEvent {
  jobId: string;
  jobName: string;
  queueName: string;
  error: Error;
  attemptsMade: number;
  maxAttempts: number;
  timestamp: Date;
  jobData: any;
  stackTrace?: string;
  isFinalFailure: boolean;
}

export interface JobFailureStats {
  totalFailures: number;
  failuresByQueue: Record<string, number>;
  failuresByJob: Record<string, number>;
  recentFailures: JobFailureEvent[];
  criticalFailures: JobFailureEvent[];
}

export class JobFailureService {
  private failureHistory: JobFailureEvent[] = [];
  private readonly maxHistorySize = 1000;
  private readonly criticalFailureThreshold = 5; // failures per hour
  private readonly alertCooldownMs = 60 * 60 * 1000; // 1 hour
  private lastAlertTime: Map<string, number> = new Map();

  /**
   * Log a job failure event
   * Requirements: 8.5 - Log errors and alert system administrators
   */
  async logJobFailure(job: Job, error: Error): Promise<void> {
    try {
      const failureEvent: JobFailureEvent = {
        jobId: job.id?.toString() || 'unknown',
        jobName: job.name,
        queueName: job.queue.name,
        error,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts || 1,
        timestamp: new Date(),
        jobData: this.sanitizeJobData(job.data),
        stackTrace: error.stack,
        isFinalFailure: job.attemptsMade >= (job.opts.attempts || 1),
      };

      // Add to failure history
      this.addToHistory(failureEvent);

      // Log the failure with appropriate level
      if (failureEvent.isFinalFailure) {
        logger.error('Job failed permanently:', {
          jobId: failureEvent.jobId,
          jobName: failureEvent.jobName,
          queueName: failureEvent.queueName,
          error: error.message,
          attemptsMade: failureEvent.attemptsMade,
          maxAttempts: failureEvent.maxAttempts,
          stackTrace: error.stack,
        });
      } else {
        logger.warn('Job failed, will retry:', {
          jobId: failureEvent.jobId,
          jobName: failureEvent.jobName,
          queueName: failureEvent.queueName,
          error: error.message,
          attemptsMade: failureEvent.attemptsMade,
          maxAttempts: failureEvent.maxAttempts,
        });
      }

      // Check if we need to send alerts
      await this.checkAndSendAlerts(failureEvent);
    } catch (alertError) {
      logger.error('Failed to log job failure:', alertError);
    }
  }

  /**
   * Add failure event to history and maintain size limit
   */
  private addToHistory(failureEvent: JobFailureEvent): void {
    this.failureHistory.push(failureEvent);

    // Maintain history size limit
    if (this.failureHistory.length > this.maxHistorySize) {
      this.failureHistory = this.failureHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Sanitize job data to remove sensitive information
   */
  private sanitizeJobData(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const sanitized = { ...data };

    // Remove or mask sensitive fields
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'email'];
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  /**
   * Check if alerts should be sent and send them
   */
  private async checkAndSendAlerts(failureEvent: JobFailureEvent): Promise<void> {
    try {
      // Always alert on final failures of critical jobs
      if (failureEvent.isFinalFailure && this.isCriticalJob(failureEvent.jobName)) {
        await this.sendCriticalJobAlert(failureEvent);
        return;
      }

      // Check for high failure rate
      const recentFailures = this.getRecentFailures(60 * 60 * 1000); // Last hour
      const queueFailures = recentFailures.filter(f => f.queueName === failureEvent.queueName);

      if (queueFailures.length >= this.criticalFailureThreshold) {
        const alertKey = `high-failure-rate:${failureEvent.queueName}`;
        if (this.shouldSendAlert(alertKey)) {
          await this.sendHighFailureRateAlert(failureEvent.queueName, queueFailures);
        }
      }
    } catch (error) {
      logger.error('Failed to check and send alerts:', error);
    }
  }

  /**
   * Check if a job is considered critical
   */
  private isCriticalJob(jobName: string): boolean {
    const criticalJobs = [
      'expire-aliases',
      'send-expiry-notification',
      'cleanup-qr-codes',
      'process-bulk-notifications',
    ];
    return criticalJobs.includes(jobName);
  }

  /**
   * Check if we should send an alert (respecting cooldown)
   */
  private shouldSendAlert(alertKey: string): boolean {
    const lastAlert = this.lastAlertTime.get(alertKey) || 0;
    const now = Date.now();

    if (now - lastAlert > this.alertCooldownMs) {
      this.lastAlertTime.set(alertKey, now);
      return true;
    }

    return false;
  }

  /**
   * Send alert for critical job failure
   */
  private async sendCriticalJobAlert(failureEvent: JobFailureEvent): Promise<void> {
    try {
      const alertKey = `critical-job-failure:${failureEvent.jobId}`;
      if (!this.shouldSendAlert(alertKey)) {
        return;
      }

      const subject = `🚨 Critical Job Failure - ${failureEvent.jobName}`;
      const message = this.formatCriticalJobAlertMessage(failureEvent);

      await this.sendAdminAlert(subject, message);

      logger.error('Critical job failure alert sent:', {
        jobId: failureEvent.jobId,
        jobName: failureEvent.jobName,
        queueName: failureEvent.queueName,
      });
    } catch (error) {
      logger.error('Failed to send critical job alert:', error);
    }
  }

  /**
   * Send alert for high failure rate
   */
  private async sendHighFailureRateAlert(
    queueName: string,
    failures: JobFailureEvent[]
  ): Promise<void> {
    try {
      const subject = `⚠️ High Job Failure Rate - ${queueName} Queue`;
      const message = this.formatHighFailureRateAlertMessage(queueName, failures);

      await this.sendAdminAlert(subject, message);

      logger.warn('High failure rate alert sent:', {
        queueName,
        failureCount: failures.length,
      });
    } catch (error) {
      logger.error('Failed to send high failure rate alert:', error);
    }
  }

  /**
   * Format critical job failure alert message
   */
  private formatCriticalJobAlertMessage(failureEvent: JobFailureEvent): string {
    return `
Critical Job Failure Alert

Job Details:
- Job ID: ${failureEvent.jobId}
- Job Name: ${failureEvent.jobName}
- Queue: ${failureEvent.queueName}
- Timestamp: ${failureEvent.timestamp.toISOString()}

Failure Details:
- Error: ${failureEvent.error.message}
- Attempts Made: ${failureEvent.attemptsMade}/${failureEvent.maxAttempts}
- Final Failure: ${failureEvent.isFinalFailure ? 'Yes' : 'No'}

Job Data:
${JSON.stringify(failureEvent.jobData, null, 2)}

Stack Trace:
${failureEvent.stackTrace || 'Not available'}

Please investigate this failure immediately as it may impact system functionality.

Environment: ${config.nodeEnv}
Service: 1815-api
    `.trim();
  }

  /**
   * Format high failure rate alert message
   */
  private formatHighFailureRateAlertMessage(
    queueName: string,
    failures: JobFailureEvent[]
  ): string {
    const jobCounts = failures.reduce(
      (acc, failure) => {
        acc[failure.jobName] = (acc[failure.jobName] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const jobCountsText = Object.entries(jobCounts)
      .map(([jobName, count]) => `- ${jobName}: ${count} failures`)
      .join('\n');

    return `
High Job Failure Rate Alert

Queue: ${queueName}
Time Period: Last 1 hour
Total Failures: ${failures.length}

Failure Breakdown by Job Type:
${jobCountsText}

Recent Failures:
${failures
  .slice(-5)
  .map(f => `- ${f.timestamp.toISOString()} | ${f.jobName} (${f.jobId}) | ${f.error.message}`)
  .join('\n')}

This indicates a potential system issue that requires investigation.

Environment: ${config.nodeEnv}
Service: 1815-api
    `.trim();
  }

  /**
   * Send alert to system administrators
   */
  private async sendAdminAlert(subject: string, message: string): Promise<void> {
    try {
      const adminEmails = this.getAdminEmails();

      if (adminEmails.length === 0) {
        logger.warn('No admin emails configured for job failure alerts');
        return;
      }

      // Send email to all administrators
      const emailPromises = adminEmails.map(email =>
        emailService.sendEmail({
          to: email,
          subject,
          text: message,
          html: message.replace(/\n/g, '<br>'),
        })
      );

      await Promise.all(emailPromises);

      logger.info('Job failure alert sent to administrators:', {
        recipients: adminEmails.length,
        subject,
      });
    } catch (error) {
      logger.error('Failed to send admin alert:', error);
    }
  }

  /**
   * Get administrator email addresses from configuration
   */
  private getAdminEmails(): string[] {
    const adminEmails = process.env.ADMIN_EMAILS;
    if (!adminEmails) {
      return [];
    }

    return adminEmails
      .split(',')
      .map(email => email.trim())
      .filter(email => email.length > 0);
  }

  /**
   * Get recent failures within a time window
   */
  private getRecentFailures(timeWindowMs: number): JobFailureEvent[] {
    const cutoff = new Date(Date.now() - timeWindowMs);
    return this.failureHistory.filter(failure => failure.timestamp >= cutoff);
  }

  /**
   * Get failure statistics
   */
  getFailureStats(): JobFailureStats {
    const recentFailures = this.getRecentFailures(24 * 60 * 60 * 1000); // Last 24 hours
    const criticalFailures = recentFailures.filter(
      f => f.isFinalFailure && this.isCriticalJob(f.jobName)
    );

    const failuresByQueue = recentFailures.reduce(
      (acc, failure) => {
        acc[failure.queueName] = (acc[failure.queueName] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const failuresByJob = recentFailures.reduce(
      (acc, failure) => {
        acc[failure.jobName] = (acc[failure.jobName] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      totalFailures: recentFailures.length,
      failuresByQueue,
      failuresByJob,
      recentFailures: recentFailures.slice(-20), // Last 20 failures
      criticalFailures,
    };
  }

  /**
   * Clear failure history (for testing or maintenance)
   */
  clearHistory(): void {
    this.failureHistory = [];
    this.lastAlertTime.clear();
    logger.info('Job failure history cleared');
  }

  /**
   * Get all failure events (for debugging)
   */
  getAllFailures(): JobFailureEvent[] {
    return [...this.failureHistory];
  }
}

// Create singleton instance
export const jobFailureService = new JobFailureService();
