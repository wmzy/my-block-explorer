// On-chain amounts were formatted by round-tripping viem's EXACT decimal
// string through parseFloat().toFixed() — which destroys the exactness the
// BigInt math had, in three concrete ways:
//
//   1. distinct 256-bit amounts collapse — 10,000,000,000,000,001 and
//      10,000,000,000,000,000 base units both rendered
//      "10000000000000000.0000";
//   2. at >= 1e21 units toFixed switches to exponential notation, so a
//      table cell read the literal "1e+21";
//   3. any nonzero amount below the display floor (e.g. an event's
//      400,000,000 wei) rendered as an exact "0.000000 ETH" —
//      indistinguishable from a real zero, which the repo's own dust
//      floors ("<0.0001") exist to prevent.
//
// The exact formatter is integer-only (divide + half-up rounding), so the
// gwei/wei paths' documented "never touch Number arithmetic" rule holds for
// the native/token paths too. It also covers decimals < fractionDigits
// (a 0-decimal token, where the in-repo formatFixed's `10n ** negative`
// would throw).
import { describe, it, expect } from 'vitest';
import { formatEth, formatFixedDecimals, formatTokenAmount, formatValue } from '@/utils/format';
import { formatValueByUnit } from '@/util/units';

const ONE_ETH = 10n ** 18n;

describe('exact wei/token formatting', () => {
  it('keeps amounts 1 base unit apart distinct at 1e16 units', () => {
    const a = formatTokenAmount(10000000000000001n, 0);
    const b = formatTokenAmount(10000000000000000n, 0);

    expect(a).not.toBe(b);
    expect(a).toBe('10000000000000001.0000');
    expect(b).toBe('10000000000000000.0000');
  });

  it('never emits exponential notation for a 1e21-unit token', () => {
    const shown = formatTokenAmount(10n ** 21n, 0);

    expect(shown).not.toContain('e+');
    expect(shown).toBe('1000000000000000000000.0000');
  });

  it('renders a nonzero dust amount as the floor, not an exact zero', () => {
    // 400,000,000 wei = 0.0000004 ETH: nonzero, but below 6 displayed
    // decimals. `0.000000 ETH` claims an exact zero that never happened.
    const shown = formatTokenAmount(400000000n, 18, 6);

    expect(shown).not.toBe('0.000000');
    expect(shown).toBe('<0.000001');
  });

  it('renders 1 wei of an 18-decimal token as a nonzero floor', () => {
    expect(formatTokenAmount(1n, 18)).toBe('<0.0001');
  });

  it('keeps ordinary amounts byte-identical to the old float path', () => {
    // Regression guard: the common cases must not move.
    expect(formatTokenAmount(1234500000000000000n, 18)).toBe('1.2345');
    expect(formatEth(ONE_ETH)).toBe('1.0000');
    expect(formatValue(2n * ONE_ETH, 'ETH')).toBe('2.0000 ETH');
    expect(formatValue(0n, 'ETH')).toBe('0 ETH');
    expect(formatValue(99999999999999n, 'ETH')).toBe('<0.0001 ETH');
  });

  it('rounds half up at the last displayed digit', () => {
    // 0.00005 native units (500n at 7 decimals) → 0.0001 at 4 digits.
    expect(formatTokenAmount(500n, 7)).toBe('0.0001');
    // Just below the midpoint rounds down — and states the floor.
    expect(formatTokenAmount(499n, 7)).toBe('<0.0001');
  });

  it('handles decimals below the displayed precision without throwing', () => {
    // A 0-decimal token with 2 displayed digits: the exact value is simply
    // padded (10n ** negative would throw).
    expect(formatTokenAmount(7n, 0, 2)).toBe('7.00');
  });

  it('native unit rows keep exactness and the dust floor', () => {
    const chain = { decimals: 18, symbol: 'ETH' };

    // 1e16 whole ETH: past 2^53 in unit terms, where parseFloat collapses
    // neighbouring values onto the same figure.
    const big = 10n ** 34n;
    const shown = formatValueByUnit(big, chain, 'native').text;
    const shownPlus = formatValueByUnit(big + 1n, chain, 'native').text;
    expect(shown).not.toContain('e+');
    expect(shown).toBe('10000000000000000.0000 ETH');
    // 1 wei more at that magnitude is invisible at 4 displayed decimals —
    // the point is that it is a bounded, non-exponential rendering.
    expect(shownPlus).toBe(shown);
    expect(formatValueByUnit(10000n, chain, 'native').text).toBe('<0.0001 ETH');
    expect(formatValueByUnit(2n * ONE_ETH, chain, 'native').text).toBe('2.0000 ETH');
    // gwei/wei readouts are untouched by this change.
    expect(formatValueByUnit(12345678901n, chain, 'gwei').text).toBe('12 gwei');
    expect(formatValueByUnit(12345678901n, chain, 'wei').text).toBe('12,345,678,901 wei');
  });
});

describe('formatEth/formatFixedDecimals precision guards', () => {
  it('renders zero displayed digits without a trailing dot', () => {
    expect(formatFixedDecimals(ONE_ETH, 18, 0)).toBe('1');
    expect(formatFixedDecimals(123456789n, 8, 0)).toBe('1');
    expect(formatEth(ONE_ETH, 0)).toBe('1');
  });

  it('caps display precision at the native unit instead of throwing', () => {
    // decimals > 18 asks for sub-wei precision that does not exist;
    // a negative BigInt exponent used to throw.
    expect(formatEth(2n * ONE_ETH, 20)).toBe('2.000000000000000000');
    expect(formatEth(ONE_ETH, 100)).toBe('1.000000000000000000');
  });

  it('falls back to the default precision on non-integer input', () => {
    expect(formatEth(ONE_ETH, 4.5)).toBe('1.0000');
    // Negative display precision is nonsense input; the clamp reads it
    // as zero displayed digits rather than throwing.
    expect(formatEth(ONE_ETH, -1)).toBe('1');
  });
});
