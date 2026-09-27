// Unit tests for the pure Solidity storage-slot math. Every keccak256
// expectation is recomputed independently with viem primitives in this
// file — the module's own helpers are never used to produce the expected
// value (no tautologies).
import { describe, expect, it } from 'vitest';
import { concat, hexToBigInt, keccak256, pad, toHex } from 'viem';
import type { Hex } from 'viem';
import {
  abiTypeForLabel,
  arrayElementPlacement,
  decodeBytesWord,
  dynamicArrayDataSlot,
  encodeMappingKey,
  formatSlotDecimal,
  keyTypeFamily,
  mappingValueSlot,
  normalizeSlot,
  slotAdd,
  validateMappingKey,
} from '@/utils/storageSlots';

const KEY1 = '0x0000000000000000000000000000000000000001';
const MAX = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

const asHex = (value: string) => value as Hex;

describe('normalizeSlot', () => {
  it.each([
    ['3', '0x3'],
    ['0x03', '0x3'],
    ['0', '0x0'],
    [3, '0x3'],
    [0, '0x0'],
  ])('normalizes %p to %s', (input, expected) => {
    expect(normalizeSlot(input)).toBe(expected);
  });

  it('normalizes bigint inputs including slot 2^256-1', () => {
    expect(normalizeSlot(3n)).toBe('0x3');
    expect(normalizeSlot(2n ** 256n - 1n)).toBe(MAX);
  });

  it('normalizes 64-nibble zero-padded hex WITHOUT the 0x prefix (Sourcify solc shape)', () => {
    // Regression: some layout sources emit padded hex slots without the
    // prefix — a bare BigInt() threw and took the whole tab down.
    expect(normalizeSlot(`${'0'.repeat(62)}0a`)).toBe('0xa');
    expect(normalizeSlot(`${'0'.repeat(63)}f`)).toBe('0xf');
    expect(normalizeSlot('f'.repeat(64))).toBe(MAX);
  });

  it('rejects unrecognizable slot strings', () => {
    expect(() => normalizeSlot('zzz')).toThrow(RangeError);
    expect(() => normalizeSlot('')).toThrow(RangeError);
  });
});

describe('slotAdd', () => {
  it('adds decimal deltas', () => {
    expect(slotAdd('0x5', 2n)).toBe('0x7');
    expect(slotAdd('0x0', 0n)).toBe('0x0');
  });

  it('carries across byte boundaries exactly (BigInt domain)', () => {
    expect(slotAdd('0xff', 1n)).toBe('0x100');
    expect(slotAdd(MAX, 1n)).toBe(toHex(2n ** 256n));
  });

  it('throws on underflow below slot 0', () => {
    expect(() => slotAdd('0x0', -1n)).toThrow(RangeError);
  });
});

describe('keyTypeFamily', () => {
  it.each([
    ['uint256', 'uint'],
    ['uint8', 'uint'],
    ['enum Status', 'uint'],
    ['int128', 'int'],
    ['bool', 'bool'],
    ['address', 'address'],
    ['contract IERC20', 'address'],
    ['string', 'string'],
    ['bytes', 'bytes'],
    ['bytes32', 'bytes'],
    ['function (uint) external returns (bool)', 'unsupported'],
    ['t_struct(Foo)_storage', 'unsupported'],
  ])('classifies %s as %s', (label, expected) => {
    expect(keyTypeFamily(label)).toBe(expected);
  });
});

describe('validateMappingKey', () => {
  it('accepts valid keys per family', () => {
    expect(validateMappingKey('42', 'uint256')).toBeNull();
    expect(validateMappingKey('0x1f', 'uint256')).toBeNull();
    expect(validateMappingKey('-7', 'int128')).toBeNull();
    expect(validateMappingKey('true', 'bool')).toBeNull();
    expect(validateMappingKey(KEY1, 'address')).toBeNull();
    expect(validateMappingKey('0x616263', 'bytes')).toBeNull();
    expect(validateMappingKey(`0x${'ab'.repeat(32)}`, 'bytes32')).toBeNull();
    expect(validateMappingKey('hello world', 'string')).toBeNull();
  });

  it.each([
    ['', 'uint256', 'Empty key'],
    ['   ', 'address', 'Empty key'],
    ['abc', 'uint256', 'Not a number'],
    ['1.5', 'uint256', 'Not a number'],
    ['-1', 'uint256', 'Negative value not allowed for unsigned key'],
    ['yes', 'bool', 'Expected true/false'],
    ['0x123', 'address', 'Invalid address'],
    ['zz', 'bytes', 'Invalid hex'],
    ['0xabc', 'bytes', 'Invalid hex'],
    ['0xdead', 'bytes32', 'Expected 32 bytes'],
    ['5', 'function (uint) external', /unsupported key type/i],
  ])('rejects %p for %s', (key, label, expected) => {
    const error = validateMappingKey(key, label);
    expect(error).not.toBeNull();
    if (expected instanceof RegExp) expect(error).toMatch(expected);
    else expect(error).toBe(expected);
  });
});

describe('encodeMappingKey', () => {
  it('left-pads address keys to 32 bytes (known-correct vector)', () => {
    const result = encodeMappingKey(KEY1, 'address');
    expect(result).toEqual({ encoded: pad(KEY1, { size: 32 }) });
  });

  it('left-pads uint keys using the numeric value', () => {
    expect(encodeMappingKey('255', 'uint256')).toEqual({ encoded: pad('0xff', { size: 32 }) });
    expect(encodeMappingKey('0x1f', 'uint8')).toEqual({ encoded: pad('0x1f', { size: 32 }) });
  });

  it('two\'s-complement encodes int keys (int -1 → 0xff…ff)', () => {
    const result = encodeMappingKey('-1', 'int256');
    expect(result).toEqual({
      encoded: pad(toHex(BigInt.asUintN(256, -1n)), { size: 32 }),
    });
    if (!('encoded' in result)) throw new Error('unreachable');
    expect(result.encoded).toBe(MAX);
    expect(encodeMappingKey('-2', 'int8')).toEqual({
      encoded: pad(toHex(BigInt.asUintN(256, -2n)), { size: 32 }),
    });
  });

  it('encodes bool keys as 0x01/0x00 padded left', () => {
    expect(encodeMappingKey('true', 'bool')).toEqual({ encoded: pad('0x01', { size: 32 }) });
    expect(encodeMappingKey('FALSE', 'bool')).toEqual({ encoded: pad('0x00', { size: 32 }) });
  });

  it('right-pads fixed bytesN keys (high-order bytes)', () => {
    expect(encodeMappingKey('0x61626364', 'bytes4')).toEqual({
      encoded: pad('0x61626364', { size: 32, dir: 'right' }),
    });
  });

  it('hashes dynamic bytes keys unpadded and string keys as keccak(utf8)', () => {
    expect(encodeMappingKey('0x616263', 'bytes')).toEqual({ encoded: keccak256('0x616263') });
    expect(encodeMappingKey('abc', 'string')).toEqual({ encoded: keccak256(toHex('abc')) });
  });

  it('returns the validator\'s message for invalid keys', () => {
    expect(encodeMappingKey('nope', 'address')).toEqual({ error: 'Invalid address' });
    expect(encodeMappingKey('', 'uint256')).toEqual({ error: 'Empty key' });
  });
});

describe('mappingValueSlot', () => {
  it('computes keccak256(concat([h(key), pad(slot,32)])) — address key vector', () => {
    const encodedKey = pad(KEY1, { size: 32 });
    const expected = keccak256(concat([encodedKey, pad('0x5', { size: 32 })]));
    expect(mappingValueSlot(encodedKey, '0x5')).toBe(expected);
  });

  it('string key "abc" at slot 2 — keccak-of-keccak vector', () => {
    const encodedKey = keccak256(toHex('abc'));
    const expected = keccak256(concat([encodedKey, pad('0x2', { size: 32 })]));
    expect(mappingValueSlot(encodedKey, '0x2')).toBe(expected);
  });
});

describe('dynamicArrayDataSlot', () => {
  it('is keccak256 of the padded base slot', () => {
    expect(dynamicArrayDataSlot('0x3')).toBe(keccak256(pad('0x3', { size: 32 })));
    expect(dynamicArrayDataSlot('0x0')).toBe(keccak256(pad('0x0', { size: 32 })));
  });
});

describe('arrayElementPlacement', () => {
  it.each([
    // [index, elementBytes, slotDelta, offset]
    [0, 32, 0, 0],
    [3, 32, 3, 0], // uint256: one element per slot
    [0, 20, 0, 0],
    [4, 20, 4, 0], // address: nPerSlot = 1 → whole slots
    [5, 16, 2, 16], // uint128 packed 2/slot: floor(5/2)=2, (5%2)*16=16
    [0, 16, 0, 0],
    [1, 16, 0, 16],
    [4, 16, 2, 0],
    [0, 1, 0, 0],
    [31, 1, 0, 31],
    [32, 1, 1, 0], // bytes1 packed 32/slot
    [40, 1, 1, 8],
    [0, 64, 0, 0],
    [2, 64, 4, 0], // 64-byte struct: ceil(64/32)=2 slots per element
  ])('places element %i of %iB at delta %i offset %i', (index, bytes, slotDelta, offset) => {
    expect(arrayElementPlacement(index, bytes)).toEqual({ slotDelta, offset });
  });

  it('throws for negative or non-integer indexes and byte sizes', () => {
    expect(() => arrayElementPlacement(-1, 32)).toThrow(RangeError);
    expect(() => arrayElementPlacement(1.5, 32)).toThrow(RangeError);
    expect(() => arrayElementPlacement(0, 0)).toThrow(RangeError);
  });
});

describe('decodeBytesWord', () => {
  it('decodes a short string word (data in word, length in lowest byte)', () => {
    // 'abc' short form: 0x616263 in the high bytes, length 3*2=6 last.
    const word = asHex(`0x${'616263'.padEnd(62, '0')}06`);
    expect(decodeBytesWord(word, '0x0')).toEqual({
      kind: 'short',
      length: 3n,
      lengthOdd: false,
    });
  });

  it('decodes an empty short word', () => {
    expect(decodeBytesWord(asHex(`0x${'00'.repeat(32)}`), '0x4')).toEqual({
      kind: 'short',
      length: 0n,
      lengthOdd: false,
    });
  });

  it('decodes a long word (odd lowest bit) with exact length and data slot', () => {
    // length 33 → word = 33*2+1 = 67
    const word = pad(toHex(67n), { size: 32 });
    const result = decodeBytesWord(word, '0x7');
    expect(result).toEqual({
      kind: 'long',
      length: 33n,
      dataSlots: 2, // ceil(33/32)
      dataSlot: keccak256(pad('0x7', { size: 32 })),
    });
  });

  it('decodes a 32-byte-exact long word as exactly one data slot', () => {
    const word = pad(toHex(65n), { size: 32 });
    const result = decodeBytesWord(word, '0x0');
    expect(result.kind).toBe('long');
    if (result.kind === 'long') expect(result.dataSlots).toBe(1);
  });

  it('accepts short hex words by padding them first', () => {
    expect(decodeBytesWord('0x06', '0x0')).toEqual({
      kind: 'short',
      length: 3n,
      lengthOdd: false,
    });
  });
});

describe('abiTypeForLabel', () => {
  it.each([
    ['contract IERC20', 'address'],
    ['enum Status', 'uint8'],
    ['uint128', 'uint128'],
    ['bytes10', 'bytes10'],
  ])('maps %s to %s', (label, expected) => {
    expect(abiTypeForLabel(label)).toBe(expected);
  });
});

describe('formatSlotDecimal', () => {
  it('renders decimal strings', () => {
    expect(formatSlotDecimal('0x0')).toBe('0');
    expect(formatSlotDecimal('0x0a')).toBe('10');
    expect(formatSlotDecimal(MAX)).toBe(hexToBigInt(MAX).toString());
  });
});
