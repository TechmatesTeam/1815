import { logger } from './logger';

export interface CircuitBreakerOptions {
  failureThreshold: number; // Number of failures before opening circuit
  resetTimeout: number; // Time in ms before attempting to close circuit
  monitoringPeriod: number; // Time window in ms for failure counting
  name: string; // Circuit breaker name for logging
}

export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Circuit is open, failing fast
  HALF_OPEN = 'HALF_OPEN', // Testing if service is back
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  nextAttemptTime?: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime?: number;
  private lastSuccessTime?: number;
  private nextAttemptTime?: number;
  private readonly options: CircuitBreakerOptions;

  constructor(options: CircuitBreakerOptions) {
    this.options = options;
    logger.info(`Circuit breaker initialized: ${options.name}`, {
      failureThreshold: options.failureThreshold,
      resetTimeout: options.resetTimeout,
      monitoringPeriod: options.monitoringPeriod,
    });
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
        logger.info(`Circuit breaker ${this.options.name} transitioning to HALF_OPEN`);
      } else {
        const error = new Error(`Circuit breaker ${this.options.name} is OPEN`);
        (error as any).isCircuitBreakerOpen = true;
        throw error;
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.successCount++;
    this.lastSuccessTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
      this.failureCount = 0;
      logger.info(`Circuit breaker ${this.options.name} closed after successful test`);
    }

    // Reset failure count if we're in monitoring period and have success
    if (this.isInMonitoringPeriod()) {
      this.failureCount = 0;
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.options.resetTimeout;
      logger.warn(`Circuit breaker ${this.options.name} opened after failed test`);
    } else if (
      this.state === CircuitState.CLOSED &&
      this.failureCount >= this.options.failureThreshold
    ) {
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.options.resetTimeout;
      logger.warn(`Circuit breaker ${this.options.name} opened due to failure threshold`, {
        failureCount: this.failureCount,
        threshold: this.options.failureThreshold,
      });
    }
  }

  /**
   * Check if we should attempt to reset the circuit breaker
   */
  private shouldAttemptReset(): boolean {
    return this.nextAttemptTime !== undefined && Date.now() >= this.nextAttemptTime;
  }

  /**
   * Check if we're within the monitoring period for failure counting
   */
  private isInMonitoringPeriod(): boolean {
    if (!this.lastFailureTime) {
      return false;
    }
    return Date.now() - this.lastFailureTime <= this.options.monitoringPeriod;
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttemptTime: this.nextAttemptTime,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
    this.nextAttemptTime = undefined;
    logger.info(`Circuit breaker ${this.options.name} manually reset`);
  }

  /**
   * Check if circuit breaker is open
   */
  isOpen(): boolean {
    return this.state === CircuitState.OPEN;
  }

  /**
   * Check if circuit breaker is closed
   */
  isClosed(): boolean {
    return this.state === CircuitState.CLOSED;
  }

  /**
   * Check if circuit breaker is half-open
   */
  isHalfOpen(): boolean {
    return this.state === CircuitState.HALF_OPEN;
  }
}

/**
 * Create a circuit breaker with default options for external APIs
 */
export function createAPICircuitBreaker(name: string): CircuitBreaker {
  return new CircuitBreaker({
    name,
    failureThreshold: 5, // Open after 5 failures
    resetTimeout: 60000, // Try again after 1 minute
    monitoringPeriod: 120000, // 2 minute monitoring window
  });
}

/**
 * Create a circuit breaker with default options for database operations
 */
export function createDatabaseCircuitBreaker(name: string): CircuitBreaker {
  return new CircuitBreaker({
    name,
    failureThreshold: 3, // Open after 3 failures
    resetTimeout: 30000, // Try again after 30 seconds
    monitoringPeriod: 60000, // 1 minute monitoring window
  });
}
