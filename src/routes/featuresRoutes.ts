import { Router } from 'express';
import { FeaturesController } from '@/controllers/FeaturesController';
import {
  validateRequest,
  validationSchemas,
  securityValidation,
  requestId,
} from '@/middlewares/validation';
import { asyncHandler } from '@/middlewares/errorHandler';

const router = Router();

// Apply common middleware to all routes
router.use(requestId);
router.use(securityValidation);

/**
 * Get all features and roadmap data
 * GET /api/v1/features
 */
router.get('/', asyncHandler(FeaturesController.getFeatures));

/**
 * Subscribe to newsletter
 * POST /api/v1/features/newsletter/subscribe
 */
router.post(
  '/newsletter/subscribe',
  validateRequest(validationSchemas.newsletterSubscription, 'body'),
  asyncHandler(FeaturesController.subscribeNewsletter)
);

/**
 * Subscribe to feature notifications
 * POST /api/v1/features/notify
 */
router.post(
  '/notify',
  validateRequest(validationSchemas.featureNotification, 'body'),
  asyncHandler(FeaturesController.subscribeFeatureNotification)
);

/**
 * Verify email subscription
 * GET /api/v1/features/verify/:token
 */
router.get(
  '/verify/:token',
  validateRequest(validationSchemas.verificationToken, 'params'),
  asyncHandler(FeaturesController.verifySubscription)
);

/**
 * Unsubscribe from newsletter
 * POST /api/v1/features/newsletter/unsubscribe/:token
 */
router.post(
  '/newsletter/unsubscribe/:token',
  validateRequest(validationSchemas.unsubscribeToken, 'params'),
  asyncHandler(FeaturesController.unsubscribeNewsletter)
);

export { router as featuresRoutes };
