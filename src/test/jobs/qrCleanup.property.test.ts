import * as fc from 'fast-check';
import { Alias } from '@/models/Alias';
import { processQRCleanup } from '@/jobs/qrCleanupJob';
import { Job } from 'bull';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock fs module
jest.mock('fs/promises');
const mockFs = fs as jest.Mocked<typeof fs>;

/**
 * **Feature: cardash-backend-api, Property 32: QR code cleanup**
 * **Validates: Requirements 8.4**
 *
 * Property: For any expired alias with associated QR code files, maintenance jobs should remove the files from storage
 */

describe('QR Code Cleanup Property Tests', () => {
  const testQRPath = './test-qr-codes';

  beforeAll(async () => {
    // Clean up any existing test data
    await Alias.deleteMany({ shortCode: /^tqr/ });
  });

  beforeEach(async () => {
    // Clean up test data and reset mocks
    await Alias.deleteMany({ shortCode: /^tqr/ });
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  afterEach(async () => {
    // Clean up test data and reset mocks
    await Alias.deleteMany({ shortCode: /^tqr/ });
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  afterAll(async () => {
    // Final cleanup
    await Alias.deleteMany({ shortCode: /^tqr/ });
  });

  test('Property 32: QR code cleanup for expired aliases', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          expiredAliasCount: fc.integer({ min: 1, max: 5 }),
          activeAliasCount: fc.integer({ min: 0, max: 3 }),
          batchSize: fc.integer({ min: 5, max: 20 }),
        }),
        async ({ expiredAliasCount, activeAliasCount, batchSize }) => {
          // Reset mocks at the start of each property test
          jest.clearAllMocks();
          jest.resetAllMocks();

          // Clean up any existing test data
          await Alias.deleteMany({ shortCode: /^tqre/ });
          await Alias.deleteMany({ shortCode: /^tqra/ });

          const testId = Math.random().toString(36).substring(7);

          // Create expired aliases with QR codes
          const expiredAliases = [];
          for (let i = 0; i < expiredAliasCount; i++) {
            const alias = new Alias({
              shortCode: `tqre${testId}${i}`, // Unique per test run
              cardanoAddress:
                'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj0vs2qd4a',
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Future date for creation
              isActive: false, // Expired
              qrCodeUrl: `/qr-codes/tqre${testId}${i}.png`,
            });
            await alias.save();
            expiredAliases.push(alias);
          }

          // Create active aliases with QR codes (should not be cleaned)
          const activeAliases = [];
          for (let i = 0; i < activeAliasCount; i++) {
            const alias = new Alias({
              shortCode: `tqra${testId}${i}`, // Unique per test run
              cardanoAddress:
                'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj0vs2qd4a',
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Future date
              isActive: true, // Active
              qrCodeUrl: `/qr-codes/tqra${testId}${i}.png`,
            });
            await alias.save();
            activeAliases.push(alias);
          }

          // Mock file system operations
          mockFs.access.mockResolvedValue(undefined); // File exists
          mockFs.unlink.mockResolvedValue(undefined); // File deletion succeeds

          // Mock job object
          const mockJob = {
            data: { batchSize, dryRun: false, qrStoragePath: testQRPath },
            progress: jest.fn(),
          } as unknown as Job<any>;

          // Run the QR cleanup job
          const result = await processQRCleanup(mockJob);

          // Property 1: All expired aliases with QR codes should be processed
          expect(result.processed).toBe(expiredAliases.length);
          expect(result.cleaned).toBe(expiredAliases.length);
          expect(result.errors).toBe(0);

          // Property 2: File system operations should be called for each expired alias
          expect(mockFs.access).toHaveBeenCalledTimes(expiredAliases.length);
          expect(mockFs.unlink).toHaveBeenCalledTimes(expiredAliases.length);

          // Property 3: QR code URLs should be cleared from expired aliases
          const updatedExpiredAliases = await Alias.find({
            shortCode: new RegExp(`^tqre${testId}`),
            isActive: false,
          });

          for (const alias of updatedExpiredAliases) {
            expect(alias.qrCodeUrl).toBeUndefined();
          }

          // Property 4: Active aliases should remain unchanged
          const unchangedActiveAliases = await Alias.find({
            shortCode: new RegExp(`^tqra${testId}`),
            isActive: true,
          });

          expect(unchangedActiveAliases).toHaveLength(activeAliases.length);
          for (const alias of unchangedActiveAliases) {
            expect(alias.qrCodeUrl).toBeDefined();
          }

          // Property 5: Correct file paths should be used
          for (let i = 0; i < expiredAliases.length; i++) {
            const expectedFileName = path.basename(expiredAliases[i].qrCodeUrl!);
            const expectedPath = path.join(testQRPath, expectedFileName);
            expect(mockFs.access).toHaveBeenCalledWith(expectedPath);
            expect(mockFs.unlink).toHaveBeenCalledWith(expectedPath);
          }

          // Clean up test data
          await Alias.deleteMany({ shortCode: new RegExp(`^tqre${testId}`) });
          await Alias.deleteMany({ shortCode: new RegExp(`^tqra${testId}`) });
        }
      ),
      { numRuns: 20 }
    );
  });

  test('Property 32: QR code cleanup handles missing files gracefully', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          aliasCount: fc.integer({ min: 1, max: 5 }),
          missingFileCount: fc.integer({ min: 1, max: 3 }),
        }),
        async ({ aliasCount, missingFileCount }) => {
          // Reset mocks at the start of each property test
          jest.clearAllMocks();
          jest.resetAllMocks();

          // Clean up any existing test data
          await Alias.deleteMany({ shortCode: /^tqrm/ });

          // Ensure missingFileCount doesn't exceed aliasCount
          const actualMissingCount = Math.min(missingFileCount, aliasCount);
          const testId = Math.random().toString(36).substring(7);

          // Create expired aliases with QR codes
          const expiredAliases = [];
          for (let i = 0; i < aliasCount; i++) {
            const alias = new Alias({
              shortCode: `tqrm${testId}${i}`, // Unique per test run
              cardanoAddress:
                'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj0vs2qd4a',
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              isActive: false,
              qrCodeUrl: `/qr-codes/tqrm${testId}${i}.png`,
            });
            await alias.save();
            expiredAliases.push(alias);
          }

          // Mock file system operations
          let accessCallCount = 0;
          mockFs.access.mockImplementation(() => {
            accessCallCount++;
            if (accessCallCount <= actualMissingCount) {
              // Simulate file not found for first few calls
              const error = new Error('File not found') as any;
              error.code = 'ENOENT';
              return Promise.reject(error);
            }
            return Promise.resolve(undefined);
          });

          mockFs.unlink.mockResolvedValue(undefined);

          const mockJob = {
            data: { batchSize: aliasCount, dryRun: false, qrStoragePath: testQRPath },
            progress: jest.fn(),
          } as unknown as Job<any>;

          // Run the QR cleanup job
          const result = await processQRCleanup(mockJob);

          // Property 1: All aliases should be processed despite missing files
          expect(result.processed).toBe(aliasCount);
          expect(result.cleaned).toBe(aliasCount);
          expect(result.errors).toBe(0);

          // Property 2: File unlink should only be called for existing files
          expect(mockFs.unlink).toHaveBeenCalledTimes(aliasCount - actualMissingCount);

          // Property 3: QR code URLs should be cleared from all aliases (even with missing files)
          const updatedAliases = await Alias.find({
            shortCode: new RegExp(`^tqrm${testId}`),
            isActive: false,
          });

          expect(updatedAliases).toHaveLength(aliasCount);
          for (const alias of updatedAliases) {
            expect(alias.qrCodeUrl).toBeUndefined();
          }

          // Clean up test data
          await Alias.deleteMany({ shortCode: new RegExp(`^tqrm${testId}`) });
        }
      ),
      { numRuns: 15 }
    );
  });

  test('Property 32: Dry run mode does not modify files or database', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          aliasCount: fc.integer({ min: 1, max: 5 }),
        }),
        async ({ aliasCount }) => {
          // Reset mocks at the start of each property test
          jest.clearAllMocks();
          jest.resetAllMocks();

          // Clean up any existing test data
          await Alias.deleteMany({ shortCode: /^tqrd/ });

          const testId = Math.random().toString(36).substring(7);

          // Create expired aliases with QR codes
          const expiredAliases = [];
          for (let i = 0; i < aliasCount; i++) {
            const alias = new Alias({
              shortCode: `tqrd${testId}${i}`, // Unique per test run
              cardanoAddress:
                'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj0vs2qd4a',
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              isActive: false,
              qrCodeUrl: `/qr-codes/tqrd${testId}${i}.png`,
            });
            await alias.save();
            expiredAliases.push(alias);
          }

          const mockJob = {
            data: { batchSize: aliasCount, dryRun: true, qrStoragePath: testQRPath },
            progress: jest.fn(),
          } as unknown as Job<any>;

          // Run the QR cleanup job in dry run mode
          const result = await processQRCleanup(mockJob);

          // Property 1: Dry run should report what would be cleaned
          expect(result.processed).toBe(aliasCount);
          expect(result.cleaned).toBe(aliasCount);
          expect(result.errors).toBe(0);

          // Property 2: No file system operations should be performed
          expect(mockFs.access).not.toHaveBeenCalled();
          expect(mockFs.unlink).not.toHaveBeenCalled();

          // Property 3: Database should remain unchanged
          const unchangedAliases = await Alias.find({
            shortCode: new RegExp(`^tqrd${testId}`),
            isActive: false,
          });

          expect(unchangedAliases).toHaveLength(aliasCount);
          for (const alias of unchangedAliases) {
            expect(alias.qrCodeUrl).toBeDefined();
          }

          // Clean up test data
          await Alias.deleteMany({ shortCode: new RegExp(`^tqrd${testId}`) });
        }
      ),
      { numRuns: 10 }
    );
  });
});
