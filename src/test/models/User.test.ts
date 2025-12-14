import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fc from 'fast-check';
import { User, IUserDocument } from '../../models/User';
import { encryptData, decryptData, isValidEmail } from '../../utils/validation';

describe('User Model Property Tests', () => {
  beforeEach(async () => {
    await User.deleteMany({});
  });

  describe('Property 21: Email encryption', () => {
    it('should encrypt and decrypt email addresses correctly', async () => {
      await fc.assert(
        fc.asyncProperty(fc.emailAddress(), async email => {
          const user = new User({
            email: email.toLowerCase(),
            notificationPreferences: {
              aliasExpiry: true,
              featureUpdates: false,
              ecosystemNews: false,
            },
          });

          await user.save();

          // Email should be encrypted in database
          expect(user.encryptedEmail).toBeDefined();
          expect(user.encryptedEmail).not.toBe(email);
          expect(user.encryptedEmail.includes(':')).toBe(true); // Our encryption format includes colons

          // Should be able to decrypt email
          const decryptedEmail = user.getDecryptedEmail();
          expect(decryptedEmail).toBe(email.toLowerCase());
        }),
        { numRuns: 50 }
      );
    });

    it('should handle encryption/decryption roundtrip for various email formats', async () => {
      await fc.assert(
        fc.property(
          fc
            .oneof(
              fc.emailAddress(),
              fc.string({ minLength: 3, maxLength: 20 }).map(s => s + '@example.com'),
              fc.string({ minLength: 3, maxLength: 20 }).map(s => s + '@test.org'),
              fc.constant('user@domain.co.uk'),
              fc.constant('test.email+tag@example.com')
            )
            .filter(email => isValidEmail(email)),
          email => {
            const encrypted = encryptData(email);
            const decrypted = decryptData(encrypted);

            expect(decrypted).toBe(email);
            expect(encrypted).not.toBe(email);
            expect(encrypted.split(':').length).toBe(2); // iv:encrypted
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate unique encrypted values for same email', async () => {
      await fc.assert(
        fc.property(fc.emailAddress(), email => {
          const encrypted1 = encryptData(email);
          const encrypted2 = encryptData(email);

          // Different encrypted values due to random IV
          expect(encrypted1).not.toBe(encrypted2);

          // But both decrypt to same value
          expect(decryptData(encrypted1)).toBe(email);
          expect(decryptData(encrypted2)).toBe(email);
        }),
        { numRuns: 30 }
      );
    });

    it('should fail decryption for tampered data', async () => {
      await fc.assert(
        fc.property(
          fc.emailAddress(),
          fc.integer({ min: 0, max: 1 }), // Which part to tamper with
          (email, tamperPart) => {
            const encrypted = encryptData(email);
            const parts = encrypted.split(':');

            // Tamper with one part
            parts[tamperPart] = parts[tamperPart].slice(0, -2) + 'xx';
            const tamperedEncrypted = parts.join(':');

            expect(() => decryptData(tamperedEncrypted)).toThrow();
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Email validation', () => {
    it('should accept valid email addresses', async () => {
      await fc.assert(
        fc.asyncProperty(fc.emailAddress(), async email => {
          const user = new User({
            email,
            notificationPreferences: {
              aliasExpiry: true,
              featureUpdates: false,
              ecosystemNews: false,
            },
          });

          await expect(user.save()).resolves.toBeDefined();
          expect(user.email).toBe(email.toLowerCase());
        }),
        { numRuns: 50 }
      );
    });

    it('should reject invalid email addresses', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.string().filter(s => !s.includes('@')), // No @ symbol
            fc.string().filter(s => s.includes('@') && !s.includes('.')), // No domain
            fc.constant(''),
            fc.constant('@domain.com'),
            fc.constant('user@'),
            fc.constant('user@.com'),
            fc.string().filter(s => s.includes(' ')) // Contains spaces
          ),
          async invalidEmail => {
            const user = new User({
              email: invalidEmail,
              notificationPreferences: {
                aliasExpiry: true,
                featureUpdates: false,
                ecosystemNews: false,
              },
            });

            await expect(user.save()).rejects.toThrow();
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('Notification preferences', () => {
    it('should persist notification preferences correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.emailAddress(),
          fc.boolean(),
          fc.boolean(),
          fc.boolean(),
          async (email, aliasExpiry, featureUpdates, ecosystemNews) => {
            const user = new User({
              email,
              notificationPreferences: {
                aliasExpiry,
                featureUpdates,
                ecosystemNews,
              },
            });

            await user.save();

            // Retrieve from database
            const savedUser = await User.findById(user._id);
            expect(savedUser).toBeDefined();
            expect(savedUser!.notificationPreferences.aliasExpiry).toBe(aliasExpiry);
            expect(savedUser!.notificationPreferences.featureUpdates).toBe(featureUpdates);
            expect(savedUser!.notificationPreferences.ecosystemNews).toBe(ecosystemNews);
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should use default preferences when not specified', async () => {
      await fc.assert(
        fc.asyncProperty(fc.emailAddress(), async email => {
          const user = new User({ email });
          await user.save();

          expect(user.notificationPreferences.aliasExpiry).toBe(true);
          expect(user.notificationPreferences.featureUpdates).toBe(false);
          expect(user.notificationPreferences.ecosystemNews).toBe(false);
        }),
        { numRuns: 20 }
      );
    });
  });

  describe('Unsubscribe token generation', () => {
    it('should generate unique unsubscribe tokens', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.emailAddress(), { minLength: 2, maxLength: 10 }),
          async emails => {
            const users: IUserDocument[] = [];

            for (const email of emails) {
              const user = new User({ email });
              await user.save();
              users.push(user);
            }

            // All tokens should be unique
            const tokens = users.map(u => u.unsubscribeToken);
            const uniqueTokens = new Set(tokens);
            expect(uniqueTokens.size).toBe(tokens.length);

            // All tokens should be 64 characters (32 bytes in hex)
            tokens.forEach(token => {
              expect(token).toHaveLength(64);
              expect(/^[a-f0-9]+$/.test(token)).toBe(true);
            });
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('User queries', () => {
    it('should find users by notification preferences', async () => {
      // Create test users with known preferences
      const users = [
        { email: 'user1@test.com', aliasExpiry: true, featureUpdates: false },
        { email: 'user2@test.com', aliasExpiry: false, featureUpdates: true },
        { email: 'user3@test.com', aliasExpiry: true, featureUpdates: true },
        { email: 'user4@test.com', aliasExpiry: false, featureUpdates: false },
      ];

      for (const userData of users) {
        const user = new User({
          email: userData.email,
          notificationPreferences: {
            aliasExpiry: userData.aliasExpiry,
            featureUpdates: userData.featureUpdates,
            ecosystemNews: false,
          },
        });
        await user.save();
      }

      // Test expiry notification users query
      const expiryUsers = await User.findExpiryNotificationUsers();
      const expectedExpiryCount = users.filter(u => u.aliasExpiry).length;
      expect(expiryUsers).toHaveLength(expectedExpiryCount);

      // Test feature update users query
      const featureUsers = await User.findFeatureUpdateUsers();
      const expectedFeatureCount = users.filter(u => u.featureUpdates).length;
      expect(featureUsers).toHaveLength(expectedFeatureCount);
    });
  });
});
