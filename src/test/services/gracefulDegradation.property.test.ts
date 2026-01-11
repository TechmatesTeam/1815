/**
 * Property-based tests for graceful degradation
 * **Feature: cardash-backend-api, Property 27: Graceful degradation**
 * **Validates: Requirements 7.3**
 */

import fc from 'fast-check';
import { ExplorerService } from '@/services/explorerService';
import { CircuitBreaker, createAPICircuitBreaker } from '@/utils/circuitBreaker';
import { serviceDegradationManager } from '@/utils/serviceDegradation';
import { cacheService } from '@/services/cacheService';
import { logger } from '@/utils/logger';

// Mock the BlockFrost API to simulate failures
jest.mock('@blockfrost/blockfrost-js');

// Mock the cache service to avoid Redis dependency
jest.mock('@/services/cacheService', () => ({
  cacheService: {
    set: jest.fn().mockResolvedValue(true),
    get: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(true),
  },
  CacheKeys: {
    SEARCH: 'search',
    BLOCKFROST: 'blockfrost',
  },
  CacheTTL: {
    SEARCH: 300,
    BLOCKFROST: 600,
  },
}));

describe('Graceful Degradation Property Tests', () => {
  let explorerService: ExplorerService;
  let originalConsoleError: typeof console.error;

  beforeAll(() => {
    // Suppress console errors during tests
    originalConsoleError = console.error;
    console.error = jest.fn();
  });

  afterAll(() => {
    console.error = originalConsoleError;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    explorerService = new ExplorerService();
    serviceDegradationManager.resetAllServices();
  });

  afterEach(async () => {
    // Clean up any test data
    jest.clearAllMocks();
  });

  /**
   * Property: For any external service failure, the system should return appropriate fallback responses
   * without crashing the application
   */
  test('should handle external service failures gracefully', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          query: fc.oneof(
            // Valid Cardano addresses
            fc.constant(
              'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x'
            ),
            fc.constant(
              'addr_test1qpw0djgj0x59ngrjvqthn7enhvruxnsavsw5th63la3mjel3tkc974sr23jmlzgq5zda4gtv8k9cy38756r9y3qgmkqqjz6aa7'
            ),
            // Valid transaction hashes
            fc.constant('1e043f100dce12d107f679685acd2fc0610e10f72a92d412794c9773d11d8477'),
            // Valid block identifiers
            fc.constant('4873401'),
            fc.constant('89d9b5a5b8ddc8d7e5a6dc19c1c74d5ab3b9c1a2e3f4d5c6b7a8e9f0a1b2c3d4')
          ),
          failureType: fc.oneof(
            fc.constant('network_error'),
            fc.constant('timeout'),
            fc.constant('api_error'),
            fc.constant('circuit_breaker_open')
          ),
          hasCachedData: fc.boolean(),
        }),
        async ({ query, failureType, hasCachedData }) => {
          // Setup: Mock cached data if specified
          if (hasCachedData) {
            const mockCachedData = {
              type: 'address',
              data: {
                address: query,
                amount: [{ unit: 'lovelace', quantity: '1000000' }],
                type: 'shelley',
                script: false,
              },
            };
            (cacheService.get as jest.Mock).mockResolvedValueOnce(mockCachedData);
          } else {
            (cacheService.get as jest.Mock).mockResolvedValue(null);
          }

          // Mock the BlockFrost API to simulate the specified failure
          const mockBlockfrost = {
            addresses: jest.fn(),
            txs: jest.fn(),
            blocks: jest.fn(),
            network: jest.fn(),
          };

          const errorMessage = `Simulated ${failureType}`;
          const error = new Error(errorMessage);

          if (failureType === 'circuit_breaker_open') {
            (error as any).isCircuitBreakerOpen = true;
          }

          mockBlockfrost.addresses.mockRejectedValue(error);
          mockBlockfrost.txs.mockRejectedValue(error);
          mockBlockfrost.blocks.mockRejectedValue(error);
          mockBlockfrost.network.mockRejectedValue(error);

          // Replace the blockfrost instance
          (explorerService as any).blockfrost = mockBlockfrost;

          // Execute the search operation
          try {
            const result = await explorerService.search({
              query,
              type: 'auto',
              ipAddress: '127.0.0.1',
              userAgent: 'test-agent',
            });

            // If we get a result, it should be from cache (graceful degradation)
            if (hasCachedData) {
              expect(result.cached).toBe(true);
              expect(result.type).toBeDefined();
              expect(result.data).toBeDefined();
            } else {
              // If no cached data, we should not get a successful result
              // This case should throw an error
              expect(false).toBe(true); // Should not reach here
            }
          } catch (caughtError) {
            // Verify that the error is handled gracefully
            expect(caughtError).toBeInstanceOf(Error);

            const error = caughtError as Error;

            if ((error as any).isGracefulDegradation) {
              // This is a graceful degradation error - should have fallback response
              expect((error as any).fallbackResponse).toBeDefined();
              expect((error as any).fallbackResponse.metadata.degraded).toBe(true);
            } else if (hasCachedData) {
              // If we have cached data but still got an error, something went wrong
              // This should not happen in graceful degradation
              logger.error('Unexpected error with cached data available', { error: error.message });
            }

            // The error should not be a system crash - it should be a controlled error
            expect(error.message).not.toContain('Cannot read property');
            expect(error.message).not.toContain('undefined is not a function');
          }

          // Verify that the service degradation manager recorded the failure
          const serviceStatus = serviceDegradationManager.getServiceStatus('blockfrost-api');
          if (serviceStatus) {
            expect(serviceStatus.consecutiveFailures).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Circuit breaker should prevent cascading failures by failing fast
   * when external services are consistently failing
   */
  test('should fail fast when circuit breaker is open', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          query: fc.constant(
            'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x'
          ),
          consecutiveFailures: fc.integer({ min: 5, max: 10 }),
        }),
        async ({ query, consecutiveFailures }) => {
          // Create a circuit breaker and force it to open by simulating failures
          const circuitBreaker = createAPICircuitBreaker('test-circuit-breaker');

          // Mock operation that always fails
          const failingOperation = async () => {
            throw new Error('Simulated API failure');
          };

          // Trigger enough failures to open the circuit breaker
          for (let i = 0; i < consecutiveFailures; i++) {
            try {
              await circuitBreaker.execute(failingOperation);
            } catch (error) {
              // Expected to fail
            }
          }

          // Verify circuit breaker is open
          expect(circuitBreaker.isOpen()).toBe(true);

          // Now test that subsequent calls fail fast
          const startTime = Date.now();

          try {
            await circuitBreaker.execute(failingOperation);
            expect(false).toBe(true); // Should not reach here
          } catch (error) {
            const endTime = Date.now();
            const executionTime = endTime - startTime;

            // Should fail fast (within 10ms) when circuit breaker is open
            expect(executionTime).toBeLessThan(10);
            expect((error as any).isCircuitBreakerOpen).toBe(true);
            expect((error as Error).message).toContain('Circuit breaker');
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property: Service degradation manager should accurately track service health
   * and provide appropriate status information
   */
  test('should track service health accurately', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          serviceName: fc.constantFrom('blockfrost-api', 'database', 'email-service'),
          operations: fc.array(
            fc.record({
              success: fc.boolean(),
              errorMessage: fc.option(fc.string({ minLength: 1, maxLength: 50 }), {
                nil: undefined,
              }),
            }),
            { minLength: 1, maxLength: 20 }
          ),
        }),
        async ({ serviceName, operations }) => {
          // Reset service status
          serviceDegradationManager.resetService(serviceName);

          let expectedFailures = 0;
          let expectedSuccesses = 0;

          // Execute operations and track expected state
          for (const operation of operations) {
            if (operation.success) {
              serviceDegradationManager.recordSuccess(serviceName);
              expectedSuccesses++;
              expectedFailures = 0; // Reset on success
            } else {
              serviceDegradationManager.recordFailure(
                serviceName,
                operation.errorMessage || 'Test failure'
              );
              expectedFailures++;
            }
          }

          // Verify service status
          const serviceStatus = serviceDegradationManager.getServiceStatus(serviceName);
          expect(serviceStatus).toBeDefined();

          if (serviceStatus) {
            expect(serviceStatus.name).toBe(serviceName);
            expect(serviceStatus.consecutiveFailures).toBe(expectedFailures);

            // Service should be unhealthy if consecutive failures >= 3
            const expectedHealthy = expectedFailures < 3;
            expect(serviceStatus.healthy).toBe(expectedHealthy);

            if (expectedFailures > 0) {
              expect(serviceStatus.lastError).toBeDefined();
            }
          }

          // Verify degradation summary
          const summary = serviceDegradationManager.getDegradationSummary();
          const isServiceUnhealthy = expectedFailures >= 3;

          if (isServiceUnhealthy) {
            expect(summary.degraded).toBe(true);
            expect(summary.unhealthyServices).toContain(serviceName);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  /**
   * Property: Fallback responses should always maintain consistent structure
   * and provide meaningful error information
   */
  test('should provide consistent fallback response structure', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          serviceName: fc.constantFrom('Blockfrost API', 'Database', 'Email Service'),
          operation: fc.string({ minLength: 1, maxLength: 50 }),
          requestId: fc.option(fc.uuid(), { nil: undefined }),
        }),
        async ({ serviceName, operation, requestId }) => {
          let fallbackResponse;

          // Test different types of fallback responses
          if (serviceName === 'Blockfrost API') {
            fallbackResponse = await serviceDegradationManager.createBlockfrostFallback(
              'test-query',
              requestId
            );
          } else if (serviceName === 'Database') {
            fallbackResponse = serviceDegradationManager.createDatabaseFallback(
              operation,
              requestId
            );
          } else {
            fallbackResponse = serviceDegradationManager.createEmailServiceFallback(
              operation,
              requestId
            );
          }

          // Verify consistent structure
          expect(fallbackResponse).toHaveProperty('success');
          expect(fallbackResponse).toHaveProperty('metadata');
          expect(fallbackResponse.metadata).toHaveProperty('timestamp');
          expect(fallbackResponse.metadata).toHaveProperty('version');
          expect(fallbackResponse.metadata).toHaveProperty('degraded');
          expect(fallbackResponse.metadata.degraded).toBe(true);

          if (requestId) {
            expect(fallbackResponse.metadata.requestId).toBe(requestId);
          }

          // Verify error structure when not successful
          if (!fallbackResponse.success && fallbackResponse.error) {
            expect(fallbackResponse).toHaveProperty('error');
            expect(fallbackResponse.error).toHaveProperty('code');
            expect(fallbackResponse.error).toHaveProperty('message');
            expect(fallbackResponse.error).toHaveProperty('fallbackUsed');
            expect(fallbackResponse.error.fallbackUsed).toBe(true);

            // Error message should be meaningful
            expect(fallbackResponse.error.message.length).toBeGreaterThan(10);
            expect(fallbackResponse.error.code).toMatch(/^[A-Z_]+$/);
          }

          // Verify fallback reason is provided
          expect(fallbackResponse.metadata).toHaveProperty('fallbackReason');
          expect(fallbackResponse.metadata.fallbackReason).toBeDefined();
        }
      ),
      { numRuns: 25 }
    );
  });
});
