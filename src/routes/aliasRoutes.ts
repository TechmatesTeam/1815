import { Router } from 'express';
import { AliasController } from '@/controllers/AliasController';
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

// Generate alias preview (new two-step process)
router.post(
  '/preview',
  validateRequest(validationSchemas.createAlias, 'body'),
  asyncHandler(AliasController.previewAlias)
);

// Confirm and save alias (new two-step process)
router.post(
  '/confirm',
  validateRequest(validationSchemas.confirmAlias, 'body'),
  asyncHandler(AliasController.confirmAlias)
);

// Create alias (legacy - direct creation)
router.post(
  '/',
  validateRequest(validationSchemas.createAlias, 'body'),
  asyncHandler(AliasController.createAlias)
);

// Get alias details
router.get(
  '/:code',
  validateRequest(validationSchemas.resolveAlias, 'params'),
  asyncHandler(AliasController.getAliasDetails)
);

// Delete alias
router.delete(
  '/:code',
  validateRequest(validationSchemas.resolveAlias, 'params'),
  asyncHandler(AliasController.deleteAlias)
);

// Get existing alias by address (for existing alias display)
router.get(
  '/by-address/:address',
  validateRequest(validationSchemas.getExistingAliasByAddress, 'params'),
  asyncHandler(AliasController.getExistingAliasByAddress)
);

// Get aliases by address (query parameter)
router.get('/', asyncHandler(AliasController.getAliasesByAddress));

export { router as aliasRoutes };
