import { Request, Response, NextFunction } from 'express';
import { featuresService } from '@/services/featuresService';
import { subscriptionService } from '@/services/subscriptionService';
import { createError } from '@/middlewares/errorHandler';
import { logger } from '@/utils/logger';

export class FeaturesController {
  /**
   * Get all features and roadmap data
   * GET /api/v1/features
   */
  static async getFeatures(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      logger.info('Fetching features data', {
        requestId: res.locals.requestId,
      });

      const featuresData = await featuresService.getFeatures();

      logger.info('Features data retrieved successfully', {
        featureCount: featuresData.features.length,
        currentVersion: featuresData.currentVersion,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: featuresData,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to fetch features data', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      next(createError('Failed to fetch features data', 500, 'FEATURES_FETCH_ERROR'));
    }
  }

  /**
   * Subscribe to newsletter
   * POST /api/v1/features/newsletter/subscribe
   */
  static async subscribeNewsletter(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, featureUpdates, generalNews } = req.body;

      if (!email) {
        next(createError('Email address is required', 400, 'MISSING_EMAIL'));
        return;
      }

      logger.info('Processing newsletter subscription', {
        email: email.substring(0, 5) + '***',
        featureUpdates: !!featureUpdates,
        generalNews: !!generalNews,
        requestId: res.locals.requestId,
      });

      const result = await subscriptionService.initiateNewsletterSubscription({
        email,
        featureUpdates: featureUpdates || false,
        generalNews: generalNews || false,
      });

      if (!result.success) {
        logger.warn('Newsletter subscription failed', {
          email: email.substring(0, 5) + '***',
          message: result.message,
          requestId: res.locals.requestId,
        });

        if (result.message.includes('Invalid email')) {
          next(createError('Invalid email format provided', 400, 'INVALID_EMAIL'));
        } else if (
          result.message.includes('already subscribed') ||
          result.message.includes('recently sent')
        ) {
          // Return a 400 with the specific message for user-friendly errors
          res.status(400).json({
            success: false,
            error: {
              code: 'ALREADY_SUBSCRIBED',
              message: result.message,
            },
            metadata: {
              timestamp: new Date().toISOString(),
              requestId: res.locals.requestId,
              version: process.env.npm_package_version || '1.0.0',
            },
          });
        } else {
          next(createError('Failed to process subscription', 500, 'SUBSCRIPTION_FAILED'));
        }
        return;
      }

      logger.info('Newsletter subscription initiated', {
        email: email.substring(0, 5) + '***',
        verificationId: result.verificationId,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          message: result.message,
          verificationRequired: true,
          verificationId: result.verificationId,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to process newsletter subscription', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      next(createError('Failed to process subscription request', 500, 'SUBSCRIPTION_ERROR'));
    }
  }

  /**
   * Subscribe to feature notifications
   * POST /api/v1/features/notify
   */
  static async subscribeFeatureNotification(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { email, featureId, featureName } = req.body;

      if (!email || !featureId) {
        next(createError('Email and feature ID are required', 400, 'MISSING_REQUIRED_FIELDS'));
        return;
      }

      logger.info('Processing feature notification subscription', {
        email: email.substring(0, 5) + '***',
        featureId,
        featureName,
        requestId: res.locals.requestId,
      });

      const result = await subscriptionService.initiateFeatureNotificationSubscription({
        email,
        featureId,
        featureName,
      });

      if (!result.success) {
        logger.warn('Feature notification subscription failed', {
          email: email.substring(0, 5) + '***',
          featureId,
          message: result.message,
          requestId: res.locals.requestId,
        });

        if (result.message.includes('Invalid email')) {
          next(createError('Invalid email format provided', 400, 'INVALID_EMAIL'));
        } else if (
          result.message.includes('already subscribed') ||
          result.message.includes('recently sent')
        ) {
          // Return a 400 with the specific message for user-friendly errors
          res.status(400).json({
            success: false,
            error: {
              code: 'ALREADY_SUBSCRIBED',
              message: result.message,
            },
            metadata: {
              timestamp: new Date().toISOString(),
              requestId: res.locals.requestId,
              version: process.env.npm_package_version || '1.0.0',
            },
          });
        } else {
          next(createError('Failed to process subscription', 500, 'SUBSCRIPTION_FAILED'));
        }
        return;
      }

      logger.info('Feature notification subscription initiated', {
        email: email.substring(0, 5) + '***',
        featureId,
        verificationId: result.verificationId,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          message: result.message,
          verificationRequired: true,
          verificationId: result.verificationId,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to process feature notification subscription', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      next(createError('Failed to process subscription request', 500, 'SUBSCRIPTION_ERROR'));
    }
  }

  /**
   * Verify email subscription
   * GET /api/v1/features/verify/:token
   */
  static async verifySubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = req.params;

      if (!token) {
        next(createError('Verification token is required', 400, 'MISSING_TOKEN'));
        return;
      }

      logger.info('Processing email verification', {
        token: token.substring(0, 8) + '***',
        requestId: res.locals.requestId,
      });

      const result = await subscriptionService.verifyEmailSubscription(token);

      if (!result.success) {
        logger.warn('Email verification failed', {
          token: token.substring(0, 8) + '***',
          message: result.message,
          requestId: res.locals.requestId,
        });

        if (result.message.includes('Invalid') || result.message.includes('expired')) {
          next(createError('Invalid or expired verification token', 400, 'INVALID_TOKEN'));
        } else {
          next(createError('Failed to verify subscription', 500, 'VERIFICATION_FAILED'));
        }
        return;
      }

      logger.info('Email verification successful', {
        token: token.substring(0, 8) + '***',
        subscriptionType: result.subscriptionType,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          message: result.message,
          subscriptionType: result.subscriptionType,
          verifiedAt: result.verifiedAt,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to verify subscription', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      next(createError('Failed to verify subscription', 500, 'VERIFICATION_ERROR'));
    }
  }

  /**
   * Unsubscribe from newsletter
   * POST /api/v1/features/newsletter/unsubscribe/:token
   */
  static async unsubscribeNewsletter(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { token } = req.params;

      if (!token) {
        next(createError('Unsubscribe token is required', 400, 'MISSING_TOKEN'));
        return;
      }

      logger.info('Processing newsletter unsubscribe', {
        token: token.substring(0, 8) + '***',
        requestId: res.locals.requestId,
      });

      const result = await subscriptionService.unsubscribeNewsletter(token);

      if (!result.success) {
        logger.warn('Newsletter unsubscribe failed', {
          token: token.substring(0, 8) + '***',
          message: result.message,
          requestId: res.locals.requestId,
        });

        if (result.message.includes('Invalid')) {
          next(createError('Invalid unsubscribe token', 400, 'INVALID_TOKEN'));
        } else {
          next(createError('Failed to unsubscribe', 500, 'UNSUBSCRIBE_FAILED'));
        }
        return;
      }

      logger.info('Newsletter unsubscribe successful', {
        token: token.substring(0, 8) + '***',
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
      logger.error('Failed to unsubscribe from newsletter', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      next(createError('Failed to unsubscribe', 500, 'UNSUBSCRIBE_ERROR'));
    }
  }
}
