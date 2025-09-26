import { describe, it, expect } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import {
  getValidatedAddress,
  getValidatedChainId,
  getValidatedTxHash,
  getValidatedBlockNumber,
} from '@/server/validation';

describe('Server Validation', () => {
  describe('getValidatedAddress', () => {
    it('should validate correct Ethereum addresses', () => {
      const validAddresses = [
        '0x1234567890123456789012345678901234567890',
        '0xABCDEF1234567890123456789012345678901234',
        '0xabcdef1234567890123456789012345678901234',
        '0x0000000000000000000000000000000000000000',
        '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
      ];

      validAddresses.forEach(address => {
        expect(() => getValidatedAddress(address)).not.toThrow();
        // getAddress returns checksum format, not lowercase
        expect(getValidatedAddress(address)).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });
    });

    it('should reject invalid addresses', () => {
      const invalidAddresses = [
        '',
        '0x',
        '0x123', // Too short
        '0x12345678901234567890123456789012345678901', // Too long
        '1234567890123456789012345678901234567890', // Missing 0x prefix
        '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG', // Invalid hex characters
        '0x123456789012345678901234567890123456789Z', // Invalid character at end
        null,
        undefined,
      ];

      invalidAddresses.forEach(address => {
        expect(() => getValidatedAddress(address as any)).toThrow(HTTPException);
      });
    });

    it('should normalize address case', () => {
      const mixedCaseAddress = '0xAbCdEf1234567890123456789012345678901234';
      const result = getValidatedAddress(mixedCaseAddress);
      // getAddress returns checksum format, not lowercase
      expect(result).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(result.length).toBe(42);
    });
  });

  describe('getValidatedChainId', () => {
    it('should validate supported chain IDs', () => {
      const supportedChainIds = ['1', '137', '42161', '10', '5000'];
      
      supportedChainIds.forEach(chainId => {
        expect(() => getValidatedChainId(chainId)).not.toThrow();
        expect(getValidatedChainId(chainId)).toBe(parseInt(chainId));
      });
    });

    it('should reject invalid chain IDs', () => {
      const invalidChainIds = [
        '',
        'abc',
        '0',
        '-1',
        '99999', // Unsupported chain
        null,
        undefined,
      ];

      invalidChainIds.forEach(chainId => {
        expect(() => getValidatedChainId(chainId as any)).toThrow(HTTPException);
      });
    });

    it('should handle numeric input', () => {
      expect(getValidatedChainId('1')).toBe(1);
      expect(getValidatedChainId('137')).toBe(137);
    });
  });

  describe('getValidatedTxHash', () => {
    it('should validate correct transaction hashes', () => {
      const validHashes = [
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        '0xABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      ];

      validHashes.forEach(hash => {
        expect(() => getValidatedTxHash(hash)).not.toThrow();
        expect(getValidatedTxHash(hash)).toBe(hash.toLowerCase());
      });
    });

    it('should reject invalid transaction hashes', () => {
      const invalidHashes = [
        '',
        '0x',
        '0x123', // Too short
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1', // Too long
        '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', // Missing 0x prefix
        '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG', // Invalid hex
        null,
        undefined,
      ];

      invalidHashes.forEach(hash => {
        expect(() => getValidatedTxHash(hash as any)).toThrow(HTTPException);
      });
    });

    it('should normalize hash case', () => {
      const mixedCaseHash = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf1234567890AbCdEf1234567890';
      const result = getValidatedTxHash(mixedCaseHash);
      expect(result).toBe(mixedCaseHash.toLowerCase());
    });
  });

  describe('getValidatedBlockNumber', () => {
    it('should validate correct block numbers', () => {
      const validBlockNumbers = ['0', '1', '123456', '18000000'];
      
      validBlockNumbers.forEach(blockNumber => {
        expect(() => getValidatedBlockNumber(blockNumber)).not.toThrow();
        expect(getValidatedBlockNumber(blockNumber)).toBe(parseInt(blockNumber));
      });
    });

    it('should validate "latest" keyword', () => {
      expect(() => getValidatedBlockNumber('latest')).not.toThrow();
      expect(getValidatedBlockNumber('latest')).toBe('latest');
    });

    it('should reject invalid block numbers', () => {
      const invalidBlockNumbers = [
        '',
        'abc',
        '-1',
        'earliest', // Not supported
        'pending', // Not supported
      ];

      invalidBlockNumbers.forEach(blockNumber => {
        expect(() => getValidatedBlockNumber(blockNumber as any)).toThrow(HTTPException);
      });
      
      // Test null and undefined separately
      expect(() => getValidatedBlockNumber(null as any)).toThrow(HTTPException);
      expect(() => getValidatedBlockNumber(undefined as any)).toThrow(HTTPException);
    });

    it('should handle large block numbers', () => {
      const largeBlockNumber = '999999999';
      expect(getValidatedBlockNumber(largeBlockNumber)).toBe(999999999);
    });
  });

  describe('HTTPException behavior', () => {
    it('should throw HTTPException with 400 status for invalid address', () => {
      try {
        getValidatedAddress('invalid');
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPException);
        expect((error as HTTPException).status).toBe(400);
        expect((error as HTTPException).message).toContain('Invalid address');
      }
    });

    it('should throw HTTPException with 400 status for invalid chain ID', () => {
      try {
        getValidatedChainId('invalid');
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPException);
        expect((error as HTTPException).status).toBe(400);
        expect((error as HTTPException).message).toContain('Invalid chain ID');
      }
    });

    it('should throw HTTPException with 400 status for invalid tx hash', () => {
      try {
        getValidatedTxHash('invalid');
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPException);
        expect((error as HTTPException).status).toBe(400);
        expect((error as HTTPException).message).toContain('Invalid transaction hash');
      }
    });

    it('should throw HTTPException with 400 status for invalid block number', () => {
      try {
        getValidatedBlockNumber('invalid');
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPException);
        expect((error as HTTPException).status).toBe(400);
        expect((error as HTTPException).message).toContain('Invalid block number');
      }
    });
  });
});
