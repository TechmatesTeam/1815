import { Router } from 'express';
import { aliasRoutes } from './aliasRoutes';
import { explorerRoutes } from './explorerRoutes';
import { notificationRoutes } from './notificationRoutes';
import { healthRoutes } from './healthRoutes';

const router = Router();

// Mount route modules
router.use('/aliases', aliasRoutes);
router.use('/explorer', explorerRoutes);
router.use('/notifications', notificationRoutes);
router.use('/health', healthRoutes);

export { router as apiRoutes };
