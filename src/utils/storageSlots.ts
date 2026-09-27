// Pure Solidity storage-slot arithmetic for the Contract page's storage
// explorer (and the copyable snippets built on top of it).
//
// Everything here is deterministic bytes/BigInt manipulation over the
// compiler storage-layout shapes from src/types/storage.ts — no React,
// no network. Semantics follow the Solidity contract storage layout
// spec:
//   - mapping value slot = keccak256(concat([h(key), pad(baseSlot, 32)]))
//   - dynamic array element data starts at keccak256(pad(baseSlot, 32)),
//     with the live length in the base slot itself
//   - fixed (inplace) arrays pack multiple elements per 32-byte slot
//     when the element type fits more than once
//   - bytes/string words are short (data in the word, length in the
//     lowest byte) or long (odd lowest bit, length*2+1 in the word,
//     data at keccak256(pad(baseSlot, 32)) onwards)
//
// h(key) encoding per key family:
//   uint/int/bool/address/enum (value keys) → the key padded to 32 bytes
//     (left-padded by default; bytesN keys occupy the HIGH-order bytes,
//     so they are right-padded)
//   int keys are two's-complement encoded via BigInt.asUintN(256, key)
//   string/dynamic-bytes keys → keccak256(raw bytes), unpadded

import { concat, hexToBigInt, hexToNumber, keccak256, pad, slice, toHex } from 'viem';
import type { Hex } from 'viem';

export type KeyFamily = 'uint' | 'int' | 'bool' | 'address' | 'bytes' | 'string' | 'unsupported';

/**
 * Parse a layout slot string into a number. Layout sources emit slots as
 * decimal ('3') or 0x-hex ('0x3') — and some (e.g. certain Sourcify
 * solc outputs) emit 64-nibble zero-padded hex WITHOUT the 0x prefix
 * ('000…0a'). Tolerate all three: a 64-char hex-digit string is read as
 * padded hex (solc never zero-pads a decimal slot to 64).
 */
export function parseSlotNumber(slot: string | number | bigint): bigint {
  if (typeof slot === 'bigint') return slot;
  if (typeof slot === 'number') return BigInt(Math.trunc(slot));
  const s = slot.trim();
  if (s.startsWith('0x') || s.startsWith('0X')) return BigInt(s);
  if (s.length === 64 && /^[0-9a-fA-F]+$/.test(s)) return BigInt(`0x${s}`);
  if (/^\d+$/.test(s)) return BigInt(s);
  throw new RangeError(`unrecognized slot: ${slot}`);
}

/** '3' | '0x03' | '00…0a' | 3n → '0x3' — canonical lowercase hex for a slot number. */
export function normalizeSlot(slot: string | number | bigint): Hex {
  return toHex(parseSlotNumber(slot));
}

/** base + delta as a canonical slot hex; refuses to go below slot 0. */
export function slotAdd(base: Hex, delta: bigint): Hex {
  const next = hexToBigInt(base) + delta;
  if (next < 0n) {
    throw new RangeError(`slot underflow: ${base} + (${delta})`);
  }
  return toHex(next);
}

// Key labels come from the storage-layout type map (plus 'enum X' and
// 'contract X' shapes), so classification is prefix/regex based. uint is
// checked before int ('uint256' also starts with 'int' textually).
export function keyTypeFamily(keyTypeLabel: string): KeyFamily {
  const label = keyTypeLabel.trim();
  if (label.startsWith('uint')) return 'uint';
  if (label.startsWith('int')) return 'int';
  if (label.startsWith('enum')) return 'uint';
  if (label === 'bool') return 'bool';
  if (label === 'address' || label.startsWith('contract ')) return 'address';
  if (label === 'string') return 'string';
  if (label === 'bytes' || /^bytes\d+$/.test(label)) return 'bytes';
  return 'unsupported';
}

/**
 * Validate a user-typed mapping key against its declared key type.
 * Returns null when the key is encodable, a human-readable error
 * message otherwise. Never throws.
 */
export function validateMappingKey(key: string, keyTypeLabel: string): string | null {
  const trimmed = key.trim();
  if (trimmed === '') return 'Empty key';
  switch (keyTypeFamily(keyTypeLabel)) {
    case 'uint':
    case 'int': {
      let value: bigint;
      try {
        value = BigInt(trimmed);
      } catch {
        return 'Not a number';
      }
      if (value < 0n && keyTypeFamily(keyTypeLabel) === 'uint') {
        return 'Negative value not allowed for unsigned key';
      }
      return null;
    }
    case 'bool':
      return trimmed.toLowerCase() === 'true' || trimmed.toLowerCase() === 'false'
        ? null
        : 'Expected true/false';
    case 'address':
      return /^0x[0-9a-fA-F]{40}$/.test(trimmed) ? null : 'Invalid address';
    case 'bytes': {
      if (!/^0x[0-9a-fA-F]*$/.test(trimmed) || trimmed.length % 2 !== 0) {
        return 'Invalid hex';
      }
      const label = keyTypeLabel.trim();
      // Fixed bytesN keys must carry exactly N bytes — a short/long value
      // would silently hash a different key than the contract sees.
      const fixed = /^bytes(\d+)$/.exec(label);
      if (fixed !== null && (trimmed.length - 2) / 2 !== Number(fixed[1])) {
        return `Expected ${fixed[1]} bytes`;
      }
      return null;
    }
    case 'string':
      return null;
    default:
      return `Unsupported key type: ${keyTypeLabel}`;
  }
}

/**
 * h(key) for a mapping key: the 32-byte word Solidity hashes with the
 * mapping's base slot. Returns { encoded } on success or the same human
 * message validateMappingKey would give — never throws.
 */
export function encodeMappingKey(
  key: string,
  keyTypeLabel: string,
): { encoded: Hex } | { error: string } {
  const invalid = validateMappingKey(key, keyTypeLabel);
  if (invalid !== null) return { error: invalid };
  const trimmed = key.trim();
  const label = keyTypeLabel.trim();
  switch (keyTypeFamily(label)) {
    case 'uint':
      return { encoded: pad(toHex(BigInt(trimmed)), { size: 32 }) };
    case 'int':
      // Two's complement: -1n becomes 0xff…ff before padding.
      return { encoded: pad(toHex(BigInt.asUintN(256, BigInt(trimmed))), { size: 32 }) };
    case 'bool':
      return { encoded: pad(toHex(trimmed.toLowerCase() === 'true'), { size: 32 }) };
    case 'address':
      return { encoded: pad(trimmed.toLowerCase() as Hex, { size: 32 }) };
    case 'string':
      // The raw (untrimmed) string is the key the contract hashed — only
      // whitespace-only input is rejected above.
      return { encoded: keccak256(toHex(key)) };
    case 'bytes': {
      const normalized = trimmed.toLowerCase() as Hex;
      if (label === 'bytes') return { encoded: keccak256(normalized) };
      // bytesN occupies the high-order bytes of the slot → right-pad.
      return { encoded: pad(normalized, { size: 32, dir: 'right' }) };
    }
    default:
      return { error: `Unsupported key type: ${keyTypeLabel}` };
  }
}

/** keccak256(concat([h(key), pad(baseSlot, 32)])) — a mapping value's slot. */
export function mappingValueSlot(encodedKey: Hex, baseSlot: Hex): Hex {
  return keccak256(concat([encodedKey, pad(baseSlot, { size: 32 })]));
}

/** First data slot of a dynamic array's elements (base slot holds length). */
export function dynamicArrayDataSlot(baseSlot: Hex): Hex {
  return keccak256(pad(baseSlot, { size: 32 }));
}

/**
 * Where element `index` of an inplace array lives, relative to the
 * array's base slot: packed types share slots (offset in bytes), types
 * of 32+ bytes (or that don't fit twice) get whole slots.
 */
export function arrayElementPlacement(
  index: number,
  baseNumberOfBytes: number,
): { slotDelta: number; offset: number } {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`invalid array index: ${index}`);
  }
  if (!Number.isInteger(baseNumberOfBytes) || baseNumberOfBytes < 1) {
    throw new RangeError(`invalid element byte size: ${baseNumberOfBytes}`);
  }
  const nPerSlot = Math.floor(32 / baseNumberOfBytes);
  if (nPerSlot < 2) {
    return { slotDelta: index * Math.ceil(baseNumberOfBytes / 32), offset: 0 };
  }
  return {
    slotDelta: Math.floor(index / nPerSlot),
    offset: (index % nPerSlot) * baseNumberOfBytes,
  };
}

export type BytesWordLayout =
  | { kind: 'short'; length: bigint; lengthOdd: boolean }
  | { kind: 'long'; length: bigint; dataSlots: number; dataSlot: Hex };

/**
 * Decode a bytes/string length word. The lowest bit of the lowest byte
 * selects the form: odd → long (word = length*2+1, data contiguous from
 * keccak256(pad(baseSlot, 32))), even → short (length = lowest byte / 2,
 * data is the word's own high-order bytes).
 */
export function decodeBytesWord(word: Hex, baseSlot: Hex): BytesWordLayout {
  const full = pad(word, { size: 32 });
  const lastByte = hexToNumber(slice(full, 31));
  if (lastByte % 2 === 1) {
    // BigInt division truncates, so (length*2 + 1) / 2 → length.
    const length = hexToBigInt(full) / 2n;
    const dataSlots = Number((length + 31n) / 32n);
    return { kind: 'long', length, dataSlots, dataSlot: keccak256(pad(baseSlot, { size: 32 })) };
  }
  return { kind: 'short', length: BigInt(lastByte / 2), lengthOdd: false };
}

/** 'contract X' → 'address', 'enum X' → 'uint8', anything else passes through. */
export function abiTypeForLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.startsWith('contract ')) return 'address';
  if (trimmed.startsWith('enum ')) return 'uint8';
  return trimmed;
}

/** Decimal string of a slot hex, for display next to the 0x form. */
export function formatSlotDecimal(slot: Hex): string {
  return hexToBigInt(slot).toString();
}
