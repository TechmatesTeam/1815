import crypto from 'crypto';
import { config } from '@/config/environment';

/**
 * Validates if a string is a valid Cardano address
 * Supports both mainnet and testnet addresses
 */
export function isValidCardanoAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  // Remove whitespace
  const cleanAddress = address.trim();

  // Cardano addresses can be:
  // 1. Byron addresses (legacy) - start with 'Ae2' or 'DdzFF'
  // 2. Shelley addresses - start with 'addr1' (mainnet) or 'addr_test1' (testnet)
  // 3. Stake addresses - start with 'stake1' (mainnet) or 'stake_test1' (testnet)

  const patterns = [
    /^addr1[a-z0-9]{50,}$/, // Mainnet payment address (flexible length)
    /^addr_test1[a-z0-9]{50,}$/, // Testnet payment address (flexible length)
    /^stake1[a-z0-9]{50,}$/, // Mainnet stake address (flexible length)
    /^stake_test1[a-z0-9]{50,}$/, // Testnet stake address (flexible length)
    /^Ae2[a-zA-Z0-9]{40,}$/, // Byron mainnet address (flexible length)
    /^DdzFF[a-zA-Z0-9]{40,}$/, // Byron testnet address (flexible length)
  ];

  return patterns.some(pattern => pattern.test(cleanAddress));
}

/**
 * Validates if an email address is valid
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Encrypts sensitive data using AES-256-CBC
 */
export function encryptData(data: string): string {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(config.encryption.key, 'salt', 32);
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(algorithm, key, iv);

  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Combine iv and encrypted data
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypts data encrypted with encryptData
 */
export function decryptData(encryptedData: string): string {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(config.encryption.key, 'salt', 32);

  const parts = encryptedData.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];

  const decipher = crypto.createDecipheriv(algorithm, key, iv);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generates a unique short code for aliases
 */
export function generateShortCode(length: number = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';

  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
}

/**
 * Validates if a date is in the future
 */
export function isFutureDate(date: Date): boolean {
  return date.getTime() > Date.now();
}

/**
 * Validates if a date is within acceptable expiry range (1 day to 1 year from now)
 */
export function isValidExpiryDate(date: Date): boolean {
  const now = new Date();
  const minExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 1 day from now
  const maxExpiry = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year from now

  return date >= minExpiry && date <= maxExpiry;
}
