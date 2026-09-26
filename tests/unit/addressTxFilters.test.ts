// URL-driven state of the tx-tab advanced filters: the shared schema's
// parse semantics for ?tfFrom=/?tfTo=/?tfMin=/?tfMax= plus the pure
// effectiveTxFilters derivation the view consumes (absent vs explicit vs
// invalid-degraded) and the active-count gate for the honest
// filtered-empty state. The explicit-vs-absent distinction is load-bearing
// (the ?tab= lesson): a .catch(default) would collapse it and deadlock
// the filter bar's open/apply state machine.
import { describe, it, expect } from 'vitest';
import { getAddress } from 'viem';
import {
  addressSearchSchema,
  effectiveTxFilters,
  hasActiveTxFilters,
} from '@/views/Address/search';

// Same input shape the router feeds the schema (parseSearchInput): a
// plain object of string values from the query string.
const parse = (search: string) =>
  addressSearchSchema.parse(Object.fromEntries(new URLSearchParams(search)));

const VALID_FROM = '0x1111111111111111111111111111111111111111';
const VALID_TO = '0x2222222222222222222222222222222222222222';
// Mixed-case body that disagrees with its EIP-55 checksum (tier 2 of the
// two-tier verdict): built from a real checksum form by uppercasing one
// position where the checksum says lowercase — the same construction as
// addressValidity.test.ts.
const CHECKSUMMED_BASE = getAddress('0x5aaeb6053f3e94c9b9a09f33669495e3474963fe');
const BAD_CHECKSUM = (() => {
  for (let i = 2; i < CHECKSUMMED_BASE.length; i++) {
    if (/[a-f]/.test(CHECKSUMMED_BASE[i])) {
      return (
        CHECKSUMMED_BASE.slice(0, i)
        + CHECKSUMMED_BASE[i].toUpperCase()
        + CHECKSUMMED_BASE.slice(i + 1)
      );
    }
  }
  return CHECKSUMMED_BASE;
})();

describe('addressSearchSchema — tf params', () => {
  it('parses the full shareable filtered deep link as raw strings', () => {
    const parsed = parse(
      `?tfFrom=${VALID_FROM}&tfTo=${VALID_TO}&tfMin=1&tfMax=1000000000000000000000`,
    );

    expect(parsed.tfFrom).toBe(VALID_FROM);
    expect(parsed.tfTo).toBe(VALID_TO);
    // Wei amounts stay exact decimal strings — never coerced to Number.
    expect(parsed.tfMin).toBe('1');
    expect(parsed.tfMax).toBe('1000000000000000000000');
  });

  it('defaults every tf key to undefined on an empty search', () => {
    const parsed = parse('');

    expect(parsed.tfFrom).toBeUndefined();
    expect(parsed.tfTo).toBeUndefined();
    expect(parsed.tfMin).toBeUndefined();
    expect(parsed.tfMax).toBeUndefined();
  });

  it('keeps malformed values as strings (validation is the derivation)', () => {
    const parsed = parse('?tfFrom=garbage&tfMin=-5');

    expect(parsed.tfFrom).toBe('garbage');
    expect(parsed.tfMin).toBe('-5');
  });

  it('parses an empty param as the empty string (present, not absent)', () => {
    const parsed = parse('?tfFrom=');

    expect(parsed.tfFrom).toBe('');
  });

  it('never drops the other tabs\' keys alongside tf params', () => {
    const parsed = parse('?tab=transactions&page=3&tfMin=7');

    expect(parsed.tab).toBe('transactions');
    expect(parsed.page).toBe(3);
    expect(parsed.tfMin).toBe('7');
  });
});

describe('effectiveTxFilters', () => {
  it('returns no keys when every param is absent', () => {
    const filters = effectiveTxFilters({});

    expect(filters).toEqual({});
    expect(hasActiveTxFilters(filters)).toBe(false);
  });

  it('keeps explicit valid values verbatim (absent vs explicit stays observable)', () => {
    const filters = effectiveTxFilters({
      tfFrom: VALID_FROM,
      tfTo: VALID_TO,
      tfMin: '0',
      tfMax: '1000000000000000000000',
    });

    expect(filters).toEqual({
      fromAddress: VALID_FROM,
      toAddress: VALID_TO,
      minValue: '0',
      maxValue: '1000000000000000000000',
    });
    expect(hasActiveTxFilters(filters)).toBe(true);
  });

  it('accepts lowercase addresses (checksum-less convention)', () => {
    const filters = effectiveTxFilters({ tfFrom: VALID_FROM.toLowerCase() });

    expect(filters.fromAddress).toBe(VALID_FROM.toLowerCase());
  });

  it('degrades a shape-invalid address to absent', () => {
    expect(effectiveTxFilters({ tfFrom: '0x123' })).toEqual({});
    expect(effectiveTxFilters({ tfTo: 'not-an-address' })).toEqual({});
  });

  it('degrades a checksum-mismatched mixed-case address to absent', () => {
    expect(effectiveTxFilters({ tfFrom: BAD_CHECKSUM })).toEqual({});
  });

  it('degrades non-integer, negative, NaN-ish and fractional wei to absent', () => {
    for (const bad of ['-5', 'NaN', '1.5', '1e18', '0x10', ' ']) {
      expect(effectiveTxFilters({ tfMin: bad })).toEqual({});
      expect(effectiveTxFilters({ tfMax: bad })).toEqual({});
    }
  });

  it('treats empty strings as absent (empty param is the cleared state)', () => {
    expect(effectiveTxFilters({ tfFrom: '', tfTo: '', tfMin: '', tfMax: '' })).toEqual({});
  });

  it('keeps only the valid subset of a mixed link', () => {
    const filters = effectiveTxFilters({
      tfFrom: VALID_FROM,
      tfTo: '0x12',
      tfMin: '7',
      tfMax: 'oops',
    });

    expect(filters).toEqual({ fromAddress: VALID_FROM, minValue: '7' });
    expect(hasActiveTxFilters(filters)).toBe(true);
  });
});

describe('hasActiveTxFilters', () => {
  it('is false only when no filter key is present', () => {
    expect(hasActiveTxFilters({})).toBe(false);
    expect(hasActiveTxFilters({ fromAddress: VALID_FROM })).toBe(true);
    expect(hasActiveTxFilters({ minValue: '0' })).toBe(true);
    expect(hasActiveTxFilters({ maxValue: '1' })).toBe(true);
    expect(hasActiveTxFilters({ toAddress: VALID_TO })).toBe(true);
  });
});
