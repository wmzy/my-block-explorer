// Unit tests for the pure Balance-over-time chart logic: the
// live-balance anchoring of discovered deltas, the unknown-history gap
// step, BigInt exactness at ≥2^64 magnitudes, ordering normalization,
// pixel geometry, and amount formatting. No network, no React.
import { describe, it, expect } from 'vitest';
import {
  buildBalanceChartGeometry,
  computeBalancePoints,
  formatNativeAmount,
  type BalanceTxInput,
} from '@/views/Address/balanceHistory';

const ADDR = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

const WEI = 1_000_000_000_000_000_000n;

const tx = (fields: Partial<BalanceTxInput>): BalanceTxInput => ({
  blockNumber: '100',
  fromAddress: OTHER,
  toAddress: ADDR,
  value: WEI.toString(),
  timestamp: '2026-01-01T00:00:00Z',
  ...fields,
});

describe('computeBalancePoints — empty set', () => {
  it('anchors a single point at the live balance', () => {
    const series = computeBalancePoints([], 5n * WEI, ADDR);

    expect(series.points).toHaveLength(1);
    expect(series.points[0]).toEqual({
      blockNumber: '',
      timestamp: undefined,
      value: 5n * WEI,
      kind: 'live',
    });
    expect(series.anchored).toBe(true);
    expect(series.txCount).toBe(0);
    expect(series.totalDelta).toBe(0n);
  });

  it('has nothing to show without a live balance', () => {
    const series = computeBalancePoints([], null, ADDR);

    expect(series.points).toEqual([]);
    expect(series.anchored).toBe(false);
    expect(series.hasResidualGap).toBe(false);
  });
});

describe('computeBalancePoints — anchoring and reconciliation', () => {
  it('walks a single reconciling tx: anchor 0 then the live balance', () => {
    const series = computeBalancePoints([tx({ blockNumber: '10' })], WEI, ADDR);

    expect(series.anchored).toBe(true);
    expect(series.hasResidualGap).toBe(false);
    expect(series.points.map(p => [p.kind, p.value])).toEqual([
      ['pre-history', 0n],
      ['tx', WEI],
    ]);
    // The chart's last point IS the on-screen live balance.
    expect(series.points[series.points.length - 1].value).toBe(WEI);
  });

  it('applies deltas oldest→newest regardless of input order', () => {
    const series = computeBalancePoints(
      [
        tx({ blockNumber: '300', value: (3n * WEI).toString(), toAddress: ADDR }),
        tx({ blockNumber: '100', value: WEI.toString(), toAddress: ADDR }),
        tx({ blockNumber: '200', value: (2n * WEI).toString(), fromAddress: ADDR, toAddress: OTHER }),
      ],
      2n * WEI,
      ADDR,
    );

    expect(series.points.map(p => p.blockNumber)).toEqual(['100', '100', '200', '300']);
    // residual = 2 − (1 − 2 + 3) = 0 → no gap step; cumulative balances:
    // 0, 1, −1, 2 (the address dipped below its final balance mid-window).
    expect(series.points.map(p => p.value)).toEqual([0n, WEI, -WEI, 2n * WEI]);
    expect(series.hasResidualGap).toBe(false);
  });

  it('renders the reconciliation gap as an explicit first step', () => {
    const series = computeBalancePoints(
      [
        tx({ blockNumber: '100', value: (2n * WEI).toString() }),
        tx({ blockNumber: '200', value: WEI.toString(), fromAddress: ADDR, toAddress: OTHER }),
      ],
      5n * WEI,
      ADDR,
    );

    expect(series.hasResidualGap).toBe(true);
    expect(series.preHistoryBalance).toBe(4n * WEI);
    // First step: 0 → estimated pre-history balance, both at the oldest
    // discovered block — the unknown history is visible, never folded in.
    expect(series.points.slice(0, 2).map(p => [p.kind, p.value])).toEqual([
      ['gap-origin', 0n],
      ['pre-history', 4n * WEI],
    ]);
    // Then the discovered steps, ending exactly at the live balance.
    expect(series.points.slice(2).map(p => p.value)).toEqual([6n * WEI, 5n * WEI]);
  });

  it('keeps a negative residual (gas-dominated history) exact, never clamped', () => {
    const series = computeBalancePoints([tx({ blockNumber: '10' })], 9n * WEI / 10n, ADDR);

    expect(series.hasResidualGap).toBe(true);
    expect(series.preHistoryBalance).toBe(-WEI / 10n);
    expect(series.points.map(p => p.value)).toEqual([0n, -WEI / 10n, 9n * WEI / 10n]);
  });

  it('nets self-transfers to zero delta', () => {
    const series = computeBalancePoints(
      [tx({ blockNumber: '10', fromAddress: ADDR, toAddress: ADDR, value: (7n * WEI).toString() })],
      0n,
      ADDR,
    );

    expect(series.totalDelta).toBe(0n);
    expect(series.hasResidualGap).toBe(false);
    expect(series.points.map(p => p.value)).toEqual([0n, 0n]);
  });
});

describe('computeBalancePoints — exactness and robustness', () => {
  it('stays BigInt-exact for sums beyond 2^64 wei', () => {
    // 2^70 wei in and out — far past Number.MAX_SAFE_INTEGER.
    const huge = 2n ** 70n;
    const series = computeBalancePoints(
      [
        tx({ blockNumber: '10', value: huge.toString() }),
        tx({ blockNumber: '20', value: (huge + 12_345n).toString() }),
      ],
      2n * huge + 12_345n + 7n,
      ADDR,
    );

    expect(series.totalDelta).toBe(2n * huge + 12_345n);
    // residual 7n ≠ 0 → the unknown-history step is present.
    expect(series.points.map(p => p.value)).toEqual([
      0n,
      7n,
      huge + 7n,
      2n * huge + 12_345n + 7n,
    ]);
    // Exactness is claimed down to the wei digit.
    expect(series.points[1].value.toString()).toBe('7');
    expect(series.points[3].value.toString()).toBe(
      (2n * huge + 12_345n + 7n).toString(),
    );
  });

  it('keeps same-block txs in their given (response) order, reversed for the walk', () => {
    // The API returns newest-first; two same-block txs arrive as [A, B].
    // The chronological walk sees [B, A] — stable, deterministic.
    const series = computeBalancePoints(
      [
        tx({ blockNumber: '50', value: (10n * WEI).toString() }),
        tx({ blockNumber: '50', value: (5n * WEI).toString() }),
      ],
      15n * WEI,
      ADDR,
    );

    expect(series.points.map(p => p.blockNumber)).toEqual(['50', '50', '50']);
    expect(series.points.map(p => p.value)).toEqual([0n, 5n * WEI, 15n * WEI]);
  });

  it('skips rows with malformed numerics instead of guessing', () => {
    const series = computeBalancePoints(
      [
        tx({ blockNumber: '0x64', value: WEI.toString() }),
        tx({ blockNumber: '20', value: '-1' }),
        tx({ blockNumber: '30', value: WEI.toString() }),
      ],
      WEI,
      ADDR,
    );

    expect(series.txCount).toBe(1);
    expect(series.points.map(p => p.blockNumber)).toEqual(['30', '30']);
  });

  it('degrades to a discovered-change series without a live balance', () => {
    const series = computeBalancePoints(
      [tx({ blockNumber: '10' }), tx({ blockNumber: '20', value: (2n * WEI).toString() })],
      null,
      ADDR,
    );

    expect(series.anchored).toBe(false);
    expect(series.points.map(p => [p.kind, p.value])).toEqual([
      ['pre-history', 0n],
      ['tx', WEI],
      ['tx', 3n * WEI],
    ]);
  });
});

describe('formatNativeAmount', () => {
  it('trims trailing fractional zeros and keeps small values exact', () => {
    expect(formatNativeAmount(15n * WEI / 10n, 18)).toBe('1.5');
    expect(formatNativeAmount(1n, 18)).toBe('0.000000000000000001');
    expect(formatNativeAmount(-15n * WEI / 10n, 18)).toBe('-1.5');
    expect(formatNativeAmount(0n, 18)).toBe('0');
    // A 6-decimal chain currency formats with its own decimals.
    expect(formatNativeAmount(1_234_567n, 6)).toBe('1.234567');
  });
});

describe('buildBalanceChartGeometry', () => {
  const T0 = Date.parse('2026-01-01T00:00:00Z');
  const HOUR = 3_600_000;

  it('returns empty geometry for an empty series', () => {
    const geo = buildBalanceChartGeometry([]);

    expect(geo.xs).toEqual([]);
    expect(geo.line).toBe('');
    expect(geo.area).toBe('');
    expect(geo.min).toBeNull();
    expect(geo.max).toBeNull();
  });

  it('centers a single point and draws no line', () => {
    const geo = buildBalanceChartGeometry([
      { blockNumber: '', timestamp: undefined, value: 5n, kind: 'live' },
    ]);

    expect(geo.xs).toEqual([120]);
    expect(geo.line).toBe('');
    expect(geo.area).toBe('');
    expect(geo.min).toBe(5n);
    expect(geo.max).toBe(5n);
  });

  it('spaces x by block time and inverts y (higher balance higher on screen)', () => {
    const geo = buildBalanceChartGeometry([
      { blockNumber: '1', timestamp: new Date(T0).toISOString(), value: 1n, kind: 'tx' },
      { blockNumber: '2', timestamp: new Date(T0 + HOUR).toISOString(), value: 3n, kind: 'tx' },
      { blockNumber: '3', timestamp: new Date(T0 + 2 * HOUR).toISOString(), value: 2n, kind: 'tx' },
    ]);

    // Strictly increasing, spanning the padded width.
    expect(geo.xs[0] < geo.xs[1]).toBe(true);
    expect(geo.xs[1] < geo.xs[2]).toBe(true);
    expect(geo.xs[0]).toBeGreaterThanOrEqual(6);
    expect(geo.xs[2]).toBeLessThanOrEqual(234);
    // value 3 is the max → smallest y; value 1 the min → largest y.
    expect(geo.ys[1] < geo.ys[2]).toBe(true);
    expect(geo.ys[2] < geo.ys[0]).toBe(true);
    expect(geo.min).toBe(1n);
    expect(geo.max).toBe(3n);
    // Line path visits all three points in order.
    expect(geo.line.startsWith('M')).toBe(true);
    expect(geo.line).toContain('L');
    expect(geo.area.endsWith('Z')).toBe(true);
  });

  it('falls back to index spacing when timestamps are missing or degenerate', () => {
    const noTime = buildBalanceChartGeometry([
      { blockNumber: '1', timestamp: undefined, value: 1n, kind: 'tx' },
      { blockNumber: '2', timestamp: undefined, value: 2n, kind: 'tx' },
    ]);
    expect(noTime.xs).toEqual([0, 240]);

    // All points in one block: time span degenerates → index spacing.
    const sameTime = buildBalanceChartGeometry([
      { blockNumber: '1', timestamp: new Date(T0).toISOString(), value: 1n, kind: 'tx' },
      { blockNumber: '1', timestamp: new Date(T0).toISOString(), value: 2n, kind: 'tx' },
    ]);
    expect(sameTime.xs).toEqual([0, 240]);
  });

  it('draws a flat series on the mid-line', () => {
    const geo = buildBalanceChartGeometry([
      { blockNumber: '1', timestamp: new Date(T0).toISOString(), value: 7n, kind: 'tx' },
      { blockNumber: '2', timestamp: new Date(T0 + HOUR).toISOString(), value: 7n, kind: 'tx' },
    ]);

    // pad + half the usable height = 6 + (96 − 12)/2 = 48.
    expect(geo.ys.every(y => y === 48)).toBe(true);
  });
});
