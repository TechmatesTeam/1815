import { Router } from 'express';
import { aliasRoutes } from './aliasRoutes';
import { explorerRoutes } from './explorerRoutes';
import { notificationRoutes } from './notificationRoutes';
import { healthRoutes } from './healthRoutes';
import { webViewerRoutes } from './webViewerRoutes';
import { featuresRoutes } from './featuresRoutes';

const router = Router();

// Mount route modules
router.use('/aliases', aliasRoutes);
router.use('/explorer', explorerRoutes);
router.use('/notifications', notificationRoutes);
router.use('/health', healthRoutes);
router.use('/web-viewer', webViewerRoutes);
router.use('/features', featuresRoutes);

// Add resolve route at the top level for clean URLs
router.get('/resolve/:query', (req, res, next) => {
  // Import here to avoid circular dependency
  const {
    validateRequest,
    validationSchemas,
    securityValidation,
    requestId,
  } = require('@/middlewares/validation');
  const { AliasController } = require('@/controllers/AliasController');
  const { asyncHandler } = require('@/middlewares/errorHandler');

  // Apply middleware chain
  requestId(req, res, () => {
    securityValidation(req, res, () => {
      validateRequest(validationSchemas.resolveQuery, 'params')(req, res, () => {
        asyncHandler(AliasController.resolveAlias)(req, res, next);
      });
    });
  });
});

// Add stats route at the top level for clean URLs
router.get('/stats', (req, res, next) => {
  // Import here to avoid circular dependency
  const { HealthController } = require('@/controllers/HealthController');
  const { asyncHandler } = require('@/middlewares/errorHandler');
  const { requestId } = require('@/middlewares/validation');

  // Apply middleware chain
  requestId(req, res, () => {
    asyncHandler(HealthController.getStats)(req, res, next);
  });
});

export { router as apiRoutes };
