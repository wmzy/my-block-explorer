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
import {
  cellText,
  formatAddress,
  formatBigInt,
  formatEth,
  formatFixedDecimals,
  formatHash,
  formatNativeDisplay,
  formatTokenAmount,
  formatValue,
  truncateMiddle,
} from '@/utils/format';
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

describe('truncateMiddle — the one truncation primitive', () => {
  const ADDR = '0x1234567890abcdef1234567890abcdef12345678';

  it('keeps a 8/6 budget byte-identical to the old list-cell slices', () => {
    expect(truncateMiddle(ADDR, 8, 6)).toBe(`${ADDR.slice(0, 8)}...${ADDR.slice(-6)}`);
  });

  it('returns the empty string for empty input (never a bare ellipsis)', () => {
    expect(truncateMiddle('', 8, 6)).toBe('');
  });

  it('returns short input unchanged — an ellipsis must shorten, not pad', () => {
    // Shorter than lead+tail: slicing would duplicate characters.
    expect(truncateMiddle('0x1234', 8, 6)).toBe('0x1234');
    // Exactly lead+tail: truncation would keep every character.
    expect(truncateMiddle('0x12345678', 8, 6)).toBe('0x12345678');
  });

  it('pins the exact boundary: unchanged at lead+tail+3, cut at +4', () => {
    const at = 'a'.repeat(8 + 6 + 3);
    const past = 'a'.repeat(8 + 6 + 4);
    expect(truncateMiddle(at, 8, 6)).toBe(at);
    expect(truncateMiddle(past, 8, 6)).toBe('aaaaaaaa...aaaaaa');
  });

  it('backs formatAddress/formatHash with their own stronger guards', () => {
    // formatAddress's head includes 0x (length counts body hex chars).
    expect(formatAddress(ADDR)).toBe(truncateMiddle(ADDR, 8, 6));
    expect(formatHash(`0x${'ab'.repeat(32)}`)).toBe('0xabababab...abababab');
  });
});

describe('formatBigInt — exact grouping without Number coercion', () => {
  it('groups realistic gas magnitudes like the old en-US toLocaleString', () => {
    expect(formatBigInt(0n)).toBe('0');
    expect(formatBigInt(30_000_000n)).toBe('30,000,000');
    expect(formatBigInt(1_234_567n)).toBe('1,234,567');
  });

  it('stays exact past 2^53, where Number(x) rounds', () => {
    const n = 2n ** 60n + 1n; // Number() of this renders ...976, not ...977
    expect(String(Number(n))).toBe(String(Number(2n ** 60n))); // the coercion really is lossy
    expect(formatBigInt(n)).toBe('1,152,921,504,606,846,977');
    expect(formatBigInt(10n ** 21n + 1n)).toBe('1,000,000,000,000,000,000,001');
  });

  it('groups negatives without a comma after the sign', () => {
    expect(formatBigInt(-1234567n)).toBe('-1,234,567');
  });
});

describe('formatNativeDisplay — decimals-generic native amounts', () => {
  it('trims the exact fraction (\'trim\', no symbol)', () => {
    expect(formatNativeDisplay(15n * 10n ** 17n, 18)).toBe('1.5');
    expect(formatNativeDisplay(1n, 18, { floor: false })).toBe('0.000000000000000001');
    expect(formatNativeDisplay(1_234_567n, 6, { floor: false })).toBe('1.234567');
    expect(formatNativeDisplay(5_000_000n, 6)).toBe('5');
  });

  it('renders the sub-floor cutoff only below 10^(decimals-4)', () => {
    expect(formatNativeDisplay(10n ** 14n, 18, { symbol: 'ETH' })).toBe('0.0001 ETH');
    expect(formatNativeDisplay(10n ** 14n - 1n, 18, { symbol: 'ETH' })).toBe('<0.0001 ETH');
    expect(formatNativeDisplay(1n, 6, { symbol: 'XTC' })).toBe('<0.0001 XTC');
    // floor: false keeps the exact chart-label value.
    expect(formatNativeDisplay(1n, 18, { floor: false })).toBe('0.000000000000000001');
  });

  it('renders zero exactly and appends the optional symbol', () => {
    expect(formatNativeDisplay(0n, 18)).toBe('0');
    expect(formatNativeDisplay(0n, 18, { symbol: 'ETH' })).toBe('0 ETH');
  });

  it('keeps the summary-total contract (\'fixed4\' + grouped, truncating)', () => {
    expect(formatNativeDisplay(15n * 10n ** 17n, 18, { symbol: 'ETH', fraction: 'fixed4', grouped: true })).toBe('1.5000 ETH');
    // 1234.56789012… truncated (not rounded) at the 4th digit.
    expect(
      formatNativeDisplay(1_234_567_890_123_456_789_000n, 18, {
        symbol: 'ETH',
        fraction: 'fixed4',
        grouped: true,
      }),
    ).toBe('1,234.5678 ETH');
    expect(
      formatNativeDisplay(12_500_000n, 6, { symbol: 'POL', fraction: 'fixed4', grouped: true }),
    ).toBe('12.5000 POL');
  });

  it('keeps the tx-surface contract (\'round4\', half-up like formatValue)', () => {
    // 0.00015 ETH half-up at 4 digits is 0.0002; truncation would say 0.0001.
    expect(formatNativeDisplay(15n * 10n ** 13n, 18, { symbol: 'ETH', fraction: 'round4' })).toBe(
      '0.0002 ETH',
    );
    expect(formatNativeDisplay(15n * 10n ** 17n, 18, { symbol: 'ETH', fraction: 'round4' })).toBe(
      '1.5000 ETH',
    );
  });
});

describe('cellText — the shared 8/6 cell truncation with fallback', () => {
  it('truncates like the old per-view addressCell one-liners', () => {
    // head 8 (incl. 0x), tail 6 — the shape every list view used to hand-roll
    expect(cellText('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x123456...345678');
  });

  it('blank cells render the fallback (default N/A)', () => {
    expect(cellText('')).toBe('N/A');
    expect(cellText(null)).toBe('N/A');
    expect(cellText(undefined, '—')).toBe('—');
    expect(cellText('short', '—')).toBe('short');
  });
});
