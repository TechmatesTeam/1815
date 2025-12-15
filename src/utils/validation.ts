import crypto from 'crypto';
import { config } from '@/config/environment';

/**
 * Validates if a string is a valid Cardano address
 * Supports both mainnet and testnet addresses with proper length validation
 */
export function isValidCardanoAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  // Remove whitespace
  const cleanAddress = address.trim();

  // Check minimum length
  if (cleanAddress.length < 50) {
    return false;
  }

  // Cardano addresses can be:
  // 1. Byron addresses (legacy) - start with 'Ae2' or 'DdzFF'
  // 2. Shelley addresses - start with 'addr1' (mainnet) or 'addr_test1' (testnet)
  // 3. Stake addresses - start with 'stake1' (mainnet) or 'stake_test1' (testnet)

  const addressPatterns = [
    // Shelley mainnet payment addresses (bech32 encoded)
    {
      pattern: /^addr1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{50,103}$/,
      description: 'Mainnet payment address',
    },
    // Shelley testnet payment addresses (bech32 encoded)
    {
      pattern: /^addr_test1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{50,103}$/,
      description: 'Testnet payment address',
    },
    // Shelley mainnet stake addresses
    {
      pattern: /^stake1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{50,103}$/,
      description: 'Mainnet stake address',
    },
    // Shelley testnet stake addresses
    {
      pattern: /^stake_test1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{50,103}$/,
      description: 'Testnet stake address',
    },
    // Byron mainnet addresses (base58 encoded)
    {
      pattern: /^Ae2[1-9A-HJ-NP-Za-km-z]{50,103}$/,
      description: 'Byron mainnet address',
    },
    // Byron testnet addresses (base58 encoded)
    {
      pattern: /^DdzFF[1-9A-HJ-NP-Za-km-z]{50,103}$/,
      description: 'Byron testnet address',
    },
  ];

  // Check if address matches any valid pattern
  const isValidFormat = addressPatterns.some(({ pattern }) => pattern.test(cleanAddress));

  if (!isValidFormat) {
    return false;
  }

  // Additional validation for bech32 addresses (Shelley era)
  if (
    cleanAddress.startsWith('addr1') ||
    cleanAddress.startsWith('addr_test1') ||
    cleanAddress.startsWith('stake1') ||
    cleanAddress.startsWith('stake_test1')
  ) {
    // Basic bech32 character set validation
    const bech32Chars = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const addressBody = cleanAddress.substring(cleanAddress.indexOf('1') + 1);

    // Check if all characters in the address body are valid bech32 characters
    for (const char of addressBody) {
      if (!bech32Chars.includes(char)) {
        return false;
      }
    }
  }

  // Additional validation for Byron addresses (base58 encoded)
  if (cleanAddress.startsWith('Ae2') || cleanAddress.startsWith('DdzFF')) {
    // Basic base58 character set validation
    const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const addressBody = cleanAddress.substring(3); // Skip prefix

    // Check if all characters are valid base58 characters
    for (const char of addressBody) {
      if (!base58Chars.includes(char)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Validates if an email address is valid
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  const trimmedEmail = email.trim();

  // Basic format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    return false;
  }

  // Additional checks for edge cases
  if (trimmedEmail.includes('..')) {
    return false; // No consecutive dots
  }

  if (trimmedEmail.startsWith('.') || trimmedEmail.endsWith('.')) {
    return false; // No leading or trailing dots
  }

  if (trimmedEmail.includes('@.') || trimmedEmail.includes('.@')) {
    return false; // No dots immediately adjacent to @
  }

  const parts = trimmedEmail.split('@');
  if (parts.length !== 2) {
    return false; // Must have exactly one @
  }

  const [localPart, domainPart] = parts;

  // Local part validation
  if (localPart.length === 0 || localPart.length > 64) {
    return false;
  }

  // Domain part validation
  if (domainPart.length === 0 || domainPart.length > 253) {
    return false;
  }

  if (domainPart.startsWith('.') || domainPart.endsWith('.')) {
    return false;
  }

  return true;
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
 * Generates a unique 16-digit numeric code for aliases
 * Uses high-resolution timestamp + random digits + counter to ensure uniqueness
 */
let codeCounter = 0;
export function generateShortCode(length: number = 16): string {
  if (length !== 16) {
    throw new Error('Short code must be exactly 16 digits');
  }

  // Get high-resolution timestamp (microseconds since epoch)
  const now = Date.now();
  const hrTime = process.hrtime.bigint();

  // Use last 10 digits of high-resolution time for better uniqueness
  const timeComponent = (hrTime % 10000000000n).toString().padStart(10, '0');

  // Increment counter and use last 3 digits
  codeCounter = (codeCounter + 1) % 1000;
  const counterComponent = codeCounter.toString().padStart(3, '0');

  // Generate 3 random digits
  const randomComponent = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');

  // Combine: 10 digits time + 3 digits counter + 3 digits random = 16 digits
  const code = timeComponent + counterComponent + randomComponent;

  // Ensure it's exactly 16 digits
  if (code.length !== 16 || !/^\d+$/.test(code)) {
    // Fallback: generate 16 random digits if method fails
    let result = '';
    for (let i = 0; i < 16; i++) {
      result += Math.floor(Math.random() * 10).toString();
    }
    return result;
  }

  return code;
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
