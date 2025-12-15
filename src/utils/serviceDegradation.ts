import { logger } from './logger';
import { cacheService, CacheKeys } from '@/services/cacheService';

export interface FallbackResponse {
  success: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
    fallbackUsed: boolean;
  };
  metadata: {
    timestamp: string;
    requestId?: string;
    version: string;
    degraded: boolean;
    fallbackReason?: string;
  };
}

export interface ServiceStatus {
  name: string;
  healthy: boolean;
  lastCheck: number;
  consecutiveFailures: number;
  lastError?: string;
}

export class ServiceDegradationManager {
  private serviceStatuses: Map<string, ServiceStatus> = new Map();
  private readonly maxConsecutiveFailures = 3;
  private readonly healthCheckInterval = 30000; // 30 seconds

  /**
   * Record a service failure
   */
  recordFailure(serviceName: string, error: string): void {
    const status = this.serviceStatuses.get(serviceName) || {
      name: serviceName,
      healthy: true,
      lastCheck: Date.now(),
      consecutiveFailures: 0,
    };

    status.consecutiveFailures++;
    status.lastError = error;
    status.lastCheck = Date.now();
    status.healthy = status.consecutiveFailures < this.maxConsecutiveFailures;

    this.serviceStatuses.set(serviceName, status);

    if (!status.healthy) {
      logger.warn(`Service ${serviceName} marked as unhealthy`, {
        consecutiveFailures: status.consecutiveFailures,
        lastError: error,
      });
    }
  }

  /**
   * Record a service success
   */
  recordSuccess(serviceName: string): void {
    const status = this.serviceStatuses.get(serviceName) || {
      name: serviceName,
      healthy: true,
      lastCheck: Date.now(),
      consecutiveFailures: 0,
    };

    const wasUnhealthy = !status.healthy;
    status.consecutiveFailures = 0;
    status.lastCheck = Date.now();
    status.healthy = true;
    status.lastError = undefined;

    this.serviceStatuses.set(serviceName, status);

    if (wasUnhealthy) {
      logger.info(`Service ${serviceName} recovered and marked as healthy`);
    }
  }

  /**
   * Check if a service is healthy
   */
  isServiceHealthy(serviceName: string): boolean {
    const status = this.serviceStatuses.get(serviceName);
    return status ? status.healthy : true; // Assume healthy if not tracked
  }

  /**
   * Get service status
   */
  getServiceStatus(serviceName: string): ServiceStatus | undefined {
    return this.serviceStatuses.get(serviceName);
  }

  /**
   * Get all service statuses
   */
  getAllServiceStatuses(): ServiceStatus[] {
    return Array.from(this.serviceStatuses.values());
  }

  /**
   * Create a fallback response for Blockfrost API failures
   */
  async createBlockfrostFallback(query: string, requestId?: string): Promise<FallbackResponse> {
    // Try to get cached data as fallback
    const cacheKey = `search:${query}`;
    const cachedResult = await cacheService.get<{
      type: string;
      data: any;
    }>(cacheKey, { prefix: CacheKeys.SEARCH });

    if (cachedResult) {
      logger.info(`Using cached fallback data for Blockfrost failure: ${query}`);
      return {
        success: true,
        data: {
          type: cachedResult.type,
          data: cachedResult.data,
          cached: true,
          responseTime: 0,
          fallback: true,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId,
          version: process.env.npm_package_version || '1.0.0',
          degraded: true,
          fallbackReason: 'Blockfrost API unavailable, serving cached data',
        },
      };
    }

    // No cached data available
    return {
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Blockchain data service is temporarily unavailable. Please try again later.',
        fallbackUsed: true,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId,
        version: process.env.npm_package_version || '1.0.0',
        degraded: true,
        fallbackReason: 'Blockfrost API unavailable, no cached data available',
      },
    };
  }

  /**
   * Create a fallback response for database failures
   */
  createDatabaseFallback(operation: string, requestId?: string): FallbackResponse {
    return {
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database service is temporarily unavailable. Please try again later.',
        fallbackUsed: true,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId,
        version: process.env.npm_package_version || '1.0.0',
        degraded: true,
        fallbackReason: `Database unavailable for operation: ${operation}`,
      },
    };
  }

  /**
   * Create a fallback response for email service failures
   */
  createEmailServiceFallback(operation: string, requestId?: string): FallbackResponse {
    return {
      success: false,
      error: {
        code: 'EMAIL_SERVICE_UNAVAILABLE',
        message:
          'Email service is temporarily unavailable. Your request has been queued for retry.',
        fallbackUsed: true,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId,
        version: process.env.npm_package_version || '1.0.0',
        degraded: true,
        fallbackReason: `Email service unavailable for operation: ${operation}`,
      },
    };
  }

  /**
   * Create a generic service unavailable fallback
   */
  createGenericFallback(
    serviceName: string,
    operation: string,
    requestId?: string
  ): FallbackResponse {
    return {
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: `${serviceName} is temporarily unavailable. Please try again later.`,
        fallbackUsed: true,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId,
        version: process.env.npm_package_version || '1.0.0',
        degraded: true,
        fallbackReason: `${serviceName} unavailable for operation: ${operation}`,
      },
    };
  }

  /**
   * Check if system is in degraded mode
   */
  isSystemDegraded(): boolean {
    const unhealthyServices = Array.from(this.serviceStatuses.values()).filter(
      status => !status.healthy
    );
    return unhealthyServices.length > 0;
  }

  /**
   * Get degradation summary
   */
  getDegradationSummary(): {
    degraded: boolean;
    unhealthyServices: string[];
    totalServices: number;
    healthyServices: number;
  } {
    const allServices = Array.from(this.serviceStatuses.values());
    const unhealthyServices = allServices.filter(status => !status.healthy);

    return {
      degraded: unhealthyServices.length > 0,
      unhealthyServices: unhealthyServices.map(s => s.name),
      totalServices: allServices.length,
      healthyServices: allServices.length - unhealthyServices.length,
    };
  }

  /**
   * Reset all service statuses (for testing or manual recovery)
   */
  resetAllServices(): void {
    this.serviceStatuses.clear();
    logger.info('All service statuses reset');
  }

  /**
   * Reset specific service status
   */
  resetService(serviceName: string): void {
    this.serviceStatuses.delete(serviceName);
    logger.info(`Service status reset: ${serviceName}`);
  }
}

// Create singleton instance
export const serviceDegradationManager = new ServiceDegradationManager();
