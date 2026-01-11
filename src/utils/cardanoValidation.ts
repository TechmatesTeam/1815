/**
 * Fast Cardano address validation utilities for backend
 */

/**
 * Validate if a string is a valid Cardano address
 * Updated to handle variable-length addresses more flexibly
 */
export function isValidCardanoAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  const cleanAddress = address.trim();

  // Bech32 character set for Shelley addresses
  const bech32Chars = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

  // Base58 character set for Byron addresses
  const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  // Shelley mainnet addresses: addr1 + variable length bech32 chars (typically 59-103 chars)
  if (/^addr1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{54,98}$/.test(cleanAddress)) {
    return true;
  }

  // Shelley testnet addresses: addr_test1 + variable length bech32 chars (typically 63-108 chars)
  if (/^addr_test1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{54,98}$/.test(cleanAddress)) {
    return true;
  }

  // Byron addresses: Ae2 or DdzFF + base58 chars (variable length 50-104 chars)
  if (
    /^(Ae2|DdzFF)[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{47,101}$/.test(
      cleanAddress
    )
  ) {
    return true;
  }

  // Stake addresses (mainnet): stake1 + bech32 chars (typically 56-59 chars)
  if (/^stake1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{50,55}$/.test(cleanAddress)) {
    return true;
  }

  // Stake addresses (testnet): stake_test1 + bech32 chars (typically 61-64 chars)
  if (/^stake_test1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{50,55}$/.test(cleanAddress)) {
    return true;
  }

  return false;
}

/**
 * Validate if a string is a valid transaction hash
 */
export function isValidTransactionHash(hash: string): boolean {
  if (!hash || typeof hash !== 'string') {
    return false;
  }
  // Transaction hashes are 64-character hexadecimal strings
  return /^[a-fA-F0-9]{64}$/.test(hash.trim());
}

/**
 * Validate if a string is a valid block hash or number
 */
export function isValidBlockIdentifier(identifier: string): boolean {
  if (!identifier || typeof identifier !== 'string') {
    return false;
  }

  const cleanId = identifier.trim();

  // Block hash: 64-character hexadecimal string
  const blockHashRegex = /^[a-fA-F0-9]{64}$/;
  // Block number: positive integer
  const blockNumberRegex = /^\d+$/;

  return blockHashRegex.test(cleanId) || blockNumberRegex.test(cleanId);
}
