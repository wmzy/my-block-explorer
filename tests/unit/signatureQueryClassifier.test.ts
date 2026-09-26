// Pure input classification for the /signatures tool page: strict selector/
// topic0 shapes (exact 8-or-64 hex characters after 0x, case-insensitive,
// whitespace-trimmed), signature-syntax name fragments, and actionable
// guidance for everything else — including the deliberately rejected
// redundant-zero forms and bare hex words without the 0x prefix.
import { describe, it, expect, vi } from 'vitest';

// The view module pulls the topbar graph; the classifier is pure, so the
// stub only needs to satisfy the import (nothing renders here).
vi.mock('@/components/TopNavigation', () => ({ default: () => null }));

import { classifySignatureQuery } from '@/views/Signatures';

const invalidReason = (input: string): string => {
  const result = classifySignatureQuery(input);
  if (result.kind !== 'invalid') {
    throw new Error(`expected "${input}" to classify as invalid, got ${result.kind}`);
  }
  return result.reason;
};

const SELECTOR = '0xa9059cbb';
const TOPIC0 = `0x${'ab'.repeat(32)}`;

describe('classifySignatureQuery - well-formed kinds', () => {
  it('classifies a 4-byte function selector', () => {
    expect(classifySignatureQuery(SELECTOR)).toEqual({
      kind: 'selector',
      normalized: SELECTOR,
    });
  });

  it('classifies a 32-byte event topic0', () => {
    expect(classifySignatureQuery(TOPIC0)).toEqual({ kind: 'topic0', normalized: TOPIC0 });
  });

  it('normalizes hex case and trims surrounding whitespace', () => {
    expect(classifySignatureQuery(`  ${SELECTOR.toUpperCase()} `)).toEqual({
      kind: 'selector',
      normalized: SELECTOR,
    });
    expect(classifySignatureQuery(`${TOPIC0.toUpperCase()} `)).toEqual({
      kind: 'topic0',
      normalized: TOPIC0,
    });
  });

  it('accepts the uppercase 0X prefix like the backend does', () => {
    expect(classifySignatureQuery(`0X${SELECTOR.slice(2)}`)).toEqual({
      kind: 'selector',
      normalized: SELECTOR,
    });
  });

  it('classifies signature-syntax name fragments', () => {
    expect(classifySignatureQuery('transfer(address,uint256)')).toEqual({
      kind: 'name',
      normalized: 'transfer(address,uint256)',
    });
    expect(classifySignatureQuery('  foo(uint256[2][],bytes) ')).toEqual({
      kind: 'name',
      normalized: 'foo(uint256[2][],bytes)',
    });
    expect(classifySignatureQuery('OrderFilled')).toEqual({
      kind: 'name',
      normalized: 'OrderFilled',
    });
  });
});

describe('classifySignatureQuery - invalid forms with guidance', () => {
  it('rejects empty and whitespace-only queries', () => {
    for (const input of ['', '   ', '\t']) {
      expect(invalidReason(input)).toContain('Enter a 4-byte function selector');
    }
  });

  it('rejects wrong-length 0x values with exact-width guidance', () => {
    expect(invalidReason('0x1234')).toContain('4 hex characters after 0x');
    expect(invalidReason('0x1234')).toContain('exactly 8');

    // One nibble over selector width / two over topic0 width.
    expect(invalidReason(`${SELECTOR}0`)).toContain('9 hex characters after 0x');
    expect(invalidReason(`0x${'ab'.repeat(33)}`)).toContain('66 hex characters after 0x');
    // One nibble short of a topic0.
    expect(invalidReason(`0x${'ab'.repeat(31)}`)).toContain('62 hex characters after 0x');
  });

  it('rejects redundant-zero padded forms instead of guessing the last nibbles', () => {
    // 16 hex characters: neither an 8-char selector nor a 64-char topic0 —
    // padding a selector to another width would name a different value.
    expect(invalidReason(`0x00000000${SELECTOR.slice(2)}`)).toContain(
      '16 hex characters after 0x',
    );
  });

  it('rejects non-hex bodies behind a 0x prefix', () => {
    expect(invalidReason('0xzzzzzzzz')).toContain('not hexadecimal');
    expect(invalidReason('0xa9059cbbz')).toContain('not hexadecimal');
  });

  it('rejects bare hex words with a prefix hint instead of treating them as names', () => {
    expect(invalidReason('a9059cbb')).toContain('without its 0x prefix');
    expect(invalidReason('deadbeef')).toContain('without its 0x prefix');
  });

  it('rejects fragments outside signature syntax', () => {
    // Inner spaces and punctuation outside the allowed set.
    expect(invalidReason('transfer (address,uint256)')).toContain(
      'neither a 0x-prefixed selector/topic0 nor signature syntax',
    );
    expect(invalidReason('foo;bar()')).toContain('signature syntax');
    expect(invalidReason('a.b(c)')).toContain('signature syntax');
  });
});
