import { Alias } from '@/models/Alias';
import { User } from '@/models/User';
import { emailService } from '@/services/emailService';
import { queueService, QueueNames, JobNames } from '@/services/queueService';
import { cacheService, CacheKeys } from '@/services/cacheService';
import { logger } from '@/utils/logger';
import { isValidEmail } from '@/utils/validation';

export interface NotificationPreferences {
  aliasExpiry: boolean;
  featureUpdates: boolean;
  ecosystemNews: boolean;
  email: string;
}

export interface SubscriptionData {
  email: string;
  preferences: Partial<NotificationPreferences>;
  aliasId?: string;
}

export interface NotificationResult {
  success: boolean;
  message: string;
  notificationId?: string;
}

class NotificationService {
  /**
   * Subscribe user to notifications with email validation
   * Requirement 4.3: Validate User_Email format
   */
  async subscribeToNotifications(data: SubscriptionData): Promise<NotificationResult> {
    try {
      const { email, preferences, aliasId } = data;

      // Validate email format
      if (!isValidEmail(email)) {
        return {
          success: false,
          message: 'Invalid email format provided',
        };
      }

      // Create or update user preferences
      const userPreferences: NotificationPreferences = {
        aliasExpiry: preferences.aliasExpiry ?? true,
        featureUpdates: preferences.featureUpdates ?? false,
        ecosystemNews: preferences.ecosystemNews ?? false,
        email,
      };

      // Store user preferences in database
      let user = await User.findOne({ email });
      if (user) {
        // Update existing user
        user.notificationPreferences = userPreferences;
        user.updatedAt = new Date();
        await user.save();
      } else {
        // Create new user
        user = new User({
          email,
          notificationPreferences: userPreferences,
        });
        await user.save();
      }

      // If aliasId provided, associate email with the alias
      if (aliasId) {
        await Alias.findByIdAndUpdate(aliasId, {
          userEmail: email,
          updatedAt: new Date(),
        });
      }

      // Cache preferences for quick access
      await cacheService.set(`preferences:${email}`, userPreferences, {
        prefix: CacheKeys.NOTIFICATION,
        ttl: 3600, // 1 hour
      });

      logger.info(`User subscribed to notifications: ${email}`);
      return {
        success: true,
        message: 'Successfully subscribed to notifications',
        notificationId: email,
      };
    } catch (error) {
      logger.error('Failed to subscribe to notifications:', error);
      return {
        success: false,
        message: 'Failed to subscribe to notifications',
      };
    }
  }

  /**
   * Update notification preferences
   * Requirement 4.4: Store preference changes immediately
   */
  async updatePreferences(
    email: string,
    preferences: Partial<NotificationPreferences>
  ): Promise<NotificationResult> {
    try {
      // Validate email format
      if (!isValidEmail(email)) {
        return {
          success: false,
          message: 'Invalid email format provided',
        };
      }

      // Find existing user
      const user = await User.findOne({ email });
      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      // Update preferences - preserve existing values and apply updates
      const updatedPreferences: NotificationPreferences = {
        aliasExpiry:
          preferences.aliasExpiry !== undefined
            ? preferences.aliasExpiry
            : user.notificationPreferences.aliasExpiry,
        featureUpdates:
          preferences.featureUpdates !== undefined
            ? preferences.featureUpdates
            : user.notificationPreferences.featureUpdates,
        ecosystemNews:
          preferences.ecosystemNews !== undefined
            ? preferences.ecosystemNews
            : user.notificationPreferences.ecosystemNews,
        email, // Ensure email is preserved
      };

      user.notificationPreferences = updatedPreferences;
      user.updatedAt = new Date();
      await user.save();

      // Update cache
      await cacheService.set(`preferences:${email}`, updatedPreferences, {
        prefix: CacheKeys.NOTIFICATION,
        ttl: 3600, // 1 hour
      });

      logger.info(`Updated notification preferences for: ${email}`);
      return {
        success: true,
        message: 'Notification preferences updated successfully',
      };
    } catch (error) {
      logger.error('Failed to update notification preferences:', error);
      return {
        success: false,
        message: 'Failed to update notification preferences',
      };
    }
  }

  /**
   * Get user notification preferences
   */
  async getPreferences(email: string): Promise<NotificationPreferences | null> {
    try {
      // Try cache first
      const cached = await cacheService.get<NotificationPreferences>(`preferences:${email}`, {
        prefix: CacheKeys.NOTIFICATION,
      });

      if (cached) {
        return cached;
      }

      // Fallback to database
      const user = await User.findOne({ email }).select('notificationPreferences');
      if (!user || !user.notificationPreferences) {
        return null;
      }

      // Combine user preferences with email
      const preferences: NotificationPreferences = {
        aliasExpiry: user.notificationPreferences.aliasExpiry,
        featureUpdates: user.notificationPreferences.featureUpdates,
        ecosystemNews: user.notificationPreferences.ecosystemNews,
        email,
      };

      // Cache for future requests
      await cacheService.set(`preferences:${email}`, preferences, {
        prefix: CacheKeys.NOTIFICATION,
        ttl: 3600, // 1 hour
      });

      return preferences;
    } catch (error) {
      logger.error('Failed to get notification preferences:', error);
      return null;
    }
  }

  /**
   * Send expiry warning notification
   * Requirement 4.1: Send email warning 3 days before expiry
   * Requirement 4.2: Include Short_Code and original Cardano_Address
   */
  async sendExpiryWarning(
    aliasId: string,
    shortCode: string,
    cardanoAddress: string,
    userEmail: string,
    expiresAt: Date
  ): Promise<NotificationResult> {
    try {
      // Enhanced deduplication check
      // Requirement 4.5: Prevent duplicate notification sending
      const isDuplicate = await this.checkNotificationDeduplication(aliasId, 'expiry_warning');
      if (isDuplicate) {
        return {
          success: true,
          message: 'Expiry warning already sent for this alias',
        };
      }

      // Get user preferences
      const preferences = await this.getPreferences(userEmail);
      if (!preferences || !preferences.aliasExpiry) {
        return {
          success: true,
          message: 'User has disabled expiry warning notifications',
        };
      }

      // Calculate days remaining
      const daysRemaining = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

      // Mark notification as being sent (atomic operation)
      const marked = await this.markNotificationAsSent(aliasId, 'expiry_warning', {
        shortCode,
        cardanoAddress,
        userEmail,
        expiresAt: expiresAt.toISOString(),
        daysRemaining,
      });

      if (!marked) {
        return {
          success: false,
          message: 'Failed to mark notification as sent (possible race condition)',
        };
      }

      // Queue notification for delivery
      await queueService.addJob(
        QueueNames.NOTIFICATION_DELIVERY,
        JobNames.SEND_EXPIRY_NOTIFICATION,
        {
          aliasId,
          shortCode,
          cardanoAddress,
          userEmail,
          type: 'expiry_warning',
          templateData: {
            expiryDate: expiresAt.toISOString(),
            daysRemaining,
          },
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        }
      );

      logger.info(`Expiry warning queued for alias: ${shortCode}`);
      return {
        success: true,
        message: 'Expiry warning notification queued for delivery',
        notificationId: `${aliasId}:expiry_warning`,
      };
    } catch (error) {
      logger.error('Failed to send expiry warning:', error);
      return {
        success: false,
        message: 'Failed to send expiry warning notification',
      };
    }
  }

  /**
   * Send feature update notification
   */
  async sendFeatureUpdate(
    email: string,
    featureName: string,
    description: string
  ): Promise<NotificationResult> {
    try {
      // Get user preferences
      const preferences = await this.getPreferences(email);
      if (!preferences || !preferences.featureUpdates) {
        return {
          success: true,
          message: 'User has disabled feature update notifications',
        };
      }

      // Queue notification for delivery
      await queueService.addJob(
        QueueNames.NOTIFICATION_DELIVERY,
        JobNames.SEND_EXPIRY_NOTIFICATION, // Reuse the same processor
        {
          userEmail: email,
          type: 'feature_update',
          templateData: {
            subject: `New Feature Available: ${featureName}`,
            featureName,
            description,
            features: [{ name: featureName, description }],
          },
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        }
      );

      logger.info(`Feature update notification queued for: ${email}`);
      return {
        success: true,
        message: 'Feature update notification queued for delivery',
      };
    } catch (error) {
      logger.error('Failed to send feature update notification:', error);
      return {
        success: false,
        message: 'Failed to send feature update notification',
      };
    }
  }

  /**
   * Unsubscribe user from notifications
   */
  async unsubscribe(email: string, token?: string): Promise<NotificationResult> {
    try {
      // Validate email format
      if (!isValidEmail(email)) {
        return {
          success: false,
          message: 'Invalid email format provided',
        };
      }

      // Update user preferences to disable all notifications
      let user = await User.findOne({ email });
      if (user) {
        user.notificationPreferences = {
          aliasExpiry: false,
          featureUpdates: false,
          ecosystemNews: false,
        };
        user.updatedAt = new Date();
        await user.save();
      } else {
        // Create new user with disabled notifications
        user = new User({
          email,
          notificationPreferences: {
            aliasExpiry: false,
            featureUpdates: false,
            ecosystemNews: false,
          },
        });
        await user.save();
      }

      // Clear cache
      await cacheService.delete(`preferences:${email}`, {
        prefix: CacheKeys.NOTIFICATION,
      });

      logger.info(`User unsubscribed from notifications: ${email}`);
      return {
        success: true,
        message: 'Successfully unsubscribed from all notifications',
      };
    } catch (error) {
      logger.error('Failed to unsubscribe from notifications:', error);
      return {
        success: false,
        message: 'Failed to unsubscribe from notifications',
      };
    }
  }

  /**
   * Check if notification was already sent (deduplication helper)
   * Requirement 4.5: Prevent duplicate notification sending
   */
  async isNotificationSent(aliasId: string, type: string): Promise<boolean> {
    try {
      const notificationKey = `${aliasId}:${type}`;
      return await cacheService.exists(notificationKey, {
        prefix: CacheKeys.NOTIFICATION,
      });
    } catch (error) {
      logger.error('Failed to check notification status:', error);
      return false;
    }
  }

  /**
   * Enhanced deduplication check using both cache and database
   * Requirement 4.5: Prevent duplicate notification sending
   */
  async checkNotificationDeduplication(aliasId: string, type: string): Promise<boolean> {
    try {
      // Check cache first (fastest)
      const notificationKey = `${aliasId}:${type}`;
      const cacheExists = await cacheService.exists(notificationKey, {
        prefix: CacheKeys.NOTIFICATION,
      });

      if (cacheExists) {
        return true;
      }

      // Check database flag for expiry warnings
      if (type === 'expiry_warning') {
        const alias = await Alias.findById(aliasId).select('notificationSent');
        if (alias && alias.notificationSent) {
          // Sync cache with database state
          await cacheService.set(
            notificationKey,
            { sentAt: new Date().toISOString(), type, source: 'database' },
            {
              prefix: CacheKeys.NOTIFICATION,
              ttl: 7 * 24 * 60 * 60, // 7 days
            }
          );
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Failed to check notification deduplication:', error);
      // Fail safe: assume notification was sent to prevent spam
      return true;
    }
  }

  /**
   * Atomically mark notification as sent to prevent race conditions
   * Requirement 4.5: Prevent duplicate notification sending
   */
  async markNotificationAsSent(aliasId: string, type: string, metadata: any): Promise<boolean> {
    try {
      const notificationKey = `${aliasId}:${type}`;

      // Use Redis SET with NX (only set if not exists) for atomic operation
      const cacheKey = `${CacheKeys.NOTIFICATION}:${notificationKey}`;
      const notificationData = {
        sentAt: new Date().toISOString(),
        type,
        metadata,
        source: 'service',
      };

      // Atomic cache operation - only succeeds if key doesn't exist
      const wasSet = await cacheService.setIfNotExists(notificationKey, notificationData, {
        prefix: CacheKeys.NOTIFICATION,
        ttl: 7 * 24 * 60 * 60, // 7 days
      });

      if (!wasSet) {
        // Another process already marked this notification as sent
        return false;
      }

      // Update database flag for expiry warnings
      if (type === 'expiry_warning') {
        await Alias.findByIdAndUpdate(
          aliasId,
          {
            notificationSent: true,
            updatedAt: new Date(),
          },
          { new: true }
        );
      }

      return true;
    } catch (error) {
      logger.error('Failed to mark notification as sent:', error);
      return false;
    }
  }

  /**
   * Clear notification sent flag (for testing or manual reset)
   * Requirement 4.5: Allow manual reset of notification flags
   */
  async clearNotificationFlag(aliasId: string, type: string): Promise<boolean> {
    try {
      const notificationKey = `${aliasId}:${type}`;

      // Clear cache
      await cacheService.delete(notificationKey, {
        prefix: CacheKeys.NOTIFICATION,
      });

      // Clear database flag for expiry warnings
      if (type === 'expiry_warning') {
        await Alias.findByIdAndUpdate(
          aliasId,
          {
            notificationSent: false,
            updatedAt: new Date(),
          },
          { new: true }
        );
      }

      logger.info(`Cleared notification flag for alias ${aliasId}, type: ${type}`);
      return true;
    } catch (error) {
      logger.error('Failed to clear notification flag:', error);
      return false;
    }
  }

  /**
   * Get notification history for an alias
   */
  async getNotificationHistory(aliasId: string): Promise<any[]> {
    try {
      const types = ['expiry_warning', 'feature_update', 'ecosystem_news'];
      const history = [];

      for (const type of types) {
        const notificationKey = `${aliasId}:${type}`;
        const data = await cacheService.get(notificationKey, {
          prefix: CacheKeys.NOTIFICATION,
        });

        if (data) {
          history.push({
            type,
            ...data,
          });
        }
      }

      return history.sort(
        (a, b) => new Date((b as any).sentAt).getTime() - new Date((a as any).sentAt).getTime()
      );
    } catch (error) {
      logger.error('Failed to get notification history:', error);
      return [];
    }
  }

  /**
   * Get notification statistics
   */
  async getNotificationStats(): Promise<{
    totalSubscribers: number;
    aliasExpiryEnabled: number;
    featureUpdatesEnabled: number;
    ecosystemNewsEnabled: number;
  }> {
    try {
      const stats = await User.aggregate([
        {
          $match: {
            notificationPreferences: { $exists: true },
          },
        },
        {
          $group: {
            _id: null,
            totalSubscribers: { $sum: 1 },
            aliasExpiryEnabled: {
              $sum: {
                $cond: ['$notificationPreferences.aliasExpiry', 1, 0],
              },
            },
            ecosystemNewsEnabled: {
              $sum: {
                $cond: ['$notificationPreferences.ecosystemNews', 1, 0],
              },
            },
            featureUpdatesEnabled: {
              $sum: {
                $cond: ['$notificationPreferences.featureUpdates', 1, 0],
              },
            },
          },
        },
      ]);

      return (
        stats[0] || {
          totalSubscribers: 0,
          aliasExpiryEnabled: 0,
          featureUpdatesEnabled: 0,
          ecosystemNewsEnabled: 0,
        }
      );
    } catch (error) {
      logger.error('Failed to get notification statistics:', error);
      return {
        totalSubscribers: 0,
        aliasExpiryEnabled: 0,
        featureUpdatesEnabled: 0,
        ecosystemNewsEnabled: 0,
      };
    }
  }
}

export const notificationService = new NotificationService();
