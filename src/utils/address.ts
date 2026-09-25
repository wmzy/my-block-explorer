import { getAddress, isAddress } from 'viem';

/**
 * Format an Ethereum address as a checksum address (EIP-55)
 * @param address The raw address
 * @returns The checksummed address, or the input unchanged when invalid
 */
export function formatAddress(address: string): `0x${string}` {
  try {
    if (!address || !isAddress(address)) {
      return address as `0x${string}`;
    }
    return getAddress(address);
  }
  catch {
    return address as `0x${string}`;
  }
}

/**
 * Compare two Ethereum addresses for equality (case-insensitive)
 * @param address1 First address
 * @param address2 Second address
 * @returns Whether the addresses are equal
 */
export function addressEquals(address1: string, address2: string): boolean {
  if (!address1 || !address2) return false;
  try {
    return getAddress(address1) === getAddress(address2);
  }
  catch {
    return address1.toLowerCase() === address2.toLowerCase();
  }
}

/**
 * Validate an address format
 * @param address The address
 * @returns Whether the address is valid
 */
export function isValidAddress(address: string): boolean {
  return isAddress(address);
}
