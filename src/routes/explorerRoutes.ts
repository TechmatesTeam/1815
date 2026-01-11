import { Router } from 'express';
import { ExplorerController } from '@/controllers/ExplorerController';
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

// Search endpoint
router.get('/search', asyncHandler(ExplorerController.search));

// Address details
router.get('/address/:address', asyncHandler(ExplorerController.getAddressDetails));

// Transaction details
router.get('/transaction/:hash', asyncHandler(ExplorerController.getTransactionDetails));

// Block details
router.get('/block/:id', asyncHandler(ExplorerController.getBlockDetails));

// Bulk resolve
router.post('/resolve/bulk', asyncHandler(ExplorerController.bulkResolve));

export { router as explorerRoutes };
