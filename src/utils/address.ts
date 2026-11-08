import { getAddress, isAddress } from 'viem';

// 0x-prefixed, 40 hex characters — the raw address shape every address
// surface in this explorer assumes beneath its case handling.
export const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Shape-only check: 0x + 40 hex chars, no checksum opinion. */
export function isAddressShape(input: string): boolean {
  return HEX_ADDRESS_RE.test(input);
}

/**
 * The two-tier address verdict every address surface agrees on (server
 * route params, search, the address page, the MCP tools): shape first,
 * then EIP-55 checksum.
 *
 * viem's getAddress silently checksum-corrects ANY hex-shaped input, so
 * the EIP-55 check is an explicit comparison of the ORIGINAL string with
 * getAddress's result — and only a MIXED-case body carries checksum
 * information at all (all-lowercase and all-uppercase are the
 * checksum-less pass-through convention and only get canonicalized).
 */
export type AddressVerdict =
  | { tier: 'invalid-shape' }
  | { tier: 'invalid-checksum'; checksummed: `0x${string}` }
  | { tier: 'valid'; checksummed: `0x${string}` };

/**
 * Classify an address string into the shared two-tier verdict. The
 * `checksummed` field carries getAddress's result for both surviving
 * tiers (the retry form an invalid-checksum caller should show, the
 * canonical form a valid caller should store/key on). getAddress may
 * throw on a bad shape, so it is only called after the shape gate.
 */
export function addressVerdict(input: string): AddressVerdict {
  if (!HEX_ADDRESS_RE.test(input)) {
    return { tier: 'invalid-shape' };
  }
  const checksummed = getAddress(input);
  const body = input.slice(2);
  const isMixedCase = /[a-f]/.test(body) && /[A-F]/.test(body);
  if (isMixedCase && input !== checksummed) {
    return { tier: 'invalid-checksum', checksummed };
  }
  return { tier: 'valid', checksummed };
}

/**
 * Canonicalize an Ethereum address to its checksum (EIP-55) form.
 *
 * Named `checksumAddress` — the old `formatAddress` name collided with
 * utils/format.ts's truncation formatter of the same name (the barrel
 * had to pin a winner), and "format" said nothing about what this does:
 * same input shape, EIP-55 case.
 *
 * @param address The raw address
 * @returns The checksummed address, or the input unchanged when invalid
 */
export function checksumAddress(address: string): `0x${string}` {
  try {
    if (!address || !isAddress(address)) {
      return address as `0x${string}`;
    }
    return getAddress(address);
  } catch {
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
  } catch {
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
