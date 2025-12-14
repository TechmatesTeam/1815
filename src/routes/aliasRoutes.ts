import { Router } from 'express';
// Controllers will be implemented in later tasks
// import { AliasController } from '@/controllers/AliasController';

const router = Router();

// Placeholder routes - controllers will be implemented in later tasks
router.post('/', (req, res) => {
  res.status(501).json({
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Alias creation endpoint not yet implemented',
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: res.locals.requestId,
      version: process.env.npm_package_version || '1.0.0',
    },
  });
});

router.get('/:code', (req, res) => {
  res.status(501).json({
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Alias details endpoint not yet implemented',
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: res.locals.requestId,
      version: process.env.npm_package_version || '1.0.0',
    },
  });
});

router.delete('/:code', (req, res) => {
  res.status(501).json({
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Alias deletion endpoint not yet implemented',
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: res.locals.requestId,
      version: process.env.npm_package_version || '1.0.0',
    },
  });
});

export { router as aliasRoutes };
