import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fc from 'fast-check';
import { Alias, IAliasDocument } from '../../models/Alias';
import { isValidCardanoAddress } from '../../utils/validation';

describe('Alias Model Property Tests', () => {
  beforeEach(async () => {
    await Alias.deleteMany({});
  });

  describe('Property 2: Cardano address validation', () => {
    it('should accept valid Cardano addresses', async () => {
      const validAddresses = [
        'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
        'addr_test1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgsxj90mg',
        'stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw',
        'Ae2tdPwUPEZCanmBz5g2GEwFqKTKpNJcGYPKfDxoNeKZ8bRHr8366kseiK2',
      ];

      for (let i = 0; i < validAddresses.length; i++) {
        const alias = new Alias({
          shortCode: `t${i}${Math.random().toString(36).substr(2, 4)}`,
          cardanoAddress: validAddresses[i],
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });

        await expect(alias.save()).resolves.toBeDefined();
        expect(alias.cardanoAddress).toBe(validAddresses[i]);
      }
    });

    it('should reject invalid Cardano addresses', async () => {
      const invalidAddresses = [
        'invalid_address',
        '',
        'addr1', // Too short
        'stake1', // Too short
        'addr1 with spaces',
        'not_an_address_at_all',
      ];

      for (let i = 0; i < invalidAddresses.length; i++) {
        const alias = new Alias({
          shortCode: `i${i}${Math.random().toString(36).substr(2, 4)}`,
          cardanoAddress: invalidAddresses[i],
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });

        await expect(alias.save()).rejects.toThrow();
      }
    });
  });

  describe('Property 3: Expiry date constraints', () => {
    it('should accept future expiry dates', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.date({
            min: new Date(Date.now() + 60 * 1000),
            max: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          }),
          async futureDate => {
            const alias = new Alias({
              shortCode: `f${Math.random().toString(36).substr(2, 8)}`,
              cardanoAddress:
                'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
              expiresAt: futureDate,
            });

            await expect(alias.save()).resolves.toBeDefined();
            expect(alias.expiresAt).toEqual(futureDate);
            expect(alias.isExpired()).toBe(false);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should reject past expiry dates', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.date({
            min: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
            max: new Date(Date.now() - 1000),
          }),
          async pastDate => {
            const alias = new Alias({
              shortCode: `p${Math.random().toString(36).substr(2, 8)}`,
              cardanoAddress:
                'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
              expiresAt: pastDate,
            });

            await expect(alias.save()).rejects.toThrow(/Expiry date must be in the future/);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should correctly identify expired aliases', async () => {
      const alias = new Alias({
        shortCode: `e${Math.random().toString(36).substr(2, 8)}`,
        cardanoAddress:
          'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
        expiresAt: new Date(Date.now() + 1000), // Expires in 1 second
      });

      await alias.save();
      expect(alias.isExpired()).toBe(false);

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 1500));

      expect(alias.isExpired()).toBe(true);
    });
  });

  describe('Short code uniqueness', () => {
    it('should enforce unique short codes', async () => {
      const shortCode = `u${Math.random().toString(36).substr(2, 8)}`;

      // Create first alias
      const alias1 = new Alias({
        shortCode,
        cardanoAddress:
          'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      await alias1.save();

      // Try to create second alias with same short code
      const alias2 = new Alias({
        shortCode, // Same short code
        cardanoAddress:
          'addr1qy2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      await expect(alias2.save()).rejects.toThrow();
    });
  });

  describe('Use count increment', () => {
    it('should correctly increment use count and update lastUsedAt', async () => {
      const alias = new Alias({
        shortCode: `uc${Math.random().toString(36).substr(2, 7)}`,
        cardanoAddress:
          'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      await alias.save();

      const initialUseCount = alias.useCount;
      const initialLastUsedAt = alias.lastUsedAt;

      // Increment use count multiple times
      const incrementCount = 3;
      for (let i = 0; i < incrementCount; i++) {
        await alias.incrementUseCount();
      }

      expect(alias.useCount).toBe(initialUseCount + incrementCount);
      expect(alias.lastUsedAt).toBeDefined();
      expect(alias.lastUsedAt).not.toBe(initialLastUsedAt);
    });
  });

  describe('Static methods', () => {
    it('should find active aliases', async () => {
      // Create active alias
      const activeAlias = new Alias({
        shortCode: `a${Math.random().toString(36).substr(2, 8)}`,
        cardanoAddress:
          'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        isActive: true,
      });
      await activeAlias.save();

      // Create inactive alias
      const inactiveAlias = new Alias({
        shortCode: `ia${Math.random().toString(36).substr(2, 7)}`,
        cardanoAddress:
          'addr1qy2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        isActive: false,
      });
      await inactiveAlias.save();

      const activeAliases = await Alias.findActive();
      expect(activeAliases.length).toBe(1);
      expect(activeAliases[0].shortCode).toBe(activeAlias.shortCode);
    });
  });
});
