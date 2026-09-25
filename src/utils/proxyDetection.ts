import { getAddress } from 'viem';

import type { Address, Hex } from 'viem';

/**
 * EIP-1967 implementation slot. Derived as
 * toHex(BigInt(keccak256(toBytes('eip1967.proxy.implementation'))) - 1n, { size: 32 }).
 * Pinned as a literal so this util performs no runtime keccak; unit tests
 * re-derive it from the formula.
 */
export const EIP1967_IMPLEMENTATION_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

/**
 * EIP-1967 admin slot. Derived as
 * toHex(BigInt(keccak256(toBytes('eip1967.proxy.admin'))) - 1n, { size: 32 }).
 */
export const EIP1967_ADMIN_SLOT =
  '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';

/**
 * EIP-1967 beacon slot. Derived as
 * toHex(BigInt(keccak256(toBytes('eip1967.proxy.beacon'))) - 1n, { size: 32 }).
 */
export const EIP1967_BEACON_SLOT =
  '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';

/**
 * EIP-1822 (UUPS) proxiable slot. Derived as keccak256(toBytes('PROXIABLE')) —
 * UPPERCASE label, and unlike the EIP-1967 slots there is NO -1 decrement.
 */
export const EIP1822_PROXIABLE_SLOT =
  '0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7';

/**
 * Canonical EIP-1167 "minimal proxy" runtime bytecode: `0x` + the 10-byte
 * deploy-and-return-runtime prefix + the 20-byte implementation address + the
 * 15-byte suffix — 45 bytes total, nothing before or after.
 */
const MINIMAL_PROXY_PATTERN =
  /^0x363d3d373d3d3d363d73([0-9a-fA-F]{40})5af43d82803e903d91602b57fd5bf3$/i;

/** Raw-hex shape check for storage-slot values read off chain. */
const RAW_HEX_PATTERN = /^0x[0-9a-fA-F]*$/;

/**
 * Detect the EIP-1167 minimal-proxy runtime bytecode and extract its embedded
 * implementation address (checksummed).
 *
 * Only the canonical 45-byte runtime is matched — a case-insensitive EXACT
 * full match. The clone-with-args variant (extra calldata appended) is
 * deliberately NOT decoded: an honest miss beats a false positive. The zero
 * address is returned faithfully when embedded; interpreting it is the
 * caller's job. Returns null for anything else.
 */
export function decodeMinimalProxy(code: Hex): Address | null {
  const match = MINIMAL_PROXY_PATTERN.exec(code);
  if (!match) {
    return null;
  }
  return getAddress(`0x${match[1].toLowerCase()}`);
}

/**
 * Canonical OpenZeppelin BeaconProxy dispatcher bytecode prefix this module
 * detects. Exact-prefix heuristic pinned to one canonical dispatcher build;
 * other compiler versions/builds honestly return false — misses are
 * acceptable, false positives are not.
 */
export const BEACON_PROXY_BYTECODE_PREFIX =
  '0x60806040526040523615600b5760e01c8063';

/**
 * Case-insensitive startsWith match of the canonical BeaconProxy dispatcher
 * prefix against deployed bytecode. See BEACON_PROXY_BYTECODE_PREFIX for the
 * heuristic's limits.
 */
export function decodeBeaconProxyPrefix(code: Hex): boolean {
  return code.toLowerCase().startsWith(BEACON_PROXY_BYTECODE_PREFIX);
}

/**
 * Convert a raw storage-slot value into an address, tolerating dirty high
 * bytes: requires an even-length hex string holding at least 20 bytes, then
 * takes the LAST 20 bytes. Returns null for malformed input and when the
 * last 20 bytes are all zeros (an empty slot is not an implementation).
 */
export function slotValueToAddress(value: Hex): Address | null {
  if (!RAW_HEX_PATTERN.test(value) || value.length < 42 || (value.length - 2) % 2 !== 0) {
    return null;
  }
  const addressPart = value.slice(-40);
  if (/^0+$/.test(addressPart)) {
    return null;
  }
  return getAddress(`0x${addressPart.toLowerCase()}`);
}

/** A proxy detected for an address the verification backend could not resolve. */
export type DetectedProxy = {
  kind: 'eip1967' | 'eip1822' | 'beacon' | 'eip1167';
  implementation: Address | null;
  via: 'bytecode' | 'storage-slot' | 'beacon-slot';
  slot?: Hex;
};

/**
 * Classify deployed bytecode into the proxy kinds detectable from code alone:
 * 'eip1167' when decodeMinimalProxy matches, else 'beacon' when the canonical
 * BeaconProxy prefix matches, else null. Storage-slot kinds ('eip1967' /
 * 'eip1822') need on-chain reads and are classified elsewhere.
 */
export function classifyProxyCode(code: Hex): { kind: 'eip1167' | 'beacon' } | null {
  if (decodeMinimalProxy(code) !== null) {
    return { kind: 'eip1167' };
  }
  if (decodeBeaconProxyPrefix(code)) {
    return { kind: 'beacon' };
  }
  return null;
}
