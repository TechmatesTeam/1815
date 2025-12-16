import { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from '@/config/environment';
import { logger } from '@/utils/logger';
import { securityService } from '@/services/securityService';

// CORS middleware with configuration
export const corsMiddleware = cors({
  origin: (origin: any, callback: any) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const allowedOrigins = config.cors.origin as string[];

    // Check if the origin is in the allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Log unauthorized CORS attempts using SecurityService
    securityService.logCorsViolation(origin, allowedOrigins);

    logger.warn('CORS policy violation', {
      origin,
      allowedOrigins,
      userAgent: 'unknown', // Will be filled by request context
    });

    const error = new Error(`CORS policy: Origin ${origin} is not allowed`);
    callback(error, false);
  },
  credentials: config.cors.credentials,
  methods: config.cors.methods,
  allowedHeaders: config.cors.allowedHeaders,
  optionsSuccessStatus: 200, // Some legacy browsers (IE11, various SmartTVs) choke on 204
});

// Security headers middleware using Helmet
export const securityHeaders = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'"],
      connectSrc: [
        "'self'",
        'https://cardano-mainnet.blockfrost.io',
        'https://cardano-testnet.blockfrost.io',
      ],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },

  // Cross-Origin Embedder Policy
  crossOriginEmbedderPolicy: false, // Disable for API compatibility

  // Cross-Origin Opener Policy
  crossOriginOpenerPolicy: { policy: 'same-origin' },

  // Cross-Origin Resource Policy
  crossOriginResourcePolicy: { policy: 'cross-origin' },

  // DNS Prefetch Control
  dnsPrefetchControl: { allow: false },

  // Frameguard (X-Frame-Options)
  frameguard: { action: 'deny' },

  // Hide Powered-By header
  hidePoweredBy: true,

  // HTTP Strict Transport Security
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },

  // IE No Open
  ieNoOpen: true,

  // No Sniff (X-Content-Type-Options)
  noSniff: true,

  // Origin Agent Cluster
  originAgentCluster: true,

  // Permitted Cross-Domain Policies
  permittedCrossDomainPolicies: false,

  // Referrer Policy
  referrerPolicy: { policy: 'no-referrer' },

  // X-XSS-Protection
  xssFilter: true,
});

// Custom security middleware for additional headers
export const additionalSecurityHeaders = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Add custom security headers
  res.setHeader('X-API-Version', process.env.npm_package_version || '1.0.0');
  res.setHeader('X-Request-ID', res.locals.requestId || 'unknown');

  // Prevent caching of sensitive endpoints
  if (req.path.includes('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }

  // Add timing information for performance monitoring
  const startTime = Date.now();
  res.locals.startTime = startTime;

  // Log security-relevant request information
  logger.debug('Security headers applied', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    origin: req.get('Origin'),
    referer: req.get('Referer'),
    requestId: res.locals.requestId,
  });

  next();
};

// CORS preflight handler
export const handleCORSPreflight = (req: Request, res: Response, next: NextFunction): void => {
  if (req.method === 'OPTIONS') {
    // Handle preflight requests
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
    res.status(200).end();
    return;
  }
  next();
};

// Security event logger middleware
export const securityEventLogger = (req: Request, res: Response, next: NextFunction): void => {
  // Use SecurityService to analyze request and log security events
  const requestId = res.locals.requestId;
  securityService.analyzeRequest(req, requestId);

  next();
};

// Combined security middleware stack
export const securityMiddlewareStack = [
  corsMiddleware,
  securityHeaders,
  additionalSecurityHeaders,
  handleCORSPreflight,
  securityEventLogger,
];
