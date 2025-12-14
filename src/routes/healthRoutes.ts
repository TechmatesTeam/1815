import { Router } from 'express';
// Controllers will be implemented in later tasks
// import { HealthController } from '@/controllers/HealthController';

const router = Router();

// Placeholder routes - controllers will be implemented in later tasks
router.get('/', (req, res) => {
  res.status(501).json({
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Health check endpoint not yet implemented',
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: res.locals.requestId,
      version: process.env.npm_package_version || '1.0.0',
    },
  });
});

router.get('/stats', (req, res) => {
  res.status(501).json({
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Statistics endpoint not yet implemented',
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: res.locals.requestId,
      version: process.env.npm_package_version || '1.0.0',
    },
  });
});

export { router as healthRoutes };
