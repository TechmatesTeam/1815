import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import { config } from '@/config/environment';
import { cacheService, CacheKeys, CacheTTL } from './cacheService';
import { logger } from '@/utils/logger';
import { SearchHistory } from '@/models/SearchHistory';
import { CircuitBreaker, createAPICircuitBreaker } from '@/utils/circuitBreaker';
import { serviceDegradationManager, FallbackResponse } from '@/utils/serviceDegradation';
import {
  isValidCardanoAddress,
  isValidTransactionHash,
  isValidBlockIdentifier,
} from '@/utils/cardanoValidation';

export interface AddressDetails {
  address: string;
  amount: Array<{
    unit: string;
    quantity: string;
  }>;
  stake_address?: string | null;
  type: string;
  script: boolean;
}

export interface TransactionDetails {
  hash: string;
  block: string;
  block_height: number;
  block_time: number;
  slot: number;
  index: number;
  output_amount: Array<{
    unit: string;
    quantity: string;
  }>;
  fees: string;
  deposit: string;
  size: number;
  invalid_before?: string | null;
  invalid_hereafter?: string | null;
  utxo_count: number;
  withdrawal_count: number;
  mir_cert_count: number;
  delegation_count: number;
  stake_cert_count: number;
  pool_update_count: number;
  pool_retire_count: number;
  asset_mint_or_burn_count: number;
  redeemer_count: number;
  valid_contract: boolean;
}

export interface BlockDetails {
  time: number;
  height?: number | null;
  hash: string;
  slot?: number | null;
  epoch?: number | null;
  epoch_slot?: number | null;
  slot_leader: string;
  size: number;
  tx_count: number;
  output?: string | null;
  fees?: string | null;
  block_vrf?: string | null;
  op_cert?: string | null;
  op_cert_counter?: string | null;
  previous_block?: string | null;
  next_block?: string | null;
  confirmations: number;
}

export interface SearchRequest {
  query: string;
  type?: 'auto' | 'address' | 'transaction' | 'block' | 'alias';
  ipAddress: string;
  userAgent?: string;
}

export interface SearchResult {
  type: 'address' | 'transaction' | 'block' | 'alias' | 'not_found';
  data: AddressDetails | TransactionDetails | BlockDetails | any;
  cached: boolean;
  responseTime: number;
}

export class ExplorerService {
  private blockfrost: BlockFrostAPI;
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000; // 1 second
  private readonly circuitBreaker: CircuitBreaker;

  constructor() {
    this.blockfrost = new BlockFrostAPI({
      projectId: config.blockfrost.apiKey,
      network: config.blockfrost.network as any, // Type assertion for network compatibility
    });

    // Initialize circuit breaker for Blockfrost API
    this.circuitBreaker = createAPICircuitBreaker('blockfrost-api');
  }

  /**
   * Validate if a string is a valid Cardano address
   */
  isValidCardanoAddress(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }

    const cleanAddress = address.trim();

    // Cardano addresses can be:
    // - Shelley mainnet addresses: start with 'addr1' + bech32 chars (59 chars total)
    // - Shelley testnet addresses: start with 'addr_test1' + bech32 chars (63 chars total)
    // - Byron addresses: start with 'Ae2' or 'DdzFF' + base58 chars (variable length)
    // - Stake addresses: start with 'stake1' or 'stake_test1' + bech32 chars

    // Bech32 character set (used in Shelley addresses)
    const bech32Chars = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const bech32Regex = `[${bech32Chars}]`;

    // Base58 character set (used in Byron addresses)
    const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const base58Regex = `[${base58Chars}]`;

    // Shelley mainnet address: addr1 + 54 bech32 chars = 59 total
    const shelleyMainnetRegex = new RegExp(`^addr1${bech32Regex}{54}$`);

    // Shelley testnet address: addr_test1 + 54 bech32 chars = 63 total
    const shelleyTestnetRegex = new RegExp(`^addr_test1${bech32Regex}{54}$`);

    // Byron addresses: Ae2 or DdzFF + base58 chars (50-104 chars total)
    const byronRegex = new RegExp(`^(Ae2|DdzFF)${base58Regex}{47,101}$`);

    // Stake mainnet address: stake1 + 50 bech32 chars = 56 total
    const stakeMainnetRegex = new RegExp(`^stake1${bech32Regex}{50}$`);

    // Stake testnet address: stake_test1 + 50 bech32 chars = 61 total
    const stakeTestnetRegex = new RegExp(`^stake_test1${bech32Regex}{50}$`);

    return (
      shelleyMainnetRegex.test(cleanAddress) ||
      shelleyTestnetRegex.test(cleanAddress) ||
      byronRegex.test(cleanAddress) ||
      stakeMainnetRegex.test(cleanAddress) ||
      stakeTestnetRegex.test(cleanAddress)
    );
  }

  /**
   * Validate if a string is a valid transaction hash
   */
  private isValidTransactionHash(hash: string): boolean {
    if (!hash || typeof hash !== 'string') {
      return false;
    }
    // Transaction hashes are 64-character hexadecimal strings
    return /^[a-fA-F0-9]{64}$/.test(hash.trim());
  }

  /**
   * Validate if a string is a valid block hash or number
   */
  private isValidBlockIdentifier(identifier: string): boolean {
    if (!identifier || typeof identifier !== 'string') {
      return false;
    }

    const cleanId = identifier.trim();

    // Block hash: 64-character hexadecimal string
    const blockHashRegex = /^[a-fA-F0-9]{64}$/;
    // Block number: positive integer
    const blockNumberRegex = /^\d+$/;

    return blockHashRegex.test(cleanId) || blockNumberRegex.test(cleanId);
  }

  /**
   * Determine the type of query automatically
   */
  private determineQueryType(query: string): 'address' | 'transaction' | 'block' | 'unknown' {
    const cleanQuery = query.trim();

    if (isValidCardanoAddress(cleanQuery)) {
      return 'address';
    }

    if (isValidTransactionHash(cleanQuery)) {
      return 'transaction';
    }

    if (isValidBlockIdentifier(cleanQuery)) {
      return 'block';
    }

    return 'unknown';
  }

  /**
   * Retry wrapper for Blockfrost API calls with circuit breaker protection
   */
  private async withRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    return await this.circuitBreaker.execute(async () => {
      let lastError: Error;

      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const result = await operation();
          serviceDegradationManager.recordSuccess('blockfrost-api');
          return result;
        } catch (error) {
          lastError = error as Error;
          logger.warn(`${operationName} attempt ${attempt}/${this.maxRetries} failed:`, error);

          if (attempt < this.maxRetries) {
            await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
          }
        }
      }

      // Record failure for service degradation tracking
      serviceDegradationManager.recordFailure('blockfrost-api', lastError!.message);
      throw lastError!;
    });
  }

  /**
   * Get address details from Blockfrost API
   */
  async getAddressDetails(address: string): Promise<AddressDetails> {
    if (!isValidCardanoAddress(address)) {
      throw new Error('Invalid Cardano address format');
    }

    const cacheKey = `address:${address}`;

    // Try cache first
    const cached = await cacheService.get<AddressDetails>(cacheKey, {
      prefix: CacheKeys.BLOCKFROST,
    });

    if (cached) {
      logger.debug(`Address details cache hit: ${address}`);
      return cached;
    }

    // Fetch from Blockfrost API
    const addressDetails = await this.withRetry(async () => {
      return await this.blockfrost.addresses(address);
    }, `getAddressDetails(${address})`);

    // Cache the result (ignore cache errors)
    try {
      await cacheService.set(cacheKey, addressDetails, {
        prefix: CacheKeys.BLOCKFROST,
        ttl: CacheTTL.BLOCKFROST,
      });
    } catch (cacheError) {
      logger.warn('Failed to cache address details, continuing without cache:', cacheError);
    }

    logger.info(`Address details fetched: ${address}`);
    return addressDetails;
  }

  /**
   * Get transaction details from Blockfrost API
   */
  async getTransactionDetails(hash: string): Promise<TransactionDetails> {
    if (!isValidTransactionHash(hash)) {
      throw new Error('Invalid transaction hash format');
    }

    const cacheKey = `transaction:${hash}`;

    // Try cache first
    const cached = await cacheService.get<TransactionDetails>(cacheKey, {
      prefix: CacheKeys.BLOCKFROST,
    });

    if (cached) {
      logger.debug(`Transaction details cache hit: ${hash}`);
      return cached;
    }

    // Fetch from Blockfrost API
    const transactionDetails = await this.withRetry(async () => {
      return await this.blockfrost.txs(hash);
    }, `getTransactionDetails(${hash})`);

    // Cache the result (ignore cache errors)
    try {
      await cacheService.set(cacheKey, transactionDetails, {
        prefix: CacheKeys.BLOCKFROST,
        ttl: CacheTTL.BLOCKFROST,
      });
    } catch (cacheError) {
      logger.warn('Failed to cache transaction details, continuing without cache:', cacheError);
    }

    logger.info(`Transaction details fetched: ${hash}`);
    return transactionDetails;
  }

  /**
   * Get block details from Blockfrost API
   */
  async getBlockDetails(identifier: string): Promise<BlockDetails> {
    if (!isValidBlockIdentifier(identifier)) {
      throw new Error('Invalid block identifier format');
    }

    const cacheKey = `block:${identifier}`;

    // Try cache first
    const cached = await cacheService.get<BlockDetails>(cacheKey, {
      prefix: CacheKeys.BLOCKFROST,
    });

    if (cached) {
      logger.debug(`Block details cache hit: ${identifier}`);
      return cached;
    }

    // Fetch from Blockfrost API
    const blockDetails = await this.withRetry(async () => {
      return await this.blockfrost.blocks(identifier);
    }, `getBlockDetails(${identifier})`);

    // Cache the result (ignore cache errors)
    try {
      await cacheService.set(cacheKey, blockDetails, {
        prefix: CacheKeys.BLOCKFROST,
        ttl: CacheTTL.BLOCKFROST,
      });
    } catch (cacheError) {
      logger.warn('Failed to cache block details, continuing without cache:', cacheError);
    }

    logger.info(`Block details fetched: ${identifier}`);
    return blockDetails;
  }

  /**
   * Search for blockchain data with automatic type detection
   */
  async search(request: SearchRequest): Promise<SearchResult> {
    const startTime = Date.now();
    let cached = false;
    let resultType: SearchResult['type'] = 'not_found';
    let data: any = null;
    let errorMessage: string | undefined;

    try {
      const queryType =
        request.type === 'auto' ? this.determineQueryType(request.query) : request.type;

      if (!queryType || queryType === 'unknown') {
        throw new Error('Unable to determine query type or unsupported query format');
      }

      // Check if we have cached result first
      const cacheKey = `search:${request.query}`;
      const cachedResult = await cacheService.get<{
        type: string;
        data: any;
      }>(cacheKey, { prefix: CacheKeys.SEARCH });

      if (cachedResult) {
        cached = true;
        resultType = cachedResult.type as SearchResult['type'];
        data = cachedResult.data;
      } else {
        // Fetch fresh data based on query type
        switch (queryType) {
          case 'address':
            data = await this.getAddressDetails(request.query);
            resultType = 'address';
            break;

          case 'transaction':
            data = await this.getTransactionDetails(request.query);
            resultType = 'transaction';
            break;

          case 'block':
            data = await this.getBlockDetails(request.query);
            resultType = 'block';
            break;

          default:
            throw new Error(`Unsupported query type: ${queryType}`);
        }

        // Cache the search result (ignore cache errors)
        try {
          await cacheService.set(
            cacheKey,
            { type: resultType, data },
            { prefix: CacheKeys.SEARCH, ttl: CacheTTL.SEARCH }
          );
        } catch (cacheError) {
          logger.warn('Failed to cache search result, continuing without cache:', cacheError);
        }
      }

      const responseTime = Date.now() - startTime;

      // Log search history
      await this.logSearchHistory({
        query: request.query,
        queryType: request.type || 'auto',
        resultType,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
        responseTime,
        wasSuccessful: true,
        cacheHit: cached,
      });

      return {
        type: resultType,
        data,
        cached,
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error(`Search failed for query: ${request.query}`, error);

      // Log failed search
      await this.logSearchHistory({
        query: request.query,
        queryType: request.type || 'auto',
        resultType: undefined,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
        responseTime,
        wasSuccessful: false,
        errorMessage,
        cacheHit: false,
      });

      // Handle circuit breaker and service degradation
      if (error instanceof Error) {
        // Check if this is a 404 "not found" error
        const isNotFound =
          error.message.includes('not been found') ||
          error.message.includes('Not Found') ||
          (error as any).status_code === 404;

        if (isNotFound) {
          // Return a proper "not found" response instead of throwing an error
          logger.info(`Address/transaction/block not found: ${request.query}`);
          return {
            type: 'not_found',
            data: {
              message:
                'The requested address, transaction, or block was not found on the blockchain.',
              query: request.query,
              suggestions: [
                'Verify the address format is correct',
                'Check if the address exists on the correct network (mainnet/testnet)',
                'For transactions, ensure the hash is complete and accurate',
              ],
            },
            cached: false,
            responseTime,
          };
        }

        // Check if this is a circuit breaker error or API failure
        const isCircuitBreakerOpen = (error as any).isCircuitBreakerOpen;
        const isAPIFailure =
          error.message.includes('API') ||
          error.message.includes('fetch') ||
          error.message.includes('network');

        if (isCircuitBreakerOpen || isAPIFailure) {
          logger.warn(
            `Blockfrost API failure detected, attempting graceful degradation for: ${request.query}`
          );

          // Try to get cached fallback data
          const fallbackCacheKey = `search:${request.query}`;
          const fallbackResult = await cacheService.get<{
            type: string;
            data: any;
          }>(fallbackCacheKey, { prefix: CacheKeys.SEARCH });

          if (fallbackResult) {
            logger.info(`Returning cached fallback data for: ${request.query}`);
            return {
              type: fallbackResult.type as SearchResult['type'],
              data: fallbackResult.data,
              cached: true,
              responseTime,
            };
          }

          // No cached data available, create graceful error response
          const fallbackResponse = await serviceDegradationManager.createBlockfrostFallback(
            request.query,
            'search-request'
          );

          // Convert fallback response to SearchResult format for consistency
          if (fallbackResponse.success && fallbackResponse.data) {
            return fallbackResponse.data as SearchResult;
          } else {
            // Create a graceful error that doesn't crash the application
            const gracefulError = new Error(
              fallbackResponse.error?.message || 'Service temporarily unavailable'
            );
            (gracefulError as any).isGracefulDegradation = true;
            (gracefulError as any).fallbackResponse = fallbackResponse;
            throw gracefulError;
          }
        }
      }

      throw error;
    }
  }

  /**
   * Log search history to database
   */
  private async logSearchHistory(data: {
    query: string;
    queryType: string;
    resultType?: string;
    ipAddress: string;
    userAgent?: string;
    responseTime: number;
    wasSuccessful: boolean;
    errorMessage?: string;
    cacheHit: boolean;
  }): Promise<void> {
    try {
      const searchHistory = new SearchHistory({
        query: data.query,
        queryType: data.queryType,
        resultType: data.resultType,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        responseTime: data.responseTime,
        wasSuccessful: data.wasSuccessful,
        errorMessage: data.errorMessage,
        cacheHit: data.cacheHit,
      });

      await searchHistory.save();
      logger.debug(`Search history logged: ${data.query}`);
    } catch (error) {
      logger.error('Failed to log search history:', error);
      // Don't throw error as this is a background operation
    }
  }

  /**
   * Get search analytics
   */
  async getSearchAnalytics(days: number = 7): Promise<any> {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      return await (SearchHistory as any).getAnalytics(startDate, endDate);
    } catch (error) {
      logger.error('Failed to get search analytics:', error);
      return {
        totalSearches: 0,
        successfulSearches: 0,
        cacheHits: 0,
        avgResponseTime: 0,
        queryTypes: [],
        resultTypes: [],
      };
    }
  }

  /**
   * Get popular search queries
   */
  async getPopularQueries(limit: number = 10, days: number = 7): Promise<any[]> {
    try {
      return await (SearchHistory as any).getPopularQueries(limit, days);
    } catch (error) {
      logger.error('Failed to get popular queries:', error);
      return [];
    }
  }

  /**
   * Health check for Blockfrost API with circuit breaker status
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy' | 'degraded';
    latency?: number;
    error?: string;
    circuitBreaker?: {
      state: string;
      failureCount: number;
      successCount: number;
    };
    serviceStatus?: any;
  }> {
    try {
      const startTime = Date.now();
      const circuitBreakerStats = this.circuitBreaker.getStats();
      const serviceStatus = serviceDegradationManager.getServiceStatus('blockfrost-api');

      // If circuit breaker is open, return degraded status
      if (this.circuitBreaker.isOpen()) {
        return {
          status: 'degraded',
          error: 'Circuit breaker is open',
          circuitBreaker: {
            state: circuitBreakerStats.state,
            failureCount: circuitBreakerStats.failureCount,
            successCount: circuitBreakerStats.successCount,
          },
          serviceStatus,
        };
      }

      // Try to get network information as a simple health check
      await this.withRetry(async () => {
        return await this.blockfrost.network();
      }, 'healthCheck');

      const latency = Date.now() - startTime;

      return {
        status: 'healthy',
        latency,
        circuitBreaker: {
          state: circuitBreakerStats.state,
          failureCount: circuitBreakerStats.failureCount,
          successCount: circuitBreakerStats.successCount,
        },
        serviceStatus,
      };
    } catch (error) {
      logger.error('Blockfrost health check failed:', error);
      const circuitBreakerStats = this.circuitBreaker.getStats();
      const serviceStatus = serviceDegradationManager.getServiceStatus('blockfrost-api');

      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        circuitBreaker: {
          state: circuitBreakerStats.state,
          failureCount: circuitBreakerStats.failureCount,
          successCount: circuitBreakerStats.successCount,
        },
        serviceStatus,
      };
    }
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus() {
    return this.circuitBreaker.getStats();
  }

  /**
   * Reset circuit breaker (for manual recovery)
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    serviceDegradationManager.resetService('blockfrost-api');
  }
}

// Create singleton instance
export const explorerService = new ExplorerService();
