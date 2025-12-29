import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';
import { APIResponse } from '@/types/api';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  isOperational?: boolean;
}

export function errorHandler(
  error: AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Log the error
  logger.error('Error occurred:', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: res.locals.requestId,
  });

  // Default error response
  let statusCode = error.statusCode || 500;
  let errorCode = error.code || 'INTERNAL_SERVER_ERROR';
  let message = error.message || 'An unexpected error occurred';

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = 'Invalid input data';
  } else if (error.name === 'CastError') {
    statusCode = 400;
    errorCode = 'INVALID_ID';
    message = 'Invalid ID format';
  } else if (error.name === 'MongoError' && (error as any).code === 11000) {
    statusCode = 409;
    errorCode = 'DUPLICATE_RESOURCE';
    message = 'Resource already exists';
  } else if (error.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorCode = 'INVALID_TOKEN';
    message = 'Invalid authentication token';
  } else if (error.name === 'TokenExpiredError') {
    statusCode = 401;
    errorCode = 'TOKEN_EXPIRED';
    message = 'Authentication token has expired';
  } else if ((error as any).isCircuitBreakerOpen) {
    statusCode = 503;
    errorCode = 'SERVICE_UNAVAILABLE';
    message = 'External service is temporarily unavailable due to repeated failures';
  } else if ((error as any).isGracefulDegradation) {
    // Handle graceful degradation errors
    const fallbackResponse = (error as any).fallbackResponse;
    if (fallbackResponse && fallbackResponse.error) {
      statusCode = 503;
      errorCode = fallbackResponse.error.code;
      message = fallbackResponse.error.message;
    }
  }

  // Don't expose internal errors in production
  if (statusCode === 500 && process.env.NODE_ENV === 'production') {
    message = 'Internal server error';
  }

  const errorResponse: APIResponse = {
    success: false,
    error: {
      code: errorCode,
      message,
      ...(process.env.NODE_ENV === 'development' && { details: error.stack }),
      // Surface validation details when available (development only)
      ...(process.env.NODE_ENV === 'development' &&
        (error as any).details && { validation: (error as any).details }),
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: res.locals.requestId || 'unknown',
      version: process.env.npm_package_version || '1.0.0',
    },
  };

  res.status(statusCode).json(errorResponse);
}

export function createError(message: string, statusCode: number = 500, code?: string): AppError {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  error.code = code;
  error.isOperational = true;
  return error;
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
