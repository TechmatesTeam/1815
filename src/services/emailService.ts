import nodemailer from 'nodemailer';
import sgMail from '@sendgrid/mail';
import { config } from '@/config/environment';
import { logger } from '@/utils/logger';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    this.initializeEmailService();
  }

  private initializeEmailService(): void {
    if (config.email.useMailhog) {
      // Configure nodemailer for MailHog
      this.transporter = nodemailer.createTransport({
        host: config.email.mailhog.host,
        port: config.email.mailhog.port,
        secure: false, // MailHog doesn't use SSL
        auth: undefined, // MailHog doesn't require authentication
      });
      logger.info('Email service initialized with MailHog for development');
    } else {
      // Configure SendGrid for production
      sgMail.setApiKey(config.email.sendgrid.apiKey);
      logger.info('Email service initialized with SendGrid for production');
    }
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      if (config.email.useMailhog && this.transporter) {
        // Send via MailHog using nodemailer
        await this.transporter.sendMail({
          from: `${config.email.sendgrid.fromName} <${config.email.sendgrid.fromEmail}>`,
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text,
        });
        logger.info(`Email sent via MailHog to: ${options.to}`);
      } else {
        // Send via SendGrid
        const msg = {
          to: options.to,
          from: {
            email: config.email.sendgrid.fromEmail,
            name: config.email.sendgrid.fromName,
          },
          subject: options.subject,
          html: options.html,
          text: options.text,
        };
        await sgMail.send(msg);
        logger.info(`Email sent via SendGrid to: ${options.to}`);
      }
    } catch (error) {
      logger.error('Failed to send email:', error);
      throw new Error(`Email delivery failed: ${error}`);
    }
  }

  async sendAliasExpiryNotification(
    email: string,
    shortCode: string,
    cardanoAddress: string,
    expiresAt: Date
  ): Promise<void> {
    const subject = `Your Cardash.io alias ${shortCode} expires soon`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Alias Expiry Notification</h2>
        <p>Hello,</p>
        <p>Your Cardano address alias is expiring soon:</p>
        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Short Code:</strong> ${shortCode}</p>
          <p><strong>Cardano Address:</strong> ${cardanoAddress}</p>
          <p><strong>Expires At:</strong> ${expiresAt.toLocaleDateString()}</p>
        </div>
        <p>To continue using this alias, please create a new one before the expiry date.</p>
        <p>Visit <a href="https://1815.dev" style="color: #2563eb;">1815</a> to manage your aliases.</p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 14px;">
          This is an automated notification from 1815. 
          If you no longer wish to receive these notifications, you can unsubscribe in your account settings.
        </p>
      </div>
    `;
    const text = `
      Alias Expiry Notification
      
      Your Cardano address alias is expiring soon:
      Short Code: ${shortCode}
      Cardano Address: ${cardanoAddress}
      Expires At: ${expiresAt.toLocaleDateString()}
      
      To continue using this alias, please create a new one before the expiry date.
      Visit https://1815.dev to manage your aliases.
    `;

    await this.sendEmail({
      to: email,
      subject,
      html,
      text,
    });
  }

  async sendFeatureUpdateNotification(
    email: string,
    featureName: string,
    description: string
  ): Promise<void> {
    const subject = `New Feature Available: ${featureName}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">New Feature Available</h2>
        <p>Hello,</p>
        <p>We're excited to announce a new feature on 1815:</p>
        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #1f2937; margin-top: 0;">${featureName}</h3>
          <p>${description}</p>
        </div>
        <p>Visit <a href="https://1815.dev" style="color: #2563eb;">1815</a> to try out the new feature.</p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 14px;">
          This is a feature update notification from 1815. 
          You can manage your notification preferences in your account settings.
        </p>
      </div>
    `;
    const text = `
      New Feature Available: ${featureName}
      
      ${description}
      
      Visit https://1815.dev to try out the new feature.
    `;

    await this.sendEmail({
      to: email,
      subject,
      html,
      text,
    });
  }
}

export const emailService = new EmailService();
