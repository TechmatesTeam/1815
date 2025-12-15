import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fc from 'fast-check';
import { Request, Response, NextFunction } from 'express';
import { errorHandler, createError, AppError } from '../../middlewares/errorHandler';

/**
 * **Feature: cardash-backend-api, Property 25: Standardized error responses**
 * **Validates: Requirements 7.1, 7.4**
 *
 * For any error condition, the response should follow a consistent JSON structure
 * with appropriate HTTP status codes and include required metadata
 */

describe('Error Handler Property Tests', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let statusSpy: jest.Mock;
  let jsonSpy: jest.Mock;

  beforeEach(() => {
    statusSpy = jest.fn().mockReturnThis();
    jsonSpy = jest.fn().mockReturnThis();

    mockRequest = {
      url: '/test',
      method: 'GET',
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('test-user-agent'),
    };

    mockResponse = {
      status: statusSpy,
      json: jsonSpy,
      locals: {
        requestId: 'test-request-id',
      },
    };

    mockNext = jest.fn();
  });

  describe('Property 25: Standardized error responses', () => {
    it('should always return consistent error response structure for any error', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            message: fc.string({ minLength: 1, maxLength: 200 }),
            statusCode: fc.integer({ min: 400, max: 599 }),
            code: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
            name: fc.option(
              fc.constantFrom(
                'ValidationError',
                'CastError',
                'MongoError',
                'JsonWebTokenError',
                'TokenExpiredError',
                'Error'
              ),
              { nil: undefined }
            ),
          }),
          async errorData => {
            // Create error with random properties
            const error = new Error(errorData.message) as AppError;
            error.statusCode = errorData.statusCode;
            if (errorData.code) error.code = errorData.code;
            if (errorData.name) error.name = errorData.name;

            // Special case for MongoError
            if (errorData.name === 'MongoError') {
              (error as any).code = 11000; // Duplicate key error
            }

            // Call error handler
            errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

            // Verify status was called with a valid HTTP error code
            expect(statusSpy).toHaveBeenCalledWith(expect.any(Number));
            const statusCode = statusSpy.mock.calls[0][0];
            expect(statusCode).toBeGreaterThanOrEqual(400);
            expect(statusCode).toBeLessThanOrEqual(599);

            // Verify JSON response was called
            expect(jsonSpy).toHaveBeenCalledTimes(1);
            const responseBody = jsonSpy.mock.calls[0][0];

            // Verify standardized response structure
            expect(responseBody).toHaveProperty('success');
            expect(responseBody.success).toBe(false);

            expect(responseBody).toHaveProperty('error');
            expect(responseBody.error).toHaveProperty('code');
            expect(responseBody.error).toHaveProperty('message');

            expect(responseBody).toHaveProperty('metadata');
            expect(responseBody.metadata).toHaveProperty('timestamp');
            expect(responseBody.metadata).toHaveProperty('requestId');
            expect(responseBody.metadata).toHaveProperty('version');

            // Verify error code is a non-empty string
            expect(typeof responseBody.error.code).toBe('string');
            expect(responseBody.error.code.length).toBeGreaterThan(0);

            // Verify error message is a non-empty string
            expect(typeof responseBody.error.message).toBe('string');
            expect(responseBody.error.message.length).toBeGreaterThan(0);

            // Verify timestamp is a valid ISO string
            expect(() => new Date(responseBody.metadata.timestamp)).not.toThrow();
            const timestamp = new Date(responseBody.metadata.timestamp);
            expect(timestamp.getTime()).toBeGreaterThan(0);

            // Verify requestId is present and non-empty
            expect(typeof responseBody.metadata.requestId).toBe('string');
            expect(responseBody.metadata.requestId.length).toBeGreaterThan(0);

            // Verify version is present
            expect(typeof responseBody.metadata.version).toBe('string');

            // Reset mocks for next iteration
            statusSpy.mockClear();
            jsonSpy.mockClear();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should map specific error types to appropriate HTTP status codes consistently', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            message: fc.string({ minLength: 1, maxLength: 100 }),
            errorType: fc.constantFrom(
              'ValidationError',
              'CastError',
              'MongoError',
              'JsonWebTokenError',
              'TokenExpiredError',
              'Generic'
            ),
          }),
          async errorData => {
            const error = new Error(errorData.message) as AppError;

            // Set error properties based on type
            switch (errorData.errorType) {
              case 'ValidationError':
                error.name = 'ValidationError';
                break;
              case 'CastError':
                error.name = 'CastError';
                break;
              case 'MongoError':
                error.name = 'MongoError';
                (error as any).code = 11000;
                break;
              case 'JsonWebTokenError':
                error.name = 'JsonWebTokenError';
                break;
              case 'TokenExpiredError':
                error.name = 'TokenExpiredError';
                break;
              case 'Generic':
                // Keep default Error name
                break;
            }

            errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

            const statusCode = statusSpy.mock.calls[0][0];
            const responseBody = jsonSpy.mock.calls[0][0];

            // Verify status code mapping is consistent
            switch (errorData.errorType) {
              case 'ValidationError':
                expect(statusCode).toBe(400);
                expect(responseBody.error.code).toBe('VALIDATION_ERROR');
                break;
              case 'CastError':
                expect(statusCode).toBe(400);
                expect(responseBody.error.code).toBe('INVALID_ID');
                break;
              case 'MongoError':
                expect(statusCode).toBe(409);
                expect(responseBody.error.code).toBe('DUPLICATE_RESOURCE');
                break;
              case 'JsonWebTokenError':
                expect(statusCode).toBe(401);
                expect(responseBody.error.code).toBe('INVALID_TOKEN');
                break;
              case 'TokenExpiredError':
                expect(statusCode).toBe(401);
                expect(responseBody.error.code).toBe('TOKEN_EXPIRED');
                break;
              case 'Generic':
                expect(statusCode).toBe(500);
                expect(responseBody.error.code).toBe('INTERNAL_SERVER_ERROR');
                break;
            }

            // Reset mocks for next iteration
            statusSpy.mockClear();
            jsonSpy.mockClear();
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should include request metadata consistently across all error responses', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            url: fc.webUrl(),
            method: fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'PATCH'),
            ip: fc.ipV4(),
            userAgent: fc.string({ minLength: 10, maxLength: 200 }),
            requestId: fc.string({ minLength: 10, maxLength: 50 }),
          }),
          async requestData => {
            // Update mock request with random data
            mockRequest = {
              ...mockRequest,
              url: requestData.url,
              method: requestData.method,
              ip: requestData.ip,
              get: jest.fn().mockReturnValue(requestData.userAgent),
            };
            mockResponse.locals!.requestId = requestData.requestId;

            const error = new Error('Test error');
            errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

            const responseBody = jsonSpy.mock.calls[0][0];

            // Verify metadata includes request ID
            expect(responseBody.metadata.requestId).toBe(requestData.requestId);

            // Verify timestamp is recent (within last 5 seconds)
            const timestamp = new Date(responseBody.metadata.timestamp);
            const now = new Date();
            const timeDiff = now.getTime() - timestamp.getTime();
            expect(timeDiff).toBeLessThan(5000);
            expect(timeDiff).toBeGreaterThanOrEqual(0);

            // Verify version is present
            expect(responseBody.metadata.version).toBeDefined();
            expect(typeof responseBody.metadata.version).toBe('string');

            // Reset mocks for next iteration
            statusSpy.mockClear();
            jsonSpy.mockClear();
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should handle custom errors with specified status codes and error codes', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            message: fc.string({ minLength: 1, maxLength: 100 }),
            statusCode: fc.integer({ min: 400, max: 599 }),
            errorCode: fc.string({ minLength: 1, maxLength: 30 }),
          }),
          async errorData => {
            const error = createError(errorData.message, errorData.statusCode, errorData.errorCode);

            errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

            const statusCode = statusSpy.mock.calls[0][0];
            const responseBody = jsonSpy.mock.calls[0][0];

            // Verify custom status code is preserved
            expect(statusCode).toBe(errorData.statusCode);

            // Verify custom error code is preserved
            expect(responseBody.error.code).toBe(errorData.errorCode);

            // Verify custom message is preserved
            expect(responseBody.error.message).toBe(errorData.message);

            // Verify structure is still standardized
            expect(responseBody.success).toBe(false);
            expect(responseBody).toHaveProperty('metadata');
            expect(responseBody.metadata).toHaveProperty('timestamp');
            expect(responseBody.metadata).toHaveProperty('requestId');
            expect(responseBody.metadata).toHaveProperty('version');

            // Reset mocks for next iteration
            statusSpy.mockClear();
            jsonSpy.mockClear();
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should never expose internal error details in production environment', async () => {
      const originalEnv = process.env.NODE_ENV;

      await fc.assert(
        fc.asyncProperty(
          fc.record({
            message: fc.string({ minLength: 1, maxLength: 100 }),
            isProduction: fc.boolean(),
            hasStack: fc.boolean(),
          }),
          async testData => {
            // Set environment
            process.env.NODE_ENV = testData.isProduction ? 'production' : 'development';

            const error = new Error(testData.message) as AppError;
            error.statusCode = 500; // Internal server error
            if (testData.hasStack) {
              error.stack = 'Error: Test\n    at test.js:1:1';
            }

            errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

            const responseBody = jsonSpy.mock.calls[0][0];

            if (testData.isProduction) {
              // In production, should not expose original error message for 500 errors
              expect(responseBody.error.message).toBe('Internal server error');
              // Should not include stack trace details
              expect(responseBody.error.details).toBeUndefined();
            } else {
              // In development, can show original message
              expect(responseBody.error.message).toBe(testData.message);
              // May include stack trace in development
              if (testData.hasStack) {
                expect(responseBody.error.details).toBeDefined();
              }
            }

            // Structure should be consistent regardless of environment
            expect(responseBody.success).toBe(false);
            expect(responseBody).toHaveProperty('error');
            expect(responseBody).toHaveProperty('metadata');

            // Reset mocks for next iteration
            statusSpy.mockClear();
            jsonSpy.mockClear();
          }
        ),
        { numRuns: 40 }
      );

      // Restore original environment
      process.env.NODE_ENV = originalEnv;
    });
  });
});
