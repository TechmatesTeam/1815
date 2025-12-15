import { Request } from 'express';
import { logger } from '@/utils/logger';

export interface SecurityEvent {
  type: SecurityEventType;
  severity: SecuritySeverity;
  source: string;
  description: string;
  metadata: SecurityEventMetadata;
  timestamp: Date;
}

export enum SecurityEventType {
  SUSPICIOUS_REQUEST = 'SUSPICIOUS_REQUEST',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  CORS_VIOLATION = 'CORS_VIOLATION',
  INVALID_INPUT = 'INVALID_INPUT',
  AUTHENTICATION_FAILURE = 'AUTHENTICATION_FAILURE',
  AUTHORIZATION_FAILURE = 'AUTHORIZATION_FAILURE',
  INJECTION_ATTEMPT = 'INJECTION_ATTEMPT',
  XSS_ATTEMPT = 'XSS_ATTEMPT',
  DIRECTORY_TRAVERSAL = 'DIRECTORY_TRAVERSAL',
  MALFORMED_REQUEST = 'MALFORMED_REQUEST',
  UNUSUAL_ACTIVITY = 'UNUSUAL_ACTIVITY',
}

export enum SecuritySeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface SecurityEventMetadata {
  ip: string;
  userAgent?: string;
  origin?: string;
  referer?: string;
  requestId?: string;
  method: string;
  path: string;
  query?: Record<string, any>;
  body?: Record<string, any>;
  headers?: Record<string, string>;
  patterns?: string[];
  additionalInfo?: Record<string, any>;
}

class SecurityService {
  private static instance: SecurityService;
  private eventBuffer: SecurityEvent[] = [];
  private readonly maxBufferSize = 1000;

  private constructor() {}

  public static getInstance(): SecurityService {
    if (!SecurityService.instance) {
      SecurityService.instance = new SecurityService();
    }
    return SecurityService.instance;
  }

  /**
   * Log a security event with appropriate severity and metadata
   */
  public logSecurityEvent(event: Omit<SecurityEvent, 'timestamp'>): void {
    const securityEvent: SecurityEvent = {
      ...event,
      timestamp: new Date(),
    };

    // Add to buffer for monitoring
    this.addToBuffer(securityEvent);

    // Log based on severity
    this.logBySeverity(securityEvent);

    // Trigger alerts for high severity events
    if (
      securityEvent.severity === SecuritySeverity.HIGH ||
      securityEvent.severity === SecuritySeverity.CRITICAL
    ) {
      this.triggerAlert(securityEvent);
    }
  }

  /**
   * Analyze request for suspicious patterns and log security events
   */
  public analyzeRequest(req: Request, requestId?: string): SecurityEvent[] {
    const events: SecurityEvent[] = [];
    const metadata: SecurityEventMetadata = {
      ip: req.ip || 'unknown',
      userAgent: req.get('User-Agent'),
      origin: req.get('Origin'),
      referer: req.get('Referer'),
      requestId,
      method: req.method,
      path: req.path,
      query: req.query,
      body: req.body,
      headers: this.sanitizeHeaders(req.headers),
    };

    // Check for suspicious patterns
    const suspiciousPatterns = this.detectSuspiciousPatterns(req);
    if (suspiciousPatterns.length > 0) {
      const event = {
        type: this.categorizePatterns(suspiciousPatterns),
        severity: this.calculateSeverity(suspiciousPatterns),
        source: 'request_analyzer',
        description: `Suspicious patterns detected: ${suspiciousPatterns.join(', ')}`,
        metadata: {
          ...metadata,
          patterns: suspiciousPatterns,
        },
      };
      this.logSecurityEvent(event);
      events.push({ ...event, timestamp: new Date() });
    }

    // Check for unusual request characteristics
    const unusualActivity = this.detectUnusualActivity(req);
    if (unusualActivity.length > 0) {
      const event = {
        type: SecurityEventType.UNUSUAL_ACTIVITY,
        severity: SecuritySeverity.MEDIUM,
        source: 'activity_analyzer',
        description: `Unusual activity detected: ${unusualActivity.join(', ')}`,
        metadata: {
          ...metadata,
          additionalInfo: { unusualActivity },
        },
      };
      this.logSecurityEvent(event);
      events.push({ ...event, timestamp: new Date() });
    }

    return events;
  }

  /**
   * Log rate limit violations
   */
  public logRateLimitViolation(req: Request, requestId?: string): void {
    this.logSecurityEvent({
      type: SecurityEventType.RATE_LIMIT_EXCEEDED,
      severity: SecuritySeverity.MEDIUM,
      source: 'rate_limiter',
      description: 'Rate limit exceeded for IP address',
      metadata: {
        ip: req.ip || 'unknown',
        userAgent: req.get('User-Agent'),
        origin: req.get('Origin'),
        referer: req.get('Referer'),
        requestId,
        method: req.method,
        path: req.path,
        query: req.query,
      },
    });
  }

  /**
   * Log CORS violations
   */
  public logCorsViolation(origin: string, allowedOrigins: string[], requestId?: string): void {
    this.logSecurityEvent({
      type: SecurityEventType.CORS_VIOLATION,
      severity: SecuritySeverity.HIGH,
      source: 'cors_middleware',
      description: `CORS policy violation from unauthorized origin: ${origin}`,
      metadata: {
        ip: 'unknown',
        origin,
        requestId,
        method: 'unknown',
        path: 'unknown',
        additionalInfo: {
          allowedOrigins,
          violatingOrigin: origin,
        },
      },
    });
  }

  /**
   * Log authentication failures
   */
  public logAuthenticationFailure(req: Request, reason: string, requestId?: string): void {
    this.logSecurityEvent({
      type: SecurityEventType.AUTHENTICATION_FAILURE,
      severity: SecuritySeverity.HIGH,
      source: 'auth_middleware',
      description: `Authentication failure: ${reason}`,
      metadata: {
        ip: req.ip || 'unknown',
        userAgent: req.get('User-Agent'),
        origin: req.get('Origin'),
        referer: req.get('Referer'),
        requestId,
        method: req.method,
        path: req.path,
        additionalInfo: { reason },
      },
    });
  }

  /**
   * Get recent security events for monitoring
   */
  public getRecentEvents(limit: number = 100): SecurityEvent[] {
    return this.eventBuffer.slice(-limit);
  }

  /**
   * Clear the event buffer (for testing purposes)
   */
  public clearEventBuffer(): void {
    this.eventBuffer = [];
  }

  /**
   * Get security event statistics
   */
  public getEventStatistics(): Record<string, number> {
    const stats: Record<string, number> = {};

    // Count by type
    this.eventBuffer.forEach(event => {
      const key = `type_${event.type}`;
      stats[key] = (stats[key] || 0) + 1;
    });

    // Count by severity
    this.eventBuffer.forEach(event => {
      const key = `severity_${event.severity}`;
      stats[key] = (stats[key] || 0) + 1;
    });

    return stats;
  }

  private addToBuffer(event: SecurityEvent): void {
    this.eventBuffer.push(event);

    // Maintain buffer size
    if (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer = this.eventBuffer.slice(-this.maxBufferSize);
    }
  }

  private logBySeverity(event: SecurityEvent): void {
    const logData = {
      securityEvent: event.type,
      severity: event.severity,
      source: event.source,
      description: event.description,
      metadata: event.metadata,
      timestamp: event.timestamp,
    };

    switch (event.severity) {
      case SecuritySeverity.CRITICAL:
        logger.error('CRITICAL SECURITY EVENT', logData);
        break;
      case SecuritySeverity.HIGH:
        logger.error('HIGH SECURITY EVENT', logData);
        break;
      case SecuritySeverity.MEDIUM:
        logger.warn('MEDIUM SECURITY EVENT', logData);
        break;
      case SecuritySeverity.LOW:
        logger.info('LOW SECURITY EVENT', logData);
        break;
    }
  }

  private triggerAlert(event: SecurityEvent): void {
    // In a production environment, this would integrate with alerting systems
    // like PagerDuty, Slack, email notifications, etc.
    logger.error('SECURITY ALERT TRIGGERED', {
      event: event.type,
      severity: event.severity,
      description: event.description,
      metadata: event.metadata,
      timestamp: event.timestamp,
      alertLevel: 'IMMEDIATE_ATTENTION_REQUIRED',
    });
  }

  private detectSuspiciousPatterns(req: Request): string[] {
    const patterns: string[] = [];

    // Combine all request data for pattern matching
    const requestData = JSON.stringify({
      url: req.url,
      query: req.query,
      body: req.body,
      headers: req.headers,
    });

    // Directory traversal patterns
    if (/\.\./g.test(requestData)) {
      patterns.push('directory_traversal');
    }

    // Script injection patterns
    if (/<script/gi.test(requestData)) {
      patterns.push('script_injection');
    }

    // SQL injection patterns
    if (/union.*select/gi.test(requestData) || /drop.*table/gi.test(requestData)) {
      patterns.push('sql_injection');
    }

    // JavaScript protocol
    if (/javascript:/gi.test(requestData)) {
      patterns.push('javascript_protocol');
    }

    // VBScript protocol
    if (/vbscript:/gi.test(requestData)) {
      patterns.push('vbscript_protocol');
    }

    // Data URL with HTML
    if (/data:text\/html/gi.test(requestData)) {
      patterns.push('data_url_html');
    }

    // Command injection patterns (more specific)
    if (/[;&|`$]\s*[a-zA-Z]/g.test(requestData) || /\$\(/g.test(requestData)) {
      patterns.push('command_injection');
    }

    // LDAP injection patterns (more specific - look for LDAP filter syntax)
    if (/\(\s*[a-zA-Z]+\s*[=*!]\s*[^)]*\)/g.test(requestData)) {
      patterns.push('ldap_injection');
    }

    return patterns;
  }

  private detectUnusualActivity(req: Request): string[] {
    const unusual: string[] = [];

    // Unusually long URLs
    if (req.url && req.url.length > 2000) {
      unusual.push('long_url');
    }

    // Unusual user agents
    const userAgent = req.get('User-Agent');
    if (!userAgent || userAgent.length < 10 || /bot|crawler|spider/i.test(userAgent)) {
      unusual.push('suspicious_user_agent');
    }

    // Missing common headers
    if (!req.get('Accept') && !req.get('Accept-Language')) {
      unusual.push('missing_common_headers');
    }

    // Unusual request methods for certain paths
    if (
      req.path.includes('/api/') &&
      !['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'].includes(req.method)
    ) {
      unusual.push('unusual_http_method');
    }

    return unusual;
  }

  private categorizePatterns(patterns: string[]): SecurityEventType {
    if (patterns.includes('script_injection') || patterns.includes('javascript_protocol')) {
      return SecurityEventType.XSS_ATTEMPT;
    }
    if (patterns.includes('sql_injection')) {
      return SecurityEventType.INJECTION_ATTEMPT;
    }
    if (patterns.includes('directory_traversal')) {
      return SecurityEventType.DIRECTORY_TRAVERSAL;
    }
    return SecurityEventType.SUSPICIOUS_REQUEST;
  }

  private calculateSeverity(patterns: string[]): SecuritySeverity {
    const highRiskPatterns = ['sql_injection', 'command_injection', 'script_injection'];
    const mediumRiskPatterns = ['directory_traversal', 'javascript_protocol', 'vbscript_protocol'];

    if (patterns.some(p => highRiskPatterns.includes(p))) {
      return SecuritySeverity.HIGH;
    }
    if (patterns.some(p => mediumRiskPatterns.includes(p))) {
      return SecuritySeverity.MEDIUM;
    }
    return SecuritySeverity.LOW;
  }

  private sanitizeHeaders(headers: Record<string, any>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];

    Object.entries(headers).forEach(([key, value]) => {
      if (sensitiveHeaders.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = String(value);
      }
    });

    return sanitized;
  }
}

export const securityService = SecurityService.getInstance();
