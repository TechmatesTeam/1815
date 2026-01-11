import { Router } from 'express';
import { NotificationController } from '@/controllers/NotificationController';
import {
  validateRequest,
  validationSchemas,
  securityValidation,
  requestId,
} from '@/middlewares/validation';
import { asyncHandler } from '@/middlewares/errorHandler';

const router = Router();

// Apply request ID middleware to all routes
router.use(requestId);

// Apply security validation to all routes
router.use(securityValidation);

// Subscribe to notifications
router.post(
  '/subscribe',
  validateRequest(validationSchemas.subscribeNotifications, 'body'),
  asyncHandler(NotificationController.subscribe)
);

// Update notification preferences
router.put(
  '/preferences',
  validateRequest(validationSchemas.updatePreferences, 'body'),
  asyncHandler(NotificationController.updatePreferences)
);

// Unsubscribe from notifications
router.post(
  '/unsubscribe/:token',
  validateRequest(validationSchemas.unsubscribeToken, 'params'),
  validateRequest(validationSchemas.unsubscribeBody, 'body'),
  asyncHandler(NotificationController.unsubscribe)
);

// Get notification preferences (optional convenience endpoint)
router.get('/preferences', asyncHandler(NotificationController.getPreferences));

// Get notification statistics (admin endpoint)
router.get('/stats', asyncHandler(NotificationController.getStats));

export { router as notificationRoutes };
