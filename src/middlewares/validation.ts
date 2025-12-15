import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { createError } from './errorHandler';
import { logger } from '@/utils/logger';

// Cardano address validation regex (comprehensive for all address types)
const CARDANO_ADDRESS_REGEX =
  /^(addr1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{50,103}|addr_test1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{50,103}|stake1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{50,103}|stake_test1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{50,103}|Ae2[1-9A-HJ-NP-Za-km-z]{50,103}|DdzFF[1-9A-HJ-NP-Za-km-z]{50,103})$/;

// Common validation schemas
export const commonSchemas = {
  cardanoAddress: Joi.string().pattern(CARDANO_ADDRESS_REGEX).required().messages({
    'string.pattern.base': 'Invalid Cardano address format',
    'any.required': 'Cardano address is required',
  }),

  email: Joi.string()
    .email({ tlds: { allow: false } })
    .optional()
    .messages({
      'string.email': 'Invalid email format',
    }),

  shortCode: Joi.string()
    .length(16)
    .pattern(/^\d{16}$/)
    .required()
    .messages({
      'string.length': 'Short code must be exactly 16 characters',
      'string.pattern.base': 'Short code must contain only digits',
      'any.required': 'Short code is required',
    }),

  customName: Joi.string().min(1).max(50).optional().messages({
    'string.min': 'Custom name must be at least 1 character',
    'string.max': 'Custom name must not exceed 50 characters',
  }),

  searchQuery: Joi.string().min(1).max(200).required().messages({
    'string.min': 'Search query must be at least 1 character',
    'string.max': 'Search query must not exceed 200 characters',
    'any.required': 'Search query is required',
  }),

  searchType: Joi.string()
    .valid('auto', 'address', 'transaction', 'block', 'alias')
    .optional()
    .default('auto'),

  notificationPreferences: Joi.object({
    aliasExpiry: Joi.boolean().default(true),
    featureUpdates: Joi.boolean().default(false),
    ecosystemNews: Joi.boolean().default(false),
  }).optional(),
};

// API endpoint validation schemas
export const validationSchemas = {
  // Alias creation
  createAlias: Joi.object({
    cardanoAddress: commonSchemas.cardanoAddress,
    userEmail: commonSchemas.email,
    customName: commonSchemas.customName,
    expiryDays: Joi.number().integer().min(1).max(30).optional().messages({
      'number.base': 'Expiry days must be a number',
      'number.integer': 'Expiry days must be an integer',
      'number.min': 'Expiry days must be at least 1',
      'number.max': 'Expiry days must not exceed 30',
    }),
  }),

  // Alias confirmation (for two-step process)
  confirmAlias: Joi.object({
    shortCode: commonSchemas.shortCode,
    cardanoAddress: commonSchemas.cardanoAddress,
    userEmail: commonSchemas.email,
    customName: commonSchemas.customName,
    expiryDays: Joi.number().integer().min(1).max(30).optional().messages({
      'number.base': 'Expiry days must be a number',
      'number.integer': 'Expiry days must be an integer',
      'number.min': 'Expiry days must be at least 1',
      'number.max': 'Expiry days must not exceed 30',
    }),
  }),

  // Alias resolution
  resolveAlias: Joi.object({
    code: commonSchemas.shortCode,
  }),

  // Alias resolution by query (more flexible for resolve endpoint)
  resolveQuery: Joi.object({
    query: Joi.string().min(1).max(200).required().messages({
      'string.min': 'Query must be at least 1 character',
      'string.max': 'Query must not exceed 200 characters',
      'any.required': 'Query is required',
    }),
  }),

  // Get existing alias by address
  getExistingAliasByAddress: Joi.object({
    address: commonSchemas.cardanoAddress,
  }),

  // Explorer search
  explorerSearch: Joi.object({
    query: commonSchemas.searchQuery,
    type: commonSchemas.searchType,
  }),

  // Bulk resolution
  bulkResolve: Joi.object({
    codes: Joi.array().items(commonSchemas.shortCode).min(1).max(100).required().messages({
      'array.min': 'At least one short code is required',
      'array.max': 'Maximum 100 short codes allowed per request',
      'any.required': 'Short codes array is required',
    }),
  }),

  // Notification subscription
  subscribeNotifications: Joi.object({
    email: commonSchemas.email.required(),
    preferences: commonSchemas.notificationPreferences,
  }),

  // Update notification preferences
  updatePreferences: Joi.object({
    email: commonSchemas.email.required(),
    preferences: commonSchemas.notificationPreferences.required(),
  }),

  // Unsubscribe token validation
  unsubscribeToken: Joi.object({
    token: Joi.string().min(1).required().messages({
      'string.min': 'Unsubscribe token must not be empty',
      'any.required': 'Unsubscribe token is required',
    }),
  }),

  // Unsubscribe body validation
  unsubscribeBody: Joi.object({
    email: commonSchemas.email.required(),
  }),
};

// Input sanitization function
function sanitizeInput(obj: any): any {
  if (typeof obj === 'string') {
    // Remove potentially dangerous characters and HTML tags
    return obj
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .replace(/eval\s*\(/gi, '') // Remove eval calls
      .replace(/expression\s*\(/gi, '') // Remove CSS expressions
      .trim();
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeInput);
  }

  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }

  return obj;
}

// Validation middleware factory
export function validateRequest(
  schema: Joi.ObjectSchema,
  source: 'body' | 'params' | 'query' = 'body'
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Get the data to validate based on source
      let dataToValidate: any;
      switch (source) {
        case 'body':
          dataToValidate = req.body;
          break;
        case 'params':
          dataToValidate = req.params;
          break;
        case 'query':
          dataToValidate = req.query;
          break;
        default:
          dataToValidate = req.body;
      }

      // Sanitize input first
      const sanitizedData = sanitizeInput(dataToValidate);

      // Validate against schema
      const { error, value } = schema.validate(sanitizedData, {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
      });

      if (error) {
        const validationErrors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value,
        }));

        logger.warn('Validation failed', {
          url: req.url,
          method: req.method,
          ip: req.ip,
          errors: validationErrors,
          requestId: res.locals.requestId,
        });

        const validationError = createError('Validation failed', 400, 'VALIDATION_ERROR');
        (validationError as any).details = validationErrors;

        throw validationError;
      }

      // Replace the original data with validated and sanitized data
      switch (source) {
        case 'body':
          req.body = value;
          break;
        case 'params':
          req.params = value;
          break;
        case 'query':
          req.query = value;
          break;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

// Security validation middleware for suspicious patterns
export function securityValidation(req: Request, res: Response, next: NextFunction): void {
  try {
    const suspiciousPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, // Script tags
      /javascript:/gi, // JavaScript protocol
      /on\w+\s*=/gi, // Event handlers
      /eval\s*\(/gi, // Eval function
      /expression\s*\(/gi, // CSS expressions
      /vbscript:/gi, // VBScript protocol
      /data:text\/html/gi, // Data URLs with HTML
    ];

    const requestData = JSON.stringify({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    const foundSuspiciousPattern = suspiciousPatterns.some(pattern => pattern.test(requestData));

    if (foundSuspiciousPattern) {
      logger.warn('Suspicious input detected', {
        url: req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        requestId: res.locals.requestId,
        data: requestData,
      });

      throw createError('Invalid input detected', 400, 'SECURITY_VIOLATION');
    }

    next();
  } catch (error) {
    next(error);
  }
}

// Request ID middleware
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const requestId =
    req.get('X-Request-ID') || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  res.locals.requestId = requestId;
  res.set('X-Request-ID', requestId);

  next();
}
