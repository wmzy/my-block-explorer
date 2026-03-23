import { describe, it, expect } from 'vitest';
import { isAddress, isAddressType, ADDRESS_REGEX } from '../addressTypeDetection';

describe('addressTypeDetection', () => {
  describe('ADDRESS_REGEX', () => {
    it('should match valid Ethereum addresses', () => {
      expect(ADDRESS_REGEX.test('0x1234567890123456789012345678901234567890')).toBe(true);
      expect(ADDRESS_REGEX.test('0xABCDEF1234567890123456789012345678901234')).toBe(true);
      expect(ADDRESS_REGEX.test('0xabcdef1234567890123456789012345678901234')).toBe(true);
      expect(ADDRESS_REGEX.test('0x0000000000000000000000000000000000000000')).toBe(true);
      expect(ADDRESS_REGEX.test('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')).toBe(true);
    });

    it('should not match invalid addresses', () => {
      expect(ADDRESS_REGEX.test('0x123')).toBe(false);
      expect(ADDRESS_REGEX.test('0x12345678901234567890123456789012345678901')).toBe(false);
      expect(ADDRESS_REGEX.test('1234567890123456789012345678901234567890')).toBe(false);
      expect(ADDRESS_REGEX.test('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG')).toBe(false);
      expect(ADDRESS_REGEX.test('')).toBe(false);
    });
  });

  describe('isAddress', () => {
    it('should return true for valid Ethereum address strings', () => {
      expect(isAddress('0x1234567890123456789012345678901234567890')).toBe(true);
      expect(isAddress('0xABCDEF1234567890123456789012345678901234')).toBe(true);
      expect(isAddress('0xabcdef1234567890123456789012345678901234')).toBe(true);
      expect(isAddress('0x0000000000000000000000000000000000000000')).toBe(true);
      expect(isAddress('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')).toBe(true);
    });

    it('should return false for invalid addresses', () => {
      expect(isAddress('0x123')).toBe(false);
      expect(isAddress('0x12345678901234567890123456789012345678901')).toBe(false);
      expect(isAddress('1234567890123456789012345678901234567890')).toBe(false);
      expect(isAddress('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG')).toBe(false);
      expect(isAddress('')).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(isAddress(1234567890)).toBe(false);
      expect(isAddress(null)).toBe(false);
      expect(isAddress(undefined)).toBe(false);
      expect(isAddress({})).toBe(false);
      expect(isAddress([])).toBe(false);
      expect(isAddress(true)).toBe(false);
    });
  });

  describe('isAddressType', () => {
    it('should return true for address type', () => {
      expect(isAddressType('address')).toBe(true);
    });

    it('should return true for address array type', () => {
      expect(isAddressType('address[]')).toBe(true);
    });

    it('should return true for fixed-size address array type', () => {
      expect(isAddressType('address[10]')).toBe(true);
      expect(isAddressType('address[1]')).toBe(true);
      expect(isAddressType('address[100]')).toBe(true);
    });

    it('should return false for non-address types', () => {
      expect(isAddressType('uint256')).toBe(false);
      expect(isAddressType('uint128')).toBe(false);
      expect(isAddressType('int256')).toBe(false);
      expect(isAddressType('bool')).toBe(false);
      expect(isAddressType('string')).toBe(false);
      expect(isAddressType('bytes')).toBe(false);
      expect(isAddressType('bytes32')).toBe(false);
      expect(isAddressType('uint256[]')).toBe(false);
      expect(isAddressType('uint256[10]')).toBe(false);
    });

    it('should return false for malformed address types', () => {
      expect(isAddressType('address[')).toBe(false);
      expect(isAddressType('address[0]')).toBe(false);
      expect(isAddressType('address[-1]')).toBe(false);
      expect(isAddressType('address[] extra')).toBe(false);
      expect(isAddressType('')).toBe(false);
    });
  });
});
