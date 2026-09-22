// Charts page (/chain/:chainId/charts): ~30 days of daily chain series —
// blocks per day, average block time, sampled gas used, and daily fee
// averages — all derived client-side from RPC block headers and chunked
// eth_feeHistory windows (services/chartStats). The page states its
// sampling basis up front and every chart carries its own source label:
// the explorer's event tables only cover user-configured ranges, so
// nothing here is presented as indexer truth. Gaps stay gaps — a day the
// probes could not resolve is simply absent from a series, never
// zero-filled — and the fee section degrades on its own reasons while
// the boundary-derived charts keep rendering.
import { useMemo } from 'react';
import { css, cx } from '@linaria/core';
import { useMatched } from '@native-router/react';
import { navigate } from '@native-router/core';

import TopNavigation from '@/components/TopNavigation';
import { UnsupportedChainState } from '@/views/Home/UnsupportedChainState';
import { PageContainer, PageHeader, BackButton } from '@/components/ui/PageLayout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { parseChainIdParam } from '@/utils/chainParam';
import { formatNumber } from '@/utils/format';
import { formatGwei } from '@/services/gasHistory';
import {
  CHART_DAY_COUNT,
  gasCoverageLabel,
  useChartStats,
  type ChartsSnapshot,
  type ChartsUnavailableReason,
  type GasChartUnavailableReason,
} from '@/services/chartStats';
import { getChainInfo, getChainName } from '@/config/chains';
import {
  buildBars,
  buildLineSegments,
  dayTickPositions,
  formatDayTick,
  linePoints,
  lineX,
  seriesExtent,
  expandExtent,
  type GappedSeries,
} from './chartSvg';

// --- chart frame geometry (shared by every card's SVG) ---

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 216;
const PLOT_LEFT = 46;
const PLOT_RIGHT = 8;
const PLOT_TOP = 8;
const PLOT_BOTTOM = 30;
const TICK_TEXT_X = 42;
const TICK_TEXT_Y = 202;

// Why the whole page (boundary-derived charts) cannot render, in terms
// the UI shows verbatim.
const PAGE_UNAVAILABLE_COPY: Record<ChartsUnavailableReason, string> = {
  'unsupported-chain': 'Charts unavailable — this chain cannot be reached.',
  'rpc-error': 'Charts unavailable — the RPC did not answer the block probes.',
  'method-not-supported':
    'Charts unavailable — this RPC does not implement the block methods the series needs.',
  'insufficient-history':
    'Charts unavailable — fewer than one complete day of blocks is resolvable on this chain yet.',
};

// Why the fee section alone cannot render while the rest of the page does.
const GAS_UNAVAILABLE_COPY: Record<GasChartUnavailableReason, string> = {
  'rpc-cap':
    'Fee history unavailable — this RPC refuses fee-history windows even at the minimum size.',
  'method-not-supported':
    'Fee history unavailable — this endpoint does not implement eth_feeHistory.',
  'pre-eip-1559':
    'Fee history unavailable — no EIP-1559 base-fee data was returned (pre-EIP-1559 chain).',
  'rpc-error': 'Fee history unavailable — the fee-history requests failed.',
};

// Source labels: what each series is actually derived from. These ride
// the card headers verbatim — the honesty contract made visible.
const LABEL_BLOCKS_PER_DAY = 'block numbers at day boundaries — derived from block timestamps';
const LABEL_BLOCK_TIME = 'day-boundary block numbers — derived from block timestamps';
const LABEL_GAS_USED = 'sampled: one block per day boundary';
const PAGE_SAMPLING_NOTE =
  'Derived from block headers and eth_feeHistory windows fetched live from this chain\u2019s RPC — sampled estimates, not an indexer\u2019s full-chain aggregation.';
const BURNT_FEES_NOTE =
  'Daily burnt-fee totals are not available without full indexing — they need every block\u2019s base fee \u00d7 gas used, not these samples.';

// --- styles ---

const samplingNote = css`
  margin: calc(-1 * var(--haze-space-3)) 0 var(--haze-space-4);
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

// Two chart columns on wide screens; the app-wide 768px breakpoint stacks
// them into one column.
const cardsGrid = css`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--haze-space-5);

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

const cardMargin = css`
  margin-top: var(--haze-space-5);
`;

// Card header row (title + source label): wraps on narrow screens so the
// honest long labels never clip.
const headerRow = css`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
`;

const sourceLabel = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

const chartBox = css`
  display: block;
  width: 100%;
  height: auto;
`;

const chartText = css`
  fill: var(--haze-color-text-muted);
  font-size: 10px;
  font-family: var(--haze-font-mono);
`;

const gridLine = css`
  stroke: var(--haze-color-border);
  stroke-width: 1;
  stroke-dasharray: 2 3;
`;

const linePrimary = css`
  stroke: var(--haze-color-primary);
  stroke-width: 1.5;
  fill: none;
  stroke-linejoin: round;
  stroke-linecap: round;
`;

const lineSecondary = css`
  stroke: var(--haze-color-success);
  stroke-width: 1.5;
  fill: none;
  stroke-linejoin: round;
  stroke-linecap: round;
`;

const dotPrimary = css`
  fill: var(--haze-color-primary);
`;

const dotSecondary = css`
  fill: var(--haze-color-success);
`;

const barPrimary = css`
  fill: var(--haze-color-primary-subtle);
  stroke: var(--haze-color-primary);
  stroke-width: 1;
`;

const legendRow = css`
  display: flex;
  flex-wrap: wrap;
  gap: var(--haze-space-4);
  margin-top: var(--haze-space-2);
  color: var(--haze-color-text-secondary);
  font-size: var(--haze-text-xs);
`;

const legendItem = css`
  display: inline-flex;
  align-items: center;
  gap: var(--haze-space-2);
`;

const legendSwatch = css`
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--haze-color-primary);
`;

const legendSwatchSecondary = css`
  background: var(--haze-color-success);
`;

const summaryRow = css`
  margin-top: var(--haze-space-2);
  color: var(--haze-color-text-secondary);
  font-size: var(--haze-text-sm);
`;

const caveat = css`
  margin: var(--haze-space-2) 0 0;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

const unavailableStyle = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
  padding: var(--haze-space-5) 0;
  text-align: center;
`;

// Chart-shaped first-load placeholder (the gas panel's pulse convention).
const skeletonChart = css`
  display: block;
  width: 100%;
  height: 140px;
  background: var(--haze-color-border);
  border-radius: var(--haze-radius-sm, 4px);
  opacity: 0.35;
  animation: charts-skeleton-pulse 1.6s ease-in-out infinite;

  @keyframes charts-skeleton-pulse {
    0%,
    100% {
      opacity: 0.35;
    }
    50% {
      opacity: 0.15;
    }
  }
`;

const daysNote = css`
  margin: 0 0 var(--haze-space-4);
  color: var(--haze-color-text-secondary);
  font-size: var(--haze-text-sm);
`;

// --- small pure helpers ---

const meanOf = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0) / values.length;

// Compact y-tick text: block counts and gas figures are wide enough in
// full grouping form to overflow the label gutter.
const compactTick = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${Math.round(value / 1e3)}k`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return `${Math.round(value)}`;
};

// --- chart renderer ---

type SeriesSpec = {
  values: GappedSeries;
  tone: 'primary' | 'secondary';
};

/**
 * One day-indexed SVG chart: gapped line segments (or zero-baseline
 * bars), three y gridlines with value labels, up to five UTC day ticks.
 * The chart is aria-labelled as a whole — the card's source label beside
 * it carries the honest derivation text.
 */
function DayChart({
  gridDayStarts,
  mode,
  series,
  formatValue,
  ariaLabel,
}: {
  gridDayStarts: readonly number[];
  mode: 'bars' | 'lines';
  series: ReadonlyArray<SeriesSpec>;
  formatValue: (value: number) => string;
  ariaLabel: string;
}) {
  const plotBottom = VIEW_HEIGHT - PLOT_BOTTOM;
  const plotRight = VIEW_WIDTH - PLOT_RIGHT;
  // Bars share a zero baseline; lines normalize over their own extent
  // (flat series draw the mid-line, same rule as the gas sparkline).
  const extent =
    mode === 'bars'
      ? { min: 0, max: Math.max(0, seriesExtent(series.map(s => s.values))?.max ?? 1) }
      : expandExtent(seriesExtent(series.map(s => s.values)) ?? { min: 0, max: 1 });
  const ticks = [extent.max, (extent.max + extent.min) / 2, extent.min];
  const dayTicks = dayTickPositions(gridDayStarts.length);
  const yForTick = (value: number): number => {
    const span = extent.max - extent.min;
    const normalized = span > 0 ? (value - extent.min) / span : 0.5;
    return PLOT_TOP + (1 - normalized) * (plotBottom - PLOT_TOP);
  };
  return (
    <svg
      className={chartBox}
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      role="img"
      aria-label={ariaLabel}
    >
      {ticks.map((tick, index) => {
        const y = yForTick(tick);
        return (
          <g key={index}>
            <line className={gridLine} x1={PLOT_LEFT} y1={y} x2={plotRight} y2={y} />
            <text className={chartText} x={TICK_TEXT_X} y={y + 3} textAnchor="end">
              {formatValue(tick)}
            </text>
          </g>
        );
      })}
      {dayTicks.map(dayIndex => (
        <text
          key={dayIndex}
          className={chartText}
          x={lineX(dayIndex, gridDayStarts.length, PLOT_LEFT, plotRight)}
          y={TICK_TEXT_Y}
          textAnchor="middle"
        >
          {formatDayTick(gridDayStarts[dayIndex] ?? 0)}
        </text>
      ))}
      {mode === 'bars'
        ? buildBars(series[0]?.values ?? [], VIEW_WIDTH, VIEW_HEIGHT, 8).map(
            (bar, index) =>
              bar === null ? null : (
                <rect
                  key={index}
                  data-testid="chart-bar"
                  className={barPrimary}
                  x={bar.x}
                  y={bar.y}
                  width={bar.w}
                  height={bar.h}
                />
              ),
          )
        : series.map((spec, specIndex) => {
            const lineClass = spec.tone === 'primary' ? linePrimary : lineSecondary;
            const dotClass = spec.tone === 'primary' ? dotPrimary : dotSecondary;
            const segments = buildLineSegments(spec.values, VIEW_WIDTH, VIEW_HEIGHT, 8);
            const points = linePoints(spec.values, VIEW_WIDTH, VIEW_HEIGHT, 8);
            return (
              <g key={specIndex}>
                {segments.map((segment, segmentIndex) => (
                  <path
                    key={segmentIndex}
                    data-testid="chart-line"
                    className={lineClass}
                    d={segment}
                  />
                ))}
                {points.map((point, pointIndex) => (
                  <circle
                    key={pointIndex}
                    className={dotClass}
                    cx={point.x}
                    cy={point.y}
                    r={2}
                  />
                ))}
              </g>
            );
          })}
    </svg>
  );
}

function ChartLegend({
  items,
}: {
  items: ReadonlyArray<{ label: string; tone: 'primary' | 'secondary' }>;
}) {
  return (
    <div className={legendRow}>
      {items.map(item => (
        <span key={item.label} className={legendItem}>
          <span
            className={cx(legendSwatch, item.tone === 'secondary' && legendSwatchSecondary)}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** Chart-shaped first-load placeholder card. */
function ChartSkeletonCard({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <span className={skeletonChart} data-testid="charts-skeleton" />
      </CardContent>
    </Card>
  );
}

// --- fee card (the only card with its own degradation states) ---

function GasFeesCard({
  snapshot,
  reason,
}: {
  snapshot: ChartsSnapshot;
  reason: GasChartUnavailableReason | null;
}) {
  if (snapshot.gasDaily.length === 0) {
    const effective: GasChartUnavailableReason = reason ?? 'rpc-error';
    return (
      <div data-testid="charts-gas-fees">
        <Card>
          <CardHeader>
            <CardTitle>Gas Prices (daily avg)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={unavailableStyle} data-testid="charts-gas-unavailable">
              {GAS_UNAVAILABLE_COPY[effective]}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
  const coverage = gasCoverageLabel(snapshot);
  const baseByDay = new Map(snapshot.gasDaily.map(point => [point.dayStart, point.avgBaseFeeGwei]));
  const priorityByDay = new Map(
    snapshot.gasDaily.map(point => [point.dayStart, point.avgPriorityFeeGwei]),
  );
  const baseSeries = snapshot.gridDayStarts.map(day => baseByDay.get(day) ?? null);
  const prioritySeries: GappedSeries = snapshot.gridDayStarts.map(day => {
    const value = priorityByDay.get(day);
    // A structurally-absent priority average is a gap, never a 0-gwei line.
    return value ?? null;
  });
  const priorityPresent = snapshot.gasDaily.filter(point => point.avgPriorityFeeGwei !== null);
  const baseMean = meanOf(snapshot.gasDaily.map(point => point.avgBaseFeeGwei));
  const priorityMean = meanOf(priorityPresent.map(point => point.avgPriorityFeeGwei ?? 0));
  const partialDays = snapshot.gasDaily.filter(point => !point.complete).length;
  return (
    <div data-testid="charts-gas-fees">
      <Card>
        <CardHeader>
          <div className={headerRow}>
            <CardTitle>Gas Prices (daily avg)</CardTitle>
            <span className={sourceLabel}>daily averages · {coverage}</span>
          </div>
        </CardHeader>
        <CardContent>
          <DayChart
            gridDayStarts={snapshot.gridDayStarts}
            mode="lines"
            series={[
              { values: baseSeries, tone: 'primary' },
              { values: prioritySeries, tone: 'secondary' },
            ]}
            formatValue={value => `${formatGwei(value)} gwei`}
            ariaLabel="Daily average base fee and priority fee"
          />
          <ChartLegend
            items={[
              { label: 'Base fee (avg)', tone: 'primary' },
              {
                label:
                  priorityPresent.length > 0
                    ? 'Priority fee (25th pct reward, avg)'
                    : 'Priority fee not returned by this RPC',
                tone: 'secondary',
              },
            ]}
          />
          <p className={summaryRow}>
            Base fee avg {baseMean !== null ? `${formatGwei(baseMean)} gwei` : '—'}
            {priorityPresent.length > 0 && priorityMean !== null
              ? ` · Priority avg ${formatGwei(priorityMean)} gwei`
              : ''}
          </p>
          {partialDays > 0 && (
            <p className={caveat}>
              {partialDays} of {snapshot.gasDaily.length} days cover only part of their block span
              (RPC window limits) — partial days are averaged over the blocks actually returned.
            </p>
          )}
          <p className={caveat}>{BURNT_FEES_NOTE}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// --- page ---

export default function ChartsPage() {
  const { params, router } = useMatched();

  // An unparseable :chainId param is a broken link, not an unsupported
  // chain: parseChainIdParam returns null and the raw param travels on to
  // the unsupported state (same two-tier guard as the Home view).
  const rawChainId = params.chainId;
  const parsedChainId = rawChainId === undefined ? 1 : parseChainIdParam(rawChainId);
  const currentChainId = parsedChainId ?? 0;
  const chainInfo = getChainInfo(currentChainId);

  const handleChainChange = (newChainId: number) => {
    void navigate(router, `/chain/${newChainId}/charts`).catch(() => undefined);
  };

  if (!chainInfo) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <PageContainer>
          <UnsupportedChainState chainId={currentChainId} rawChainId={rawChainId} />
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <PageContainer>
        <BackButton
          onClick={() =>
            void navigate(router, `/chain/${currentChainId}`).catch(() => undefined)}
        />

        <PageHeader
          title={`${getChainName(currentChainId)} Charts`}
          chainInfo={`Chain ID: ${currentChainId}`}
        />

        <p className={samplingNote}>{PAGE_SAMPLING_NOTE}</p>

        <ChartsBody chainId={currentChainId} />
      </PageContainer>
    </>
  );
}

/**
 * Feed-driven body, split out so the unsupported-chain early return above
 * keeps hook order stable regardless of the chain guard outcome.
 */
function ChartsBody({ chainId }: { chainId: number }) {
  const feed = useChartStats(chainId);

  // Cross-chain guard: the query layer's store keeps the last settle while
  // the new chain's fetch runs, so another chain's result is treated as
  // absent — the page pulses instead of flashing chain A's series under
  // chain B's header.
  const own = feed.data?.chainId === chainId ? feed.data : undefined;

  if (own === undefined && feed.loading) {
    return (
      <div className={cardsGrid}>
        <ChartSkeletonCard title="Blocks per Day" />
        <ChartSkeletonCard title="Average Block Time" />
        <ChartSkeletonCard title="Gas Used (sampled)" />
        <ChartSkeletonCard title="Gas Prices (daily avg)" />
      </div>
    );
  }

  if (own === undefined || own.status === 'unavailable') {
    // A settled unavailable result names its own reason; the defensive
    // branch (own undefined, not loading — a hook-level error escape
    // hatch) keeps the generic rpc-error copy.
    const settledUnavailable = own?.status === 'unavailable' ? own : null;
    const reason: ChartsUnavailableReason = settledUnavailable?.reason ?? 'rpc-error';
    return (
      <div data-testid="charts-unavailable">
        <Card>
          <CardHeader>
            <CardTitle>Charts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={unavailableStyle}>{PAGE_UNAVAILABLE_COPY[reason]}</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <ChartsCards snapshot={own.snapshot} gasUnavailableReason={own.gasUnavailableReason} />;
}

function ChartsCards({
  snapshot,
  gasUnavailableReason,
}: {
  snapshot: ChartsSnapshot;
  gasUnavailableReason: GasChartUnavailableReason | null;
}) {
  const grid = snapshot.gridDayStarts;
  // Grid-aligned series builders: a day without a resolved point stays a
  // null slot — the gap the chart renders.
  const blocksByDay = useMemo(
    () => new Map(snapshot.blocksPerDay.map(point => [point.dayStart, point.blocks])),
    [snapshot],
  );
  const gasUsedByDay = useMemo(
    () => new Map(snapshot.boundaryHeaders.map(header => [header.dayStart, Number(header.gasUsed)])),
    [snapshot],
  );
  const blocksSeries: GappedSeries = grid.map(day => blocksByDay.get(day) ?? null);
  const blockTimeSeries: GappedSeries = grid.map(day => {
    const blocks = blocksByDay.get(day);
    return blocks === undefined ? null : 86_400 / blocks;
  });
  const gasUsedSeries: GappedSeries = grid.map(day => gasUsedByDay.get(day) ?? null);

  const blocksMean = meanOf(snapshot.blocksPerDay.map(point => point.blocks));
  const blockTimeMean = meanOf(snapshot.blocksPerDay.map(point => 86_400 / point.blocks));
  const gasUsedMean = meanOf(snapshot.boundaryHeaders.map(header => Number(header.gasUsed)));

  return (
    <>
      {snapshot.blocksPerDay.length < CHART_DAY_COUNT && (
        <p className={daysNote}>
          Showing {snapshot.blocksPerDay.length} complete day
          {snapshot.blocksPerDay.length === 1 ? '' : 's'} — this chain has less than the{' '}
          {CHART_DAY_COUNT}-day window of resolvable history.
        </p>
      )}
      <div className={cardsGrid}>
        <div data-testid="charts-blocks-day">
          <Card>
            <CardHeader>
              <div className={headerRow}>
                <CardTitle>Blocks per Day</CardTitle>
                <span className={sourceLabel}>{LABEL_BLOCKS_PER_DAY}</span>
              </div>
            </CardHeader>
            <CardContent>
              <DayChart
                gridDayStarts={grid}
                mode="bars"
                series={[{ values: blocksSeries, tone: 'primary' }]}
                formatValue={compactTick}
                ariaLabel="Blocks mined per day"
              />
              <p className={summaryRow}>
                {blocksMean !== null
                  ? `avg ${formatNumber(Math.round(blocksMean))} blocks/day`
                  : '—'}
              </p>
            </CardContent>
          </Card>
        </div>

        <div data-testid="charts-block-time">
          <Card>
            <CardHeader>
              <div className={headerRow}>
                <CardTitle>Average Block Time</CardTitle>
                <span className={sourceLabel}>{LABEL_BLOCK_TIME}</span>
              </div>
            </CardHeader>
            <CardContent>
              <DayChart
                gridDayStarts={grid}
                mode="lines"
                series={[{ values: blockTimeSeries, tone: 'primary' }]}
                formatValue={value => `${value.toFixed(1)} s`}
                ariaLabel="Average block time per day"
              />
              <p className={summaryRow}>
                {blockTimeMean !== null ? `avg ${blockTimeMean.toFixed(2)} s/block` : '—'}
              </p>
            </CardContent>
          </Card>
        </div>

        <div data-testid="charts-gas-used">
          <Card>
            <CardHeader>
              <div className={headerRow}>
                <CardTitle>Gas Used (sampled)</CardTitle>
                <span className={sourceLabel}>{LABEL_GAS_USED}</span>
              </div>
            </CardHeader>
            <CardContent>
              <DayChart
                gridDayStarts={grid}
                mode="bars"
                series={[{ values: gasUsedSeries, tone: 'primary' }]}
                formatValue={compactTick}
                ariaLabel="Gas used by the day-boundary block"
              />
              <p className={summaryRow}>
                {gasUsedMean !== null
                  ? `sampled avg ${formatNumber(Math.round(gasUsedMean))} gas/block`
                  : '—'}
              </p>
            </CardContent>
          </Card>
        </div>

        <GasFeesCard snapshot={snapshot} reason={gasUnavailableReason} />
      </div>

      <div className={cardMargin} data-testid="charts-burnt-note">
        <Card>
          <CardHeader>
            <CardTitle>Burnt Fees</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={caveat} style={{ margin: 0 }}>
              {BURNT_FEES_NOTE}
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
