import { describe, expect, it } from 'vitest';

import type { ContractFunction } from '@/utils/contractInteraction';
import {
  buildFunctionSignature,
  formatSelectorForDisplay,
  getFunctionSelector,
} from '@/utils/functionSelector';

describe('functionSelector', () => {
  describe('buildFunctionSignature', () => {
    it('builds signature for single address parameter', () => {
      const func = {
        name: 'balanceOf',
        inputs: [{ name: 'account', type: 'address' }],
      };
      expect(buildFunctionSignature(func)).toBe('balanceOf(address)');
    });

    it('builds signature for multiple parameters', () => {
      const func = {
        name: 'transfer',
        inputs: [
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
      };
      expect(buildFunctionSignature(func)).toBe('transfer(address,uint256)');
    });

    it('builds signature for no parameters', () => {
      const func = {
        name: 'owner',
        inputs: [],
      };
      expect(buildFunctionSignature(func)).toBe('owner()');
    });

    it('builds signature with complex types', () => {
      const func = {
        name: 'safeTransferFrom',
        inputs: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'tokenId', type: 'uint256' },
        ],
      };
      expect(buildFunctionSignature(func)).toBe('safeTransferFrom(address,address,uint256)');
    });
  });

  describe('getFunctionSelector', () => {
    it('returns correct selector for balanceOf(address)', () => {
      const func: ContractFunction = {
        name: 'balanceOf',
        type: 'function',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
      };
      expect(getFunctionSelector(func)).toBe('0x70a08231');
    });

    it('returns correct selector for transfer(address,uint256)', () => {
      const func: ContractFunction = {
        name: 'transfer',
        type: 'function',
        inputs: [
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
        stateMutability: 'nonpayable',
      };
      expect(getFunctionSelector(func)).toBe('0xa9059cbb');
    });

    it('returns correct selector for owner()', () => {
      const func: ContractFunction = {
        name: 'owner',
        type: 'function',
        inputs: [],
        outputs: [{ name: '', type: 'address' }],
        stateMutability: 'view',
      };
      expect(getFunctionSelector(func)).toBe('0x8da5cb5b');
    });

    it('returns null for invalid function', () => {
      const func = {
        name: '',
        inputs: [{ name: 'account', type: 'address' }],
      } as ContractFunction;
      expect(getFunctionSelector(func)).toBeNull();
    });
  });

  describe('formatSelectorForDisplay', () => {
    it('returns full selector when provided', () => {
      expect(formatSelectorForDisplay('0x70a08231')).toBe('0x70a08231');
    });

    it('returns empty string when null', () => {
      expect(formatSelectorForDisplay(null)).toBe('');
    });

    it('returns full selector for any valid hex', () => {
      expect(formatSelectorForDisplay('0xa9059cbb')).toBe('0xa9059cbb');
    });
  });
});
