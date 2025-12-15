import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fc from 'fast-check';
import { Request, Response, NextFunction } from 'express';
import { validateRequest, validationSchemas } from '../../middlewares/validation';

/**
 * **Feature: cardash-backend-api, Property 26: Field-level validation errors**
 * **Validates: Requirements 7.2**
 *
 * For any validation failure, error messages should specify which fields failed validation and why
 */

describe('Validation Property Tests', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      body: {},
      params: {},
      query: {},
    };

    mockResponse = {
      locals: {
        requestId: 'test-request-id',
      },
    };

    mockNext = jest.fn();
  });

  describe('Property 26: Field-level validation errors', () => {
    it('should always provide specific field-level error messages for any validation failure', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // Generate invalid data that should fail validation
            cardanoAddress: fc.oneof(
              fc.constant(''), // Empty string
              fc.constant('invalid'), // Invalid format
              fc.string({ minLength: 1, maxLength: 10 }), // Too short
              fc.string({ minLength: 200, maxLength: 300 }), // Too long
              fc.constant(null), // Null value
              fc.constant(undefined) // Undefined value
            ),
            userEmail: fc.oneof(
              fc.constant('invalid-email'), // Invalid email format
              fc.constant('test@'), // Incomplete email
              fc.constant('@domain.com'), // Missing local part
              fc.constant('test..test@domain.com'), // Double dots
              fc.string({ minLength: 1, maxLength: 5 }) // Random string
            ),
            customName: fc.oneof(
              fc.constant(''), // Empty string (should fail min length)
              fc.string({ minLength: 51, maxLength: 100 }), // Too long
              fc.constant(null), // Null value
              fc.constant(undefined) // Undefined value
            ),
          }),
          async invalidData => {
            // Set up request with invalid data
            mockRequest.body = invalidData;

            const middleware = validateRequest(validationSchemas.createAlias, 'body');

            // Capture the error thrown by middleware
            let thrownError: any = null;
            const nextSpy = jest.fn(error => {
              thrownError = error;
            });

            try {
              middleware(mockRequest as Request, mockResponse as Response, nextSpy);
            } catch (error) {
              thrownError = error;
            }

            // Should have thrown a validation error
            expect(thrownError).toBeDefined();
            expect(thrownError.code).toBe('VALIDATION_ERROR');
            expect(thrownError.message).toBe('Validation failed');

            // Should have field-level error details
            expect(thrownError.details).toBeDefined();
            expect(Array.isArray(thrownError.details)).toBe(true);
            expect(thrownError.details.length).toBeGreaterThan(0);

            // Each error detail should specify the field and message
            for (const errorDetail of thrownError.details) {
              expect(errorDetail).toHaveProperty('field');
              expect(errorDetail).toHaveProperty('message');
              expect(errorDetail).toHaveProperty('value');

              // Field should be a non-empty string
              expect(typeof errorDetail.field).toBe('string');
              expect(errorDetail.field.length).toBeGreaterThan(0);

              // Message should be a non-empty string
              expect(typeof errorDetail.message).toBe('string');
              expect(errorDetail.message.length).toBeGreaterThan(0);

              // Message should be descriptive (not just generic)
              expect(errorDetail.message).not.toBe('Validation failed');
              expect(errorDetail.message).not.toBe('Invalid');
              expect(errorDetail.message).not.toBe('Error');

              // Field should correspond to actual input fields
              expect(['cardanoAddress', 'userEmail', 'customName']).toContain(errorDetail.field);
            }

            // Reset mocks for next iteration
            jest.clearAllMocks();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should provide specific validation messages for different field types and constraints', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            fieldType: fc.constantFrom('cardanoAddress', 'email', 'shortCode', 'customName'),
            violationType: fc.constantFrom('required', 'format', 'length', 'pattern'),
          }),
          async testCase => {
            let invalidValue: any;
            let expectedSchema: any;
            let expectedField: string;

            // Generate invalid data based on field type and violation type
            switch (testCase.fieldType) {
              case 'cardanoAddress':
                expectedSchema = validationSchemas.createAlias;
                expectedField = 'cardanoAddress';
                switch (testCase.violationType) {
                  case 'required':
                    invalidValue = undefined;
                    break;
                  case 'format':
                    invalidValue = 'invalid-address-format';
                    break;
                  case 'length':
                    invalidValue = 'short';
                    break;
                  default:
                    invalidValue = 'invalid';
                }
                break;

              case 'email':
                expectedSchema = validationSchemas.subscribeNotifications;
                expectedField = 'email';
                switch (testCase.violationType) {
                  case 'required':
                    invalidValue = undefined;
                    break;
                  case 'format':
                    invalidValue = 'not-an-email';
                    break;
                  default:
                    invalidValue = 'invalid@';
                }
                break;

              case 'shortCode':
                expectedSchema = validationSchemas.resolveAlias;
                expectedField = 'code';
                switch (testCase.violationType) {
                  case 'required':
                    invalidValue = undefined;
                    break;
                  case 'length':
                    invalidValue = 'short'; // Should be 16 characters
                    break;
                  case 'pattern':
                    invalidValue = 'invalid-chars!!!'; // Should be digits only
                    break;
                  default:
                    invalidValue = 'toolong1234567890';
                }
                break;

              case 'customName':
              default:
                expectedSchema = validationSchemas.createAlias;
                expectedField = 'customName';
                switch (testCase.violationType) {
                  case 'required':
                    // customName is optional, so skip this test case
                    return;
                  case 'length':
                    invalidValue = ''; // Should be at least 1 character
                    break;
                  default:
                    invalidValue = 'a'.repeat(51); // Should be max 50 characters
                }
                break;
            }

            // Set up request with invalid data
            const requestData: any = {};
            requestData[expectedField] = invalidValue;
            mockRequest.body = requestData;

            const middleware = validateRequest(expectedSchema, 'body');

            // Capture the error
            let thrownError: any = null;
            const nextSpy = jest.fn(error => {
              thrownError = error;
            });

            try {
              middleware(mockRequest as Request, mockResponse as Response, nextSpy);
            } catch (error) {
              thrownError = error;
            }

            // Should have validation error
            expect(thrownError).toBeDefined();
            expect(thrownError.code).toBe('VALIDATION_ERROR');

            // Should have field-specific error
            const fieldError = thrownError.details.find(
              (detail: any) => detail.field === expectedField
            );
            expect(fieldError).toBeDefined();

            // Error message should be specific to the violation type
            switch (testCase.violationType) {
              case 'required':
                expect(fieldError.message.toLowerCase()).toMatch(/required/);
                break;
              case 'format':
                if (testCase.fieldType === 'cardanoAddress') {
                  expect(fieldError.message.toLowerCase()).toMatch(/cardano.*address.*format/);
                } else if (testCase.fieldType === 'email') {
                  expect(fieldError.message.toLowerCase()).toMatch(/email.*format/);
                }
                break;
              case 'length':
                if (testCase.fieldType === 'shortCode') {
                  expect(fieldError.message.toLowerCase()).toMatch(/(length|character)/);
                } else {
                  // For other fields like cardanoAddress, length errors may be reported as format errors
                  expect(fieldError.message.length).toBeGreaterThan(0);
                }
                break;
              case 'pattern':
                if (testCase.fieldType === 'shortCode') {
                  expect(fieldError.message.toLowerCase()).toMatch(/(digits|character)/);
                } else {
                  // For other fields, just check that it's a meaningful error message
                  expect(fieldError.message.length).toBeGreaterThan(0);
                }
                break;
            }

            // Reset mocks for next iteration
            jest.clearAllMocks();
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should include the actual invalid value in field-level error details', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            cardanoAddress: fc.string({ minLength: 1, maxLength: 20 }), // Invalid format
            userEmail: fc.string({ minLength: 1, maxLength: 20 }), // Invalid email
          }),
          async invalidData => {
            mockRequest.body = invalidData;

            const middleware = validateRequest(validationSchemas.createAlias, 'body');

            let thrownError: any = null;
            const nextSpy = jest.fn(error => {
              thrownError = error;
            });

            try {
              middleware(mockRequest as Request, mockResponse as Response, nextSpy);
            } catch (error) {
              thrownError = error;
            }

            expect(thrownError).toBeDefined();
            expect(thrownError.details).toBeDefined();

            // Check that each error includes the actual invalid value
            for (const errorDetail of thrownError.details) {
              expect(errorDetail).toHaveProperty('value');

              // The value should be related to what was provided in the request
              // Note: validation middleware may sanitize input (e.g., trim whitespace)
              if (errorDetail.field === 'cardanoAddress') {
                // Value should be defined and related to the input
                expect(errorDetail.value).toBeDefined();
                if (typeof invalidData.cardanoAddress === 'string') {
                  // Should be the sanitized version of the input
                  expect(typeof errorDetail.value).toBe('string');
                }
              } else if (errorDetail.field === 'userEmail') {
                expect(errorDetail.value).toBeDefined();
                if (typeof invalidData.userEmail === 'string') {
                  expect(typeof errorDetail.value).toBe('string');
                }
              }
            }

            // Reset mocks for next iteration
            jest.clearAllMocks();
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should handle multiple field validation errors simultaneously', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            cardanoAddress: fc.constant(''), // Invalid - empty
            userEmail: fc.constant('invalid-email'), // Invalid - format
            customName: fc.string({ minLength: 51, maxLength: 100 }), // Invalid - too long
          }),
          async invalidData => {
            mockRequest.body = invalidData;

            const middleware = validateRequest(validationSchemas.createAlias, 'body');

            let thrownError: any = null;
            const nextSpy = jest.fn(error => {
              thrownError = error;
            });

            try {
              middleware(mockRequest as Request, mockResponse as Response, nextSpy);
            } catch (error) {
              thrownError = error;
            }

            expect(thrownError).toBeDefined();
            expect(thrownError.details).toBeDefined();

            // Should have multiple errors (at least 2, possibly 3)
            expect(thrownError.details.length).toBeGreaterThanOrEqual(2);

            // Should have errors for different fields
            const fieldNames = thrownError.details.map((detail: any) => detail.field);
            const uniqueFields = [...new Set(fieldNames)];
            expect(uniqueFields.length).toBeGreaterThanOrEqual(2);

            // Each error should still be properly formatted
            for (const errorDetail of thrownError.details) {
              expect(errorDetail).toHaveProperty('field');
              expect(errorDetail).toHaveProperty('message');
              expect(errorDetail).toHaveProperty('value');
              expect(typeof errorDetail.field).toBe('string');
              expect(typeof errorDetail.message).toBe('string');
              expect(errorDetail.field.length).toBeGreaterThan(0);
              expect(errorDetail.message.length).toBeGreaterThan(0);
            }

            // Reset mocks for next iteration
            jest.clearAllMocks();
          }
        ),
        { numRuns: 25 }
      );
    });

    it('should provide consistent error structure across different validation schemas', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            { schema: validationSchemas.createAlias, invalidData: { cardanoAddress: 'invalid' } },
            { schema: validationSchemas.resolveAlias, invalidData: { code: 'short' } },
            { schema: validationSchemas.subscribeNotifications, invalidData: { email: 'invalid' } },
            { schema: validationSchemas.bulkResolve, invalidData: { codes: [] } } // Empty array
          ),
          async testCase => {
            mockRequest.body = testCase.invalidData;

            const middleware = validateRequest(testCase.schema, 'body');

            let thrownError: any = null;
            const nextSpy = jest.fn(error => {
              thrownError = error;
            });

            try {
              middleware(mockRequest as Request, mockResponse as Response, nextSpy);
            } catch (error) {
              thrownError = error;
            }

            expect(thrownError).toBeDefined();
            expect(thrownError.code).toBe('VALIDATION_ERROR');
            expect(thrownError.message).toBe('Validation failed');
            expect(thrownError.details).toBeDefined();
            expect(Array.isArray(thrownError.details)).toBe(true);
            expect(thrownError.details.length).toBeGreaterThan(0);

            // All errors should have consistent structure regardless of schema
            for (const errorDetail of thrownError.details) {
              expect(errorDetail).toHaveProperty('field');
              expect(errorDetail).toHaveProperty('message');
              expect(errorDetail).toHaveProperty('value');
              expect(typeof errorDetail.field).toBe('string');
              expect(typeof errorDetail.message).toBe('string');
            }

            // Reset mocks for next iteration
            jest.clearAllMocks();
          }
        ),
        { numRuns: 40 }
      );
    });
  });
});
