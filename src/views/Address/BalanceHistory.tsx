// Balance over time (discovered) — collapsible Address-page card.
//
// Self-contained: fetches its own page of the SAME discovered-tx
// endpoint the tx list uses, extended with ?balanceHistory=1 (the
// backend serves both from one canonical ~60s search cache, so the chart
// and the on-screen list can never disagree). The chart itself is
// computed client-side (./balanceHistory) and anchored to the LIVE RPC
// balance passed in as a prop — the newest point is always the balance
// shown elsewhere on the page.
//
// Honesty contract (project-wide): the underlying discovery is a
// heuristic, so the chart always carries the incompleteness caveat, and
// a live-balance/deltas mismatch renders as an explicit unknown-history
// step rather than a silently offset curve.
import { css } from '@linaria/core';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Collapsible } from '@/components/ui/Collapsible';
import { getChainInfo } from '@/config/chains';
import { ApiError } from '@/util/apiError';
import { get, longRunningApi, withSignal } from '@/util/http';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';
import { formatNumber } from '@/utils/format';
import {
  buildBalanceChartGeometry,
  computeBalancePoints,
  formatNativeAmount,
  type BalanceChartPoint,
  type BalanceSeries,
  type BalanceTxInput,
} from '@/views/Address/balanceHistory';

// The route clamps limit to 50 — the widest page there is. The chart
// wants as many of the discovered points as one response can carry;
// when discovery found more, the caveat says so instead of truncating
// silently.
const CHART_TX_LIMIT = 50;

/** Response envelope of the extended transactions endpoint (fields the card consumes). */
export type BalanceHistoryPage = {
  chainId: number;
  address: string;
  transactions: BalanceTxInput[];
  /** Discovered (deduped) count — may exceed transactions.length (page cap). */
  total: number;
  coverage?: 'complete' | 'partial' | 'none';
  reason?: 'no-transactions' | 'no-outgoing-transactions' | 'zero-balance' | 'search-failed';
  searchWindowBlocks?: number;
  /** Backend-computed cumulative series (anchor + one point per discovered tx). */
  balancePoints?: { blockNumber: string; timestamp: string; cumulativeValue: string }[];
  balancePointsCount?: number;
};

/**
 * Fetch the chart's own page from the extended endpoint. Like the tx
 * list, this rides `longRunningApi` (the server scans under its own 30s
 * budget) and resolves undefined without a request for gated keys
 * (chainId <= 0 / empty address).
 */
export function fetchAddressBalanceHistory(
  chainId: number,
  address: string,
  searchWindow?: number,
  signal?: AbortSignal,
): Promise<BalanceHistoryPage | undefined> {
  if (!(chainId > 0) || address.length === 0) return Promise.resolve(undefined);
  return get<BalanceHistoryPage>(
    `/api/chains/${chainId}/addresses/${address}/transactions`,
    { limit: CHART_TX_LIMIT, page: 1, balanceHistory: 1, window: searchWindow },
    withSignal(longRunningApi, signal),
  );
}

// The window rides in the cache key: a widened ?window= must resolve to
// a fresh entry, never a stale narrow-window chart.
export const balanceHistoryCache = createQueryCache<
  BalanceHistoryPage | undefined,
  [number, string, number | undefined]
>('address-balance-history');

const queryBalanceHistory = bindQueryFn(fetchAddressBalanceHistory, balanceHistoryCache);

// Exported for the Overview card's SummaryStatsRow: same args → same
// cache entry the BalanceHistory chart consumes, so the stats strip and
// the chart can never disagree AND cost zero extra requests.
export const useBalanceHistoryQuery = createQueryHook({ queryFn: queryBalanceHistory });

export type BalanceHistoryProps = {
  /**
   * Live native balance in wei (BigInt of addressRealTime's balanceWei).
   * null = live balance unavailable; the card degrades to a
   * discovered-change-only chart labeled as such.
   */
  currentBalance: bigint | null;
  /** Chain of the address — scopes the fetch and picks native-currency decimals/symbol. */
  chainId: number;
  /** The viewed address; credit/debit direction compares case-insensitively. */
  address: string;
  /**
   * Optional search window (blocks). Pass the Address page's ?window= so
   * the chart rides the SAME cached scan as the tx list; omit for the
   * backend's default window.
   */
  searchWindow?: number;
  /** Collapsed by default; pass true to mount expanded. */
  defaultExpanded?: boolean;
  /** Extra class for the card container (e.g. page-level spacing). */
  className?: string;
};

// --- styles ---

// Fixed 240x96 viewBox stretched horizontally (preserveAspectRatio="none"),
// gas-panel pattern; non-scaling strokes keep the line weight uniform at
// any width. 96 (vs the gas sparkline's 48) leaves headroom for the
// unknown-history step without flattening the curve.
const balanceChartSvg = css`
  display: block;
  width: 100%;
  height: 96px;
`;

const balanceChartLine = css`
  stroke: var(--haze-color-primary);
  stroke-width: 1.5;
  fill: none;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
`;

// The unknown-history step is not data — dashed so it never reads as a
// mined balance change.
const balanceChartGapLine = css`
  stroke: var(--haze-color-text-muted);
  stroke-width: 1.5;
  fill: none;
  stroke-dasharray: 4 3;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
`;

const balanceChartArea = css`
  fill: var(--haze-color-primary-subtle);
`;

// Event markers: vertical ticks instead of circles — a circle would
// stretch into an ellipse under preserveAspectRatio="none", while a
// non-scaling-stroke tick stays uniform at any card width.
const balanceChartTick = css`
  stroke: var(--haze-color-primary);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
`;

const balanceChartTickMuted = css`
  stroke: var(--haze-color-text-muted);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
`;

const balanceFacts = css`
  display: grid;
  grid-template-columns: repeat(3, auto);
  justify-content: start;
  column-gap: var(--haze-space-6);
  row-gap: var(--haze-space-1);
  margin-top: var(--haze-space-3);

  /* Narrow screens: the Now/Low/High trio never fits one ~340px row with
     the window label — stack into label/value pairs (same breakpoint as
     the app-wide stacking convention). */
  @media (max-width: 768px) {
    grid-template-columns: auto auto;
    column-gap: var(--haze-space-4);
  }
`;

const balanceFactLabel = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const balanceFactValue = css`
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-bold);
  color: var(--haze-color-text);
  font-family: var(--haze-font-mono, monospace);
`;

const balanceWindowLabel = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  margin-top: var(--haze-space-2);
`;

const balanceCaveats = css`
  margin: var(--haze-space-3) 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const balanceCaveat = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

const balanceUnavailable = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-muted);
  padding: var(--haze-space-2) 0;
`;

const balanceChartSkeleton = css`
  display: block;
  width: 100%;
  height: 96px;
  border-radius: var(--haze-radius-sm);
  background: var(--haze-color-bg-muted);
  animation: balance-pulse 1.6s ease-in-out infinite;

  @keyframes balance-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.55;
    }
  }
`;

// --- helpers ---

/** Tooltip text for one chart point — block number plus a formatted, kind-honest value. */
function tickTitle(
  point: BalanceChartPoint,
  series: BalanceSeries,
  decimals: number,
  symbol: string,
): string {
  const amount = `${formatNativeAmount(point.value, decimals)} ${symbol}`;
  switch (point.kind) {
    case 'gap-origin':
      return `Unknown history — balance before the oldest discovered transaction (block #${formatNumber(point.blockNumber)}) is unknown`;
    case 'pre-history':
      return series.preHistoryBalance !== null
        ? `Estimated balance before the oldest discovered transaction (block #${formatNumber(point.blockNumber)}) — unknown`
        : series.anchored
          ? `Derived balance before the oldest discovered transaction (block #${formatNumber(point.blockNumber)})`
          : `Discovered change before the oldest discovered transaction (block #${formatNumber(point.blockNumber)}) — not an absolute balance`;
    case 'live':
      return `Current balance — ${amount}`;
    default:
      return `Block #${formatNumber(point.blockNumber)} — ${amount}`;
  }
}

// Copy for a settled-but-empty discovery, mirroring the endpoint's
// honesty semantics (coverage/reason) instead of a bare "no data".
const EMPTY_DISCOVERY_COPY: Record<string, string> = {
  'zero-balance': 'Balance is zero — nothing to chart.',
  'no-outgoing-transactions':
    'No outgoing transactions; incoming activity cannot be scanned.',
  'search-failed': 'History scan failed — nothing discovered.',
  'default': 'No discovered transactions to chart.',
};

/**
 * Attach block times to the tx rows for the time-proportional x axis.
 * Exported: the Overview card's SummaryStatsRow applies the same
 * alignment so both surfaces show the same dates from one response.
 * The wire's tx rows carry NO timestamp (formatTransactionForApi only
 * converts Date instances while the discovered set stores ISO strings —
 * pre-existing behavior), but the backend balancePoints serialize theirs
 * as-is: anchor + one point per discovered tx, oldest first. When that
 * series covers the full set (length === total + 1), tx[i] (newest
 * first) aligns with the LAST entries of the points array. Any mismatch
 * leaves the rows untouched — the chart then falls back to even index
 * spacing, never to a fabricated time.
 */
export function withBlockTimes(page: BalanceHistoryPage): BalanceTxInput[] {
  const points = page.balancePoints;
  if (
    points === undefined ||
    page.total <= 0 ||
    points.length !== page.total + 1 ||
    page.transactions.length === 0
  ) {
    return page.transactions;
  }
  return page.transactions.map((tx, i) => {
    const point = points[points.length - 1 - i];
    return point !== undefined && tx.timestamp === undefined
      ? { ...tx, timestamp: point.timestamp }
      : tx;
  });
}

/**
 * Collapsible "Balance over time (discovered)" card for the Address
 * page. Hand-rolled SVG chart (gas-panel sparkline pattern): area +
 * polyline over block TIME, one tick per discovered transaction with a
 * block-number/balance tooltip, and a dashed leading step when the
 * discovered deltas do not reconcile with the live balance. See props
 * (JSDoc'd) for wiring; Main mounts this below the Overview card.
 */
export function BalanceHistory({
  currentBalance,
  chainId,
  address,
  searchWindow,
  defaultExpanded = false,
  className,
}: BalanceHistoryProps) {
  const query = useBalanceHistoryQuery([chainId, address, searchWindow]);

  // Cross-chain guard (gas-panel pattern): the query layer's store keeps
  // the last settle across an args switch, so another chain's payload is
  // treated as absent.
  const data = query.data?.chainId === chainId ? query.data : undefined;

  const chainInfo = getChainInfo(chainId);
  const decimals = chainInfo?.nativeCurrency.decimals ?? 18;
  const symbol = chainInfo?.nativeCurrency.symbol ?? 'ETH';

  const series = useMemo(
    () => computeBalancePoints(data !== undefined ? withBlockTimes(data) : [], currentBalance, address),
    [data, currentBalance, address],
  );
  const geometry = useMemo(() => buildBalanceChartGeometry(series.points), [series.points]);

  // Dashed unknown-history step (gap-origin → pre-history) drawn apart
  // from the solid discovered-balance line.
  const gapFrom = series.hasResidualGap ? 1 : 0;
  const pathFrom = (from: number, to: number): string =>
    geometry.xs
      .slice(from, to + 1)
      .map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${geometry.ys[from + i].toFixed(2)}`)
      .join(' ');
  const mainLine = geometry.xs.length > 1 ? pathFrom(gapFrom, geometry.xs.length - 1) : '';
  const gapLine = series.hasResidualGap ? pathFrom(0, 1) : '';
  const areaPath =
    geometry.xs.length > 1
      ? `${mainLine} L${geometry.xs[geometry.xs.length - 1].toFixed(2)},96 L${geometry.xs[gapFrom].toFixed(2)},96 Z`
      : '';

  const truncated =
    data !== undefined && data.transactions.length < data.total ? data : undefined;

  let body: ReactNode;
  if (data !== undefined) {
    if (series.points.length === 0) {
      // Nothing discovered AND no live balance — say why, per the
      // endpoint's own coverage semantics.
      body = (
        <div className={balanceUnavailable} data-testid="balance-history-empty">
          {EMPTY_DISCOVERY_COPY[data.reason ?? 'default'] ?? EMPTY_DISCOVERY_COPY.default}
        </div>
      );
    } else {
      body = (
        <>
          <svg
            className={balanceChartSvg}
            viewBox="0 0 240 96"
            preserveAspectRatio="none"
            role="img"
            aria-label={`Balance over time from ${series.txCount} discovered transactions`}
            data-testid="balance-chart"
          >
            {areaPath.length > 0 && <path className={balanceChartArea} d={areaPath} />}
            {gapLine.length > 0 && <path className={balanceChartGapLine} d={gapLine} />}
            {mainLine.length > 0 && <path className={balanceChartLine} d={mainLine} />}
            {series.points.map((point, i) => (
              <line
                key={`${point.blockNumber}-${point.kind}-${i}`}
                x1={geometry.xs[i].toFixed(2)}
                y1={(geometry.ys[i] - 3).toFixed(2)}
                x2={geometry.xs[i].toFixed(2)}
                y2={(geometry.ys[i] + 3).toFixed(2)}
                className={
                  point.kind === 'tx' ? balanceChartTick : balanceChartTickMuted
                }
                data-testid="balance-point"
              >
                <title>{tickTitle(point, series, decimals, symbol)}</title>
              </line>
            ))}
          </svg>
          <div className={balanceFacts}>
            <span className={balanceFactLabel}>Now</span>
            <span className={balanceFactLabel}>Low</span>
            <span className={balanceFactLabel}>High</span>
            <span className={balanceFactValue}>
              {currentBalance !== null
                ? `${formatNativeAmount(currentBalance, decimals)} ${symbol}`
                : '—'}
            </span>
            <span className={balanceFactValue}>
              {geometry.min !== null
                ? `${formatNativeAmount(geometry.min, decimals)} ${symbol}`
                : '—'}
            </span>
            <span className={balanceFactValue}>
              {geometry.max !== null
                ? `${formatNativeAmount(geometry.max, decimals)} ${symbol}`
                : '—'}
            </span>
          </div>
          {data.searchWindowBlocks !== undefined && (
            <div className={balanceWindowLabel}>
              Searched the most recent {formatNumber(data.searchWindowBlocks)} blocks
            </div>
          )}
          <ul className={balanceCaveats} data-testid="balance-history-caveats">
            <li className={balanceCaveat}>
              Computed from discovered transactions — may be incomplete.
            </li>
            {series.hasResidualGap && (
              <li className={balanceCaveat}>
                Discovered changes do not reconcile with the live balance — balance
                before the oldest discovered transaction is unknown.
              </li>
            )}
            {!series.anchored && (
              <li className={balanceCaveat}>
                Live balance unavailable — showing discovered change only, not
                absolute balance.
              </li>
            )}
            {truncated !== undefined && (
              <li className={balanceCaveat}>
                Showing the newest {truncated.transactions.length} of{' '}
                {formatNumber(truncated.total)} discovered transactions.
              </li>
            )}
          </ul>
        </>
      );
    }
  } else if (query.loading) {
    body = <span className={balanceChartSkeleton} data-testid="balance-skeleton" />;
  } else if (query.error !== undefined) {
    body = (
      <div className={balanceUnavailable} data-testid="balance-history-error">
        Balance history unavailable
        {query.error instanceof ApiError && query.error.message
          ? ` — ${query.error.message}`
          : ''}
        .
      </div>
    );
  } else {
    // Defensive: gated key (chainId <= 0) resolves undefined without an
    // error — nothing to chart, and nothing to claim either.
    body = <div className={balanceUnavailable}>Balance history unavailable.</div>;
  }

  return (
    <Collapsible
      title="Balance over time (discovered)"
      badge={
        series.txCount > 0 ? (
          <Badge variant="default" size="sm">
            {formatNumber(series.txCount)} tx
          </Badge>
        ) : undefined
      }
      defaultExpanded={defaultExpanded}
      className={className}
    >
      {body}
    </Collapsible>
  );
}

export default BalanceHistory;
