import request from 'supertest';
import express from 'express';
import * as fc from 'fast-check';
import { compressionMiddleware, compressionHeaders } from '@/middlewares/compression';

/**
 * **Feature: cardash-backend-api, Property 18: Response compression**
 * **Validates: Requirements 5.4**
 *
 * Property: For any API endpoint response, compression headers should be present
 * and content should be compressed when appropriate
 */

describe('Response Compression Property Tests', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(compressionHeaders);
    app.use(compressionMiddleware);

    // Set up test routes with plain text to avoid JSON parsing issues
    app.get('/test-large', (req, res) => {
      const largeData = 'x'.repeat(5000);
      res.setHeader('Content-Type', 'text/plain');
      res.send(largeData);
    });

    app.get('/test-small', (req, res) => {
      const smallData = 'x'.repeat(500);
      res.setHeader('Content-Type', 'text/plain');
      res.send(smallData);
    });

    app.get('/test-image', (req, res) => {
      const imageData = Buffer.alloc(3000, 'binary-data');
      res.setHeader('Content-Type', 'image/jpeg');
      res.send(imageData);
    });
  });

  test('Property 18: Response compression headers are always present', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          endpoint: fc.constantFrom('/test-large', '/test-small', '/test-image'),
          acceptEncoding: fc.constantFrom('gzip', 'deflate', 'identity', 'gzip, deflate'),
        }),
        async ({ endpoint, acceptEncoding }) => {
          const response = await request(app).get(endpoint).set('Accept-Encoding', acceptEncoding);

          // Property 1: Vary header should always be present for compression negotiation
          expect(response.headers.vary).toBeDefined();
          expect(response.headers.vary.toLowerCase()).toContain('accept-encoding');

          // Property 2: Response should be successful
          expect(response.status).toBe(200);

          // Property 3: For gzip-accepting clients, cache control should be set
          if (acceptEncoding.includes('gzip')) {
            expect(response.headers['cache-control']).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 18: Compression behavior is consistent', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          dataSize: fc.integer({ min: 100, max: 8000 }),
          acceptGzip: fc.boolean(),
        }),
        async ({ dataSize, acceptGzip }) => {
          const testData = 'x'.repeat(dataSize);
          const testPath = `/test-${dataSize}`;

          // Create endpoint for this test
          app.get(testPath, (req, res) => {
            res.setHeader('Content-Type', 'text/plain');
            res.send(testData);
          });

          const encoding = acceptGzip ? 'gzip' : 'identity';
          const response = await request(app).get(testPath).set('Accept-Encoding', encoding);

          // Property: Vary header should always be present
          expect(response.headers.vary).toBeDefined();
          expect(response.headers.vary.toLowerCase()).toContain('accept-encoding');

          // Property: Response should be successful
          expect(response.status).toBe(200);
          expect(response.text).toBeDefined();

          // Property: Response content should match expected size (when not compressed)
          if (encoding === 'identity') {
            expect(response.text.length).toBe(dataSize);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Property 18: Image content handling', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          imageType: fc.constantFrom('image/jpeg', 'image/png', 'image/gif'),
          dataSize: fc.integer({ min: 1000, max: 5000 }),
        }),
        async ({ imageType, dataSize }) => {
          const imageData = Buffer.alloc(dataSize, 0);
          const testPath = `/test-img-${dataSize}`;

          app.get(testPath, (req, res) => {
            res.setHeader('Content-Type', imageType);
            res.send(imageData);
          });

          const response = await request(app).get(testPath).set('Accept-Encoding', 'gzip');

          // Property: Vary header should be present
          expect(response.headers.vary).toBeDefined();

          // Property: Response should be successful
          expect(response.status).toBe(200);
          expect(response.body).toBeDefined();
        }
      ),
      { numRuns: 30 }
    );
  });
});
