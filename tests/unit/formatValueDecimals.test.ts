// formatValue's decimals dimension (the InternalTxns display contract,
// ported into the shared formatter) and formatGasString (the Blocks
// Detail BigInt-safe gas twin). The 18-decimal default path must stay
// byte-identical to the pre-decimals hard-coded formatter — including
// the exact-integer floor gate `wei < 10n ** 14n`, which floors the
// WHOLE sub-floor band (values half-up would round to "0.0001" too).
import { describe, it, expect } from 'vitest';

import { formatGasString, formatValue } from '@/utils/format';

const ONE = 10n ** 18n; // one 18-decimal native unit

describe('formatValue default (18 decimals) stays byte-identical', () => {
  it('renders zero exactly', () => {
    expect(formatValue(0n, 'ETH')).toBe('0 ETH');
  });

  it('renders whole units at 4 decimals', () => {
    expect(formatValue(2n * ONE, 'ETH')).toBe('2.0000 ETH');
    expect(formatValue(1234500000000000000n, 'ETH')).toBe('1.2345 ETH');
  });

  it('floors the whole sub-floor band, including the half-up boundary', () => {
    // 99999999999999 wei is 0.0000999… — the pinned dust case.
    expect(formatValue(99999999999999n, 'ETH')).toBe('<0.0001 ETH');
    // 0.00005 ETH (the exact half-up boundary) also floors: the
    // historical gate compared integers, never a rounded rendering.
    expect(formatValue(5n * 10n ** 13n, 'ETH')).toBe('<0.0001 ETH');
  });

  it('renders the floor unit itself as 0.0001', () => {
    expect(formatValue(10n ** 14n, 'ETH')).toBe('0.0001 ETH');
  });
});

describe('formatValue over the chain’s own native decimals', () => {
  it('formats a 6-decimal token amount at 4 displayed decimals', () => {
    // 1.0 unit of a 6-decimal currency.
    expect(formatValue(1_000_000n, 'TT', 6)).toBe('1.0000 TT');
  });

  it('floors sub-floor dust at 6 decimals (below 100 base units)', () => {
    expect(formatValue(99n, 'TT', 6)).toBe('<0.0001 TT');
  });

  it('renders the 6-decimal floor unit as 0.0001', () => {
    expect(formatValue(100n, 'TT', 6)).toBe('0.0001 TT');
  });

  it('renders 0-decimal currencies without an exponent blow-up', () => {
    // With decimals 0 every base unit is a whole unit: 1 → 1.0000.
    expect(formatValue(1n, 'ZERO', 0)).toBe('1.0000 ZERO');
    expect(formatValue(0n, 'ZERO', 0)).toBe('0 ZERO');
    // The floor at decimals 0 is below one whole unit: no positive
    // amount can round away, so dust never appears.
    expect(formatValue(1n, 'ZERO', 0)).not.toContain('<');
  });

  it('falls back to the raw wei integer for invalid decimals', () => {
    // formatFixedDecimals' guard (negative / non-integer decimals)
    // rejects; the fallback shows the true integer, never a fabricated
    // amount (the InternalTxns contract).
    expect(formatValue(123n, 'X', -1)).toBe('123 X');
    expect(formatValue(123n, 'X', 4.5)).toBe('123 X');
  });

  it('keeps 18-decimal rendering identical when decimals is passed explicitly', () => {
    expect(formatValue(2n * ONE, 'ETH', 18)).toBe('2.0000 ETH');
    expect(formatValue(99999999999999n, 'ETH', 18)).toBe('<0.0001 ETH');
  });
});

describe('formatGasString', () => {
  it('groups a decimal gas string exactly, precision-safe', () => {
    expect(formatGasString('21000')).toBe('21,000');
    expect(formatGasString('0')).toBe('0');
    // Past 2^53, where Number coercion would silently lose precision.
    expect(formatGasString('9007199254740993')).toBe('9,007,199,254,740,993');
  });

  it('returns a non-numeric string verbatim (renderer intent, not an error)', () => {
    expect(formatGasString('abc')).toBe('abc');
    // BigInt's own semantics, faithfully inherited from the twin this
    // replaced: BigInt('') is 0n and BigInt('0x1a') parses as hex 26 —
    // renderers only ever hand decimal strings, these document the edge.
    expect(formatGasString('')).toBe('0');
    expect(formatGasString('0x1a')).toBe('26');
  });
});
