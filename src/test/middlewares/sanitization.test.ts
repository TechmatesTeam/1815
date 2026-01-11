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

describe('Input Sanitization Middleware', () => {
  describe('Property Tests', () => {
    /**
     * **Feature: cardash-backend-api, Property 24: Input sanitization**
     * For any user input containing potentially malicious content, the system should sanitize it to prevent injection attacks
     * **Validates: Requirements 6.5**
     */
    test('Property 24: Input sanitization - malicious content should be removed from customName', () => {
      fc.assert(
        fc.property(
          fc.record({
            cardanoAddress: fc.constant(
              'addr1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
            ),
            userEmail: fc.constant('test@example.com'),
            customName: fc.oneof(
              fc.constant('Test<script>alert("xss")</script>'),
              fc.constant('Test" onclick="alert(1)"'),
              fc.constant('Test<img src=x onerror=alert(1)>'),
              fc.constant('Test javascript:alert(1)'),
              fc.constant('Test eval(alert(1))'),
              fc.constant('Test expression(alert(1))')
            ),
          }),
          inputWithMalicious => {
            const req = createMockRequest(inputWithMalicious) as Request;
            const res = createMockResponse() as Response;
            const next = createMockNext();

            const middleware = validateRequest(validationSchemas.createAlias);

            // Execute middleware
            middleware(req, res, next);

            // Check if sanitization occurred on customName (the field that allows arbitrary text)
            if (req.body.customName) {
              expect(req.body.customName).not.toContain('<script>');
              expect(req.body.customName).not.toContain('onclick=');
              expect(req.body.customName).not.toContain('<img');
              expect(req.body.customName).not.toContain('onerror=');
              expect(req.body.customName).not.toContain('javascript:');
              expect(req.body.customName).not.toContain('eval(');
              expect(req.body.customName).not.toContain('expression(');

              // But the text content should remain
              expect(req.body.customName).toContain('Test');
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * **Feature: cardash-backend-api, Property 24: Input sanitization**
     * For any input containing HTML tags, they should be stripped during sanitization
     * **Validates: Requirements 6.5**
     */
    test('Property 24: Input sanitization - HTML tags should be stripped', () => {
      fc.assert(
        fc.property(
          fc.record({
            cardanoAddress: fc.constant(
              'addr1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
            ),
            userEmail: fc.constant('test@example.com'),
            customName: fc.oneof(
              fc.constant('Test<b>Bold</b>'),
              fc.constant('Test<i>Italic</i>'),
              fc.constant('Test<div>Content</div>'),
              fc.constant('Test<span>Span</span>'),
              fc.constant('Test<p>Paragraph</p>')
            ),
          }),
          inputWithHTML => {
            const req = createMockRequest(inputWithHTML) as Request;
            const res = createMockResponse() as Response;
            const next = createMockNext();

            const middleware = validateRequest(validationSchemas.createAlias);

            // Execute middleware
            middleware(req, res, next);

            // HTML tags should be stripped
            if (req.body.customName) {
              expect(req.body.customName).not.toContain('<b>');
              expect(req.body.customName).not.toContain('</b>');
              expect(req.body.customName).not.toContain('<i>');
              expect(req.body.customName).not.toContain('</i>');
              expect(req.body.customName).not.toContain('<div>');
              expect(req.body.customName).not.toContain('</div>');
              expect(req.body.customName).not.toContain('<span>');
              expect(req.body.customName).not.toContain('</span>');
              expect(req.body.customName).not.toContain('<p>');
              expect(req.body.customName).not.toContain('</p>');

              // But the text content should remain
              expect(req.body.customName).toContain('Test');
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * **Feature: cardash-backend-api, Property 24: Input sanitization**
     * For any input containing event handlers, they should be removed during sanitization
     * **Validates: Requirements 6.5**
     */
    test('Property 24: Input sanitization - event handlers should be removed', () => {
      fc.assert(
        fc.property(
          fc.record({
            cardanoAddress: fc.constant(
              'addr1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
            ),
            userEmail: fc.constant('test@example.com'),
            customName: fc.oneof(
              fc.constant('Test onclick="alert(1)"'),
              fc.constant('Test onmouseover="alert(1)"'),
              fc.constant('Test onload="alert(1)"'),
              fc.constant('Test onfocus="alert(1)"'),
              fc.constant('Test onblur="alert(1)"')
            ),
          }),
          inputWithEvents => {
            const req = createMockRequest(inputWithEvents) as Request;
            const res = createMockResponse() as Response;
            const next = createMockNext();

            const middleware = validateRequest(validationSchemas.createAlias);

            // Execute middleware
            middleware(req, res, next);

            // Event handlers should be removed
            if (req.body.customName) {
              expect(req.body.customName).not.toContain('onclick=');
              expect(req.body.customName).not.toContain('onmouseover=');
              expect(req.body.customName).not.toContain('onload=');
              expect(req.body.customName).not.toContain('onfocus=');
              expect(req.body.customName).not.toContain('onblur=');

              // But the text content should remain
              expect(req.body.customName).toContain('Test');
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * **Feature: cardash-backend-api, Property 24: Input sanitization**
     * For any input containing JavaScript protocols, they should be removed during sanitization
     * **Validates: Requirements 6.5**
     */
    test('Property 24: Input sanitization - JavaScript protocols should be removed', () => {
      fc.assert(
        fc.property(
          fc.record({
            cardanoAddress: fc.constant(
              'addr1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
            ),
            userEmail: fc.constant('test@example.com'),
            customName: fc.oneof(
              fc.constant('Test javascript:alert(1)'),
              fc.constant('Test JAVASCRIPT:alert(1)'),
              fc.constant('Test Javascript:alert(1)'),
              fc.constant('Test eval(alert(1))'),
              fc.constant('Test expression(alert(1))')
            ),
          }),
          inputWithJS => {
            const req = createMockRequest(inputWithJS) as Request;
            const res = createMockResponse() as Response;
            const next = createMockNext();

            const middleware = validateRequest(validationSchemas.createAlias);

            // Execute middleware
            middleware(req, res, next);

            // JavaScript protocols and functions should be removed
            if (req.body.customName) {
              expect(req.body.customName.toLowerCase()).not.toContain('javascript:');
              expect(req.body.customName.toLowerCase()).not.toContain('eval(');
              expect(req.body.customName.toLowerCase()).not.toContain('expression(');

              // But the text content should remain
              expect(req.body.customName).toContain('Test');
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Security Validation Tests', () => {
    test('should detect and reject suspicious script tags', () => {
      const maliciousInput = {
        cardanoAddress:
          'addr1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        userEmail: 'test@example.com',
        customName: 'Test<script>alert("xss")</script>',
      };

      const req = createMockRequest(maliciousInput) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      securityValidation(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          code: 'SECURITY_VIOLATION',
        })
      );
    });

    test('should detect and reject JavaScript protocols', () => {
      const maliciousInput = {
        cardanoAddress:
          'addr1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        userEmail: 'test@example.com',
        customName: 'javascript:alert(1)',
      };

      const req = createMockRequest(maliciousInput) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      securityValidation(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          code: 'SECURITY_VIOLATION',
        })
      );
    });

    test('should detect and reject event handlers', () => {
      const maliciousInput = {
        cardanoAddress:
          'addr1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        userEmail: 'test@example.com',
        customName: 'Test onload="alert(1)"',
      };

      const req = createMockRequest(maliciousInput) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      securityValidation(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          code: 'SECURITY_VIOLATION',
        })
      );
    });

    test('should allow clean input to pass through', () => {
      const cleanInput = {
        cardanoAddress:
          'addr1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        userEmail: 'test@example.com',
        customName: 'Clean Test Name',
      };

      const req = createMockRequest(cleanInput) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      securityValidation(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(next).not.toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
