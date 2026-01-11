import { Request, Response, NextFunction } from 'express';
import fc from 'fast-check';
import { validateRequest, validationSchemas, securityValidation } from '@/middlewares/validation';

// Mock Express objects
const createMockRequest = (
  data: any,
  source: 'body' | 'params' | 'query' = 'body'
): Partial<Request> => {
  const req: Partial<Request> = {
    body: {},
    params: {},
    query: {},
    url: '/test',
    method: 'POST',
    ip: '127.0.0.1',
    get: jest.fn().mockReturnValue('test-agent'),
  };

  req[source] = data;
  return req;
};

const createMockResponse = (): Partial<Response> => ({
  locals: { requestId: 'test-request-id' },
  set: jest.fn(),
});

const createMockNext = (): jest.MockedFunction<NextFunction> => jest.fn();

describe('Input Validation Middleware', () => {
  describe('Property Tests', () => {
    /**
     * **Feature: cardash-backend-api, Property 20: Input validation consistency**
     * For any API endpoint, invalid input data should be rejected with validation errors according to defined schemas
     * **Validates: Requirements 6.1**
     */
    test('Property 20: Input validation consistency - invalid inputs should always be rejected', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.record({
              cardanoAddress: fc.constant('invalid-address'),
              userEmail: fc.constant('test@example.com'),
              customName: fc.constant('Test'),
            }),
            fc.record({
              cardanoAddress: fc.constant(
                'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x'
              ),
              userEmail: fc.constant('not-an-email'),
              customName: fc.constant('Test'),
            }),
            fc.record({
              cardanoAddress: fc.constant(
                'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x'
              ),
              userEmail: fc.constant('test@example.com'),
              customName: fc.constant('a'.repeat(51)),
            })
          ),
          invalidInput => {
            const req = createMockRequest(invalidInput) as Request;
            const res = createMockResponse() as Response;
            const next = createMockNext();

            const middleware = validateRequest(validationSchemas.createAlias);

            // Execute middleware
            middleware(req, res, next);

            // Should call next with an error
            expect(next).toHaveBeenCalledWith(
              expect.objectContaining({
                statusCode: 400,
                code: 'VALIDATION_ERROR',
              })
            );
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * **Feature: cardash-backend-api, Property 20: Input validation consistency**
     * For any API endpoint, valid input data should pass validation and be processed
     * **Validates: Requirements 6.1**
     */
    test('Property 20: Input validation consistency - valid inputs should always pass', () => {
      fc.assert(
        fc.property(
          fc.record({
            cardanoAddress: fc.constant(
              'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x'
            ),
            userEmail: fc.option(fc.constant('test@example.com'), { nil: undefined }),
            customName: fc.option(
              fc.string().filter(s => s.length >= 1 && s.length <= 50),
              { nil: undefined }
            ),
          }),
          validInput => {
            const req = createMockRequest(validInput) as Request;
            const res = createMockResponse() as Response;
            const next = createMockNext();

            const middleware = validateRequest(validationSchemas.createAlias);

            // Execute middleware
            middleware(req, res, next);

            // Should call next without error
            expect(next).toHaveBeenCalledWith();
            expect(next).not.toHaveBeenCalledWith(expect.any(Error));
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * **Feature: cardash-backend-api, Property 20: Input validation consistency**
     * For any input with extra fields, validation should strip unknown fields
     * **Validates: Requirements 6.1**
     */
    test('Property 20: Input validation consistency - unknown fields should be stripped', () => {
      fc.assert(
        fc.property(
          fc.record({
            cardanoAddress: fc.constant(
              'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x'
            ),
            userEmail: fc.constant('test@example.com'),
            customName: fc.constant('Test Alias'),
            // Add random extra fields
            extraField1: fc.string(),
            extraField2: fc.integer(),
            extraField3: fc.boolean(),
          }),
          inputWithExtra => {
            const req = createMockRequest(inputWithExtra) as Request;
            const res = createMockResponse() as Response;
            const next = createMockNext();

            const middleware = validateRequest(validationSchemas.createAlias);

            // Execute middleware
            middleware(req, res, next);

            // Should call next without error
            expect(next).toHaveBeenCalledWith();

            // Extra fields should be stripped from req.body
            expect(req.body).not.toHaveProperty('extraField1');
            expect(req.body).not.toHaveProperty('extraField2');
            expect(req.body).not.toHaveProperty('extraField3');

            // Valid fields should remain
            expect(req.body).toHaveProperty('cardanoAddress');
            expect(req.body).toHaveProperty('userEmail');
            expect(req.body).toHaveProperty('customName');
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Unit Tests', () => {
    test('should validate valid Cardano address', () => {
      const validInput = {
        cardanoAddress:
          'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
        userEmail: 'test@example.com',
      };

      const req = createMockRequest(validInput) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      const middleware = validateRequest(validationSchemas.createAlias);
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.body.cardanoAddress).toBe(validInput.cardanoAddress);
    });

    test('should reject invalid Cardano address format', () => {
      const invalidInput = {
        cardanoAddress: 'invalid-address',
        userEmail: 'test@example.com',
      };

      const req = createMockRequest(invalidInput) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      const middleware = validateRequest(validationSchemas.createAlias);
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
        })
      );
    });

    test('should reject invalid email format', () => {
      const invalidInput = {
        cardanoAddress:
          'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
        userEmail: 'invalid-email',
      };

      const req = createMockRequest(invalidInput) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      const middleware = validateRequest(validationSchemas.createAlias);
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
        })
      );
    });

    test('should validate short code format', () => {
      const validInput = {
        code: 'abcd1234efgh5678',
      };

      const req = createMockRequest(validInput) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      const middleware = validateRequest(validationSchemas.resolveAlias);
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.body.code).toBe(validInput.code);
    });

    test('should reject short code with invalid length', () => {
      const invalidInput = {
        code: 'short',
      };

      const req = createMockRequest(invalidInput) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      const middleware = validateRequest(validationSchemas.resolveAlias);
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
        })
      );
    });
  });
});
