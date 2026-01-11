import { Request, Response, NextFunction } from 'express';
import { notificationService, SubscriptionData } from '@/services/notificationService';
import { createError } from '@/middlewares/errorHandler';
import { logger } from '@/utils/logger';
import * as crypto from 'crypto';

export class NotificationController {
  /**
   * Subscribe to notifications
   * POST /api/v1/notifications/subscribe
   * Requirements: 4.3, 4.4
   */
  static async subscribe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, preferences } = req.body;

      logger.info('Processing notification subscription', {
        email: email ? email.substring(0, 5) + '***' : 'none',
        hasPreferences: !!preferences,
        requestId: res.locals.requestId,
      });

      const subscriptionData: SubscriptionData = {
        email,
        preferences: preferences || {},
      };

      const result = await notificationService.subscribeToNotifications(subscriptionData);

      if (!result.success) {
        logger.warn('Notification subscription failed', {
          email: email ? email.substring(0, 5) + '***' : 'none',
          message: result.message,
          requestId: res.locals.requestId,
        });

        if (result.message.includes('Invalid email')) {
          next(createError('Invalid email format provided', 400, 'INVALID_EMAIL'));
        } else {
          next(createError('Failed to subscribe to notifications', 500, 'SUBSCRIPTION_FAILED'));
        }
        return;
      }

      logger.info('Notification subscription successful', {
        email: email ? email.substring(0, 5) + '***' : 'none',
        notificationId: result.notificationId,
        requestId: res.locals.requestId,
      });

      res.status(201).json({
        success: true,
        data: {
          message: result.message,
          subscriptionId: result.notificationId,
          preferences: preferences || {
            aliasExpiry: true,
            featureUpdates: false,
            ecosystemNews: false,
          },
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to process notification subscription', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      next(createError('Failed to process subscription request', 500, 'SUBSCRIPTION_ERROR'));
    }
  }

  /**
   * Update notification preferences
   * PUT /api/v1/notifications/preferences
   * Requirements: 4.4
   */
  static async updatePreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, preferences } = req.body;

      if (!email) {
        next(createError('Email address is required', 400, 'MISSING_EMAIL'));
        return;
      }

      logger.info('Updating notification preferences', {
        email: email.substring(0, 5) + '***',
        preferences,
        requestId: res.locals.requestId,
      });

      const result = await notificationService.updatePreferences(email, preferences);

      if (!result.success) {
        logger.warn('Preference update failed', {
          email: email.substring(0, 5) + '***',
          message: result.message,
          requestId: res.locals.requestId,
        });

        if (result.message.includes('Invalid email')) {
          next(createError('Invalid email format provided', 400, 'INVALID_EMAIL'));
        } else if (result.message.includes('not found')) {
          next(createError('User not found', 404, 'USER_NOT_FOUND'));
        } else {
          next(createError('Failed to update preferences', 500, 'PREFERENCE_UPDATE_FAILED'));
        }
        return;
      }

      // Get updated preferences to return to client
      const updatedPreferences = await notificationService.getPreferences(email);

      logger.info('Notification preferences updated successfully', {
        email: email.substring(0, 5) + '***',
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          message: result.message,
          preferences: updatedPreferences
            ? {
                aliasExpiry: updatedPreferences.aliasExpiry,
                featureUpdates: updatedPreferences.featureUpdates,
                ecosystemNews: updatedPreferences.ecosystemNews,
              }
            : null,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to update notification preferences', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      next(createError('Failed to update preferences', 500, 'PREFERENCE_UPDATE_ERROR'));
    }
  }

  /**
   * Unsubscribe from notifications
   * POST /api/v1/notifications/unsubscribe/:token
   * Requirements: 4.3, 4.4
   */
  static async unsubscribe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = req.params;
      const { email } = req.body;

      // For now, we'll use email directly since token-based unsubscribe
      // would require additional token generation and storage logic
      if (!email) {
        next(createError('Email address is required for unsubscribe', 400, 'MISSING_EMAIL'));
        return;
      }

      logger.info('Processing unsubscribe request', {
        email: email.substring(0, 5) + '***',
        token: token ? token.substring(0, 8) + '***' : 'none',
        requestId: res.locals.requestId,
      });

      const result = await notificationService.unsubscribe(email, token);

      if (!result.success) {
        logger.warn('Unsubscribe failed', {
          email: email.substring(0, 5) + '***',
          message: result.message,
          requestId: res.locals.requestId,
        });

        if (result.message.includes('Invalid email')) {
          next(createError('Invalid email format provided', 400, 'INVALID_EMAIL'));
        } else {
          next(createError('Failed to unsubscribe', 500, 'UNSUBSCRIBE_FAILED'));
        }
        return;
      }

      logger.info('Unsubscribe successful', {
        email: email.substring(0, 5) + '***',
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          message: result.message,
          unsubscribedAt: new Date().toISOString(),
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to process unsubscribe request', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      next(createError('Failed to process unsubscribe request', 500, 'UNSUBSCRIBE_ERROR'));
    }
  }

  /**
   * Get notification preferences (optional endpoint for user convenience)
   * GET /api/v1/notifications/preferences?email=<email>
   */
  static async getPreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.query;

      if (!email || typeof email !== 'string') {
        next(createError('Email address is required', 400, 'MISSING_EMAIL'));
        return;
      }

      logger.debug('Getting notification preferences', {
        email: email.substring(0, 5) + '***',
        requestId: res.locals.requestId,
      });

      const preferences = await notificationService.getPreferences(email);

      if (!preferences) {
        logger.warn('Preferences not found', {
          email: email.substring(0, 5) + '***',
          requestId: res.locals.requestId,
        });
        next(createError('User preferences not found', 404, 'PREFERENCES_NOT_FOUND'));
        return;
      }

      logger.info('Notification preferences retrieved', {
        email: email.substring(0, 5) + '***',
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          preferences: {
            aliasExpiry: preferences.aliasExpiry,
            featureUpdates: preferences.featureUpdates,
            ecosystemNews: preferences.ecosystemNews,
          },
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to get notification preferences', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      next(createError('Failed to retrieve preferences', 500, 'PREFERENCES_RETRIEVAL_FAILED'));
    }
  }

  /**
   * Get notification statistics (admin endpoint)
   * GET /api/v1/notifications/stats
   */
  static async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      logger.debug('Getting notification statistics', {
        requestId: res.locals.requestId,
      });

      const stats = await notificationService.getNotificationStats();

      logger.info('Notification statistics retrieved', {
        totalSubscribers: stats.totalSubscribers,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          statistics: stats,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to get notification statistics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      next(createError('Failed to retrieve statistics', 500, 'STATS_RETRIEVAL_FAILED'));
    }
  }

  /**
   * Generate unsubscribe token (helper method for future use)
   */
  private static generateUnsubscribeToken(email: string): string {
    const timestamp = Date.now().toString();
    const randomBytes = crypto.randomBytes(16).toString('hex');
    const hash = crypto
      .createHash('sha256')
      .update(`${email}:${timestamp}:${randomBytes}`)
      .digest('hex');
    return `${timestamp}.${randomBytes}.${hash.substring(0, 16)}`;
  }

  /**
   * Validate unsubscribe token (helper method for future use)
   */
  private static validateUnsubscribeToken(token: string, email: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;

      const [timestamp, randomBytes, hash] = parts;
      const expectedHash = crypto
        .createHash('sha256')
        .update(`${email}:${timestamp}:${randomBytes}`)
        .digest('hex')
        .substring(0, 16);

      // Check if token is valid and not older than 30 days
      const tokenAge = Date.now() - parseInt(timestamp);
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

      return hash === expectedHash && tokenAge <= maxAge;
    } catch (error) {
      return false;
    }
  }
}
