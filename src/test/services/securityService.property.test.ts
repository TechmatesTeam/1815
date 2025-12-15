import fc from 'fast-check';
import { Request } from 'express';
import { securityService, SecurityEventType, SecuritySeverity } from '@/services/securityService';
import { logger } from '@/utils/logger';

// Mock logger to capture security events
jest.mock('@/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockedLogger = logger as jest.Mocked<typeof logger>;

// Helper to create mock request objects
const createMockRequest = (
  method: string = 'GET',
  path: string = '/api/test',
  ip: string = '127.0.0.1',
  headers: Record<string, string> = {},
  query: Record<string, any> = {},
  body: Record<string, any> = {}
): Partial<Request> => ({
  method,
  path,
  url: path,
  ip,
  headers: {
    'user-agent': 'test-agent',
    ...headers,
  },
  query,
  body,
  get: jest.fn((headerName: string) => {
    const headerMap: Record<string, string> = {
      'user-agent': 'test-agent',
      origin: '',
      referer: '',
      ...headers,
    };
    return headerMap[headerName.toLowerCase()];
  }) as any,
});

describe('SecurityService Property Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the security service event buffer
    securityService.clearEventBuffer();
  });

  /**
   * **Feature: cardash-backend-api, Property 23: Security event logging**
   * For any suspicious activity detected, corresponding security events should be logged for monitoring
   * **Validates: Requirements 6.4**
   */
  test('Property 23: Security event logging - suspicious patterns should be detected and logged', () => {
    fc.assert(
      fc.property(
        fc.record({
          method: fc.oneof(
            fc.constant('GET'),
            fc.constant('POST'),
            fc.constant('PUT'),
            fc.constant('DELETE')
          ),
          path: fc.string({ minLength: 1, maxLength: 100 }),
          ip: fc.ipV4(),
          suspiciousContent: fc.oneof(
            // Directory traversal
            fc.constant('../../../etc/passwd'),
            fc.constant('..\\..\\windows\\system32'),
            // Script injection
            fc.constant('<script>alert("xss")</script>'),
            fc.constant('<script src="malicious.js"></script>'),
            // SQL injection
            fc.constant("'; DROP TABLE users; --"),
            fc.constant('UNION SELECT password FROM admin'),
            // JavaScript protocol
            fc.constant('javascript:alert(1)'),
            // VBScript protocol
            fc.constant('vbscript:msgbox(1)'),
            // Data URL with HTML
            fc.constant('data:text/html,<script>alert(1)</script>'),
            // Command injection
            fc.constant('test; rm -rf /'),
            fc.constant('test && cat /etc/passwd')
          ),
        }),
        ({ method, path, ip, suspiciousContent }) => {
          // Create request with suspicious content in different locations
          const testCases = [
            // Suspicious content in URL
            createMockRequest(
              method,
              `/api/test?param=${encodeURIComponent(suspiciousContent)}`,
              ip
            ),
            // Suspicious content in body
            createMockRequest(method, path, ip, {}, {}, { input: suspiciousContent }),
            // Suspicious content in headers
            createMockRequest(method, path, ip, { 'x-custom': suspiciousContent }),
          ];

          testCases.forEach(req => {
            // Clear buffer before each test case to ensure clean state
            securityService.clearEventBuffer();
            const initialEventCount = securityService.getRecentEvents().length;

            // Analyze request for security events
            const events = securityService.analyzeRequest(req as Request, 'test-request-id');

            // Should detect suspicious patterns and create security events
            if (events.length === 0) {
              console.log('No events detected for suspicious content:', {
                method,
                path,
                ip,
                suspiciousContent,
                requestData: JSON.stringify({ url: req.url, query: req.query, body: req.body }),
              });
            }
            expect(events.length).toBeGreaterThan(0);

            // Should have logged security events
            const finalEventCount = securityService.getRecentEvents().length;
            expect(finalEventCount).toBeGreaterThan(initialEventCount);

            // Should have called appropriate logger methods (error, warn, or info depending on severity)
            expect(
              mockedLogger.error.mock.calls.length +
                mockedLogger.warn.mock.calls.length +
                mockedLogger.info.mock.calls.length
            ).toBeGreaterThan(0);

            // Events should have proper structure
            events.forEach(event => {
              expect(event.type).toBeDefined();
              expect(Object.values(SecurityEventType)).toContain(event.type);
              expect(event.severity).toBeDefined();
              expect(Object.values(SecuritySeverity)).toContain(event.severity);
              expect(event.source).toBeDefined();
              expect(event.description).toBeDefined();
              expect(event.metadata).toBeDefined();
              expect(event.metadata.ip).toBe(ip);
              expect(event.metadata.method).toBe(method);
            });
          });

          return true;
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Feature: cardash-backend-api, Property 23: Security event logging**
   * For any rate limit violation, security events should be logged with appropriate severity
   * **Validates: Requirements 6.4**
   */
  test('Property 23: Security event logging - rate limit violations should be logged', () => {
    fc.assert(
      fc.property(
        fc.record({
          method: fc.oneof(
            fc.constant('GET'),
            fc.constant('POST'),
            fc.constant('PUT'),
            fc.constant('DELETE')
          ),
          path: fc.string({ minLength: 1, maxLength: 100 }),
          ip: fc.ipV4(),
          userAgent: fc.option(fc.string({ minLength: 10, maxLength: 200 }), { nil: undefined }),
        }),
        ({ method, path, ip, userAgent }) => {
          const req = createMockRequest(
            method,
            path,
            ip,
            userAgent ? { 'user-agent': userAgent } : {}
          );

          const initialEventCount = securityService.getRecentEvents().length;

          // Log rate limit violation
          securityService.logRateLimitViolation(req as Request, 'test-request-id');

          // Should have created a security event
          const finalEventCount = securityService.getRecentEvents().length;
          expect(finalEventCount).toBe(initialEventCount + 1);

          // Should have logged with appropriate severity
          expect(mockedLogger.warn).toHaveBeenCalled();

          // Get the logged event
          const recentEvents = securityService.getRecentEvents(1);
          const event = recentEvents[0];

          expect(event.type).toBe(SecurityEventType.RATE_LIMIT_EXCEEDED);
          expect(event.severity).toBe(SecuritySeverity.MEDIUM);
          expect(event.source).toBe('rate_limiter');
          expect(event.metadata.ip).toBe(ip);
          expect(event.metadata.method).toBe(method);
          expect(event.metadata.path).toBe(path);

          return true;
        }
      ),
      { numRuns: 30 }
    );
  });

  /**
   * **Feature: cardash-backend-api, Property 23: Security event logging**
   * For any CORS violation, security events should be logged with high severity
   * **Validates: Requirements 6.4**
   */
  test('Property 23: Security event logging - CORS violations should be logged with high severity', () => {
    fc.assert(
      fc.property(
        fc.record({
          violatingOrigin: fc.webUrl(),
          allowedOrigins: fc.array(fc.webUrl(), { minLength: 1, maxLength: 5 }),
          requestId: fc.option(fc.string(), { nil: undefined }),
        }),
        ({ violatingOrigin, allowedOrigins, requestId }) => {
          // Ensure violating origin is not in allowed origins
          const filteredAllowedOrigins = allowedOrigins.filter(
            origin => origin !== violatingOrigin
          );

          // Skip this test case if the violating origin was in the allowed list
          if (allowedOrigins.includes(violatingOrigin)) {
            return true; // Skip this test case
          }

          const initialEventCount = securityService.getRecentEvents().length;

          // Log CORS violation
          securityService.logCorsViolation(violatingOrigin, filteredAllowedOrigins, requestId);

          // Should have created a security event
          const finalEventCount = securityService.getRecentEvents().length;
          expect(finalEventCount).toBe(initialEventCount + 1);

          // Should have logged with high severity
          expect(mockedLogger.error).toHaveBeenCalled();

          // Get the logged event
          const recentEvents = securityService.getRecentEvents(1);
          const event = recentEvents[0];

          expect(event.type).toBe(SecurityEventType.CORS_VIOLATION);
          expect(event.severity).toBe(SecuritySeverity.HIGH);
          expect(event.source).toBe('cors_middleware');
          expect(event.description).toContain(violatingOrigin);
          expect(event.metadata.origin).toBe(violatingOrigin);
          expect(event.metadata.additionalInfo?.allowedOrigins).toEqual(filteredAllowedOrigins);

          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * **Feature: cardash-backend-api, Property 23: Security event logging**
   * For any authentication failure, security events should be logged with high severity
   * **Validates: Requirements 6.4**
   */
  test('Property 23: Security event logging - authentication failures should be logged', () => {
    fc.assert(
      fc.property(
        fc.record({
          method: fc.oneof(
            fc.constant('GET'),
            fc.constant('POST'),
            fc.constant('PUT'),
            fc.constant('DELETE')
          ),
          path: fc.string({ minLength: 1, maxLength: 100 }),
          ip: fc.ipV4(),
          reason: fc.oneof(
            fc.constant('Invalid token'),
            fc.constant('Token expired'),
            fc.constant('Missing authorization header'),
            fc.constant('Invalid credentials')
          ),
          requestId: fc.option(fc.string(), { nil: undefined }),
        }),
        ({ method, path, ip, reason, requestId }) => {
          const req = createMockRequest(method, path, ip);

          const initialEventCount = securityService.getRecentEvents().length;

          // Log authentication failure
          securityService.logAuthenticationFailure(req as Request, reason, requestId);

          // Should have created a security event
          const finalEventCount = securityService.getRecentEvents().length;
          expect(finalEventCount).toBe(initialEventCount + 1);

          // Should have logged with high severity
          expect(mockedLogger.error).toHaveBeenCalled();

          // Get the logged event
          const recentEvents = securityService.getRecentEvents(1);
          const event = recentEvents[0];

          expect(event.type).toBe(SecurityEventType.AUTHENTICATION_FAILURE);
          expect(event.severity).toBe(SecuritySeverity.HIGH);
          expect(event.source).toBe('auth_middleware');
          expect(event.description).toContain(reason);
          expect(event.metadata.ip).toBe(ip);
          expect(event.metadata.method).toBe(method);
          expect(event.metadata.path).toBe(path);
          expect(event.metadata.additionalInfo?.reason).toBe(reason);

          return true;
        }
      ),
      { numRuns: 25 }
    );
  });

  /**
   * **Feature: cardash-backend-api, Property 23: Security event logging**
   * For any security event, statistics should be properly maintained and retrievable
   * **Validates: Requirements 6.4**
   */
  test('Property 23: Security event logging - statistics should be maintained correctly', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: fc.oneof(
              fc.constant(SecurityEventType.SUSPICIOUS_REQUEST),
              fc.constant(SecurityEventType.RATE_LIMIT_EXCEEDED),
              fc.constant(SecurityEventType.CORS_VIOLATION),
              fc.constant(SecurityEventType.INJECTION_ATTEMPT)
            ),
            severity: fc.oneof(
              fc.constant(SecuritySeverity.LOW),
              fc.constant(SecuritySeverity.MEDIUM),
              fc.constant(SecuritySeverity.HIGH)
            ),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        eventConfigs => {
          // Clear existing events
          securityService.clearEventBuffer();

          // Generate security events
          eventConfigs.forEach(({ type, severity }) => {
            securityService.logSecurityEvent({
              type,
              severity,
              source: 'test',
              description: 'Test event',
              metadata: {
                ip: '127.0.0.1',
                method: 'GET',
                path: '/test',
              },
            });
          });

          // Get statistics
          const stats = securityService.getEventStatistics();
          const recentEvents = securityService.getRecentEvents();

          // Should have correct number of events
          expect(recentEvents.length).toBe(eventConfigs.length);

          // Statistics should match generated events
          eventConfigs.forEach(({ type, severity }) => {
            const typeKey = `type_${type}`;
            const severityKey = `severity_${severity}`;

            expect(stats[typeKey]).toBeGreaterThan(0);
            expect(stats[severityKey]).toBeGreaterThan(0);
          });

          // All events should have proper structure
          recentEvents.forEach(event => {
            expect(event.type).toBeDefined();
            expect(event.severity).toBeDefined();
            expect(event.source).toBeDefined();
            expect(event.description).toBeDefined();
            expect(event.metadata).toBeDefined();
            expect(event.timestamp).toBeInstanceOf(Date);
          });

          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * **Feature: cardash-backend-api, Property 23: Security event logging**
   * For any clean request without suspicious patterns, no security events should be generated
   * **Validates: Requirements 6.4**
   */
  test('Property 23: Security event logging - clean requests should not generate security events', () => {
    fc.assert(
      fc.property(
        fc.record({
          method: fc.oneof(
            fc.constant('GET'),
            fc.constant('POST'),
            fc.constant('PUT'),
            fc.constant('DELETE')
          ),
          path: fc.oneof(
            fc.constant('/api/v1/aliases'),
            fc.constant('/api/v1/health'),
            fc.constant('/api/v1/explorer/address'),
            fc.constant('/api/v1/stats')
          ),
          ip: fc.ipV4(),
          cleanContent: fc.oneof(
            fc.constant('normal search query'),
            fc.constant('user@example.com'),
            fc.constant(
              'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x'
            ),
            fc.string({ minLength: 1, maxLength: 50 }).filter(s => {
              // Filter out any content that might trigger security patterns
              const suspiciousPatterns = [
                /\.\./g,
                /<script/gi,
                /union.*select/gi,
                /javascript:/gi,
                /vbscript:/gi,
                /data:text\/html/gi,
                /[;&|`$()]/g,
                /[()=*!&|]/g,
                /drop.*table/gi,
                /SELECT/gi,
                /UNION/gi,
              ];
              return (
                !suspiciousPatterns.some(pattern => pattern.test(s)) &&
                s.length > 0 &&
                /^[a-zA-Z0-9\s@._-]+$/.test(s)
              ); // Only allow safe characters
            })
          ),
        }),
        ({ method, path, ip, cleanContent }) => {
          const req = createMockRequest(
            method,
            path,
            ip,
            { 'user-agent': 'Mozilla/5.0 (compatible browser)' },
            { q: cleanContent },
            { input: cleanContent }
          );

          const initialEventCount = securityService.getRecentEvents().length;

          // Analyze clean request
          const events = securityService.analyzeRequest(req as Request, 'test-request-id');

          // Should not generate security events for clean requests
          // (though it might detect unusual activity like missing headers)
          const securityEvents = events.filter(e => e.type !== SecurityEventType.UNUSUAL_ACTIVITY);

          // Debug: log events if any are found
          if (securityEvents.length > 0) {
            console.log('Unexpected security events for clean request:', {
              method,
              path,
              ip,
              cleanContent,
              events: securityEvents.map(e => ({ type: e.type, description: e.description })),
            });
          }

          expect(securityEvents.length).toBe(0);

          return true;
        }
      ),
      { numRuns: 30 }
    );
  });
});
