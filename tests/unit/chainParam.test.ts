// Route-param parser tests: only plain decimal digits parse, everything
// else Number()/parseInt would have accepted ("0x1a" hex, "1e5" exponent,
// padded/signed strings) resolves null — the D5 contract that keeps NaN
// and wrong-block lookups out of the URL surfaces.
import { describe, it, expect } from 'vitest';

import { parseBlockNumberParam, parseChainIdParam } from '@/utils/chainParam';

describe('parseChainIdParam', () => {
  it.each(['1', '11155111', '137'])('parses the plain decimal id %s', raw => {
    expect(parseChainIdParam(raw)).toBe(Number(raw));
  });

  it('parses leading zeros as the same integer', () => {
    expect(parseChainIdParam('0001')).toBe(1);
  });

  it('rejects non-decimal digit strings', () => {
    for (const raw of ['abc', '0x1a', '1e5', ' 12', '12 ', '+3', '-1', '12.5', '', '1_000']) {
      expect(parseChainIdParam(raw), raw).toBeNull();
    }
  });

  it('rejects undefined (no param at all)', () => {
    expect(parseChainIdParam(undefined)).toBeNull();
  });

  it('rejects zero and negative ids (chain ids start at 1)', () => {
    expect(parseChainIdParam('0')).toBeNull();
  });

  it('rejects ids beyond the safe integer range instead of losing precision', () => {
    expect(parseChainIdParam('9007199254740993')).toBeNull();
  });
});

describe('parseBlockNumberParam', () => {
  it('parses plain decimal block numbers', () => {
    expect(parseBlockNumberParam('18000001')).toBe(18000001);
  });

  it('keeps block 0 valid (genesis is a real block)', () => {
    expect(parseBlockNumberParam('0')).toBe(0);
  });

  it('rejects non-decimal digit strings', () => {
    // "0x1A" is the review's example: Number("0x1A") === 26 used to load
    // block 26 silently.
    for (const raw of ['0x1A', 'abc', '1e5', ' 12', '-1', '12.5', '', '0b101']) {
      expect(parseBlockNumberParam(raw), raw).toBeNull();
    }
  });

  it('rejects numbers beyond the safe integer range instead of losing precision', () => {
    expect(parseBlockNumberParam('9007199254740993')).toBeNull();
  });
});
