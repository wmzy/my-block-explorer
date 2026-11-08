// The canonical two-tier address verdict (src/utils/address.ts) every
// address surface is now built on — server route params, search, the
// address page, the MCP tools. The tier boundaries and the case rules
// pinned here are load-bearing: a frontend/server/MCP disagreement on
// any of them resurfaces as split-screen conflicting verdicts.
import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { HEX_ADDRESS_RE, addressVerdict, isAddressShape } from '@/utils/address';

// EIP-55 reference address — mixed-case by construction, so both the
// valid and the corrupted variants are easy to derive from it.
const LOWER = '0x5aaeb6053f3e94c9b9a09f33669495e3474963fe';
const CHECKSUMMED = getAddress(LOWER);

/** Flip one body position the checksum renders lowercase to uppercase. */
function flipChecksumLetter(base: string): string {
  for (let i = 2; i < base.length; i++) {
    if (/[a-f]/.test(base[i])) {
      return base.slice(0, i) + base[i].toUpperCase() + base.slice(i + 1);
    }
  }
  throw new Error('fixture has no lowercase body letter to flip');
}

describe('isAddressShape', () => {
  it('accepts any 0x + 40-hex casing and rejects everything else', () => {
    expect(isAddressShape(LOWER)).toBe(true);
    expect(isAddressShape(CHECKSUMMED)).toBe(true);
    expect(isAddressShape(`0x${LOWER.slice(2).toUpperCase()}`)).toBe(true);
    expect(isAddressShape('0x123')).toBe(false);
    expect(isAddressShape(`0x${'ab'.repeat(21)}`)).toBe(false);
    expect(isAddressShape(LOWER.slice(2))).toBe(false);
    expect(isAddressShape('')).toBe(false);
    expect(isAddressShape(`${LOWER}0`)).toBe(false);
  });

  it('is the exported regex applied', () => {
    expect(isAddressShape('0xZZ')).toBe(HEX_ADDRESS_RE.test('0xZZ'));
  });
});

describe('addressVerdict', () => {
  it('returns invalid-shape for non-hex, wrong-length and unprefixed input', () => {
    expect(addressVerdict('')).toEqual({ tier: 'invalid-shape' });
    expect(addressVerdict('0x123')).toEqual({ tier: 'invalid-shape' });
    expect(addressVerdict('0x12345678901234567890123456789012345678901')).toEqual({ tier: 'invalid-shape' });
    expect(addressVerdict('1234567890abcdef1234567890abcdef12345678')).toEqual({ tier: 'invalid-shape' });
    expect(addressVerdict(`0xG${'11'.repeat(19)}1`)).toEqual({ tier: 'invalid-shape' });
  });

  it('returns invalid-checksum with the retry form when a mixed-case body disagrees with EIP-55', () => {
    // viem's getAddress would silently correct this input — the verdict
    // must instead flag it and carry the corrected form for the caller
    // to show.
    const bad = flipChecksumLetter(CHECKSUMMED);
    expect(bad).not.toBe(CHECKSUMMED);
    expect(addressVerdict(bad)).toEqual({
      tier: 'invalid-checksum',
      checksummed: CHECKSUMMED,
    });
  });

  it('accepts the all-lowercase form (checksum-less convention) and canonicalizes it', () => {
    const verdict = addressVerdict(LOWER);
    expect(verdict).toEqual({ tier: 'valid', checksummed: CHECKSUMMED });
  });

  it('accepts the all-uppercase form (checksum-less convention) and canonicalizes it', () => {
    // Single-case bodies carry no checksum information, so they skip the
    // checksum tier — server parity for all-upper deep links.
    const upper = `0x${LOWER.slice(2).toUpperCase()}`;
    const verdict = addressVerdict(upper);
    expect(verdict.tier).toBe('valid');
    if (verdict.tier !== 'valid') return;
    expect(verdict.checksummed).toBe(CHECKSUMMED);
  });

  it('accepts a correct EIP-55 checksum verbatim', () => {
    expect(addressVerdict(CHECKSUMMED)).toEqual({ tier: 'valid', checksummed: CHECKSUMMED });
  });

  it('never throws — getAddress only runs behind the shape gate', () => {
    // These inputs would make viem's getAddress throw; the verdict must
    // classify them, not crash on them.
    expect(() => addressVerdict('not-an-address')).not.toThrow();
    expect(addressVerdict('not-an-address').tier).toBe('invalid-shape');
    expect(addressVerdict('0x0000000000000000000000000000000000000000').tier).toBe('valid');
  });
});
