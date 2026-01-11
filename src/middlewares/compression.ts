import compression from 'compression';
import { Request, Response } from 'express';
import { constants } from 'zlib';

/**
 * Enhanced compression middleware with optimized configuration
 * Implements gzip compression for API responses with proper headers
 * Requirements: 5.4 - Response compression for bandwidth optimization
 */

// Compression filter function to determine what should be compressed
function shouldCompress(req: Request, res: Response): boolean {
  // Don't compress if the client doesn't support it
  if (req.headers['x-no-compression']) {
    return false;
  }

  // Don't compress already compressed content
  const contentType = res.getHeader('content-type') as string;
  if (contentType && contentType.includes('image/')) {
    return false;
  }

  // Don't compress small responses (less than 1KB)
  const contentLength = res.getHeader('content-length');
  if (contentLength && parseInt(contentLength as string) < 1024) {
    return false;
  }

  // Use compression filter function
  return compression.filter(req, res);
}

// Enhanced compression middleware with optimized settings
export const compressionMiddleware = compression({
  // Compression level (1-9, 6 is default, good balance of speed/compression)
  level: 6,

  // Minimum response size to compress (1KB)
  threshold: 1024,

  // Custom filter function
  filter: shouldCompress,

  // Memory level (1-9, 8 is default)
  memLevel: 8,

  // Window bits for deflate (15 is maximum)
  windowBits: 15,

  // Compression strategy
  strategy: constants.Z_DEFAULT_STRATEGY,
});

/**
 * Middleware to add compression-related headers
 */
export const compressionHeaders = (req: Request, res: Response, next: Function) => {
  // Add Vary header to indicate response varies based on Accept-Encoding
  res.setHeader('Vary', 'Accept-Encoding');

  // Set cache control for compressed responses
  if (req.headers['accept-encoding']?.includes('gzip')) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }

  next();
};
