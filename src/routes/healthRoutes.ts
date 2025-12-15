import { Router } from 'express';
import { HealthController } from '@/controllers/HealthController';
import { asyncHandler } from '@/middlewares/errorHandler';
import { requestId } from '@/middlewares/validation';

const router = Router();

// Apply request ID middleware to all health routes
router.use(requestId);

/**
 * Health check endpoint with dependency checks
 * GET /api/v1/health
 * Requirements: 7.5
 */
router.get('/', asyncHandler(HealthController.healthCheck));

/**
 * Public statistics endpoint
 * GET /api/v1/health/stats
 * Requirements: 7.5
 */
router.get('/stats', asyncHandler(HealthController.getStats));

/**
 * Job failure statistics (admin endpoint)
 * GET /api/v1/health/jobs
 * Requirements: 8.5
 */
router.get('/jobs', asyncHandler(HealthController.getJobStats));

/**
 * Security monitoring endpoint (admin endpoint)
 * GET /api/v1/health/security
 * Requirements: 6.4
 */
router.get('/security', asyncHandler(HealthController.getSecurityStats));

/**
 * Detailed system metrics (admin endpoint)
 * GET /api/v1/health/metrics
 */
router.get('/metrics', asyncHandler(HealthController.getMetrics));

export { router as healthRoutes };
