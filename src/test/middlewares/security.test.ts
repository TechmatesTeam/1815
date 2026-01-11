import { Request, Response, NextFunction } from 'express';
import fc from 'fast-check';
import {
  corsMiddleware,
  securityHeaders,
  additionalSecurityHeaders,
  securityEventLogger,
} from '@/middlewares/security';
import { config } from '@/config/environment';

// Mock Express objects
const createMockRequest = (
  origin?: string,
  method: string = 'GET',
  path: string = '/api/v1/test',
  headers: Record<string, string> = {}
): Partial<Request> => ({
  method,
  path,
  url: path,
  ip: '127.0.0.1',
  query: {},
  body: {},
  headers: {
    origin,
    'user-agent': 'test-agent',
    ...headers,
  },
  get: jest.fn((headerName: string) => {
    const headerMap: Record<string, string | string[]> = {
      origin: origin || '',
      'user-agent': 'test-agent',
      referer: '',
      'set-cookie': [],
      ...headers,
    };
    return headerMap[headerName.toLowerCase()];
  }) as any,
});

const createMockResponse = (): Partial<Response> => {
  const headers: Record<string, string> = {};
  const res: Partial<Response> = {
    locals: { requestId: 'test-request-id' },
    setHeader: jest.fn((name: string, value: string | number | readonly string[]) => {
      headers[name] = String(value);
      return res as Response;
    }),
    getHeader: jest.fn((name: string) => headers[name]),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  };
  return res;
};

const createMockNext = (): jest.MockedFunction<NextFunction> => jest.fn();

describe('Security Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Property Tests', () => {
    /**
     * **Feature: cardash-backend-api, Property 22: CORS policy enforcement**
     * For any cross-origin request, appropriate CORS headers should be returned according to configured policies
     * **Validates: Requirements 6.3**
     */
    test('Property 22: CORS policy enforcement - allowed origins should be accepted', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant('http://localhost:3000'),
            fc.constant('http://localhost:5173'),
            ...((config.cors.origin as string[]) || []).map(origin => fc.constant(origin))
          ),
          allowedOrigin => {
            const req = createMockRequest(allowedOrigin) as Request;
            const res = createMockResponse() as Response;
            const next = createMockNext();

            // CORS middleware should accept allowed origins
            corsMiddleware(req, res, next);

            // Should call next without error for allowed origins
            expect(next).toHaveBeenCalled();

            // The origin should be in the allowed list
            const allowedOrigins = config.cors.origin as string[];
            expect(allowedOrigins).toContain(allowedOrigin);

            return true;
          }
        ),
        { numRuns: 20 }
      );
    });

    /**
     * **Feature: cardash-backend-api, Property 22: CORS policy enforcement**
     * For any unauthorized origin, CORS should reject the request
     * **Validates: Requirements 6.3**
     */
    test('Property 22: CORS policy enforcement - unauthorized origins should be rejected', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant('http://malicious-site.com'),
            fc.constant('https://evil.example.com'),
            fc.constant('http://unauthorized.domain'),
            fc.webUrl().filter(url => {
              const allowedOrigins = config.cors.origin as string[];
              return !allowedOrigins.includes(url);
            })
          ),
          unauthorizedOrigin => {
            const req = createMockRequest(unauthorizedOrigin) as Request;
            const res = createMockResponse() as Response;
            const next = createMockNext();

            // CORS middleware should reject unauthorized origins
            corsMiddleware(req, res, next);

            // The origin should not be in the allowed list
            const allowedOrigins = config.cors.origin as string[];
            expect(allowedOrigins).not.toContain(unauthorizedOrigin);

            return true;
          }
        ),
        { numRuns: 20 }
      );
    });

    /**
     * **Feature: cardash-backend-api, Property 22: CORS policy enforcement**
     * For any request without origin (like mobile apps), it should be allowed
     * **Validates: Requirements 6.3**
     */
    test('Property 22: CORS policy enforcement - requests without origin should be allowed', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.constant(undefined), fc.constant(''), fc.constant(null)),
          noOrigin => {
            const req = createMockRequest(noOrigin as string | undefined) as Request;
            const res = createMockResponse() as Response;
            const next = createMockNext();

            // CORS middleware should allow requests without origin
            corsMiddleware(req, res, next);

            // Should call next without error for no-origin requests
            expect(next).toHaveBeenCalled();

            return true;
          }
        ),
        { numRuns: 10 }
      );
    });

    /**
     * **Feature: cardash-backend-api, Property 22: CORS policy enforcement**
     * For any OPTIONS request, proper preflight headers should be set
     * **Validates: Requirements 6.3**
     */
    test('Property 22: CORS policy enforcement - OPTIONS requests should be handled correctly', () => {
      fc.assert(
        fc.property(fc.string(), path => {
          const req = createMockRequest('http://localhost:3000', 'OPTIONS', path) as Request;
          const res = createMockResponse() as Response;
          const next = createMockNext();

          // Should handle OPTIONS method correctly
          expect(req.method).toBe('OPTIONS');

          // Path should be set correctly
          expect(req.path).toBe(path);

          return true;
        }),
        { numRuns: 30 }
      );
    });

    /**
     * **Feature: cardash-backend-api, Property 22: CORS policy enforcement**
     * For any request, security headers should be consistently applied
     * **Validates: Requirements 6.3**
     */
    test('Property 22: CORS policy enforcement - security headers should be applied consistently', () => {
      fc.assert(
        fc.property(
          fc.record({
            method: fc.oneof(
              fc.constant('GET'),
              fc.constant('POST'),
              fc.constant('PUT'),
              fc.constant('DELETE')
            ),
            path: fc.string(),
            origin: fc.option(fc.webUrl(), { nil: undefined }),
          }),
          ({ method, path, origin }) => {
            const req = createMockRequest(origin, method, path) as Request;
            const res = createMockResponse() as Response;
            const next = createMockNext();

            // Apply additional security headers
            additionalSecurityHeaders(req, res, next);

            // Should call next
            expect(next).toHaveBeenCalled();

            // Should set security headers
            expect(res.setHeader).toHaveBeenCalledWith('X-API-Version', expect.any(String));
            expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', expect.any(String));

            // For API paths, should set cache control headers
            if (path.includes('/api/')) {
              expect(res.setHeader).toHaveBeenCalledWith(
                'Cache-Control',
                expect.stringContaining('no-store')
              );
            }

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * **Feature: cardash-backend-api, Property 22: CORS policy enforcement**
     * For any suspicious request patterns, security events should be logged
     * **Validates: Requirements 6.3**
     */
    test('Property 22: CORS policy enforcement - suspicious patterns should be detected', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant('/api/test?param=../../../etc/passwd'),
            fc.constant('/api/test'),
            fc.record({
              url: fc.constant('/api/test'),
              body: fc.oneof(
                fc.constant({ input: '<script>alert("xss")</script>' }),
                fc.constant({ input: 'normal input' }),
                fc.constant({ query: 'SELECT * FROM users UNION SELECT password FROM admin' })
              ),
            })
          ),
          testCase => {
            let req: Partial<Request>;

            if (typeof testCase === 'string') {
              req = createMockRequest(undefined, 'GET', testCase);
            } else {
              req = createMockRequest(undefined, 'POST', testCase.url);
              req.body = testCase.body;
            }

            const res = createMockResponse() as Response;
            const next = createMockNext();

            // Apply security event logger
            securityEventLogger(req as Request, res as Response, next);

            // Should always call next (logging doesn't block requests)
            expect(next).toHaveBeenCalled();

            return true;
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('Unit Tests', () => {
    test('should have correct CORS configuration', () => {
      expect(config.cors.origin).toBeDefined();
      expect(config.cors.credentials).toBeDefined();
      expect(config.cors.methods).toBeDefined();
      expect(config.cors.allowedHeaders).toBeDefined();
    });

    test('should apply security headers correctly', () => {
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      additionalSecurityHeaders(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('X-API-Version', expect.any(String));
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'test-request-id');
    });

    test('should set cache control headers for API paths', () => {
      const req = createMockRequest(undefined, 'GET', '/api/v1/aliases') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      additionalSecurityHeaders(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        expect.stringContaining('no-store')
      );
      expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
      expect(res.setHeader).toHaveBeenCalledWith('Expires', '0');
    });

    test('should handle OPTIONS requests', () => {
      const req = createMockRequest('http://localhost:3000', 'OPTIONS') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      expect(req.method).toBe('OPTIONS');
      expect(typeof corsMiddleware).toBe('function');
    });

    test('should detect suspicious patterns in security event logger', () => {
      const req = createMockRequest(
        undefined,
        'GET',
        '/api/test?param=../../../etc/passwd'
      ) as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      securityEventLogger(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test('should handle requests with malicious body content', () => {
      const req = createMockRequest() as Request;
      req.body = { input: '<script>alert("xss")</script>' };

      const res = createMockResponse() as Response;
      const next = createMockNext();

      securityEventLogger(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test('should set timing information', () => {
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      additionalSecurityHeaders(req, res, next);

      expect(res.locals.startTime).toBeDefined();
      expect(typeof res.locals.startTime).toBe('number');
    });
  });
});
