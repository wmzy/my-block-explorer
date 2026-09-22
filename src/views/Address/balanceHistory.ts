// Pure logic for the Address page's "Balance over time (discovered)" card.
//
// The chart is built from the SAME discovered-transaction set the tx list
// paginates through (the component's own fetch of the extended
// /transactions?balanceHistory=1 endpoint rides the backend's canonical
// ~60s search cache), anchored to the LIVE RPC balance: discovered deltas
// are applied backwards from the current balance, so the chart's newest
// point always equals the balance shown elsewhere on the page.
//
// Honest by construction:
// - Discovery is a heuristic (see services/AddressService.ts coverage
//   semantics) — the card must always render the incompleteness caveat.
// - When the discovered deltas do not reconcile with the live balance
//   (older txs the heuristic missed, gas spend the block scan cannot
//   see), the gap renders as an explicit FIRST step from a 0 origin to
//   the estimated pre-history balance — never folded silently into the
//   curve. The card must then say the balance before the oldest
//   discovered transaction is unknown.
// - Every sum is BigInt-exact wei; floats only ever touch pixel mapping.
import { formatUnits } from 'viem';
import { parseDecimalInteger } from '@/views/Address/holdings';

/** Serialized discovered-tx row as the API returns it (numerics as strings). */
export type BalanceTxInput = {
  hash?: string;
  blockNumber: string;
  fromAddress: string;
  toAddress: string;
  value: string;
  timestamp?: string;
};

/**
 * How a chart point was derived — drives the card's tooltips and the
 * unknown-history markers:
 * - 'gap-origin': the 0 floor before all discovered history (only when
 *   the discovered deltas do NOT reconcile with the live balance)
 * - 'pre-history': estimated balance right before the oldest discovered tx
 * - 'tx': balance immediately after that discovered tx
 * - 'live': single-point series — nothing was discovered, only the
 *   current balance is known
 */
export type BalancePointKind = 'gap-origin' | 'pre-history' | 'tx' | 'live';

export type BalanceChartPoint = {
  /** Decimal-string block number (empty for the no-history 'live' anchor). */
  blockNumber: string;
  /** ISO-8601 UTC block timestamp when known. */
  timestamp: string | undefined;
  /** Absolute balance (anchored series) or cumulative discovered delta (unanchored). */
  value: bigint;
  kind: BalancePointKind;
};

export type BalanceSeries = {
  /** Chronological (oldest first); first point is always an anchor. */
  points: BalanceChartPoint[];
  /** True when the newest point equals currentBalance (live anchor available). */
  anchored: boolean;
  /** True when discovered deltas do not sum to the live balance. */
  hasResidualGap: boolean;
  /** Estimated balance before the oldest discovered tx — null when unanchored or perfectly reconciled. */
  preHistoryBalance: bigint | null;
  /** Sum of discovered deltas (BigInt-exact wei). */
  totalDelta: bigint;
  /** Discovered tx count that contributed points. */
  txCount: number;
};

/** Strictly-parsed tx row (malformed numerics are skipped defensively). */
type ParsedTx = {
  blockNumber: bigint;
  timestamp: string | undefined;
  delta: bigint;
};

/**
 * Signed native-value delta of one tx for `address` (case-insensitive):
 * +value incoming, −value outgoing, self-transfers net to zero. Token
 * transfers never appear in this set — discovery scans native-value
 * transactions only.
 */
function parseTx(tx: BalanceTxInput, lowerAddr: string): ParsedTx | null {
  const blockNumber = parseDecimalInteger(tx.blockNumber);
  const value = parseDecimalInteger(tx.value);
  if (blockNumber === null || value === null) return null;
  let delta = 0n;
  if (tx.fromAddress.toLowerCase() === lowerAddr) delta -= value;
  if (tx.toAddress.toLowerCase() === lowerAddr) delta += value;
  return { blockNumber, timestamp: tx.timestamp, delta };
}

/**
 * Build the balance-over-time chart series from a discovered tx list and
 * the live RPC balance.
 *
 * Anchored (currentBalance ≠ null): discovered deltas are applied
 * backwards from the live balance, so the last point IS the on-screen
 * balance. The first point anchors at the estimated pre-history balance
 * (live − totalDelta); when that residual is non-zero an explicit
 * gap-origin point at 0 precedes it, making the unknown history the
 * first visible step instead of a silent offset.
 *
 * Unanchored (currentBalance = null): the pure cumulative-delta series
 * from a 0 origin — the card must label it as discovered change only.
 * Empty set: a single anchor (the live balance, or nothing without one).
 */
export function computeBalancePoints(
  txs: readonly BalanceTxInput[],
  currentBalance: bigint | null,
  address: string,
): BalanceSeries {
  const lowerAddr = address.toLowerCase();
  // Normalize to newest→oldest (stable — same-block txs keep their
  // discovery order), then walk chronologically.
  const sorted = txs
    .map(tx => parseTx(tx, lowerAddr))
    .filter((tx): tx is ParsedTx => tx !== null)
    .sort((a, b) =>
      a.blockNumber > b.blockNumber ? -1 : a.blockNumber < b.blockNumber ? 1 : 0,
    );

  const totalDelta = sorted.reduce((sum, tx) => sum + tx.delta, 0n);

  if (sorted.length === 0) {
    if (currentBalance === null) {
      return {
        points: [],
        anchored: false,
        hasResidualGap: false,
        preHistoryBalance: null,
        totalDelta: 0n,
        txCount: 0,
      };
    }
    return {
      points: [
        { blockNumber: '', timestamp: undefined, value: currentBalance, kind: 'live' },
      ],
      anchored: true,
      hasResidualGap: false,
      preHistoryBalance: null,
      totalDelta: 0n,
      txCount: 0,
    };
  }

  const oldest = sorted[sorted.length - 1];
  // Cumulative deltas oldest→newest (sorted is newest-first → walk backwards).
  const txPoints: BalanceChartPoint[] = [];
  let cumulative = 0n;
  for (let i = sorted.length - 1; i >= 0; i--) {
    cumulative += sorted[i].delta;
    txPoints.push({
      blockNumber: sorted[i].blockNumber.toString(),
      timestamp: sorted[i].timestamp,
      value: cumulative,
      kind: 'tx',
    });
  }

  if (currentBalance === null) {
    return {
      points: [
        {
          blockNumber: oldest.blockNumber.toString(),
          timestamp: oldest.timestamp,
          value: 0n,
          kind: 'pre-history',
        },
        ...txPoints,
      ],
      anchored: false,
      hasResidualGap: false,
      preHistoryBalance: null,
      totalDelta,
      txCount: sorted.length,
    };
  }

  const residual = currentBalance - totalDelta;
  const anchoredTxPoints = txPoints.map(point => ({ ...point, value: point.value + residual }));

  if (residual === 0n) {
    // Perfect reconciliation: the 0 anchor IS the pre-history balance —
    // one anchor point, no fabricated gap step.
    return {
      points: [
        {
          blockNumber: oldest.blockNumber.toString(),
          timestamp: oldest.timestamp,
          value: 0n,
          kind: 'pre-history',
        },
        ...anchoredTxPoints,
      ],
      anchored: true,
      hasResidualGap: false,
      preHistoryBalance: null,
      totalDelta,
      txCount: sorted.length,
    };
  }

  // Residual gap: the first step (0 → residual) is the unknown history
  // itself — gas spend and older txs the heuristic cannot see.
  return {
    points: [
      {
        blockNumber: oldest.blockNumber.toString(),
        timestamp: oldest.timestamp,
        value: 0n,
        kind: 'gap-origin',
      },
      {
        blockNumber: oldest.blockNumber.toString(),
        timestamp: oldest.timestamp,
        value: residual,
        kind: 'pre-history',
      },
      ...anchoredTxPoints,
    ],
    anchored: true,
    hasResidualGap: true,
    preHistoryBalance: residual,
    totalDelta,
    txCount: sorted.length,
  };
}

/** Chart pixel geometry for a settled series (hand-rolled SVG, gas-panel pattern). */
export type BalanceChartGeometry = {
  /** Per-point pixel x (time-proportional; index-proportional fallback). */
  xs: number[];
  /** Per-point pixel y (value min-max normalized, inverted: higher = up). */
  ys: number[];
  /** Polyline path covering every point ('' when fewer than one point). */
  line: string;
  /** Area fill path under the line ('' when it cannot close). */
  area: string;
  /** Series extremes in wei (null when no points). */
  min: bigint | null;
  max: bigint | null;
};

/**
 * Map a chart series into a fixed viewBox. x spans the width
 * proportionally to block TIME (ms since epoch from ISO timestamps);
 * timestamps missing or degenerate (everything in one block) fall back to
 * even index spacing so a chart always renders. y min-max normalizes into
 * [pad, height − pad]; a flat series draws the mid-line. BigInt values
 * only ever enter the normalization RATIO (Number(v−min)/Number(span)) —
 * pixel-relevant precision, never a value computation.
 */
export function buildBalanceChartGeometry(
  points: readonly BalanceChartPoint[],
  width = 240,
  height = 96,
  pad = 6,
): BalanceChartGeometry {
  if (points.length === 0) {
    return { xs: [], ys: [], line: '', area: '', min: null, max: null };
  }

  const times = points.map(p => (p.timestamp !== undefined ? Date.parse(p.timestamp) : NaN));
  const finiteTimes = times.filter(t => Number.isFinite(t));
  const useTime =
    finiteTimes.length === points.length &&
    Math.min(...finiteTimes) < Math.max(...finiteTimes);
  const tMin = useTime ? Math.min(...finiteTimes) : 0;
  const tSpan = useTime ? Math.max(...finiteTimes) - tMin : 1;

  let min = points[0].value;
  let max = points[0].value;
  for (const p of points) {
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  const span = max - min;
  const usable = height - 2 * pad;
  const yFor = (value: bigint): number => {
    const normalized = span > 0n ? Number(value - min) / Number(span) : 0.5;
    const y = pad + (1 - normalized) * usable;
    return Math.min(height, Math.max(0, y));
  };

  const indexDenominator = Math.max(1, points.length - 1);
  const xs = points.map((_, i) => {
    // A one-point series centers (a left-edge tick would clip half its
    // width); longer series span the full width.
    const x =
      points.length === 1
        ? width / 2
        : useTime
          ? pad + ((times[i] - tMin) / tSpan) * (width - 2 * pad)
          : (i / indexDenominator) * width;
    return Math.min(width, Math.max(0, x));
  });
  const ys = points.map(p => yFor(p.value));

  const line =
    xs.length > 1
      ? xs
          .map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${ys[i].toFixed(2)}`)
          .join(' ')
      : '';
  const area =
    xs.length > 1
      ? `${line} L${xs[xs.length - 1].toFixed(2)},${height} L${xs[0].toFixed(2)},${height} Z`
      : '';

  return { xs, ys, line, area, min, max };
}

/**
 * formatUnits output trimmed for display: full integer precision kept,
 * trailing fractional zeros cut, a bare sign dropped. BigInt-exact —
 * formatUnits itself never rounds.
 */
export function formatNativeAmount(value: bigint, decimals: number): string {
  const raw = formatUnits(value, decimals);
  if (!raw.includes('.')) return raw;
  const trimmed = raw.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}
