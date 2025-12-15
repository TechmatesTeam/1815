import { Request, Response, NextFunction } from 'express';
import {
  aliasService,
  CreateAliasRequest,
  AliasPreviewRequest,
  ConfirmAliasRequest,
} from '@/services/aliasService';
import { createError } from '@/middlewares/errorHandler';
import { logger } from '@/utils/logger';

export class AliasController {
  /**
   * Generate alias preview without saving to database
   * POST /api/v1/aliases/preview
   * Requirements: 1.1, 1.4
   */
  static async previewAlias(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { cardanoAddress, userEmail, customName, expiryDays } = req.body as AliasPreviewRequest;

      // Get client IP for metadata
      const clientIP = req.ip || req.connection.remoteAddress || 'unknown';

      logger.info('Generating alias preview', {
        cardanoAddress: cardanoAddress.substring(0, 10) + '...',
        hasEmail: !!userEmail,
        hasCustomName: !!customName,
        ip: clientIP,
        requestId: res.locals.requestId,
      });

      // Generate preview using service
      const previewResponse = await aliasService.previewAlias({
        cardanoAddress,
        userEmail,
        customName,
        expiryDays,
      });

      logger.info('Alias preview generated successfully', {
        shortCode: previewResponse.shortCode,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: previewResponse,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to generate alias preview', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      if (error instanceof Error) {
        if (error.message.includes('Invalid Cardano address')) {
          next(createError('Invalid Cardano address format', 400, 'INVALID_ADDRESS'));
        } else if (error.message.includes('already has an active alias')) {
          next(createError(error.message, 409, 'ADDRESS_HAS_ALIAS'));
        } else if (error.message.includes('Failed to generate unique short code')) {
          next(
            createError(
              'Unable to generate unique code, please try again',
              500,
              'CODE_GENERATION_FAILED'
            )
          );
        } else {
          next(createError('Failed to generate alias preview', 500, 'PREVIEW_GENERATION_FAILED'));
        }
      } else {
        next(createError('Internal server error', 500, 'INTERNAL_ERROR'));
      }
    }
  }

  /**
   * Confirm and save alias to database
   * POST /api/v1/aliases/confirm
   * Requirements: 1.1, 1.4
   */
  static async confirmAlias(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { shortCode, cardanoAddress, userEmail, customName, expiryDays } =
        req.body as ConfirmAliasRequest;

      // Get client IP for metadata
      const clientIP = req.ip || req.connection.remoteAddress || 'unknown';

      logger.info('Confirming alias creation', {
        shortCode,
        cardanoAddress: cardanoAddress.substring(0, 10) + '...',
        hasEmail: !!userEmail,
        hasCustomName: !!customName,
        ip: clientIP,
        requestId: res.locals.requestId,
      });

      // Confirm alias using service
      const aliasResponse = await aliasService.confirmAlias({
        shortCode,
        cardanoAddress,
        userEmail,
        customName,
        expiryDays,
      });

      logger.info('Alias confirmed and created successfully', {
        shortCode: aliasResponse.shortCode,
        requestId: res.locals.requestId,
      });

      res.status(201).json({
        success: true,
        data: aliasResponse,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to confirm alias', {
        error: error instanceof Error ? error.message : 'Unknown error',
        shortCode: req.body.shortCode,
        requestId: res.locals.requestId,
      });

      if (error instanceof Error) {
        if (error.message.includes('Invalid Cardano address')) {
          next(createError('Invalid Cardano address format', 400, 'INVALID_ADDRESS'));
        } else if (error.message.includes('already has an active alias')) {
          next(createError(error.message, 409, 'ADDRESS_HAS_ALIAS'));
        } else if (error.message.includes('Short code already exists')) {
          next(
            createError(
              'Short code already exists, please generate a new preview',
              409,
              'CODE_EXISTS'
            )
          );
        } else if (error.message.includes('Short code collision')) {
          next(
            createError(
              'Code collision detected, please generate a new preview',
              409,
              'CODE_COLLISION'
            )
          );
        } else {
          next(createError('Failed to confirm alias', 500, 'ALIAS_CONFIRMATION_FAILED'));
        }
      } else {
        next(createError('Internal server error', 500, 'INTERNAL_ERROR'));
      }
    }
  }

  /**
   * Create a new alias (legacy method - creates directly)
   * POST /api/v1/aliases
   * Requirements: 1.1, 1.4
   */
  static async createAlias(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { cardanoAddress, userEmail, customName } = req.body as CreateAliasRequest;

      // Get client IP for metadata
      const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent');

      logger.info('Creating alias', {
        cardanoAddress: cardanoAddress.substring(0, 10) + '...',
        hasEmail: !!userEmail,
        hasCustomName: !!customName,
        ip: clientIP,
        requestId: res.locals.requestId,
      });

      // Create alias using service
      const aliasResponse = await aliasService.createAlias({
        cardanoAddress,
        userEmail,
        customName,
      });

      logger.info('Alias created successfully', {
        shortCode: aliasResponse.shortCode,
        requestId: res.locals.requestId,
      });

      res.status(201).json({
        success: true,
        data: aliasResponse,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to create alias', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      if (error instanceof Error) {
        if (error.message.includes('Invalid Cardano address')) {
          next(createError('Invalid Cardano address format', 400, 'INVALID_ADDRESS'));
        } else if (error.message.includes('already has an active alias')) {
          next(createError(error.message, 409, 'ADDRESS_HAS_ALIAS'));
        } else if (error.message.includes('Failed to generate unique short code')) {
          next(
            createError(
              'Unable to generate unique code, please try again',
              500,
              'CODE_GENERATION_FAILED'
            )
          );
        } else if (error.message.includes('Short code collision')) {
          next(createError('Code collision detected, please try again', 409, 'CODE_COLLISION'));
        } else {
          next(createError('Failed to create alias', 500, 'ALIAS_CREATION_FAILED'));
        }
      } else {
        next(createError('Internal server error', 500, 'INTERNAL_ERROR'));
      }
    }
  }

  /**
   * Get alias details by short code
   * GET /api/v1/aliases/:code
   * Requirements: 1.4
   */
  static async getAliasDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { code } = req.params;

      logger.debug('Getting alias details', {
        shortCode: code,
        requestId: res.locals.requestId,
      });

      const aliasDetails = await aliasService.getAliasDetails(code);

      if (!aliasDetails) {
        logger.warn('Alias not found', {
          shortCode: code,
          requestId: res.locals.requestId,
        });
        next(createError('Alias not found', 404, 'ALIAS_NOT_FOUND'));
        return;
      }

      logger.info('Alias details retrieved', {
        shortCode: code,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: aliasDetails,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to get alias details', {
        error: error instanceof Error ? error.message : 'Unknown error',
        shortCode: req.params.code,
        requestId: res.locals.requestId,
      });

      next(createError('Failed to retrieve alias details', 500, 'ALIAS_RETRIEVAL_FAILED'));
    }
  }

  /**
   * Resolve alias to Cardano address
   * GET /api/v1/resolve/:query
   * Requirements: 2.1, 2.4
   */
  static async resolveAlias(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { query } = req.params;

      logger.debug('Resolving alias', {
        query: query.substring(0, 16), // Log only first 16 chars for security
        requestId: res.locals.requestId,
      });

      const resolution = await aliasService.resolveAlias(query);

      logger.info('Alias resolved successfully', {
        query: query.substring(0, 16),
        useCount: resolution.useCount,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: resolution,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.warn('Failed to resolve alias', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query: req.params.query.substring(0, 16),
        requestId: res.locals.requestId,
      });

      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          next(createError('Alias not found', 404, 'ALIAS_NOT_FOUND'));
        } else if (error.message.includes('inactive')) {
          next(createError('Alias is inactive', 410, 'ALIAS_INACTIVE'));
        } else if (error.message.includes('expired')) {
          next(createError('Alias has expired', 410, 'ALIAS_EXPIRED'));
        } else if (error.message.includes('Invalid short code')) {
          next(createError('Invalid short code format', 400, 'INVALID_SHORT_CODE'));
        } else {
          next(createError('Failed to resolve alias', 500, 'ALIAS_RESOLUTION_FAILED'));
        }
      } else {
        next(createError('Internal server error', 500, 'INTERNAL_ERROR'));
      }
    }
  }

  /**
   * Delete (deactivate) an alias
   * DELETE /api/v1/aliases/:code
   * Requirements: 2.4
   */
  static async deleteAlias(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { code } = req.params;

      logger.info('Deleting alias', {
        shortCode: code,
        requestId: res.locals.requestId,
      });

      const deleted = await aliasService.deleteAlias(code);

      if (!deleted) {
        logger.warn('Alias not found for deletion', {
          shortCode: code,
          requestId: res.locals.requestId,
        });
        next(createError('Alias not found or already inactive', 404, 'ALIAS_NOT_FOUND'));
        return;
      }

      logger.info('Alias deleted successfully', {
        shortCode: code,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          message: 'Alias deleted successfully',
          shortCode: code,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to delete alias', {
        error: error instanceof Error ? error.message : 'Unknown error',
        shortCode: req.params.code,
        requestId: res.locals.requestId,
      });

      next(createError('Failed to delete alias', 500, 'ALIAS_DELETION_FAILED'));
    }
  }

  /**
   * Get existing alias by Cardano address (for existing alias display)
   * GET /api/v1/aliases/by-address/:address
   */
  static async getExistingAliasByAddress(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { address } = req.params;

      if (!address) {
        next(createError('Cardano address is required', 400, 'MISSING_ADDRESS'));
        return;
      }

      logger.debug('Getting existing alias by address', {
        address: address.substring(0, 10) + '...',
        requestId: res.locals.requestId,
      });

      const aliases = await aliasService.getAliasesByAddress(address);

      // Return the first active alias (most recent)
      const existingAlias = aliases.length > 0 ? aliases[0] : null;

      if (!existingAlias) {
        next(createError('No active alias found for this address', 404, 'NO_ALIAS_FOUND'));
        return;
      }

      logger.info('Existing alias retrieved by address', {
        address: address.substring(0, 10) + '...',
        shortCode: existingAlias.shortCode,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: existingAlias,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to get existing alias by address', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address:
          typeof req.params.address === 'string'
            ? req.params.address.substring(0, 10) + '...'
            : 'invalid',
        requestId: res.locals.requestId,
      });

      if (error instanceof Error && error.message.includes('Invalid Cardano address')) {
        next(createError('Invalid Cardano address format', 400, 'INVALID_ADDRESS'));
      } else {
        next(
          createError('Failed to retrieve existing alias', 500, 'EXISTING_ALIAS_RETRIEVAL_FAILED')
        );
      }
    }
  }

  /**
   * Get aliases by Cardano address (optional endpoint for user convenience)
   * GET /api/v1/aliases?address=<cardano_address>
   */
  static async getAliasesByAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { address } = req.query;

      if (!address || typeof address !== 'string') {
        next(createError('Cardano address is required', 400, 'MISSING_ADDRESS'));
        return;
      }

      logger.debug('Getting aliases by address', {
        address: address.substring(0, 10) + '...',
        requestId: res.locals.requestId,
      });

      const aliases = await aliasService.getAliasesByAddress(address);

      logger.info('Aliases retrieved by address', {
        address: address.substring(0, 10) + '...',
        count: aliases.length,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          aliases,
          count: aliases.length,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to get aliases by address', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address:
          typeof req.query.address === 'string'
            ? req.query.address.substring(0, 10) + '...'
            : 'invalid',
        requestId: res.locals.requestId,
      });

      if (error instanceof Error && error.message.includes('Invalid Cardano address')) {
        next(createError('Invalid Cardano address format', 400, 'INVALID_ADDRESS'));
      } else {
        next(createError('Failed to retrieve aliases', 500, 'ALIASES_RETRIEVAL_FAILED'));
      }
    }
  }
}
