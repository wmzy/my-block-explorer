// Strictness of the shared numeric validators (src/utils/validation.ts) and
// the server layer built on them (src/server/validation.ts).
//
// Two failure modes are pinned here:
//
// 1. parseInt accepts a valid prefix and ignores the rest, so "12abc",
//    "0x1a", "1e5" and " 7 " all validated as 12/26/100000/7. Junk input
//    reached the RPC layer and silently addressed the WRONG block/chain
//    instead of being rejected.
// 2. Truthiness was used to detect "absent", so block 0 (genesis) read as
//    absent: validateBlockRange(0, 10) dropped its from bound, and
//    validateBlockRange(10, 0) skipped the from>to check entirely and
//    returned {fromBlock: 10, toBlock: 0} — an inverted range that no
//    caller could detect.

import { describe, it, expect } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import {
  isValidBlockNumber,
  isValidChainId,
  validateBlockRange,
  validatePaginationParams,
} from '@/utils/validation';
import { getValidatedBlockNumber, getValidatedChainId } from '@/server/validation';

describe('isValidBlockNumber', () => {
  it('accepts plain decimal block numbers including genesis', () => {
    expect(isValidBlockNumber(0)).toBe(true);
    expect(isValidBlockNumber('0')).toBe(true);
    expect(isValidBlockNumber(21000000)).toBe(true);
    expect(isValidBlockNumber('21000000')).toBe(true);
  });

  it('rejects trailing garbage instead of parsing the valid prefix', () => {
    for (const junk of ['12abc', '12 34', '12.9', '-1', '1e5', '0x1a', ' 7 ', '7abc']) {
      expect(isValidBlockNumber(junk), `accepted ${JSON.stringify(junk)}`).toBe(false);
    }
  });

  it('rejects non-finite and out-of-range numbers', () => {
    expect(isValidBlockNumber(Number.NaN)).toBe(false);
    expect(isValidBlockNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidBlockNumber(-1)).toBe(false);
    expect(isValidBlockNumber(Number.MAX_SAFE_INTEGER + 2)).toBe(false);
  });
});

describe('isValidChainId', () => {
  it('accepts positive chain ids', () => {
    expect(isValidChainId(1)).toBe(true);
    expect(isValidChainId('137')).toBe(true);
  });

  it('rejects zero, junk and exponent/hex spellings', () => {
    for (const junk of ['0', 0, '-1', '1e3', '0x1', 'abc', '137abc', ' 1 ']) {
      expect(isValidChainId(junk), `accepted ${JSON.stringify(junk)}`).toBe(false);
    }
  });
});

describe('validateBlockRange', () => {
  it('keeps block 0 as a real bound, not an absent one', () => {
    // Genesis-to-10: fromBlock 0 must survive.
    expect(validateBlockRange(0, 10)).toEqual({ fromBlock: 0, toBlock: 10 });
    // Genesis alone.
    expect(validateBlockRange(0)).toEqual({ fromBlock: 0, toBlock: undefined });
    expect(validateBlockRange(undefined, 0)).toEqual({ fromBlock: undefined, toBlock: 0 });
    // String spelling of genesis behaves the same.
    expect(validateBlockRange('0', '10')).toEqual({ fromBlock: 0, toBlock: 10 });
  });

  it('reports both-absent only when nothing was supplied', () => {
    expect(validateBlockRange()).toEqual({ fromBlock: undefined, toBlock: undefined });
    expect(validateBlockRange(undefined, undefined)).toEqual({
      fromBlock: undefined,
      toBlock: undefined,
    });
  });

  it('rejects an inverted range that genesis previously slipped through', () => {
    // toBlock 0 with fromBlock 10 is invalid: 10 > 0. Before the fix the
    // truthiness check skipped this comparison entirely.
    expect(() => validateBlockRange(10, 0)).toThrow(/From block must be before to block/);
  });

  it('rejects negative and non-numeric bounds', () => {
    expect(() => validateBlockRange(-1, 10)).toThrow(/Invalid from block number/);
    expect(() => validateBlockRange(1, -5)).toThrow(/Invalid to block number/);
    expect(() => validateBlockRange('abc', 10)).toThrow(/Invalid from block number/);
    expect(() => validateBlockRange(1, 'abc')).toThrow(/Invalid to block number/);
  });

  it('still rejects junk spellings rather than parsing their prefix', () => {
    expect(() => validateBlockRange('12abc', 100)).toThrow(/Invalid from block number/);
    expect(() => validateBlockRange(1, '0x1a')).toThrow(/Invalid to block number/);
  });
});

describe('validatePaginationParams', () => {
  it('rejects junk instead of accepting its numeric prefix', () => {
    expect(() => validatePaginationParams('2abc')).toThrow(/Page must be a positive integer/);
    expect(() => validatePaginationParams(1, '50; DROP')).toThrow(
      /Limit must be between 1 and 100/,
    );
  });

  it('keeps accepting well-formed values', () => {
    expect(validatePaginationParams('2', '50')).toEqual({ page: 2, limit: 50 });
    expect(validatePaginationParams()).toEqual({ page: 1, limit: 20 });
  });
});

describe('server validation layer', () => {
  it('rejects a block route param carrying trailing garbage', () => {
    for (const junk of ['12abc', '0x1a', '1e5']) {
      expect(() => getValidatedBlockNumber(junk), `accepted ${junk}`).toThrow(HTTPException);
    }
  });

  it('rejects a chain route param carrying trailing garbage', () => {
    for (const junk of ['1abc', '0x1', '1e3']) {
      expect(() => getValidatedChainId(junk), `accepted ${junk}`).toThrow(HTTPException);
    }
  });

  it('keeps serving genesis and the "latest" keyword', () => {
    expect(getValidatedBlockNumber('0')).toBe(0);
    expect(getValidatedBlockNumber(0)).toBe(0);
    expect(getValidatedBlockNumber('latest')).toBe('latest');
  });
});
