/**
 * Fast Cardano address validation utilities for backend
 */

/**
 * Validate if a string is a valid Cardano address
 */
export function isValidCardanoAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  const cleanAddress = address.trim();

  // Simple but effective validation patterns
  // Shelley mainnet addresses: addr1 + 98 bech32 chars (103 total)
  if (/^addr1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{98}$/.test(cleanAddress)) {
    return true;
  }

  // Shelley testnet addresses: addr_test1 + 98 bech32 chars (108 total)
  if (/^addr_test1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{98}$/.test(cleanAddress)) {
    return true;
  }

  // Byron addresses: Ae2 or DdzFF + base58 chars
  if (
    /^(Ae2|DdzFF)[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{47,101}$/.test(
      cleanAddress
    )
  ) {
    return true;
  }

  // Stake addresses (mainnet): stake1 + 53 bech32 chars (59 total)
  if (/^stake1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{53}$/.test(cleanAddress)) {
    return true;
  }

  // Stake addresses (testnet): stake_test1 + 53 bech32 chars (64 total)
  if (/^stake_test1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{53}$/.test(cleanAddress)) {
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
