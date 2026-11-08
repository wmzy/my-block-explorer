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
import { getAddress } from 'viem';
import { HTTPException } from 'hono/http-exception';
import {
  isValidBlockNumber,
  isValidChainId,
  validateBlockRange,
  parsePaginationParams,
  parseChainAndAddressParams,
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

describe('parsePaginationParams — the shared route pagination contract', () => {
  // The blocks/transactions list flavor: strict decimal or null, negative
  // offsets clamp to 0, over-cap values clamp at the caps, defaults 0/20.
  const LIST_OPTIONS = { maxOffset: 100_000, maxLimit: 100 } as const;

  it('keeps the 0/20 defaults for absent and empty params', () => {
    expect(parsePaginationParams(undefined, undefined, LIST_OPTIONS)).toEqual({
      offset: 0,
      limit: 20,
    });
    expect(parsePaginationParams('', '', LIST_OPTIONS)).toEqual({ offset: 0, limit: 20 });
  });

  it('passes strict decimal values through untouched', () => {
    expect(parsePaginationParams('5', '20', LIST_OPTIONS)).toEqual({ offset: 5, limit: 20 });
    expect(parsePaginationParams('100000', '1', LIST_OPTIONS)).toEqual({
      offset: 100_000,
      limit: 1,
    });
  });

  it('clamps negative offsets to 0 (the \'-\'-prefix policy), including exponent spellings Number() accepts', () => {
    expect(parsePaginationParams('-5', undefined, LIST_OPTIONS)).toEqual({
      offset: 0,
      limit: 20,
    });
    expect(parsePaginationParams('-5e3', undefined, LIST_OPTIONS).offset).toBe(0);
  });

  it('rejects junk offsets instead of parsing their numeric prefix', () => {
    for (const junk of [
      'abc',
      '5abc',
      '0x5',
      '1e5',
      ' 5',
      '5.5',
      '+5',
      '-abc',
      '-5.5',
      '99999999999999999999',
    ]) {
      expect(
        parsePaginationParams(junk, undefined, LIST_OPTIONS).offset,
        `offset=${junk}`,
      ).toBeNull();
    }
  });

  it('clamps a safe over-cap offset at the cap', () => {
    expect(parsePaginationParams('999999999', undefined, LIST_OPTIONS).offset).toBe(100_000);
  });

  it('rejects junk and non-positive limits', () => {
    for (const junk of [
      'abc',
      '20abc',
      '0',
      '-5',
      '1e2',
      '0x14',
      ' 7',
      '2.5',
      '99999999999999999999',
    ]) {
      expect(parsePaginationParams(undefined, junk, LIST_OPTIONS).limit, `limit=${junk}`).toBeNull();
    }
  });

  it('clamps an over-cap limit to the cap instead of erroring', () => {
    expect(parsePaginationParams(undefined, '999999', LIST_OPTIONS).limit).toBe(100);
    expect(parsePaginationParams(undefined, '100', LIST_OPTIONS).limit).toBe(100);
  });

  it('contracts directory flavor: default limit 50, over-cap limit rejects instead of clamping', () => {
    const options = {
      maxOffset: 100_000,
      maxLimit: 100,
      defaultLimit: 50,
      limitOverCap: 'reject',
    } as const;

    expect(parsePaginationParams(undefined, undefined, options)).toEqual({ offset: 0, limit: 50 });
    expect(parsePaginationParams(undefined, '101', options).limit).toBeNull();
    expect(parsePaginationParams(undefined, '100', options).limit).toBe(100);
    // Offset edges stay the transactions-family ones.
    expect(parsePaginationParams('-5', undefined, options).offset).toBe(0);
    expect(parsePaginationParams('999999999', undefined, options).offset).toBe(100_000);
    expect(parsePaginationParams('abc', undefined, options).offset).toBeNull();
  });

  it('page-shaped slot (addresses transactions list): 1-based default, floors at 1, negatives are junk', () => {
    const options = {
      maxLimit: 50,
      defaultOffset: 1,
      minOffset: 1,
      negativeOffset: 'reject',
    } as const;

    expect(parsePaginationParams(undefined, undefined, options)).toEqual({ offset: 1, limit: 20 });
    expect(parsePaginationParams('0', undefined, options).offset).toBe(1);
    expect(parsePaginationParams('2', '9999', options)).toEqual({ offset: 2, limit: 50 });
    expect(parsePaginationParams('-5', undefined, options).offset).toBeNull();
    expect(parsePaginationParams('abc', undefined, options).offset).toBeNull();
  });

  it('address export flavor: uncapped offset, negatives reject like other junk', () => {
    const options = { negativeOffset: 'reject' } as const;

    expect(parsePaginationParams('12', undefined, options).offset).toBe(12);
    expect(parsePaginationParams('999999999999', undefined, options).offset).toBe(999999999999);
    for (const junk of ['abc', '-5', '12abc', '1.5']) {
      expect(parsePaginationParams(junk, undefined, options).offset, `offset=${junk}`).toBeNull();
    }
  });

  it('internal-transactions flavor: default limit 50 with a clamping cap of 100', () => {
    const options = { negativeOffset: 'reject', defaultLimit: 50, maxLimit: 100 } as const;

    expect(parsePaginationParams(undefined, undefined, options)).toEqual({ offset: 0, limit: 50 });
    expect(parsePaginationParams('200', '500', options)).toEqual({ offset: 200, limit: 100 });
  });
});

describe('parseChainAndAddressParams — the neutral chain+address validator', () => {
  const VALID_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

  it('valid params return the chain id and the lowercased address', () => {
    expect(parseChainAndAddressParams('1', VALID_ADDRESS)).toEqual({
      chainId: 1,
      address: VALID_ADDRESS,
    });

    // Checksummed input still stores lowercase (C-3).
    const checksummed = getAddress(VALID_ADDRESS);
    expect(parseChainAndAddressParams('137', checksummed)).toEqual({
      chainId: 137,
      address: checksummed.toLowerCase(),
    });
  });

  it('reports the chain error first when both params are invalid', () => {
    expect(parseChainAndAddressParams('abc', 'notanaddress')).toEqual({
      error: 'invalid_chain_id',
      message: 'Invalid chain ID',
    });
  });

  it('rejects a malformed or unsupported chain id on its own', () => {
    expect(parseChainAndAddressParams('1abc', VALID_ADDRESS)).toEqual({
      error: 'invalid_chain_id',
      message: 'Invalid chain ID',
    });
    // Outside viem's entire registry — the reliable "unsupported" case.
    expect(parseChainAndAddressParams('424242424242424', VALID_ADDRESS)).toEqual({
      error: 'unsupported_chain',
      message: 'Unsupported chain',
    });
  });

  it('rejects a shape-invalid address with the format message', () => {
    expect(parseChainAndAddressParams('1', 'notanaddress')).toEqual({
      error: 'invalid_address_format',
      message: 'Invalid address format',
    });
  });

  it('rejects a checksum-mismatched mixed-case address', () => {
    // Build the mismatch from the canonical form: flipping one body
    // letter's case keeps the string mixed-case (so the checksum tier,
    // not the shape tier, fires) but guarantees the EIP-55 mismatch.
    const checksummed = getAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
    const flipIndex = [...checksummed].findIndex((ch, i) => i >= 2 && /[a-f]/.test(ch));
    expect(flipIndex).toBeGreaterThanOrEqual(0);
    const corrupted =
      checksummed.slice(0, flipIndex) +
      checksummed.slice(flipIndex, flipIndex + 1).toUpperCase() +
      checksummed.slice(flipIndex + 1);

    expect(parseChainAndAddressParams('1', corrupted)).toEqual({
      error: 'invalid_address_checksum',
      message: 'Invalid address checksum',
    });
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
