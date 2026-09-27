// abiList pure-helper tests: category bucketing (view/pure vs
// nonpayable/payable split, singleton entries into `other`), canonical
// dedup-key stability, human signature formatting, and the merged-copy
// contract — selected entries in original ABI order with EVERY error
// definition riding along, deduped by key.
import { describe, it, expect } from 'vitest';

import {
  ABI_CATEGORY_ORDER,
  abiEntryKey,
  buildAbiCopy,
  categorize,
  categoryCounts,
  categoryOf,
  formatAbiSignature,
  isAbiListEntry,
  parseAbiEntries,
  type AbiListEntry,
} from '@/views/Contract/abiList';

const readFn = (name: string, inputs: Array<{ type: string }> = []): AbiListEntry => ({
  type: 'function',
  name,
  inputs,
  stateMutability: 'view',
});

describe('abiList categoryOf', () => {
  it('splits functions into read (view/pure) and write (nonpayable/payable)', () => {
    expect(categoryOf({ type: 'function', name: 'a', stateMutability: 'view' })).toBe('read');
    expect(categoryOf({ type: 'function', name: 'b', stateMutability: 'pure' })).toBe('read');
    expect(categoryOf({ type: 'function', name: 'c', stateMutability: 'nonpayable' })).toBe(
      'write',
    );
    expect(categoryOf({ type: 'function', name: 'd', stateMutability: 'payable' })).toBe('write');
    // Old ABIs omit stateMutability; Solidity's implicit default is
    // nonpayable, so the entry mutates.
    expect(categoryOf({ type: 'function', name: 'e' })).toBe('write');
  });

  it('gives events and errors their own buckets', () => {
    expect(categoryOf({ type: 'event', name: 'Transfer' })).toBe('event');
    expect(categoryOf({ type: 'error', name: 'Unauthorized' })).toBe('error');
  });

  it('buckets constructor/receive/fallback and untyped entries into other', () => {
    expect(categoryOf({ type: 'constructor' })).toBe('other');
    expect(categoryOf({ type: 'receive' })).toBe('other');
    expect(categoryOf({ type: 'fallback' })).toBe('other');
    expect(categoryOf({ name: 'legacy' })).toBe('other');
  });
});

describe('abiList categorize and counts', () => {
  const entries: AbiListEntry[] = [
    readFn('name'),
    { type: 'function', name: 'transfer', stateMutability: 'nonpayable' },
    { type: 'event', name: 'Transfer' },
    { type: 'error', name: 'Unauthorized' },
    { type: 'constructor' },
  ];

  it('buckets every category (empty ones included) preserving ABI order', () => {
    const buckets = categorize(entries);
    expect(ABI_CATEGORY_ORDER).toEqual(['read', 'write', 'event', 'error', 'other']);
    expect(buckets.read.map(entry => entry.name)).toEqual(['name']);
    expect(buckets.write.map(entry => entry.name)).toEqual(['transfer']);
    expect(buckets.event.map(entry => entry.name)).toEqual(['Transfer']);
    expect(buckets.error.map(entry => entry.name)).toEqual(['Unauthorized']);
    expect(buckets.other.map(entry => entry.type)).toEqual(['constructor']);
    // All five keys always exist so callers never branch on presence.
    expect(Object.keys(buckets).sort()).toEqual([...ABI_CATEGORY_ORDER].sort());
  });

  it('counts entries per category', () => {
    expect(categoryCounts(entries)).toEqual({
      read: 1,
      write: 1,
      event: 1,
      error: 1,
      other: 1,
    });
  });
});

describe('abiList abiEntryKey', () => {
  it('keys functions/events/errors on name plus input types', () => {
    expect(abiEntryKey({ type: 'function', name: 'transfer', inputs: [{ type: 'address' }] })).toBe(
      'function:transfer(address)',
    );
    // Overloads with different arg counts or types stay distinct.
    expect(abiEntryKey({ type: 'function', name: 'transfer', inputs: [] })).toBe(
      'function:transfer()',
    );
    expect(
      abiEntryKey({
        type: 'function',
        name: 'transfer',
        inputs: [{ type: 'address' }, { type: 'uint256' }],
      }),
    ).toBe('function:transfer(address,uint256)');
    expect(abiEntryKey({ type: 'error', name: 'E', inputs: [{ type: 'uint8' }] })).toBe(
      'error:E(uint8)',
    );
  });

  it('keys singleton entries on their bare type and stays stable across field order', () => {
    expect(abiEntryKey({ type: 'constructor', inputs: [{ type: 'address' }] })).toBe(
      'constructor:(address)',
    );
    expect(abiEntryKey({ type: 'receive' })).toBe('receive:()');
    expect(abiEntryKey({ type: 'fallback', name: undefined })).toBe('fallback:()');
    expect(abiEntryKey({ inputs: [{ type: 'uint256' }], name: 'f', type: 'function' })).toBe(
      'function:f(uint256)',
    );
  });
});

describe('abiList formatAbiSignature', () => {
  it('formats functions with outputs and plain names without', () => {
    expect(
      formatAbiSignature({
        type: 'function',
        name: 'balanceOf',
        inputs: [{ type: 'address' }],
        outputs: [{ type: 'uint256' }],
      }),
    ).toBe('balanceOf(address) returns (uint256)');
    expect(formatAbiSignature(readFn('name'))).toBe('name()');
    expect(
      formatAbiSignature({
        type: 'function',
        name: 'multi',
        inputs: [{ type: 'address' }, { type: 'uint256' }],
        outputs: [{ type: 'bool' }, { type: 'bytes32' }],
      }),
    ).toBe('multi(address, uint256) returns (bool, bytes32)');
  });

  it('prefixes events and errors, renders singleton entries naturally', () => {
    expect(formatAbiSignature({ type: 'event', name: 'Transfer', inputs: [{ type: 'address' }] })).toBe(
      'event Transfer(address)',
    );
    expect(formatAbiSignature({ type: 'error', name: 'Unauthorized' })).toBe('error Unauthorized()');
    expect(formatAbiSignature({ type: 'constructor', inputs: [{ type: 'address' }] })).toBe(
      'constructor(address)',
    );
    expect(formatAbiSignature({ type: 'receive' })).toBe('receive()');
    expect(formatAbiSignature({ type: 'fallback' })).toBe('fallback()');
    expect(formatAbiSignature({ type: 'fallback', inputs: [{ type: 'bytes' }] })).toBe(
      'fallback(bytes)',
    );
  });
});

describe('abiList buildAbiCopy', () => {
  const entries: AbiListEntry[] = [
    { type: 'error', name: 'Unauthorized' },
    readFn('name'),
    { type: 'function', name: 'transfer', stateMutability: 'nonpayable' },
    { type: 'error', name: 'InsufficientBalance', inputs: [{ type: 'uint256' }] },
    { type: 'event', name: 'Transfer' },
  ];

  it('merges the selection (original ABI order) plus every error, pretty-printed', () => {
    const copy = buildAbiCopy(
      new Set(['function:name()', 'event:Transfer()']),
      entries,
    );
    expect(JSON.parse(copy)).toEqual([
      { type: 'error', name: 'Unauthorized' },
      { type: 'function', name: 'name', inputs: [], stateMutability: 'view' },
      { type: 'error', name: 'InsufficientBalance', inputs: [{ type: 'uint256' }] },
      { type: 'event', name: 'Transfer' },
    ]);
    // The payload is pretty-printed JSON (paste-friendly).
    expect(copy).toBe(JSON.stringify(JSON.parse(copy), null, 2));
  });

  it('includes all error definitions even when nothing is selected', () => {
    const copy = JSON.parse(buildAbiCopy(new Set(), entries)) as AbiListEntry[];
    expect(copy.map(entry => entry.name)).toEqual(['Unauthorized', 'InsufficientBalance']);
  });

  it('does not duplicate an error that is also selected', () => {
    const copy = JSON.parse(
      buildAbiCopy(new Set(['error:Unauthorized()', 'function:name()']), entries),
    ) as AbiListEntry[];
    expect(copy.filter(entry => entry.name === 'Unauthorized')).toHaveLength(1);
  });

  it('dedupes repeated entries sharing a canonical key', () => {
    const dup: AbiListEntry[] = [readFn('name'), readFn('name')];
    const copy = JSON.parse(buildAbiCopy(new Set(['function:name()']), dup)) as AbiListEntry[];
    expect(copy).toHaveLength(1);
  });

  it('copies an empty array when nothing is selected and no errors exist', () => {
    expect(buildAbiCopy(new Set(), [readFn('name')])).toBe('[]');
  });
});

describe('abiList parseAbiEntries', () => {
  it('parses an ABI array and drops non-entry junk members', () => {
    const parsed = parseAbiEntries('[{"type":"function","name":"f"}, 3, "junk", null]');
    expect(parsed).toEqual([{ type: 'function', name: 'f' }]);
  });

  it('degrades malformed JSON or a non-array body to an empty list', () => {
    expect(parseAbiEntries('not json')).toEqual([]);
    expect(parseAbiEntries('{"type":"function"}')).toEqual([]);
  });

  it('narrows unknown values for the panel prop (isAbiListEntry)', () => {
    expect(isAbiListEntry({})).toBe(true);
    expect(isAbiListEntry(null)).toBe(false);
    expect(isAbiListEntry([1])).toBe(false);
    expect(isAbiListEntry('entry')).toBe(false);
  });
});
