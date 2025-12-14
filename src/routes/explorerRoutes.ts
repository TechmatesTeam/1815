import { Router } from 'express';
// Controllers will be implemented in later tasks
// import { ExplorerController } from '@/controllers/ExplorerController';

const router = Router();

// Placeholder routes - controllers will be implemented in later tasks
router.get('/address/:address', (req, res) => {
  res.status(501).json({
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Address lookup endpoint not yet implemented',
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: res.locals.requestId,
      version: process.env.npm_package_version || '1.0.0',
    },
  });
});

router.get('/transaction/:hash', (req, res) => {
  res.status(501).json({
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Transaction lookup endpoint not yet implemented',
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: res.locals.requestId,
      version: process.env.npm_package_version || '1.0.0',
    },
  });
});

router.get('/block/:id', (req, res) => {
  res.status(501).json({
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Block lookup endpoint not yet implemented',
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: res.locals.requestId,
      version: process.env.npm_package_version || '1.0.0',
    },
  });
});

router.post('/resolve/bulk', (req, res) => {
  res.status(501).json({
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Bulk resolution endpoint not yet implemented',
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: res.locals.requestId,
      version: process.env.npm_package_version || '1.0.0',
    },
  });
});

export { router as explorerRoutes };
