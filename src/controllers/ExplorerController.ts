import { Request, Response, NextFunction } from 'express';
import { createError } from '@/middlewares/errorHandler';
import { logger } from '@/utils/logger';
import { config } from '@/config/environment';
import { explorerService } from '@/services/explorerService';
import { aliasService } from '@/services/aliasService';

export class ExplorerController {
  /**
   * Search for addresses, transactions, blocks, or aliases
   * GET /api/v1/explorer/search?query=<query>&type=<type>
   * Requirements: 3.1, 3.2, 3.3
   */
  static async search(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { query, type = 'auto' } = req.query;

      if (!query || typeof query !== 'string') {
        next(createError('Search query is required', 400, 'MISSING_QUERY'));
        return;
      }

      logger.debug('Processing search request', {
        query: query.substring(0, 20) + '...',
        type,
        requestId: res.locals.requestId,
      });

      // Check if this is an alias first (16-digit numeric code)
      if (/^\d{16}$/.test(query.trim())) {
        try {
          // Try to resolve as alias first
          const aliasResult = await aliasService.resolveAlias(query.trim());

          // Use the same search method as direct address search to ensure consistency
          const addressSearchResult = await explorerService.search({
            query: aliasResult.cardanoAddress,
            type: 'address',
            ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
            userAgent: req.get('User-Agent'),
          });

          // Apply the same formatting logic as direct address search
          let formattedAddressData;
          if (addressSearchResult.type === 'address') {
            formattedAddressData = {
              ...addressSearchResult.data,
              balance: ExplorerController.formatBalance(addressSearchResult.data.amount),
              totalTransactions: await ExplorerController.getTransactionCount(
                addressSearchResult.data.address
              ),
              firstSeen: 'Unknown', // Would need additional API call to get this
              lastActivity: 'Unknown', // Would need additional API call to get this
              transactions: [], // Would need additional API call to get recent transactions
              // Include raw Blockfrost data for debugging consistency
              raw: addressSearchResult.data,
            };
          } else {
            formattedAddressData = addressSearchResult.data;
          }

          // Format the result for alias display, using the same data structure as address search
          const result = {
            type: 'alias' as const,
            data: {
              // Include ALL formatted blockchain data first
              ...formattedAddressData,
              // Then override with alias-specific fields
              alias: query.trim(),
              resolvedAddress: aliasResult.cardanoAddress,
              address: aliasResult.cardanoAddress,
              customName: aliasResult.customName,
              expiresAt: aliasResult.expiresAt,
              useCount: aliasResult.useCount,
              createdDate: aliasResult.createdAt
                ? new Date(aliasResult.createdAt).toLocaleDateString()
                : 'Unknown',
              expiryDate: aliasResult.expiresAt
                ? new Date(aliasResult.expiresAt).toLocaleDateString()
                : 'Unknown',
            },
            cached: addressSearchResult.cached,
            responseTime: addressSearchResult.responseTime,
          };

          logger.info('Alias search completed successfully', {
            alias: query.trim(),
            resolvedAddress: aliasResult.cardanoAddress.substring(0, 20) + '...',
            cached: addressSearchResult.cached,
            responseTime: addressSearchResult.responseTime,
            requestId: res.locals.requestId,
          });

          res.status(200).json({
            success: true,
            data: result,
            metadata: {
              timestamp: new Date().toISOString(),
              requestId: res.locals.requestId,
              version: process.env.npm_package_version || '1.0.0',
            },
          });
          return;
        } catch (aliasError) {
          logger.warn('Alias resolution failed, trying blockchain search', {
            query: query.trim(),
            error: aliasError instanceof Error ? aliasError.message : 'Unknown error',
          });
          // Continue to blockchain search if alias resolution fails
        }
      }

      // Use the explorer service for blockchain data
      const searchResult = await explorerService.search({
        query: query.trim(),
        type: type as any,
        ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
        userAgent: req.get('User-Agent'),
      });

      // Format the result based on type
      let formattedResult;
      switch (searchResult.type) {
        case 'address':
          formattedResult = {
            ...searchResult,
            data: {
              ...searchResult.data,
              balance: ExplorerController.formatBalance(searchResult.data.amount),
              totalTransactions: await ExplorerController.getTransactionCount(
                searchResult.data.address
              ),
              firstSeen: 'Unknown', // Would need additional API call to get this
              lastActivity: 'Unknown', // Would need additional API call to get this
              transactions: [], // Would need additional API call to get recent transactions
              // Include raw Blockfrost data for debugging consistency
              raw: searchResult.data,
            },
          };
          break;
        case 'transaction':
          formattedResult = {
            ...searchResult,
            data: {
              ...searchResult.data,
              timestamp: new Date(searchResult.data.block_time * 1000).toISOString(),
              fee: ExplorerController.formatBalance([
                { unit: 'lovelace', quantity: searchResult.data.fees },
              ]),
              inputs: [], // Would need additional API call to get UTXOs
              outputs: [], // Would need additional API call to get UTXOs
              // Include raw Blockfrost data for debugging consistency
              raw: searchResult.data,
            },
          };
          break;
        default:
          formattedResult = searchResult;
      }

      logger.info('Blockchain search completed successfully', {
        query: query.substring(0, 20) + '...',
        type: searchResult.type,
        cached: searchResult.cached,
        responseTime: searchResult.responseTime,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: formattedResult,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Search failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query:
          typeof req.query.query === 'string'
            ? req.query.query.substring(0, 20) + '...'
            : 'invalid',
        requestId: res.locals.requestId,
      });

      // Check if this is a graceful degradation error
      if ((error as any).isGracefulDegradation) {
        const fallbackResponse = (error as any).fallbackResponse;
        res.status(503).json({
          success: false,
          error: {
            code: 'SERVICE_DEGRADED',
            message: 'Blockchain service temporarily unavailable. Please try again later.',
            details: fallbackResponse,
          },
          metadata: {
            timestamp: new Date().toISOString(),
            requestId: res.locals.requestId,
            version: process.env.npm_package_version || '1.0.0',
          },
        });
        return;
      }

      next(createError('Search failed', 500, 'SEARCH_FAILED'));
    }
  }

  /**
   * Get address details and transaction history
   * GET /api/v1/explorer/address/:address
   * Requirements: 3.1
   */
  static async getAddressDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { address } = req.params;

      logger.debug('Getting address details', {
        address: address.substring(0, 20) + '...',
        requestId: res.locals.requestId,
      });

      // Get real address details from Blockfrost
      const addressDetails = await explorerService.getAddressDetails(address);

      // Format the response
      const formattedDetails = {
        address,
        balance: ExplorerController.formatBalance(addressDetails.amount),
        totalTransactions: await ExplorerController.getTransactionCount(address),
        firstSeen: 'Unknown', // Would need additional API call
        lastActivity: 'Unknown', // Would need additional API call
        transactions: [], // Would need additional API call for recent transactions
        // Include raw Blockfrost data for debugging
        raw: addressDetails,
      };

      logger.info('Address details retrieved', {
        address: address.substring(0, 20) + '...',
        balance: formattedDetails.balance,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: formattedDetails,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to get address details', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address: req.params.address?.substring(0, 20) + '...',
        requestId: res.locals.requestId,
      });

      next(createError('Failed to retrieve address details', 500, 'ADDRESS_RETRIEVAL_FAILED'));
    }
  }

  /**
   * Get transaction details
   * GET /api/v1/explorer/transaction/:hash
   * Requirements: 3.2
   */
  static async getTransactionDetails(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { hash } = req.params;

      logger.debug('Getting transaction details', {
        hash: hash.substring(0, 20) + '...',
        requestId: res.locals.requestId,
      });

      // Get real transaction details from Blockfrost
      const transactionDetails = await explorerService.getTransactionDetails(hash);

      // Format the response
      const formattedDetails = {
        hash,
        status: transactionDetails.valid_contract ? 'Confirmed' : 'Failed',
        block: transactionDetails.block_height,
        timestamp: new Date(transactionDetails.block_time * 1000).toISOString(),
        fee: ExplorerController.formatBalance([
          { unit: 'lovelace', quantity: transactionDetails.fees },
        ]),
        inputs: [], // Would need additional API call to get UTXOs
        outputs: [], // Would need additional API call to get UTXOs
        // Include raw Blockfrost data for debugging
        raw: transactionDetails,
      };

      logger.info('Transaction details retrieved', {
        hash: hash.substring(0, 20) + '...',
        block: transactionDetails.block_height,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: formattedDetails,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to get transaction details', {
        error: error instanceof Error ? error.message : 'Unknown error',
        hash: req.params.hash?.substring(0, 20) + '...',
        requestId: res.locals.requestId,
      });

      next(
        createError('Failed to retrieve transaction details', 500, 'TRANSACTION_RETRIEVAL_FAILED')
      );
    }
  }

  /**
   * Get block details
   * GET /api/v1/explorer/block/:id
   * Requirements: 3.3
   */
  static async getBlockDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      logger.debug('Getting block details', {
        blockId: id,
        requestId: res.locals.requestId,
      });

      // Get real block details from Blockfrost
      const blockDetails = await explorerService.getBlockDetails(id);

      // Format the response
      const formattedDetails = {
        id,
        hash: blockDetails.hash,
        height: blockDetails.height,
        timestamp: new Date(blockDetails.time * 1000).toISOString(),
        transactionCount: blockDetails.tx_count,
        size: blockDetails.size,
        slot: blockDetails.slot,
        epoch: blockDetails.epoch,
        // Include raw Blockfrost data for debugging
        raw: blockDetails,
      };

      logger.info('Block details retrieved', {
        blockId: id,
        height: blockDetails.height,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: formattedDetails,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Failed to get block details', {
        error: error instanceof Error ? error.message : 'Unknown error',
        blockId: req.params.id,
        requestId: res.locals.requestId,
      });

      next(createError('Failed to retrieve block details', 500, 'BLOCK_RETRIEVAL_FAILED'));
    }
  }

  /**
   * Bulk resolve multiple aliases
   * POST /api/v1/explorer/resolve/bulk
   * Requirements: 3.4
   */
  static async bulkResolve(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { codes } = req.body;

      if (!Array.isArray(codes)) {
        next(createError('Codes array is required', 400, 'INVALID_CODES'));
        return;
      }

      logger.debug('Processing bulk resolve request', {
        count: codes.length,
        requestId: res.locals.requestId,
      });

      // Mock bulk resolution for now
      const results = codes.map((code: string) => ({
        shortCode: code,
        cardanoAddress: `addr1qxy2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt6yr69nqzz${Math.random().toString(36).substring(2, 10)}`,
        isActive: Math.random() > 0.1, // 90% active
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }));

      logger.info('Bulk resolve completed', {
        count: codes.length,
        requestId: res.locals.requestId,
      });

      res.status(200).json({
        success: true,
        data: results,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: res.locals.requestId,
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('Bulk resolve failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: res.locals.requestId,
      });

      next(createError('Bulk resolve failed', 500, 'BULK_RESOLVE_FAILED'));
    }
  }

  /**
   * Format balance from Blockfrost amount array to human-readable string
   */
  private static formatBalance(amounts: Array<{ unit: string; quantity: string }>): string {
    if (!amounts || amounts.length === 0) {
      return '0 ₳';
    }

    // Find ADA (lovelace) amount
    const adaAmount = amounts.find(amount => amount.unit === 'lovelace');
    if (adaAmount) {
      const ada = parseInt(adaAmount.quantity) / 1_000_000; // Convert lovelace to ADA
      return `${ada.toLocaleString()} ₳`;
    }

    // If no ADA found, show the first asset
    const firstAsset = amounts[0];
    if (firstAsset.unit === 'lovelace') {
      const ada = parseInt(firstAsset.quantity) / 1_000_000;
      return `${ada.toLocaleString()} ₳`;
    }

    return `${firstAsset.quantity} ${firstAsset.unit.substring(0, 8)}...`;
  }

  /**
   * Get transaction count for an address using explorerService
   */
  private static async getTransactionCount(address: string): Promise<number> {
    try {
      // Use the explorer service to get address details which may include transaction count
      const addressDetails = await explorerService.getAddressDetails(address);

      // For now, return 0 as Blockfrost basic address endpoint doesn't include tx count
      // This would require additional API calls to get transaction history
      // TODO: Implement actual transaction count retrieval using address/transactions endpoint
      return 0;
    } catch (error) {
      logger.warn('Failed to get transaction count:', error);
      return 0;
    }
  }
}
