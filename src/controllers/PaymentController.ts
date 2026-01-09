import { Request, Response, NextFunction } from 'express';
import { paymentService } from '@/services/paymentService';
import { createError } from '@/middlewares/errorHandler';
import { logger } from '@/utils/logger';

export class PaymentController {
  static async createPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { cardanoAddress, amountAda, fiatCurrency, metadata } = req.body;

      const result = await paymentService.createPaymentRequest({
        cardanoAddress,
        amountAda,
        fiatCurrency,
        metadata,
      });

      res.status(201).json({
        success: true,
        data: {
          token: result.token,
          link: result.link,
          paymentId: result.payment._id,
        },
      });
    } catch (error) {
      logger.error('Failed to create payment request', error);
      next(createError('Failed to create payment request', 500, 'PAYMENT_CREATE_FAILED'));
    }
  }

  static async getPaymentFromToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = req.params;

      const { payment } = await paymentService.decodeToken(token);

      // Build a response suitable for frontend (do NOT include raw lovelace info)
      res.status(200).json({
        success: true,
        data: {
          id: payment._id,
          jti: payment.jti,
          shortCode: payment.shortCode,
          cardanoAddress: payment.cardanoAddress,
          fiatCurrency: payment.fiatCurrency,
          fiatAmount: payment.fiatAmount,
          status: payment.status,
          metadata: payment.status === 'completed' ? {} : payment.metadata,
          txId: payment.moonpayOrderId || null,
          expiresAt: payment.expiresAt,
        },
      });
    } catch (error) {
      logger.warn('Failed to decode payment token', error instanceof Error ? error.message : error);
      next(createError('Invalid or expired payment link', 400, 'INVALID_TOKEN'));
    }
  }

  static async createMoonpaySession(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { token } = req.params;
      const { payment } = await paymentService.decodeToken(token);

      const url = paymentService.createMoonpayUrl(payment);
      res.status(200).json({ success: true, data: { url } });
    } catch (error) {
      logger.error('Failed to create moonpay session', error);
      next(createError('Failed to create MoonPay session', 500, 'MOONPAY_SESSION_FAILED'));
    }
  }

  static async listRecent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limit = Number(req.query.limit || 20);
      const ownerEmail = (req.query.ownerEmail as string) || undefined;
      const passcode = (req.query.passcode as string) || undefined;
      const payments = await paymentService.listRecentPayments(limit, ownerEmail, passcode);

      // Redact personal metadata for completed payments
      const sanitized = payments.map(p => {
        const isCompleted = p.status === 'completed';
        const meta = isCompleted ? {} : p.metadata || {};

        return {
          id: p._id,
          jti: p.jti,
          shortCode: p.shortCode,
          cardanoAddress: p.cardanoAddress,
          fiatCurrency: p.fiatCurrency,
          fiatAmount: p.fiatAmount,
          status: p.status,
          metadata: meta,
          txId: p.moonpayOrderId || null,
          createdAt: p.createdAt,
        };
      });

      res.status(200).json({ success: true, data: sanitized });
    } catch (error) {
      logger.error('Failed to list recent payments', error);
      next(createError('Failed to list payments', 500, 'PAYMENT_LIST_FAILED'));
    }
  }

  static async discardPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { ownerEmail, passcode } = req.body || {};
      await paymentService.discardPayment(id, ownerEmail, passcode);
      res.status(200).json({ success: true, data: { id } });
    } catch (error) {
      logger.warn('Failed to discard payment', error instanceof Error ? error.message : error);
      next(createError('Failed to discard payment', 400, 'PAYMENT_DISCARD_FAILED'));
    }
  }

  static async rejectPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { reason, ownerEmail, passcode } = req.body || {};
      const payment = await paymentService.rejectPayment(id, reason, ownerEmail, passcode);
      res.status(200).json({ success: true, data: { id: payment._id, status: payment.status } });
    } catch (error) {
      logger.warn('Failed to reject payment', error instanceof Error ? error.message : error);
      next(createError('Failed to reject payment', 400, 'PAYMENT_REJECT_FAILED'));
    }
  }

  static async handleWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const signature = req.get('x-moonpay-signature') || req.get('x-signature') || '';
      const payment = await paymentService.handleMoonpayWebhook(req.body, signature);

      // Optionally send email here in future

      res.status(200).json({ success: true, data: { id: payment._id, status: payment.status } });
    } catch (error) {
      logger.error('Failed to handle MoonPay webhook', error);
      next(createError('Failed to process webhook', 400, 'WEBHOOK_FAILED'));
    }
  }
}
