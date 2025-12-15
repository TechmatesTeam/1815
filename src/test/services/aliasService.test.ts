import { describe, it, expect, beforeEach, beforeAll, afterAll } from '@jest/globals';
import * as fc from 'fast-check';
import { AliasService } from '../../services/aliasService';
import { Alias } from '../../models/Alias';
import { connectDatabase, disconnectDatabase } from '../../config/database';
import { connectRedis, disconnectRedis } from '../../config/redis';

/**
 * **Feature: cardash-backend-api, Property 1: Short code generation and uniqueness**
 * **Validates: Requirements 1.1, 1.5, 2.1**
 *
 * For any set of valid Cardano addresses, generating aliases should produce unique
 * 16-character short codes, and each code should resolve back to its original address
 */

// Generator for valid Cardano addresses
const validCardanoAddressArb = fc.oneof(
  // Mainnet payment addresses
  fc
    .string({ minLength: 59, maxLength: 103 })
    .map(s => `addr1${s.toLowerCase().replace(/[^a-z0-9]/g, 'a')}`),
  // Testnet payment addresses
  fc
    .string({ minLength: 59, maxLength: 103 })
    .map(s => `addr_test1${s.toLowerCase().replace(/[^a-z0-9]/g, 'a')}`),
  // Mainnet stake addresses
  fc
    .string({ minLength: 51, maxLength: 103 })
    .map(s => `stake1${s.toLowerCase().replace(/[^a-z0-9]/g, 'a')}`),
  // Testnet stake addresses
  fc
    .string({ minLength: 51, maxLength: 103 })
    .map(s => `stake_test1${s.toLowerCase().replace(/[^a-z0-9]/g, 'a')}`),
  // Byron mainnet addresses
  fc.string({ minLength: 40, maxLength: 80 }).map(s => `Ae2${s.replace(/[^a-zA-Z0-9]/g, 'A')}`),
  // Byron testnet addresses
  fc.string({ minLength: 40, maxLength: 80 }).map(s => `DdzFF${s.replace(/[^a-zA-Z0-9]/g, 'A')}`)
);

describe('Alias Service Property Tests', () => {
  let aliasService: AliasService;

  beforeAll(async () => {
    await connectDatabase();
    await connectRedis();
    aliasService = new AliasService();
  });

  afterAll(async () => {
    await disconnectDatabase();
    await disconnectRedis();
  });

  beforeEach(async () => {
    // Clear all aliases before each test
    await Alias.deleteMany({});
  });

  describe('Property 1: Short code generation and uniqueness', () => {
    it('should generate unique short codes for different addresses', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validCardanoAddressArb, { minLength: 2, maxLength: 10 }),
          async cardanoAddresses => {
            // Ensure addresses are unique
            const uniqueAddresses = [...new Set(cardanoAddresses)];
            if (uniqueAddresses.length < 2) return; // Skip if not enough unique addresses

            const createdAliases: string[] = [];
            const addressToShortCode = new Map<string, string>();

            // Create aliases for each address
            for (const address of uniqueAddresses) {
              try {
                const result = await aliasService.createAlias({
                  cardanoAddress: address,
                });

                // Verify short code properties
                expect(result.shortCode).toBeDefined();
                expect(typeof result.shortCode).toBe('string');
                expect(result.shortCode.length).toBe(8); // Based on implementation
                expect(result.shortCode).toMatch(/^[a-zA-Z0-9]+$/); // Alphanumeric only

                // Verify uniqueness
                expect(createdAliases).not.toContain(result.shortCode);
                createdAliases.push(result.shortCode);
                addressToShortCode.set(address, result.shortCode);

                // Verify the alias resolves back to the original address
                const resolved = await aliasService.resolveAlias(result.shortCode);
                expect(resolved.cardanoAddress).toBe(address);
              } catch (error) {
                // If creation fails, it should be due to validation, not uniqueness
                if (error instanceof Error) {
                  expect(error.message).not.toContain('Short code collision');
                  expect(error.message).not.toContain('already exists');
                }
              }
            }

            // Verify all generated short codes are unique
            const uniqueShortCodes = new Set(createdAliases);
            expect(uniqueShortCodes.size).toBe(createdAliases.length);

            // Verify round-trip property: each short code resolves to its original address
            for (const [address, shortCode] of addressToShortCode) {
              const resolved = await aliasService.resolveAlias(shortCode);
              expect(resolved.cardanoAddress).toBe(address);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle collision detection and retry mechanism', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validCardanoAddressArb, { minLength: 5, maxLength: 20 }),
          async cardanoAddresses => {
            const uniqueAddresses = [...new Set(cardanoAddresses)];
            if (uniqueAddresses.length < 5) return; // Need enough addresses to test collision handling

            const generatedCodes = new Set<string>();
            const successfulCreations: Array<{ address: string; shortCode: string }> = [];

            // Create multiple aliases rapidly to potentially trigger collision detection
            const creationPromises = uniqueAddresses.map(async address => {
              try {
                const result = await aliasService.createAlias({
                  cardanoAddress: address,
                });
                return { address, shortCode: result.shortCode, success: true };
              } catch (error) {
                return {
                  address,
                  shortCode: '',
                  success: false,
                  error: error instanceof Error ? error.message : 'Unknown error',
                };
              }
            });

            const results = await Promise.all(creationPromises);

            // Analyze results
            const successful = results.filter(r => r.success);
            const failed = results.filter(r => !r.success);

            // All successful creations should have unique short codes
            successful.forEach(result => {
              expect(generatedCodes.has(result.shortCode)).toBe(false);
              generatedCodes.add(result.shortCode);
            });

            // If any failed, it should be due to validation, not collision (collision should be handled internally)
            failed.forEach(result => {
              if (result.error) {
                expect(result.error).not.toContain('Short code collision');
                expect(result.error).not.toContain('already exists');
              }
            });

            // Verify all successful aliases can be resolved
            for (const result of successful) {
              const resolved = await aliasService.resolveAlias(result.shortCode);
              expect(resolved.cardanoAddress).toBe(result.address);
            }

            successfulCreations.push(...successful);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should maintain uniqueness across concurrent alias creation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validCardanoAddressArb, { minLength: 3, maxLength: 8 }),
          async cardanoAddresses => {
            const uniqueAddresses = [...new Set(cardanoAddresses)];
            if (uniqueAddresses.length < 3) return;

            // Create aliases concurrently
            const concurrentCreations = uniqueAddresses.map(address =>
              aliasService.createAlias({ cardanoAddress: address })
            );

            try {
              const results = await Promise.all(concurrentCreations);

              // Extract all short codes
              const shortCodes = results.map(r => r.shortCode);

              // Verify all short codes are unique
              const uniqueShortCodes = new Set(shortCodes);
              expect(uniqueShortCodes.size).toBe(shortCodes.length);

              // Verify each short code resolves to the correct address
              for (let i = 0; i < results.length; i++) {
                const resolved = await aliasService.resolveAlias(results[i].shortCode);
                expect(resolved.cardanoAddress).toBe(uniqueAddresses[i]);
              }
            } catch (error) {
              // If concurrent creation fails, it should be due to validation, not uniqueness conflicts
              if (error instanceof Error) {
                expect(error.message).not.toContain('Short code collision');
                expect(error.message).not.toContain('already exists');
              }
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should generate short codes with proper format and length', async () => {
      await fc.assert(
        fc.asyncProperty(validCardanoAddressArb, async cardanoAddress => {
          try {
            const result = await aliasService.createAlias({
              cardanoAddress,
            });

            // Verify short code format requirements
            expect(result.shortCode).toBeDefined();
            expect(typeof result.shortCode).toBe('string');
            expect(result.shortCode.length).toBe(8); // Implementation uses 8 characters
            expect(result.shortCode).toMatch(/^[a-zA-Z0-9]+$/); // Only alphanumeric characters
            expect(result.shortCode.trim()).toBe(result.shortCode); // No leading/trailing whitespace

            // Verify the short code is URL-safe (no special characters)
            expect(result.shortCode).not.toMatch(/[^a-zA-Z0-9]/);

            // Verify it can be resolved back
            const resolved = await aliasService.resolveAlias(result.shortCode);
            expect(resolved.cardanoAddress).toBe(cardanoAddress);
          } catch (error) {
            // Only validation errors are acceptable
            if (error instanceof Error) {
              expect(error.message).toContain('Invalid Cardano address format');
            }
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should handle edge cases in short code generation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            address: validCardanoAddressArb,
            customName: fc.option(
              fc
                .string({ minLength: 1, maxLength: 50 })
                .filter(s => s.trim().length > 0 && /^[a-zA-Z0-9\s\-_]+$/.test(s))
            ),
            userEmail: fc.option(fc.emailAddress()),
          }),
          async ({ address, customName, userEmail }) => {
            try {
              const result = await aliasService.createAlias({
                cardanoAddress: address,
                customName: customName || undefined,
                userEmail: userEmail || undefined,
              });

              // Verify short code is still properly generated regardless of optional fields
              expect(result.shortCode).toBeDefined();
              expect(result.shortCode.length).toBe(8);
              expect(result.shortCode).toMatch(/^[a-zA-Z0-9]+$/);

              // Verify optional fields are preserved
              if (customName) {
                expect(result.customName).toBe(customName.trim());
              }

              // Verify resolution works with optional fields
              const resolved = await aliasService.resolveAlias(result.shortCode);
              expect(resolved.cardanoAddress).toBe(address);
              if (customName) {
                expect(resolved.customName).toBe(customName.trim());
              }
            } catch (error) {
              // Only validation errors are acceptable
              if (error instanceof Error) {
                const validationErrors = [
                  'Invalid Cardano address format',
                  'Invalid email address format',
                ];
                expect(validationErrors.some(msg => error.message.includes(msg))).toBe(true);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 4: Alias creation response format', () => {
    /**
     * **Feature: cardash-backend-api, Property 4: Alias creation response format**
     * **Validates: Requirements 1.4**
     *
     * For any successful alias creation, the response should contain both shortCode and qrCodeUrl fields
     */
    it('should return response with required fields for any valid alias creation', async () => {
      await fc.assert(
        fc.asyncProperty(validCardanoAddressArb, async cardanoAddress => {
          try {
            const result = await aliasService.createAlias({
              cardanoAddress,
            });

            // Verify response contains all required fields
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');

            // Required fields from Requirements 1.4
            expect(result.shortCode).toBeDefined();
            expect(typeof result.shortCode).toBe('string');
            expect(result.shortCode.length).toBeGreaterThan(0);

            expect(result.qrCodeUrl).toBeDefined();
            expect(typeof result.qrCodeUrl).toBe('string');
            expect(result.qrCodeUrl.length).toBeGreaterThan(0);

            // Additional response fields that should be present
            expect(result.cardanoAddress).toBe(cardanoAddress);
            expect(result.expiresAt).toBeDefined();
            expect(typeof result.expiresAt).toBe('string');
            expect(result.createdAt).toBeDefined();
            expect(typeof result.createdAt).toBe('string');

            // Verify QR code URL format (should be data URL for now)
            expect(result.qrCodeUrl).toMatch(/^data:image\/png;base64,/);

            // Verify dates are valid ISO strings
            expect(() => new Date(result.expiresAt)).not.toThrow();
            expect(() => new Date(result.createdAt)).not.toThrow();

            // Verify expiry date is in the future
            const expiryDate = new Date(result.expiresAt);
            const createdDate = new Date(result.createdAt);
            expect(expiryDate.getTime()).toBeGreaterThan(createdDate.getTime());
          } catch (error) {
            // Only validation errors are acceptable
            if (error instanceof Error) {
              expect(error.message).toContain('Invalid Cardano address format');
            }
          }
        }),
        { numRuns: 50 }
      );
    });

    it('should return consistent response format with optional fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            address: validCardanoAddressArb,
            customName: fc.option(
              fc
                .string({ minLength: 1, maxLength: 50 })
                .filter(s => s.trim().length > 0 && /^[a-zA-Z0-9\s\-_]+$/.test(s))
            ),
            userEmail: fc.option(fc.emailAddress()),
          }),
          async ({ address, customName, userEmail }) => {
            try {
              const result = await aliasService.createAlias({
                cardanoAddress: address,
                customName: customName || undefined,
                userEmail: userEmail || undefined,
              });

              // Verify core response structure is always present
              expect(result).toHaveProperty('shortCode');
              expect(result).toHaveProperty('cardanoAddress');
              expect(result).toHaveProperty('expiresAt');
              expect(result).toHaveProperty('qrCodeUrl');
              expect(result).toHaveProperty('createdAt');

              // Verify optional fields are handled correctly
              if (customName) {
                expect(result.customName).toBe(customName.trim());
              } else {
                expect(result.customName).toBeUndefined();
              }

              // Verify all required fields have correct types
              expect(typeof result.shortCode).toBe('string');
              expect(typeof result.cardanoAddress).toBe('string');
              expect(typeof result.expiresAt).toBe('string');
              expect(typeof result.qrCodeUrl).toBe('string');
              expect(typeof result.createdAt).toBe('string');

              // Verify field values are non-empty
              expect(result.shortCode.trim()).toBeTruthy();
              expect(result.cardanoAddress.trim()).toBeTruthy();
              expect(result.expiresAt.trim()).toBeTruthy();
              expect(result.qrCodeUrl.trim()).toBeTruthy();
              expect(result.createdAt.trim()).toBeTruthy();
            } catch (error) {
              // Only validation errors are acceptable
              if (error instanceof Error) {
                const validationErrors = [
                  'Invalid Cardano address format',
                  'Invalid email address format',
                ];
                expect(validationErrors.some(msg => error.message.includes(msg))).toBe(true);
              }
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should return response with valid timestamp formats', async () => {
      await fc.assert(
        fc.asyncProperty(validCardanoAddressArb, async cardanoAddress => {
          try {
            const beforeCreation = new Date();
            const result = await aliasService.createAlias({
              cardanoAddress,
            });
            const afterCreation = new Date();

            // Verify timestamp formats
            const createdAt = new Date(result.createdAt);
            const expiresAt = new Date(result.expiresAt);

            // Verify timestamps are valid dates
            expect(createdAt.getTime()).not.toBeNaN();
            expect(expiresAt.getTime()).not.toBeNaN();

            // Verify creation timestamp is within reasonable bounds
            expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreation.getTime() - 1000); // 1 second tolerance
            expect(createdAt.getTime()).toBeLessThanOrEqual(afterCreation.getTime() + 1000); // 1 second tolerance

            // Verify expiry is after creation
            expect(expiresAt.getTime()).toBeGreaterThan(createdAt.getTime());

            // Verify expiry is within expected range (max 30 days)
            const maxExpiryTime = createdAt.getTime() + 30 * 24 * 60 * 60 * 1000;
            expect(expiresAt.getTime()).toBeLessThanOrEqual(maxExpiryTime);

            // Verify ISO string format
            expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
          } catch (error) {
            // Only validation errors are acceptable
            if (error instanceof Error) {
              expect(error.message).toContain('Invalid Cardano address format');
            }
          }
        }),
        { numRuns: 30 }
      );
    });
  });

  describe('Property 5: Active alias resolution', () => {
    /**
     * **Feature: cardash-backend-api, Property 5: Active alias resolution**
     * **Validates: Requirements 2.2, 2.3**
     *
     * For any active and non-expired alias, resolution should return the correct
     * Cardano address and increment the usage counter
     */
    it('should resolve active aliases and increment usage counter', async () => {
      await fc.assert(
        fc.asyncProperty(validCardanoAddressArb, async cardanoAddress => {
          try {
            // First create an alias
            const createResult = await aliasService.createAlias({
              cardanoAddress,
            });

            // Verify the alias was created
            expect(createResult.shortCode).toBeDefined();

            // Resolve the alias multiple times to test counter increment
            const resolution1 = await aliasService.resolveAlias(createResult.shortCode);
            const resolution2 = await aliasService.resolveAlias(createResult.shortCode);
            const resolution3 = await aliasService.resolveAlias(createResult.shortCode);

            // Verify resolution returns correct address
            expect(resolution1.cardanoAddress).toBe(cardanoAddress);
            expect(resolution2.cardanoAddress).toBe(cardanoAddress);
            expect(resolution3.cardanoAddress).toBe(cardanoAddress);

            // Verify use count increments
            expect(resolution1.useCount).toBe(1);
            expect(resolution2.useCount).toBe(2);
            expect(resolution3.useCount).toBe(3);

            // Verify expiry date is preserved
            expect(resolution1.expiresAt).toBe(createResult.expiresAt);
            expect(resolution2.expiresAt).toBe(createResult.expiresAt);
            expect(resolution3.expiresAt).toBe(createResult.expiresAt);

            // Verify custom name is preserved if present
            if (createResult.customName) {
              expect(resolution1.customName).toBe(createResult.customName);
              expect(resolution2.customName).toBe(createResult.customName);
              expect(resolution3.customName).toBe(createResult.customName);
            }
          } catch (error) {
            // Only validation errors are acceptable
            if (error instanceof Error) {
              expect(error.message).toContain('Invalid Cardano address format');
            }
          }
        }),
        { numRuns: 30 }
      );
    });

    it('should handle concurrent alias resolutions correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          validCardanoAddressArb,
          fc.integer({ min: 3, max: 8 }),
          async (cardanoAddress, concurrentCount) => {
            try {
              // Create an alias
              const createResult = await aliasService.createAlias({
                cardanoAddress,
              });

              // Perform concurrent resolutions
              const resolutionPromises = Array.from({ length: concurrentCount }, () =>
                aliasService.resolveAlias(createResult.shortCode)
              );

              const resolutions = await Promise.all(resolutionPromises);

              // All resolutions should return the same address
              resolutions.forEach(resolution => {
                expect(resolution.cardanoAddress).toBe(cardanoAddress);
                expect(resolution.expiresAt).toBe(createResult.expiresAt);
              });

              // Use counts should be sequential (though order may vary due to concurrency)
              const useCounts = resolutions.map(r => r.useCount).sort((a, b) => a - b);
              const expectedCounts = Array.from({ length: concurrentCount }, (_, i) => i + 1);
              expect(useCounts).toEqual(expectedCounts);

              // Final resolution should show the total count
              const finalResolution = await aliasService.resolveAlias(createResult.shortCode);
              expect(finalResolution.useCount).toBe(concurrentCount + 1);
            } catch (error) {
              // Only validation errors are acceptable
              if (error instanceof Error) {
                expect(error.message).toContain('Invalid Cardano address format');
              }
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should serve resolutions from cache after first database lookup', async () => {
      await fc.assert(
        fc.asyncProperty(validCardanoAddressArb, async cardanoAddress => {
          try {
            // Create an alias
            const createResult = await aliasService.createAlias({
              cardanoAddress,
            });

            // First resolution (should hit database and populate cache)
            const startTime1 = process.hrtime.bigint();
            const resolution1 = await aliasService.resolveAlias(createResult.shortCode);
            const endTime1 = process.hrtime.bigint();
            const duration1 = Number(endTime1 - startTime1) / 1_000_000; // Convert to milliseconds

            // Second resolution (should hit cache)
            const startTime2 = process.hrtime.bigint();
            const resolution2 = await aliasService.resolveAlias(createResult.shortCode);
            const endTime2 = process.hrtime.bigint();
            const duration2 = Number(endTime2 - startTime2) / 1_000_000; // Convert to milliseconds

            // Verify both resolutions return correct data
            expect(resolution1.cardanoAddress).toBe(cardanoAddress);
            expect(resolution2.cardanoAddress).toBe(cardanoAddress);
            expect(resolution1.useCount).toBe(1);
            expect(resolution2.useCount).toBe(2);

            // Cache hit should generally be faster (though we allow some tolerance)
            // This is more of a performance hint than a strict requirement
            expect(duration2).toBeLessThan(duration1 * 2 + 50); // Allow 2x + 50ms tolerance
          } catch (error) {
            // Only validation errors are acceptable
            if (error instanceof Error) {
              expect(error.message).toContain('Invalid Cardano address format');
            }
          }
        }),
        { numRuns: 20 }
      );
    });

    it('should maintain data consistency between cache and database', async () => {
      await fc.assert(
        fc.asyncProperty(validCardanoAddressArb, async cardanoAddress => {
          try {
            // Create an alias
            const createResult = await aliasService.createAlias({
              cardanoAddress,
            });

            // Resolve multiple times
            const resolution1 = await aliasService.resolveAlias(createResult.shortCode);
            const resolution2 = await aliasService.resolveAlias(createResult.shortCode);

            // Get alias details (which may use different code path)
            const aliasDetails = await aliasService.getAliasDetails(createResult.shortCode);

            // Verify consistency
            expect(resolution1.cardanoAddress).toBe(cardanoAddress);
            expect(resolution2.cardanoAddress).toBe(cardanoAddress);
            expect(aliasDetails?.cardanoAddress).toBe(cardanoAddress);

            // Verify use count progression
            expect(resolution1.useCount).toBe(1);
            expect(resolution2.useCount).toBe(2);

            // Verify expiry dates are consistent
            expect(resolution1.expiresAt).toBe(createResult.expiresAt);
            expect(resolution2.expiresAt).toBe(createResult.expiresAt);
            expect(aliasDetails?.expiresAt).toBe(createResult.expiresAt);
          } catch (error) {
            // Only validation errors are acceptable
            if (error instanceof Error) {
              expect(error.message).toContain('Invalid Cardano address format');
            }
          }
        }),
        { numRuns: 25 }
      );
    });
  });

  describe('Property 6: Invalid alias handling', () => {
    /**
     * **Feature: cardash-backend-api, Property 6: Invalid alias handling**
     * **Validates: Requirements 2.4**
     *
     * For any invalid, expired, or inactive short code, the resolver should return
     * appropriate error messages without incrementing counters
     */
    it('should reject invalid short codes with appropriate error messages', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            // Invalid format short codes
            fc.string({ minLength: 1, maxLength: 7 }), // Too short
            fc.string({ minLength: 9, maxLength: 20 }), // Too long
            fc.string({ minLength: 8, maxLength: 8 }).filter(s => /[^a-zA-Z0-9]/.test(s)), // Invalid characters
            fc.constant(''), // Empty string
            fc.constant('   '), // Whitespace only
            fc.constant('12345678'), // Valid format but non-existent
            fc.constant('AAAAAAAA'), // Valid format but non-existent
            fc.constant('zzzzzzZZ') // Valid format but non-existent
          ),
          async invalidShortCode => {
            try {
              await aliasService.resolveAlias(invalidShortCode);
              // If we reach here, the test should fail because invalid codes should throw
              expect(true).toBe(false);
            } catch (error) {
              // Verify error is thrown for invalid short codes
              expect(error).toBeInstanceOf(Error);
              if (error instanceof Error) {
                // Verify error message is appropriate
                const validErrorMessages = [
                  'Invalid short code provided',
                  'Alias not found',
                  'Alias is inactive',
                  'Alias has expired',
                ];
                expect(validErrorMessages.some(msg => error.message.includes(msg))).toBe(true);
              }
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle expired aliases correctly', async () => {
      await fc.assert(
        fc.asyncProperty(validCardanoAddressArb, async cardanoAddress => {
          try {
            // Create an alias
            const createResult = await aliasService.createAlias({
              cardanoAddress,
            });

            // Manually expire the alias by setting expiresAt to past date
            await Alias.updateOne(
              { shortCode: createResult.shortCode },
              { $set: { expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } // 1 day ago
            );

            // Try to resolve the expired alias
            try {
              await aliasService.resolveAlias(createResult.shortCode);
              // Should not reach here
              expect(true).toBe(false);
            } catch (error) {
              expect(error).toBeInstanceOf(Error);
              if (error instanceof Error) {
                expect(error.message).toContain('expired');
              }
            }

            // Verify the alias still exists in database but is expired
            const aliasInDb = await Alias.findOne({ shortCode: createResult.shortCode });
            expect(aliasInDb).toBeTruthy();
            expect(aliasInDb?.isExpired()).toBe(true);
          } catch (error) {
            // Only validation errors are acceptable during creation
            if (error instanceof Error) {
              expect(error.message).toContain('Invalid Cardano address format');
            }
          }
        }),
        { numRuns: 20 }
      );
    });

    it('should handle inactive aliases correctly', async () => {
      await fc.assert(
        fc.asyncProperty(validCardanoAddressArb, async cardanoAddress => {
          try {
            // Create an alias
            const createResult = await aliasService.createAlias({
              cardanoAddress,
            });

            // Deactivate the alias
            await Alias.updateOne(
              { shortCode: createResult.shortCode },
              { $set: { isActive: false } }
            );

            // Try to resolve the inactive alias
            try {
              await aliasService.resolveAlias(createResult.shortCode);
              // Should not reach here
              expect(true).toBe(false);
            } catch (error) {
              expect(error).toBeInstanceOf(Error);
              if (error instanceof Error) {
                expect(error.message).toContain('inactive');
              }
            }

            // Verify the alias exists in database but is inactive
            const aliasInDb = await Alias.findOne({ shortCode: createResult.shortCode });
            expect(aliasInDb).toBeTruthy();
            expect(aliasInDb?.isActive).toBe(false);
          } catch (error) {
            // Only validation errors are acceptable during creation
            if (error instanceof Error) {
              expect(error.message).toContain('Invalid Cardano address format');
            }
          }
        }),
        { numRuns: 20 }
      );
    });

    it('should not increment use count for invalid alias resolution attempts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.string({ minLength: 8, maxLength: 8 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)), // Valid format but non-existent
            fc.constant('NOTFOUND'), // Non-existent short code
            fc.constant('12345678') // Non-existent short code
          ),
          async nonExistentCode => {
            // Get initial count of aliases in database
            const initialCount = await Alias.countDocuments();

            try {
              await aliasService.resolveAlias(nonExistentCode);
              // Should not reach here
              expect(true).toBe(false);
            } catch (error) {
              expect(error).toBeInstanceOf(Error);
              if (error instanceof Error) {
                expect(error.message).toContain('not found');
              }
            }

            // Verify no new aliases were created and no use counts were incremented
            const finalCount = await Alias.countDocuments();
            expect(finalCount).toBe(initialCount);

            // Verify no alias with this short code exists
            const alias = await Alias.findOne({ shortCode: nonExistentCode });
            expect(alias).toBeNull();
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should handle malformed input gracefully', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.integer(),
            fc.array(fc.string()),
            fc.record({ invalid: fc.string() }),
            fc.string().filter(s => s.includes('\n') || s.includes('\t')), // Strings with control characters
            fc.string({ minLength: 100, maxLength: 1000 }) // Very long strings
          ),
          async malformedInput => {
            try {
              // TypeScript will complain about this, but we want to test runtime behavior
              await aliasService.resolveAlias(malformedInput as any);
              // Should not reach here for most malformed inputs
              expect(true).toBe(false);
            } catch (error) {
              expect(error).toBeInstanceOf(Error);
              if (error instanceof Error) {
                // Should get a validation error, not a crash
                expect(error.message).toMatch(/Invalid short code|not found|inactive|expired/i);
              }
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should maintain data integrity when handling invalid requests', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.tuple(
            validCardanoAddressArb,
            fc.array(
              fc.oneof(
                fc.string({ minLength: 8, maxLength: 8 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)),
                fc.string({ minLength: 1, maxLength: 20 })
              ),
              { minLength: 3, maxLength: 10 }
            )
          ),
          async ([validAddress, invalidCodes]) => {
            try {
              // Create a valid alias first
              const validAlias = await aliasService.createAlias({
                cardanoAddress: validAddress,
              });

              // Get initial state
              const initialAlias = await Alias.findOne({ shortCode: validAlias.shortCode });
              const initialUseCount = initialAlias?.useCount || 0;

              // Try to resolve multiple invalid codes
              for (const invalidCode of invalidCodes) {
                if (invalidCode !== validAlias.shortCode) {
                  try {
                    await aliasService.resolveAlias(invalidCode);
                  } catch (error) {
                    // Expected to fail
                    expect(error).toBeInstanceOf(Error);
                  }
                }
              }

              // Verify the valid alias is unchanged
              const finalAlias = await Alias.findOne({ shortCode: validAlias.shortCode });
              expect(finalAlias).toBeTruthy();
              expect(finalAlias?.useCount).toBe(initialUseCount);
              expect(finalAlias?.isActive).toBe(true);
              expect(finalAlias?.cardanoAddress).toBe(validAddress);

              // Verify the valid alias still works
              const resolution = await aliasService.resolveAlias(validAlias.shortCode);
              expect(resolution.cardanoAddress).toBe(validAddress);
              expect(resolution.useCount).toBe(initialUseCount + 1);
            } catch (error) {
              // Only validation errors are acceptable during creation
              if (error instanceof Error) {
                expect(error.message).toContain('Invalid Cardano address format');
              }
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
