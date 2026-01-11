import { Router } from 'express';
import { PaymentController } from '@/controllers/PaymentController';
import { requestId, validateRequest, validationSchemas } from '@/middlewares/validation';
import Joi from 'joi';
import { asyncHandler } from '@/middlewares/errorHandler';

const router = Router();

// Create a new payment request (receiver)
router.post(
  '/',
  requestId,
  validateRequest(validationSchemas.createPayment, 'body'),
  asyncHandler(PaymentController.createPayment)
);

// Get payment details by token (server-side decode)
router.get(
  '/token/:token',
  requestId,
  validateRequest(validationSchemas.verificationToken, 'params'),
  asyncHandler(PaymentController.getPaymentFromToken)
);

// Create a moonpay session (redirect URL)
router.post(
  '/token/:token/moonpay',
  requestId,
  validateRequest(validationSchemas.verificationToken, 'params'),
  asyncHandler(PaymentController.createMoonpaySession)
);

// Webhook endpoint for MoonPay
router.post('/webhook', asyncHandler(PaymentController.handleWebhook));

// List recent payments (public summary)
router.get('/recent', requestId, asyncHandler(PaymentController.listRecent));

// Discard (delete) a payment by id (only if not completed)
router.delete(
  '/:id',
  requestId,
  validateRequest(validationSchemas.paymentIdParam, 'params'),
  validateRequest(
    Joi.object({
      ownerEmail: Joi.string().email().required(),
      passcode: Joi.string().min(4).required(),
    }),
    'body'
  ),
  asyncHandler(PaymentController.discardPayment)
);

// Reject a payment (mark as failed) with optional reason
router.post(
  '/:id/reject',
  requestId,
  validateRequest(validationSchemas.paymentIdParam, 'params'),
  validateRequest(
    Joi.object({
      reason: Joi.string().max(1000).optional(),
      ownerEmail: Joi.string().email().required(),
      passcode: Joi.string().min(4).required(),
    }),
    'body'
  ),
  asyncHandler(PaymentController.rejectPayment)
);

export { router as paymentRoutes };
