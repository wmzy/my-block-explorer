import { getAddress, keccak256, toBytes, toHex } from 'viem';
import { describe, expect, it } from 'vitest';

import {
  BEACON_PROXY_BYTECODE_PREFIX,
  EIP1822_PROXIABLE_SLOT,
  EIP1967_ADMIN_SLOT,
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
  classifyProxyCode,
  decodeBeaconProxyPrefix,
  decodeMinimalProxy,
  slotValueToAddress,
} from '@/utils/proxyDetection';

const asHex = (payload: string): `0x${string}` => `0x${payload}`;

const IMPL_ADDRESS = '0x1234567890abcdef1234567890abcdef123456cd';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const MINIMAL_PROXY_PREFIX = '363d3d373d3d3d363d73';
const MINIMAL_PROXY_SUFFIX = '5af43d82803e903d91602b57fd5bf3';

const buildMinimalProxyRuntime = (impl: string) =>
  asHex(
    `${MINIMAL_PROXY_PREFIX}${impl.slice(2).toLowerCase()}${MINIMAL_PROXY_SUFFIX}`,
  );

const deriveEip1967Slot = (label: string) =>
  toHex(BigInt(keccak256(toBytes(label))) - 1n, { size: 32 });

describe('proxyDetection', () => {
  describe('storage slot constants', () => {
    it('pins EIP-1967 implementation slot to keccak256(label) - 1', () => {
      expect(EIP1967_IMPLEMENTATION_SLOT).toBe(
        deriveEip1967Slot('eip1967.proxy.implementation'),
      );
    });

    it('pins EIP-1967 admin slot to keccak256(label) - 1', () => {
      expect(EIP1967_ADMIN_SLOT).toBe(deriveEip1967Slot('eip1967.proxy.admin'));
    });

    it('pins EIP-1967 beacon slot to keccak256(label) - 1', () => {
      expect(EIP1967_BEACON_SLOT).toBe(deriveEip1967Slot('eip1967.proxy.beacon'));
    });

    it('pins EIP-1822 proxiable slot to keccak256 of the uppercase label without decrement', () => {
      expect(EIP1822_PROXIABLE_SLOT).toBe(keccak256(toBytes('PROXIABLE')));
    });
  });

  describe('decodeMinimalProxy', () => {
    it('decodes canonical EIP-1167 runtime bytecode to the checksummed implementation', () => {
      const runtime = buildMinimalProxyRuntime(IMPL_ADDRESS);
      expect(decodeMinimalProxy(runtime)).toBe(getAddress(IMPL_ADDRESS));
    });

    it('decodes uppercased runtime bytecode identically', () => {
      const runtime = asHex(
        `${MINIMAL_PROXY_PREFIX}${IMPL_ADDRESS.slice(2)}${MINIMAL_PROXY_SUFFIX}`.toUpperCase(),
      );
      expect(decodeMinimalProxy(runtime)).toBe(getAddress(IMPL_ADDRESS));
    });

    it('decodes a zero embedded address to the zero address, not null', () => {
      const runtime = buildMinimalProxyRuntime(ZERO_ADDRESS);
      expect(decodeMinimalProxy(runtime)).toBe(ZERO_ADDRESS);
    });

    it('returns null when one suffix nibble is corrupted', () => {
      const runtime = buildMinimalProxyRuntime(IMPL_ADDRESS);
      expect(decodeMinimalProxy(asHex(`${runtime.slice(2, -1)}2`))).toBeNull();
    });

    it('returns null for the clone-with-args shape (one extra byte appended)', () => {
      const runtime = buildMinimalProxyRuntime(IMPL_ADDRESS);
      expect(decodeMinimalProxy(asHex(`${runtime.slice(2)}ff`))).toBeNull();
    });

    it('returns null when garbage precedes the pattern', () => {
      const runtime = buildMinimalProxyRuntime(IMPL_ADDRESS);
      expect(decodeMinimalProxy(asHex(`1234${runtime.slice(2)}`))).toBeNull();
    });

    it('returns null for empty bytecode', () => {
      expect(decodeMinimalProxy('0x')).toBeNull();
    });
  });

  describe('slotValueToAddress', () => {
    it('decodes a left-padded 32-byte slot to the checksummed address', () => {
      const slotValue = asHex('00'.repeat(12) + IMPL_ADDRESS.slice(2));
      expect(slotValueToAddress(slotValue)).toBe(getAddress(IMPL_ADDRESS));
    });

    it('ignores dirty nonzero high bytes and still returns the last 20 bytes', () => {
      const slotValue = asHex('ff'.repeat(12) + IMPL_ADDRESS.slice(2));
      expect(slotValueToAddress(slotValue)).toBe(getAddress(IMPL_ADDRESS));
    });

    it('decodes an exact 20-byte value to the checksummed address', () => {
      expect(slotValueToAddress(asHex(IMPL_ADDRESS.slice(2)))).toBe(getAddress(IMPL_ADDRESS));
    });

    it('returns null for an all-zero 32-byte slot', () => {
      expect(slotValueToAddress(asHex('00'.repeat(32)))).toBeNull();
    });

    it('returns null for odd-length hex', () => {
      expect(slotValueToAddress('0x123')).toBeNull();
    });

    it('returns null for the empty value', () => {
      expect(slotValueToAddress('0x')).toBeNull();
    });
  });

  describe('decodeBeaconProxyPrefix', () => {
    it('matches the canonical prefix with arbitrary trailing bytecode', () => {
      const code = asHex(`${BEACON_PROXY_BYTECODE_PREFIX.slice(2)}515afa`);
      expect(decodeBeaconProxyPrefix(code)).toBe(true);
    });

    it('does not match when one early nibble differs', () => {
      // Same prefix with the first nibble changed from 6 to 7.
      const code = asHex('70806040526040523615600b5760e01c8063515afa');
      expect(decodeBeaconProxyPrefix(code)).toBe(false);
    });

    it('matches the fully uppercased prefix form', () => {
      const code = asHex(`${BEACON_PROXY_BYTECODE_PREFIX.slice(2).toUpperCase()}515afa`);
      expect(decodeBeaconProxyPrefix(code)).toBe(true);
    });
  });

  describe('classifyProxyCode', () => {
    it('classifies an EIP-1167 runtime as eip1167', () => {
      expect(classifyProxyCode(buildMinimalProxyRuntime(IMPL_ADDRESS))).toEqual({
        kind: 'eip1167',
      });
    });

    it('classifies beacon-prefixed bytecode as beacon', () => {
      const code = asHex(`${BEACON_PROXY_BYTECODE_PREFIX.slice(2)}515afa`);
      expect(classifyProxyCode(code)).toEqual({ kind: 'beacon' });
    });

    it('returns null for a plain (non-proxy) contract bytecode', () => {
      expect(classifyProxyCode('0x608060405234801561001157600080fd5b50')).toBeNull();
    });

    it('returns null for empty bytecode', () => {
      expect(classifyProxyCode('0x')).toBeNull();
    });
  });
});
