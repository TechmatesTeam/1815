import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { connectDatabase, disconnectDatabase } from '../../config/database';
import { connectRedis, disconnectRedis } from '../../config/redis';
import { AliasController } from '../../controllers/AliasController';
import { ExplorerController } from '../../controllers/ExplorerController';
import { HealthController } from '../../controllers/HealthController';
import { asyncHandler } from '../../middlewares/errorHandler';
import { requestId } from '../../middlewares/validation';
import { Alias } from '../../models/Alias';

/**
 * Integration Tests for Complete Alias Creation and Resolution Workflow
 *
 * Tests the end-to-end flow:
 * 1. Create alias with valid Cardano address
 * 2. Resolve alias to get original address
 * 3. Verify usage counter increment
 * 4. Test alias expiry handling
 */

describe('Alias Workflow Integration Tests', () => {
  let app: express.Application;

  beforeAll(async () => {
    // Database and Redis connections are handled by global test setup
    // Set up Express app for testing
    app = express();
    app.use(express.json());
    app.use(requestId);

    // Alias routes
    app.post('/api/v1/aliases', asyncHandler(AliasController.createAlias));
    app.get('/api/v1/aliases/:code', asyncHandler(AliasController.getAlias));
    app.get('/api/v1/resolve/:query', asyncHandler(AliasController.resolveAlias));
    app.delete('/api/v1/aliases/:code', asyncHandler(AliasController.deleteAlias));

    // Explorer routes for address validation
    app.get(
      '/api/v1/explorer/address/:address',
      asyncHandler(ExplorerController.getAddressDetails)
    );

    // Health route
    app.get('/api/v1/health', asyncHandler(HealthController.healthCheck));
  });

  afterAll(async () => {
    // Database and Redis disconnections are handled by global test teardown
  });

  beforeEach(async () => {
    // Clear aliases collection before each test
    await Alias.deleteMany({});
  });

  describe('Complete Alias Creation and Resolution Flow', () => {
    it('should create alias, resolve it, and track usage correctly', async () => {
      const testAddress =
        'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';
      const userEmail = 'test@example.com';

      // Step 1: Create alias
      const createResponse = await request(app)
        .post('/api/v1/aliases')
        .send({
          cardanoAddress: testAddress,
          userEmail: userEmail,
          customName: 'Test Alias',
        })
        .expect(201);

      expect(createResponse.body.success).toBe(true);
      expect(createResponse.body.data).toHaveProperty('shortCode');
      expect(createResponse.body.data).toHaveProperty('qrCodeUrl');
      expect(createResponse.body.data.cardanoAddress).toBe(testAddress);
      expect(createResponse.body.data.customName).toBe('Test Alias');

      const shortCode = createResponse.body.data.shortCode;
      expect(shortCode).toHaveLength(16);

      // Step 2: Get alias details
      const getResponse = await request(app).get(`/api/v1/aliases/${shortCode}`).expect(200);

      expect(getResponse.body.success).toBe(true);
      expect(getResponse.body.data.cardanoAddress).toBe(testAddress);
      expect(getResponse.body.data.isActive).toBe(true);
      expect(getResponse.body.data.useCount).toBe(0);

      // Step 3: Resolve alias (should increment usage counter)
      const resolveResponse = await request(app).get(`/api/v1/resolve/${shortCode}`).expect(200);

      expect(resolveResponse.body.success).toBe(true);
      expect(resolveResponse.body.data.cardanoAddress).toBe(testAddress);
      expect(resolveResponse.body.data.shortCode).toBe(shortCode);

      // Step 4: Verify usage counter was incremented
      const getAfterResolveResponse = await request(app)
        .get(`/api/v1/aliases/${shortCode}`)
        .expect(200);

      expect(getAfterResolveResponse.body.data.useCount).toBe(1);

      // Step 5: Resolve again to verify counter increments
      await request(app).get(`/api/v1/resolve/${shortCode}`).expect(200);

      const getFinalResponse = await request(app).get(`/api/v1/aliases/${shortCode}`).expect(200);

      expect(getFinalResponse.body.data.useCount).toBe(2);
    });

    it('should handle invalid Cardano addresses during creation', async () => {
      const invalidAddress = 'invalid_cardano_address';

      const response = await request(app)
        .post('/api/v1/aliases')
        .send({
          cardanoAddress: invalidAddress,
          userEmail: 'test@example.com',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error.message).toContain('Invalid Cardano address');
    });

    it('should handle expired aliases correctly', async () => {
      const testAddress =
        'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';

      // Create alias
      const createResponse = await request(app)
        .post('/api/v1/aliases')
        .send({
          cardanoAddress: testAddress,
          userEmail: 'test@example.com',
        })
        .expect(201);

      const shortCode = createResponse.body.data.shortCode;

      // Manually expire the alias in the database
      await Alias.findOneAndUpdate(
        { shortCode },
        {
          expiresAt: new Date(Date.now() - 1000), // 1 second ago
          isActive: false,
        }
      );

      // Try to resolve expired alias
      const resolveResponse = await request(app).get(`/api/v1/resolve/${shortCode}`).expect(404);

      expect(resolveResponse.body.success).toBe(false);
      expect(resolveResponse.body.error.message).toContain('expired');
    });

    it('should handle non-existent aliases', async () => {
      const nonExistentCode = 'NONEXISTENT1234';

      const response = await request(app).get(`/api/v1/resolve/${nonExistentCode}`).expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('not found');
    });

    it('should delete aliases correctly', async () => {
      const testAddress =
        'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';

      // Create alias
      const createResponse = await request(app)
        .post('/api/v1/aliases')
        .send({
          cardanoAddress: testAddress,
          userEmail: 'test@example.com',
        })
        .expect(201);

      const shortCode = createResponse.body.data.shortCode;

      // Delete alias
      await request(app).delete(`/api/v1/aliases/${shortCode}`).expect(200);

      // Try to resolve deleted alias
      await request(app).get(`/api/v1/resolve/${shortCode}`).expect(404);

      // Try to get deleted alias
      await request(app).get(`/api/v1/aliases/${shortCode}`).expect(404);
    });

    it('should handle concurrent alias creation with same address', async () => {
      const testAddress =
        'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';

      // Create multiple aliases concurrently with same address
      const promises = Array.from({ length: 3 }, (_, i) =>
        request(app)
          .post('/api/v1/aliases')
          .send({
            cardanoAddress: testAddress,
            userEmail: `test${i}@example.com`,
            customName: `Test Alias ${i}`,
          })
      );

      const responses = await Promise.all(promises);

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });

      // All should have unique short codes
      const shortCodes = responses.map(r => r.body.data.shortCode);
      const uniqueShortCodes = new Set(shortCodes);
      expect(uniqueShortCodes.size).toBe(3);

      // All should resolve to the same address
      for (const shortCode of shortCodes) {
        const resolveResponse = await request(app).get(`/api/v1/resolve/${shortCode}`).expect(200);

        expect(resolveResponse.body.data.cardanoAddress).toBe(testAddress);
      }
    });

    it('should maintain data consistency across multiple operations', async () => {
      const testAddress =
        'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';

      // Create alias
      const createResponse = await request(app)
        .post('/api/v1/aliases')
        .send({
          cardanoAddress: testAddress,
          userEmail: 'test@example.com',
        })
        .expect(201);

      const shortCode = createResponse.body.data.shortCode;

      // Perform multiple resolve operations
      const resolvePromises = Array.from({ length: 5 }, () =>
        request(app).get(`/api/v1/resolve/${shortCode}`)
      );

      const resolveResponses = await Promise.all(resolvePromises);

      // All should succeed
      resolveResponses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.data.cardanoAddress).toBe(testAddress);
      });

      // Check final usage count
      const finalResponse = await request(app).get(`/api/v1/aliases/${shortCode}`).expect(200);

      expect(finalResponse.body.data.useCount).toBe(5);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle malformed requests gracefully', async () => {
      // Missing required fields
      await request(app).post('/api/v1/aliases').send({}).expect(400);

      // Invalid JSON structure
      await request(app)
        .post('/api/v1/aliases')
        .send({
          cardanoAddress: null,
          userEmail: 'invalid-email',
        })
        .expect(400);
    });

    it('should validate email format when provided', async () => {
      const testAddress =
        'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';

      const response = await request(app)
        .post('/api/v1/aliases')
        .send({
          cardanoAddress: testAddress,
          userEmail: 'invalid-email-format',
        })
        .expect(400);

      expect(response.body.error.message).toContain('email');
    });

    it('should handle very long custom names', async () => {
      const testAddress =
        'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';
      const longName = 'A'.repeat(1000); // Very long name

      const response = await request(app)
        .post('/api/v1/aliases')
        .send({
          cardanoAddress: testAddress,
          userEmail: 'test@example.com',
          customName: longName,
        })
        .expect(400);

      expect(response.body.error.message).toContain('name');
    });
  });
});
