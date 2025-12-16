import { EmailVerification } from '@/models/EmailVerification';
import { NewsletterSubscription } from '@/models/NewsletterSubscription';
import { FeatureSubscription } from '@/models/FeatureSubscription';
import { emailService } from '@/services/emailService';
import { logger } from '@/utils/logger';
import { isValidEmail } from '@/utils/validation';
import { config } from '@/config/environment';

export interface NewsletterSubscriptionData {
  email: string;
  featureUpdates: boolean;
  generalNews: boolean;
}

export interface FeatureNotificationData {
  email: string;
  featureId: string;
  featureName: string;
}

export interface SubscriptionResult {
  success: boolean;
  message: string;
  verificationId?: string;
  subscriptionType?: string;
  verifiedAt?: string;
}

class SubscriptionService {
  private isDatabaseAvailable(): boolean {
    // Check if we're in mock mode (database not available)
    return process.env.NODE_ENV !== 'development' || process.env.MONGODB_AVAILABLE === 'true';
  }

  /**
   * Initiate newsletter subscription with email verification
   */
  async initiateNewsletterSubscription(
    data: NewsletterSubscriptionData
  ): Promise<SubscriptionResult> {
    try {
      const { email, featureUpdates, generalNews } = data;

      // Validate email format
      if (!isValidEmail(email)) {
        return {
          success: false,
          message: 'Invalid email format provided',
        };
      }

      // If database is not available, return mock success
      if (!this.isDatabaseAvailable()) {
        logger.info('Mock newsletter subscription (database unavailable)', {
          email: email.substring(0, 5) + '***',
          featureUpdates,
          generalNews,
        });

        return {
          success: true,
          message: 'Verification email sent. Please check your inbox.',
          verificationId: 'mock_verification_' + Date.now(),
        };
      }

      // Check if user is already subscribed
      const existingSubscription = await NewsletterSubscription.findOne({ email });
      if (existingSubscription && existingSubscription.isActive) {
        return {
          success: false,
          message: 'You are already subscribed to our newsletter. Thank you for your interest!',
        };
      }

      // Check for existing pending verification (within last 5 minutes to prevent spam)
      const recentVerification = await EmailVerification.findOne({
        email,
        subscriptionType: 'newsletter',
        isVerified: false,
        createdAt: { $gt: new Date(Date.now() - 5 * 60 * 1000) }, // 5 minutes ago
        expiresAt: { $gt: new Date() },
      });

      if (recentVerification) {
        return {
          success: false,
          message:
            'A verification email was recently sent. Please check your inbox or wait a few minutes before trying again.',
        };
      }

      // Check for existing pending verification (older than 5 minutes)
      const existingVerification = await EmailVerification.findOne({
        email,
        subscriptionType: 'newsletter',
        isVerified: false,
        expiresAt: { $gt: new Date() },
      });

      if (existingVerification) {
        // Update the existing verification with new preferences and resend
        existingVerification.subscriptionData = {
          featureUpdates,
          generalNews,
        };
        await existingVerification.save();

        // Resend verification email
        await this.sendVerificationEmail(existingVerification);
        return {
          success: true,
          message:
            'Verification email resent. Please check your inbox and click the verification link.',
          verificationId: existingVerification._id.toString(),
        };
      }

      // Generate verification token and expiry
      const crypto = require('crypto');
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

      // Create new verification record
      const verification = new EmailVerification({
        email,
        subscriptionType: 'newsletter',
        subscriptionData: {
          featureUpdates,
          generalNews,
        },
        verificationToken,
        expiresAt,
      });

      await verification.save();

      // Send verification email
      await this.sendVerificationEmail(verification);

      logger.info('Newsletter subscription verification initiated', {
        email: email.substring(0, 5) + '***',
        verificationId: verification._id,
      });

      return {
        success: true,
        message:
          'Verification email sent! Please check your inbox and click the verification link to complete your subscription.',
        verificationId: verification._id.toString(),
      };
    } catch (error) {
      logger.error('Failed to initiate newsletter subscription:', error);
      return {
        success: false,
        message: 'Failed to process subscription request',
      };
    }
  }

  /**
   * Initiate feature notification subscription with email verification
   */
  async initiateFeatureNotificationSubscription(
    data: FeatureNotificationData
  ): Promise<SubscriptionResult> {
    try {
      const { email, featureId, featureName } = data;

      // Validate email format
      if (!isValidEmail(email)) {
        return {
          success: false,
          message: 'Invalid email format provided',
        };
      }

      // If database is not available, return mock success
      if (!this.isDatabaseAvailable()) {
        logger.info('Mock feature notification subscription (database unavailable)', {
          email: email.substring(0, 5) + '***',
          featureId,
          featureName,
        });

        return {
          success: true,
          message: 'Verification email sent. Please check your inbox.',
          verificationId: 'mock_verification_' + Date.now(),
        };
      }

      // Check if user is already subscribed to this feature
      const existingSubscription = await FeatureSubscription.findOne({ email });
      if (existingSubscription && existingSubscription.features.includes(featureId)) {
        return {
          success: false,
          message: `You are already subscribed to notifications for "${featureName}". We'll notify you when it's available!`,
        };
      }

      // Check for existing pending verification for this specific feature (within last 5 minutes to prevent spam)
      const recentVerification = await EmailVerification.findOne({
        email,
        subscriptionType: 'feature_notification',
        'subscriptionData.featureId': featureId,
        isVerified: false,
        createdAt: { $gt: new Date(Date.now() - 5 * 60 * 1000) }, // 5 minutes ago
        expiresAt: { $gt: new Date() },
      });

      if (recentVerification) {
        return {
          success: false,
          message: `A verification email for "${featureName}" was recently sent. Please check your inbox or wait a few minutes before trying again.`,
        };
      }

      // Check for existing pending verification for this feature (older than 5 minutes)
      const existingVerification = await EmailVerification.findOne({
        email,
        subscriptionType: 'feature_notification',
        'subscriptionData.featureId': featureId,
        isVerified: false,
        expiresAt: { $gt: new Date() },
      });

      if (existingVerification) {
        // Resend verification email
        await this.sendVerificationEmail(existingVerification);
        return {
          success: true,
          message: `Verification email resent for "${featureName}". Please check your inbox and click the verification link.`,
          verificationId: existingVerification._id.toString(),
        };
      }

      // Generate verification token and expiry
      const crypto = require('crypto');
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

      // Create new verification record
      const verification = new EmailVerification({
        email,
        subscriptionType: 'feature_notification',
        subscriptionData: {
          featureId,
          featureName,
        },
        verificationToken,
        expiresAt,
      });

      await verification.save();

      // Send verification email
      await this.sendVerificationEmail(verification);

      logger.info('Feature notification subscription verification initiated', {
        email: email.substring(0, 5) + '***',
        featureId,
        verificationId: verification._id,
      });

      return {
        success: true,
        message: `Verification email sent for "${featureName}"! Please check your inbox and click the verification link to complete your subscription.`,
        verificationId: verification._id.toString(),
      };
    } catch (error) {
      logger.error('Failed to initiate feature notification subscription:', error);
      return {
        success: false,
        message: 'Failed to process subscription request',
      };
    }
  }

  /**
   * Verify email subscription using verification token
   */
  async verifyEmailSubscription(token: string): Promise<SubscriptionResult> {
    try {
      // If database is not available, return mock success for mock tokens
      if (!this.isDatabaseAvailable()) {
        if (token.startsWith('mock_verification_')) {
          logger.info('Mock email verification (database unavailable)', {
            token: token.substring(0, 20) + '***',
          });

          return {
            success: true,
            message: 'Email verified successfully! You are now subscribed.',
            subscriptionType: 'newsletter',
            verifiedAt: new Date().toISOString(),
          };
        } else {
          return {
            success: false,
            message: 'Invalid or expired verification token',
          };
        }
      }

      // Find verification record
      const verification = await EmailVerification.findByToken(token);
      if (!verification) {
        return {
          success: false,
          message: 'Invalid or expired verification token',
        };
      }

      // Mark as verified
      verification.isVerified = true;
      verification.verifiedAt = new Date();
      await verification.save();

      // Process the subscription based on type
      let confirmationMessage = '';
      if (verification.subscriptionType === 'newsletter') {
        await this.processNewsletterSubscription(verification);
        confirmationMessage =
          'You are now subscribed to our newsletter! You will receive updates about new features and ecosystem news.';

        // Send confirmation email
        await this.sendConfirmationEmail(verification);
      } else if (verification.subscriptionType === 'feature_notification') {
        await this.processFeatureNotificationSubscription(verification);
        const featureName = verification.subscriptionData.featureName || 'this feature';
        confirmationMessage = `You are now subscribed to notifications for "${featureName}"! We'll email you as soon as it's available.`;

        // Send confirmation email
        await this.sendConfirmationEmail(verification);
      }

      logger.info('Email subscription verified successfully', {
        email: verification.email.substring(0, 5) + '***',
        subscriptionType: verification.subscriptionType,
        verificationId: verification._id,
      });

      return {
        success: true,
        message: confirmationMessage,
        subscriptionType: verification.subscriptionType,
        verifiedAt: verification.verifiedAt!.toISOString(),
      };
    } catch (error) {
      logger.error('Failed to verify email subscription:', error);
      return {
        success: false,
        message: 'Failed to verify subscription',
      };
    }
  }

  /**
   * Unsubscribe from newsletter
   */
  async unsubscribeNewsletter(token: string): Promise<SubscriptionResult> {
    try {
      const subscription = await NewsletterSubscription.findByUnsubscribeToken(token);
      if (!subscription) {
        return {
          success: false,
          message: 'Invalid unsubscribe token',
        };
      }

      subscription.isActive = false;
      await subscription.save();

      logger.info('Newsletter unsubscribe successful', {
        email: subscription.email.substring(0, 5) + '***',
        subscriptionId: subscription._id,
      });

      return {
        success: true,
        message: 'Successfully unsubscribed from newsletter',
      };
    } catch (error) {
      logger.error('Failed to unsubscribe from newsletter:', error);
      return {
        success: false,
        message: 'Failed to unsubscribe',
      };
    }
  }

  /**
   * Send confirmation email after successful verification
   */
  private async sendConfirmationEmail(verification: any): Promise<void> {
    let subject: string;
    let html: string;
    let text: string;

    if (verification.subscriptionType === 'newsletter') {
      const { featureUpdates, generalNews } = verification.subscriptionData;

      subject = 'Welcome to CardanoResolve Newsletter!';

      const subscriptionTypes = [];
      if (featureUpdates) subscriptionTypes.push('Feature updates and releases');
      if (generalNews) subscriptionTypes.push('General ecosystem news');

      text = `Welcome to CardanoResolve Newsletter!

Thank you for subscribing! Your email has been successfully verified.

You will receive:
${subscriptionTypes.map(type => `• ${type}`).join('\n')}

We're excited to keep you updated with the latest developments in the Cardano ecosystem.

Best regards,
The CardanoResolve Team`;

      html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2563eb; margin-bottom: 10px;">CardanoResolve</h1>
          <h2 style="color: #1f2937; margin-top: 0;">Welcome to Our Newsletter!</h2>
        </div>
        
        <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #2563eb;">
          <p style="margin: 0 0 15px 0; font-size: 16px;"><strong>🎉 Subscription Confirmed!</strong></p>
          <p style="margin: 0 0 15px 0;">Thank you for subscribing to our newsletter! Your email has been successfully verified.</p>
          <p style="margin: 0 0 15px 0;">You will receive:</p>
          <ul style="margin: 0; padding-left: 20px;">
            ${subscriptionTypes.map(type => `<li>${type}</li>`).join('')}
          </ul>
        </div>
        
        <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <p style="margin: 0 0 15px 0;">We're excited to keep you updated with the latest developments in the Cardano ecosystem and CardanoResolve platform improvements.</p>
          <p style="margin: 0;">Stay tuned for exciting updates!</p>
        </div>
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
        
        <p style="color: #6b7280; font-size: 12px; text-align: center;">
          You can unsubscribe at any time by clicking the unsubscribe link in our emails.<br>
          Thank you for being part of the CardanoResolve community!
        </p>
      </div>
      `;
    } else if (verification.subscriptionType === 'feature_notification') {
      const { featureName } = verification.subscriptionData;

      subject = `Notification confirmed for ${featureName}`;

      text = `Notification Confirmed!

Thank you for subscribing to notifications for "${featureName}".

We'll send you an email as soon as this feature becomes available. You'll be among the first to know!

Best regards,
The CardanoResolve Team`;

      html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2563eb; margin-bottom: 10px;">CardanoResolve</h1>
          <h2 style="color: #1f2937; margin-top: 0;">Notification Confirmed!</h2>
        </div>
        
        <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #2563eb;">
          <p style="margin: 0 0 15px 0; font-size: 16px;"><strong>🔔 You're all set!</strong></p>
          <p style="margin: 0 0 15px 0;">Thank you for subscribing to notifications for:</p>
          <p style="margin: 0; font-weight: bold; color: #2563eb; font-size: 18px;">"${featureName}"</p>
        </div>
        
        <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <p style="margin: 0 0 15px 0;">We'll send you an email as soon as this feature becomes available. You'll be among the first to know!</p>
          <p style="margin: 0;">Keep an eye on your inbox for updates.</p>
        </div>
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
        
        <p style="color: #6b7280; font-size: 12px; text-align: center;">
          Thank you for your interest in CardanoResolve!<br>
          We're working hard to bring you the best features.
        </p>
      </div>
      `;
    } else {
      return; // Unknown subscription type
    }

    await emailService.sendEmail({
      to: verification.email,
      subject,
      html,
      text,
    });

    logger.info('Confirmation email sent', {
      email: verification.email.substring(0, 5) + '***',
      subscriptionType: verification.subscriptionType,
    });
  }

  /**
   * Send verification email
   */
  private async sendVerificationEmail(verification: any): Promise<void> {
    const verificationUrl = `http://localhost:5174/verify-subscription/${verification.verificationToken}`;

    let subject: string;
    let html: string;
    let text: string;

    if (verification.subscriptionType === 'newsletter') {
      subject = 'Verify your newsletter subscription - CardanoResolve';
      html = this.generateNewsletterVerificationEmail(
        verificationUrl,
        verification.subscriptionData
      );
      text = `Please verify your newsletter subscription by clicking this link: ${verificationUrl}`;
    } else {
      subject = `Verify your notification subscription for ${verification.subscriptionData.featureName}`;
      html = this.generateFeatureNotificationVerificationEmail(
        verificationUrl,
        verification.subscriptionData.featureName
      );
      text = `Please verify your feature notification subscription by clicking this link: ${verificationUrl}`;
    }

    await emailService.sendEmail({
      to: verification.email,
      subject,
      html,
      text,
    });
  }

  /**
   * Process newsletter subscription after verification
   */
  private async processNewsletterSubscription(verification: any): Promise<void> {
    const { email, subscriptionData } = verification;

    // Create or update newsletter subscription
    let subscription = await NewsletterSubscription.findOne({ email });
    if (subscription) {
      subscription.subscriptionTypes = {
        featureUpdates: subscriptionData.featureUpdates,
        generalNews: subscriptionData.generalNews,
      };
      subscription.isActive = true;
      subscription.subscribedAt = new Date();
    } else {
      const crypto = require('crypto');
      subscription = new NewsletterSubscription({
        email,
        subscriptionTypes: {
          featureUpdates: subscriptionData.featureUpdates,
          generalNews: subscriptionData.generalNews,
        },
        unsubscribeToken: crypto.randomBytes(32).toString('hex'),
      });
    }

    await subscription.save();
  }

  /**
   * Process feature notification subscription after verification
   */
  private async processFeatureNotificationSubscription(verification: any): Promise<void> {
    const { email, subscriptionData } = verification;

    // Create or update feature subscription
    let subscription = await FeatureSubscription.findOne({ email });
    if (subscription) {
      subscription.addFeature(subscriptionData.featureId);
    } else {
      const crypto = require('crypto');
      subscription = new FeatureSubscription({
        email,
        features: [subscriptionData.featureId],
        unsubscribeToken: crypto.randomBytes(32).toString('hex'),
      });
    }

    await subscription.save();
  }

  /**
   * Generate newsletter verification email HTML
   */
  private generateNewsletterVerificationEmail(
    verificationUrl: string,
    subscriptionData: any
  ): string {
    const subscriptionTypes = [];
    if (subscriptionData.featureUpdates) subscriptionTypes.push('Feature updates and releases');
    if (subscriptionData.generalNews) subscriptionTypes.push('General ecosystem news');

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2563eb; margin-bottom: 10px;">CardanoResolve</h1>
          <h2 style="color: #1f2937; margin-top: 0;">Verify Your Newsletter Subscription</h2>
        </div>
        
        <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <p style="margin: 0 0 15px 0;">Thank you for subscribing to our newsletter!</p>
          <p style="margin: 0 0 15px 0;">You've requested to receive:</p>
          <ul style="margin: 0; padding-left: 20px;">
            ${subscriptionTypes.map(type => `<li>${type}</li>`).join('')}
          </ul>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" 
             style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Verify Subscription
          </a>
        </div>
        
        <div style="background-color: #fef3c7; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; color: #92400e;">
            <strong>Important:</strong> This verification link will expire in 24 hours.
          </p>
        </div>
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
        
        <p style="color: #6b7280; font-size: 12px; text-align: center;">
          If you didn't request this subscription, you can safely ignore this email.<br>
          This verification link will expire automatically.
        </p>
      </div>
    `;
  }

  /**
   * Generate feature notification verification email HTML
   */
  private generateFeatureNotificationVerificationEmail(
    verificationUrl: string,
    featureName: string
  ): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2563eb; margin-bottom: 10px;">CardanoResolve</h1>
          <h2 style="color: #1f2937; margin-top: 0;">Verify Your Feature Notification</h2>
        </div>
        
        <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <p style="margin: 0 0 15px 0;">You've requested to be notified when this feature becomes available:</p>
          <div style="background-color: #e0f2fe; padding: 15px; border-radius: 6px; border-left: 4px solid #0284c7;">
            <h3 style="margin: 0; color: #0c4a6e;">${featureName}</h3>
          </div>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" 
             style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Verify Notification Request
          </a>
        </div>
        
        <div style="background-color: #fef3c7; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; color: #92400e;">
            <strong>Important:</strong> This verification link will expire in 24 hours.
          </p>
        </div>
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
        
        <p style="color: #6b7280; font-size: 12px; text-align: center;">
          If you didn't request this notification, you can safely ignore this email.<br>
          This verification link will expire automatically.
        </p>
      </div>
    `;
  }

  /**
   * Cleanup expired verification tokens (should be run periodically)
   */
  async cleanupExpiredVerifications(): Promise<void> {
    try {
      const result = await EmailVerification.cleanupExpired();
      logger.info(`Cleaned up ${result.deletedCount} expired verification tokens`);
    } catch (error) {
      logger.error('Failed to cleanup expired verifications:', error);
    }
  }
}

export const subscriptionService = new SubscriptionService();
