import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { PaymentRequest, IPaymentRequestDocument } from '@/models/PaymentRequest';
import { config } from '@/config/environment';
import { ratesService } from './ratesService';
import { sendPaymentHonored, sendPaymentRejected } from './emailService';
import { addEmailJob } from './emailQueue';
import { PaymentAudit } from '@/models/PaymentAudit';
import { aliasService } from './aliasService';
import { logger } from '@/utils/logger';

const LOVELACE_PER_ADA = 1_000_000;

export interface CreatePaymentRequestInput {
  cardanoAddress: string;
  amountAda: number; // amount in ADA from receiver
  fiatCurrency?: string; // default USD
  metadata?: Record<string, any>;
  expiryHours?: number; // default 48
}

export class PaymentService {
  async createPaymentRequest(input: CreatePaymentRequestInput) {
    const currency = (input.fiatCurrency || 'USD').toUpperCase();

    // Validate amount
    if (!input.amountAda || typeof input.amountAda !== 'number' || input.amountAda <= 0) {
      throw new Error('Invalid amount');
    }

    // Convert ADA to lovelaces
    const amountLovelace = Math.round(input.amountAda * LOVELACE_PER_ADA);

    // Ensure alias exists (create short-lived alias if needed)
    let shortCode: string | undefined;
    try {
      const aliases = await aliasService.getAliasesByAddress(input.cardanoAddress);
      if (aliases && aliases.length > 0) {
        shortCode = aliases[0].shortCode;
      } else {
        // Create alias with short expiry of 2 days
        const alias = await aliasService.createAlias({
          cardanoAddress: input.cardanoAddress,
          expiryDays: 2,
        });
        shortCode = alias.shortCode;
      }
    } catch (error) {
      logger.warn('Alias creation/lookup failed during payment request creation', error);
    }

    const jti = uuidv4();
    const expiryHours = input.expiryHours || 48;
    const expiresAt = new Date(Date.now() + expiryHours * 3600 * 1000);

    // Fetch fiat amount at current rate
    const prices = await ratesService.getPrices([currency]);
    const adaPrice = prices[currency] || 0;
    const fiatAmount = parseFloat((input.amountAda * adaPrice).toFixed(2));

    // If metadata contains an owner email, generate a 4-digit passcode and store a hash
    let ownerEmail: string | undefined;
    let ownerPasscodeHash: string | undefined;
    let isPublic = false;
    if (input.metadata && (input.metadata as any).email) {
      ownerEmail = (input.metadata as any).email;
      // Generate 4-digit numeric passcode
      const passcode = Math.floor(1000 + Math.random() * 9000).toString();
      ownerPasscodeHash = crypto.createHash('sha256').update(passcode).digest('hex');
      // expose passcode to caller via result
      (input as any)._generatedPasscode = passcode;
      isPublic = !!(input.metadata && (input.metadata as any).isPublic);
    }

    // Store payment request record
    const payment = new PaymentRequest({
      jti,
      shortCode,
      cardanoAddress: input.cardanoAddress,
      amountLovelace,
      fiatCurrency: currency,
      fiatAmount,
      metadata: input.metadata || {},
      ownerEmail,
      ownerPasscodeHash,
      isPublic,
      expiresAt,
      status: 'pending',
    });

    await payment.save();

    // Create JWT token with payload (do NOT include human-readable amounts in URL)
    const tokenPayload = {
      jti,
    };

    const token = jwt.sign(tokenPayload, config.jwt.secret, { expiresIn: `${expiryHours}h` });

    const link = `${config.app.frontendUrl}/pay/${encodeURIComponent(token)}`;

    const result: any = { payment, token, link };
    if ((input as any)._generatedPasscode) result.passcode = (input as any)._generatedPasscode;

    // audit created
    try {
      await PaymentAudit.create({
        paymentId: payment._id,
        action: 'created',
        actorEmail: ownerEmail || null,
        reason: null,
      });
    } catch (err) {
      logger.warn('Failed to write creation audit', err);
    }

    return result;
  }

  async decodeToken(token: string): Promise<{ payment: IPaymentRequestDocument; payload: any }> {
    try {
      const payload = jwt.verify(token, config.jwt.secret) as any;

      if (!payload || !payload.jti) throw new Error('Invalid token');

      const payment = await PaymentRequest.findOne({ jti: payload.jti });

      if (!payment) throw new Error('Payment request not found');

      // Check expiry
      if (payment.expiresAt <= new Date()) {
        throw new Error('Payment request expired');
      }

      return { payment, payload };
    } catch (error) {
      logger.warn('Token decode failed', error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /**
   * Create a MoonPay widget URL (signed) for the payment. This is a simplified implementation
   * - In production, use MoonPay's server API, signed sessions and redirect flows
   */
  createMoonpayUrl(payment: IPaymentRequestDocument) {
    const base = config.moonpay.widgetUrl || 'https://buy.moonpay.com';

    // Convert lovelace to ADA
    const adaAmount = payment.amountLovelace / LOVELACE_PER_ADA;

    const params: Record<string, string> = {
      apiKey: config.moonpay.apiKey || '',
      currencyCode: 'ADA',
      baseCurrencyCode: payment.fiatCurrency || 'USD',
      baseCurrencyAmount: (payment.fiatAmount || 0).toString(),
      walletAddress: payment.cardanoAddress,
      reference: payment.jti,
    };

    const qs = Object.keys(params)
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join('&');

    // Sign query with HMAC-SHA256 using secretKey if present
    let signature = '';
    if (config.moonpay.secretKey) {
      signature = crypto.createHmac('sha256', config.moonpay.secretKey).update(qs).digest('hex');
    }

    const url = `${base}?${qs}${signature ? `&signature=${signature}` : ''}`;
    return url;
  }

  async handleMoonpayWebhook(body: any, signatureHeader?: string) {
    // Basic validation using webhook secret
    if (config.moonpay.webhookSecret && signatureHeader) {
      const computed = crypto
        .createHmac('sha256', config.moonpay.webhookSecret)
        .update(JSON.stringify(body))
        .digest('hex');
      if (computed !== signatureHeader) {
        throw new Error('Invalid webhook signature');
      }
    }

    // Expect body to have orderId, status, reference
    const orderId = body.id || body.orderId || body.order_id;
    const status = body.status || body.state;
    const reference = body.reference || body.metadata?.reference;

    if (!reference) throw new Error('Missing reference');

    const payment = await PaymentRequest.findOne({ jti: reference });

    if (!payment) throw new Error('Payment request not found');

    payment.moonpayOrderId = orderId;
    payment.moonpayStatus = status;

    if (status === 'completed' || status === 'success') {
      payment.status = 'completed';
    } else if (status === 'failed' || status === 'cancelled') {
      payment.status = 'failed';
    }

    await payment.save();

    // If payment moved to completed or failed, enqueue notification email if email provided in metadata
    try {
      const recipient = (payment.metadata && (payment.metadata as any).email) || null;
      if (recipient) {
        if (payment.status === 'completed') {
          await addEmailJob({
            type: 'honored',
            to: recipient,
            payment: payment.toJSON ? payment.toJSON() : payment,
          });
        } else if (payment.status === 'failed') {
          await addEmailJob({
            type: 'rejected',
            to: recipient,
            payment: payment.toJSON ? payment.toJSON() : payment,
          });
        }
      }
    } catch (err) {
      logger.warn('Failed to enqueue payment notification email', err);
    }

    // add audit entry for honored/failed status
    try {
      await PaymentAudit.create({
        paymentId: payment._id,
        action: payment.status === 'completed' ? 'honored' : 'rejected',
        actorEmail: (payment.metadata && (payment.metadata as any).email) || null,
        reason: null,
      });
    } catch (err) {
      logger.warn('Failed to write payment audit', err);
    }

    return payment;
  }

  async listRecentPayments(limit: number = 20, ownerEmail?: string, passcode?: string) {
    // If owner credentials provided return owner's payments (including pending)
    if (ownerEmail && passcode) {
      const hash = crypto.createHash('sha256').update(passcode).digest('hex');
      const payments = await PaymentRequest.find({ ownerEmail, ownerPasscodeHash: hash })
        .sort({ createdAt: -1 })
        .limit(limit)
        .exec();
      return payments;
    }

    // Public: only show completed (honored) invoices
    const payments = await PaymentRequest.find({ status: 'completed' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
    return payments;
  }

  async discardPayment(paymentId: string, actorEmail?: string, passcode?: string) {
    const payment = await PaymentRequest.findById(paymentId).exec();
    if (!payment) throw new Error('Payment not found');
    if (payment.status === 'completed')
      throw new Error('Cannot discard a completed (honored) payment');

    // verify owner
    if (!payment.ownerEmail) throw new Error('No owner set for this payment');
    if (!actorEmail || !passcode) throw new Error('Owner credentials required');
    if (actorEmail !== payment.ownerEmail) throw new Error('Invalid owner email');
    const hash = crypto.createHash('sha256').update(passcode).digest('hex');
    if (hash !== payment.ownerPasscodeHash) throw new Error('Invalid passcode');

    // record audit
    try {
      await PaymentAudit.create({
        paymentId: payment._id,
        action: 'discarded',
        actorEmail,
        reason: null,
      });
    } catch (err) {
      logger.warn('Failed to write discard audit', err);
    }

    await PaymentRequest.deleteOne({ _id: paymentId }).exec();
    return true;
  }

  async rejectPayment(paymentId: string, reason?: string, actorEmail?: string, passcode?: string) {
    const payment = await PaymentRequest.findById(paymentId).exec();
    if (!payment) throw new Error('Payment not found');
    if (payment.status === 'completed') throw new Error('Cannot reject a completed payment');

    // enforce owner validation
    if (!payment.ownerEmail) throw new Error('No owner set for this payment');
    if (!actorEmail || !passcode) throw new Error('Owner credentials required');
    if (actorEmail !== payment.ownerEmail) throw new Error('Invalid owner email');
    const hash = crypto.createHash('sha256').update(passcode).digest('hex');
    if (hash !== payment.ownerPasscodeHash) throw new Error('Invalid passcode');

    // if invoice is public, reject is still allowed only for owner (already validated)

    payment.status = 'failed';
    payment.metadata = payment.metadata || {};
    (payment.metadata as any).rejection = { reason: reason || null, rejectedAt: new Date() };

    await payment.save();

    try {
      const recipient = (payment.metadata && (payment.metadata as any).email) || null;
      if (recipient) {
        await addEmailJob({
          type: 'rejected',
          to: recipient,
          payment: payment.toJSON ? payment.toJSON() : payment,
          reason,
        });
      }
    } catch (err) {
      logger.warn('Failed to enqueue rejection email', err);
    }

    try {
      await PaymentAudit.create({
        paymentId: payment._id,
        action: 'rejected',
        actorEmail: actorEmail || null,
        reason: reason || null,
      });
    } catch (err) {
      logger.warn('Failed to write rejection audit', err);
    }

    return payment;
  }
}

export const paymentService = new PaymentService();
