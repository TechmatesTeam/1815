import { Request, Response, NextFunction } from 'express';
import { errorHandler, createError, AppError } from '../../middlewares/errorHandler';

describe('Error Handler Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      url: '/test',
      method: 'GET',
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('test-user-agent'),
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      locals: {
        requestId: 'test-request-id',
      },
    };

    mockNext = jest.fn();
  });

  it('should handle generic errors with default 500 status', () => {
    const error = new Error('Test error') as AppError;

    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Test error',
      },
      metadata: {
        timestamp: expect.any(String),
        requestId: 'test-request-id',
        version: expect.any(String),
      },
    });
  });

  it('should handle validation errors with 400 status', () => {
    const error = new Error('Validation failed') as AppError;
    error.name = 'ValidationError';

    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input data',
      },
      metadata: {
        timestamp: expect.any(String),
        requestId: 'test-request-id',
        version: expect.any(String),
      },
    });
  });

  it('should handle custom errors with specified status code', () => {
    const error = createError('Custom error', 404, 'NOT_FOUND');

    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Custom error',
      },
      metadata: {
        timestamp: expect.any(String),
        requestId: 'test-request-id',
        version: expect.any(String),
      },
    });
  });

  it('should include request ID in metadata', () => {
    const error = new Error('Test error') as AppError;

    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    const responseCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
    expect(responseCall.metadata.requestId).toBe('test-request-id');
  });

  it('should include timestamp in metadata', () => {
    const error = new Error('Test error') as AppError;

    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    const responseCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
    expect(responseCall.metadata.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });

  it('should handle MongoDB duplicate key errors', () => {
    const error = new Error('Duplicate key') as AppError & { code?: number };
    error.name = 'MongoError';
    (error as any).code = 11000;

    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(409);
    expect(mockResponse.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'DUPLICATE_RESOURCE',
        message: 'Resource already exists',
      },
      metadata: {
        timestamp: expect.any(String),
        requestId: 'test-request-id',
        version: expect.any(String),
      },
    });
  });

  it('should handle JWT errors', () => {
    const error = new Error('Invalid token') as AppError;
    error.name = 'JsonWebTokenError';

    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid authentication token',
      },
      metadata: {
        timestamp: expect.any(String),
        requestId: 'test-request-id',
        version: expect.any(String),
      },
    });
  });
});

describe('createError utility', () => {
  it('should create an AppError with specified properties', () => {
    const error = createError('Test message', 400, 'TEST_CODE');

    expect(error.message).toBe('Test message');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('TEST_CODE');
    expect(error.isOperational).toBe(true);
  });

  it('should create an AppError with default status code', () => {
    const error = createError('Test message');

    expect(error.message).toBe('Test message');
    expect(error.statusCode).toBe(500);
    expect(error.isOperational).toBe(true);
  });
});
