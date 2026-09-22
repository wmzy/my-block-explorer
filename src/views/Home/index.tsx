import { useEffect } from 'react';
import { css, cx } from '@linaria/core';
import { Alert } from 'haze-ui';
import { TypedLink, useMatched } from '@native-router/react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import TopNavigation from '@/components/TopNavigation';
import { getChainInfo, getChainSymbol, getChainType } from '@/config/chains';
import {
  formatNumber,
  formatAddress,
  formatHash,
  formatRelativeTime,
  formatValue,
} from '@/utils/format';
import { parseChainIdParam } from '@/utils/chainParam';
import { PageContainer } from '@/components/ui/PageLayout';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { useLatestBlocksFeed, useLatestTransactionsFeed, HOME_FEED_ITEMS } from '@/services/homeFeed';
import { useLiveBlocks, mergeLiveBlocks } from '@/services/liveChain';
import {
  buildSparklinePath,
  formatGwei,
  gasWindowLabel,
  useGasHistory,
  type GasHistoryResult,
  type GasUnavailableReason,
} from '@/services/gasHistory';
import { describeBlockProducer } from '@/utils/blockRpcData';
import { gasTransferCostUsd, useNativeUsdPrice } from '@/services/prices';
import { UsdValue } from '@/components/ui/UsdValue';
import { redirectReplace, rememberChainId } from './Landing';
import { UnsupportedChainState } from './UnsupportedChainState';
import Watchlist from './Watchlist';

// --- styles ---

const hero = css`
  text-align: center;
  padding: var(--haze-space-8) 0 var(--haze-space-4);
`;

const titleStyle = css`
  font-size: 36px;
  font-weight: var(--haze-weight-bold);
  margin: 0 0 var(--haze-space-2) 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;

  @media (max-width: 768px) {
    font-size: 28px;
  }
`;

const subtitleStyle = css`
  font-size: var(--haze-text-base);
  color: var(--haze-color-text-muted);
  margin: 0;
`;

// Testnet pill sits inline with the hero subtitle's chain meta.
const heroBadge = css`
  margin-left: var(--haze-space-2);
  vertical-align: middle;
`;

const statsBar = css`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--haze-space-4);
  margin: var(--haze-space-6) 0;
`;

const statItem = css`
  text-align: center;
  padding: var(--haze-space-4);
`;

const statValueStyle = css`
  font-size: 22px;
  font-weight: var(--haze-weight-bold);
  color: var(--haze-color-text);
  margin-bottom: 2px;
`;

const statLabelStyle = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const columnsLayout = css`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--haze-space-5);
  margin-top: var(--haze-space-4);

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const listItem = css`
  display: flex;
  align-items: flex-start;
  gap: var(--haze-space-3);
  padding: var(--haze-space-3) 0;
  border-bottom: 1px solid var(--haze-color-border);

  &:last-child {
    border-bottom: none;
  }
`;

const listIcon = css`
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: var(--haze-radius-md);
  background: var(--haze-color-primary-subtle);
  color: var(--haze-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--haze-text-xs);
  font-weight: var(--haze-weight-bold);
`;

const listBody = css`
  flex: 1;
  min-width: 0;
`;

const listRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--haze-space-2);

  /* Mobile feeds get ~193px of body width next to the 40px row icon; the
     hash link (~137px) plus the nowrap listMeta (relative time, "Block N")
     cannot share one line, so the meta drops below the link instead of
     overflowing into the card padding (same wrap approach as the hardened
     tx/block detail header rows). */
  @media (max-width: 768px) {
    flex-wrap: wrap;
  }
`;

const listPrimary = css`
  font-weight: var(--haze-weight-semibold);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-primary);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const listSecondary = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

const listMeta = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  white-space: nowrap;
`;

const listValue = css`
  font-size: var(--haze-text-xs);
  font-weight: var(--haze-weight-medium);
  color: var(--haze-color-text);
  font-family: var(--haze-font-mono, monospace);
`;

const viewAllLink = css`
  display: block;
  text-align: center;
  padding: var(--haze-space-3);
  color: var(--haze-color-primary);
  text-decoration: none;
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-medium);
  border-top: 1px solid var(--haze-color-border);

  &:hover {
    background: var(--haze-color-primary-subtle);
  }
`;

const cardHeaderRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;

  /* The gas header pairs the title with the nowrap block-window label
     (~224px at 12px); at 375px the two exceed the ~245px header width, so
     the label drops under the title instead of spilling into the card
     padding. Feed headers carry only a title and are unaffected. */
  @media (max-width: 768px) {
    flex-wrap: wrap;
    row-gap: var(--haze-space-1);
  }
`;

// Message + Retry row inside the stale-data warning alert.
const staleBannerRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
`;

// --- gas panel ---

// Trend + tiers side by side on every width down to the mobile stack; the
// wrap point sits well below the 1024px layout width so the panel never
// squeezes the page grid.
const gasPanelRow = css`
  display: flex;
  flex-wrap: wrap;
  gap: var(--haze-space-4) var(--haze-space-6);
  align-items: stretch;
`;

const gasTrendColumn = css`
  flex: 1 1 280px;
  min-width: 0;
`;

const gasTierColumn = css`
  flex: 0 1 220px;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--haze-space-2);
`;

// Fixed 240x48 viewBox stretched horizontally (preserveAspectRatio="none");
// non-scaling strokes below keep the line weight uniform at any width.
const gasSparkline = css`
  display: block;
  width: 100%;
  height: 48px;
`;

const gasSparkLine = css`
  stroke: var(--haze-color-primary);
  stroke-width: 1.5;
  fill: none;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
`;

const gasSparkArea = css`
  fill: var(--haze-color-primary-subtle);
`;

const gasFeeFacts = css`
  display: grid;
  grid-template-columns: auto auto;
  justify-content: start;
  column-gap: var(--haze-space-6);
  row-gap: 2px;
  margin-top: var(--haze-space-2);
`;

const gasFeeValue = css`
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-bold);
  color: var(--haze-color-text);
  font-family: var(--haze-font-mono, monospace);
`;

const gasTierRow = css`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--haze-space-3);
  font-size: var(--haze-text-sm);
`;

const gasTierLabel = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const gasTierValue = css`
  font-weight: var(--haze-weight-medium);
  font-family: var(--haze-font-mono, monospace);
  color: var(--haze-color-text);
`;

// Per-tier transfer-cost USD: secondary inside the mono tier value, so
// the gwei figure stays the row's anchor.
const gasTierUsdStyle = css`
  font-family: var(--haze-font-body, inherit);
  font-weight: var(--haze-weight-regular);
  color: var(--haze-color-text-muted);
`;

const gasTierNote = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

const gasWindowLabelStyle = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  white-space: nowrap;
`;

const gasUnavailableStyle = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-muted);
  padding: var(--haze-space-2) 0;
`;

// Sparkline-shaped placeholder: full-width 48px surface mirroring the real
// chart geometry so the card does not jump when data lands.
const gasSparkSkeleton = css`
  display: block;
  width: 100%;
  height: 48px;
`;

// --- first-load skeletons ---

// Shared placeholder surface. The pulse animates opacity only, so it stays
// on the compositor (no layout work) and reads as a steady shimmer instead
// of a flicker. Keyframes are defined exactly once here; every skeleton
// size composes onto this base via cx.
const skeletonBase = css`
  display: inline-block;
  background: var(--haze-color-border);
  border-radius: var(--haze-radius-sm, 4px);
  animation: home-skeleton-pulse 1.4s ease-in-out infinite;

  @keyframes home-skeleton-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

// Stats-bar value placeholder sized to the value line it stands in for.
const statValueSkeleton = css`
  width: 72px;
  height: 22px;
  vertical-align: middle;
`;

// Feed-row placeholders mirror the real row geometry (40px icon square +
// three text lines) so the card does not jump when data lands.
const skeletonIcon = css`
  width: 40px;
  height: 40px;
  border-radius: var(--haze-radius-md);
`;

const skeletonLine = css`
  height: 16px;
  flex-shrink: 0;
`;

// --- helpers ---

// BigInt-safe fixed-decimal formatting: divides and rounds (half up) in
// integer arithmetic instead of round-tripping viem's formatted strings
// through parseFloat, so on-chain magnitudes never lose precision to a
// double. `decimals` is the value's token scale (gwei = 9, ether = 18).
function formatFixed(value: bigint, decimals: number, fractionDigits: number): string {
  const unit = 10n ** BigInt(decimals - fractionDigits);
  const scaled = (value + unit / 2n) / unit;
  const fractionScale = 10n ** BigInt(fractionDigits);
  const whole = scaled / fractionScale;
  const fraction = scaled % fractionScale;
  return `${whole}.${fraction.toString().padStart(fractionDigits, '0')}`;
}

// --- stats-bar presentation ---

// Feed-level facts every stats card shares.
export type StatFeedStatus = {
  /** True while the feed's first fetch is in flight (nothing fetched yet). */
  loading: boolean;
  /** True while the feed's fetches are currently failing (stale or dead). */
  error: boolean;
};

// One card's inputs: the shared feed status plus this card's own value.
export type StatState = StatFeedStatus & {
  /** Formatted value from the latest successful fetch; null when none. */
  value: string | null;
};

// The rendering states of a stats card, plus the plain dash kept for a
// successful fetch that simply has no figure to show.
export type StatPresentation =
  | { kind: 'skeleton' }
  | { kind: 'value'; text: string }
  | { kind: 'unavailable'; title: string }
  | { kind: 'empty' };

// Pure on purpose (unit-tested without a render): a present value always
// wins — stale-but-present numbers stay on screen under the stale banner,
// and a background refetch never swaps a number for a skeleton — then the
// first load pulses, an error with no value is honestly "Unavailable", and
// a clean fetch without the figure keeps the page's long-standing dash.
export function deriveStatPresentation(state: StatState): StatPresentation {
  if (state.loading && state.value === null) return { kind: 'skeleton' };
  if (state.value !== null) return { kind: 'value', text: state.value };
  if (state.error) return { kind: 'unavailable', title: 'Unavailable' };
  return { kind: 'empty' };
}

function StatCard({
  label,
  value,
  feed,
}: {
  label: string;
  value: string | null;
  feed: StatFeedStatus;
}) {
  const presentation = deriveStatPresentation({ ...feed, value });
  return (
    <Card className={statItem}>
      <div
        className={statValueStyle}
        title={presentation.kind === 'unavailable' ? presentation.title : undefined}
      >
        {presentation.kind === 'skeleton' ? (
          <span className={cx(skeletonBase, statValueSkeleton)} data-testid="stat-skeleton" />
        ) : presentation.kind === 'value' ? (
          presentation.text
        ) : (
          '—'
        )}
      </div>
      <div className={statLabelStyle}>{label}</div>
    </Card>
  );
}

// First-load placeholder for one feed column: mirrors the real row shape
// (icon square + three lines) at a lighter row count, so the card reads as
// loading without flickering or jumping when its data lands.
const HOME_FEED_SKELETON_ROWS = 6;

function FeedSkeletonRows({ rows }: { rows: number }) {
  return (
    <div aria-hidden="true" data-testid="feed-skeleton">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={listItem}>
          <div className={cx(skeletonBase, skeletonIcon)} />
          <div className={listBody}>
            <div className={listRow}>
              <span className={cx(skeletonBase, skeletonLine)} style={{ width: '38%' }} />
              <span className={cx(skeletonBase, skeletonLine)} style={{ width: '16%' }} />
            </div>
            <div className={listRow} style={{ marginTop: 6 }}>
              <span className={cx(skeletonBase, skeletonLine)} style={{ width: '55%' }} />
              <span className={cx(skeletonBase, skeletonLine)} style={{ width: '14%' }} />
            </div>
            <div className={listRow} style={{ marginTop: 6 }}>
              <span className={cx(skeletonBase, skeletonLine)} style={{ width: '48%' }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- gas panel ---

// Rhythm with the surrounding blocks: the stats bar's bottom margin and
// this card's own bottom margin collapse with the columns' top margin, so
// the gaps around the panel match the page's existing spacing.
const gasPanelCard = css`
  margin-bottom: var(--haze-space-6);
`;

// Feed shape the panel consumes (the polled gas hook's observable fields).
type GasFeedState = {
  data: GasHistoryResult | undefined;
  loading: boolean;
  error: Error | undefined;
};

// Honest copy per unavailable reason. The fetch never throws, so the
// view-level error fallback below reuses 'fetch-failed'; the
// unsupported-chain case never renders (the view early-returns for unknown
// chains and the fetch guards the parked id 0 without an RPC call).
const GAS_UNAVAILABLE_COPY: Record<GasUnavailableReason, string> = {
  'unsupported-chain': 'Gas history unavailable from this RPC.',
  'method-not-supported':
    'Gas history unavailable from this RPC — this endpoint does not implement eth_feeHistory.',
  'no-base-fee-data':
    'Gas history unavailable from this RPC — no EIP-1559 base-fee data was returned.',
  'fetch-failed': 'Gas history unavailable from this RPC — the fee-history request failed.',
};

const GAS_TIER_LABELS = { slow: 'Slow', standard: 'Standard', fast: 'Fast' } as const;

// The per-tier USD figure prices a plain ETH transfer (21,000 gas — the
// canonical cheapest send), not the tier price alone.
const TRANSFER_GAS_UNITS = 21_000;

// EIP-1559 panel under the stats bar: base-fee sparkline over the actual
// returned block window plus Slow/Standard/Fast priority-fee tiers. Same
// tri-state honesty as the stat cards — first load pulses, a settled
// unavailable state is explicit (never an error page), and present data
// always wins over a background refetch.
function GasPanel({ feed, chainId }: { feed: GasFeedState; chainId: number }) {
  // USD valuation of the per-tier transfer cost (browser-side DefiLlama
  // layer): an unmapped chain or unavailable price settles null without
  // any network and the tier rows keep their gwei-only shape.
  const nativePrice = useNativeUsdPrice(chainId);

  // Cross-chain guard: the query layer's store keeps the last settle while
  // the new chain's fetch runs, so another chain's result is treated as
  // absent — the panel pulses instead of flashing chain A's fees under
  // chain B's header.
  const own = feed.data?.chainId === chainId ? feed.data : undefined;
  const snapshot = own?.status === 'ok' ? own.snapshot : undefined;

  if (snapshot) {
    const windowText = gasWindowLabel(snapshot.oldestBlock, snapshot.newestBlock);
    const line = buildSparklinePath(snapshot.baseFeeGwei);
    const area = line.length > 0 ? `${line} L240,48 L0,48 Z` : '';
    const tiers = snapshot.tiers;
    return (
      <div data-testid="gas-panel" className={gasPanelCard}>
        <Card>
          <CardHeader>
            <div className={cardHeaderRow}>
              <CardTitle>Gas</CardTitle>
              <span className={gasWindowLabelStyle}>{windowText}</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className={gasPanelRow}>
              <div className={gasTrendColumn}>
                <svg
                  className={gasSparkline}
                  viewBox="0 0 240 48"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={`Base fee per gas, ${windowText}`}
                >
                  {area.length > 0 && <path className={gasSparkArea} d={area} />}
                  <path className={gasSparkLine} d={line} />
                </svg>
                <div className={gasFeeFacts}>
                  <span className={statLabelStyle}>Base fee</span>
                  <span className={statLabelStyle}>Window avg</span>
                  <span
                    className={gasFeeValue}
                    title={`${snapshot.currentBaseFeeGwei} gwei (newest block in window)`}
                  >
                    {formatGwei(snapshot.currentBaseFeeGwei)} gwei
                  </span>
                  <span
                    className={gasFeeValue}
                    title={`${snapshot.averageBaseFeeGwei} gwei (mean of window)`}
                  >
                    {formatGwei(snapshot.averageBaseFeeGwei)} gwei
                  </span>
                </div>
              </div>
              <div className={gasTierColumn}>
                {(['slow', 'standard', 'fast'] as const).map(tier => (
                  <div key={tier} className={gasTierRow}>
                    <span className={gasTierLabel}>{GAS_TIER_LABELS[tier]}</span>
                    <span className={gasTierValue}>
                      {tiers ? `${formatGwei(tiers[tier])} gwei` : '—'}
                    </span>
                    {/* Per-tier USD for a plain 21,000-gas transfer (base
                        fee + this tier's tip): a SIBLING of the gwei value
                        so the tier figure's text stays exactly "N gwei";
                        renders only when the native coin priced. */}
                    {tiers && nativePrice != null && (
                      <span
                        className={gasTierUsdStyle}
                        title={`≈ cost of a plain ${TRANSFER_GAS_UNITS.toLocaleString()}-gas transfer at this tier (base fee + tip)`}
                      >
                        <UsdValue
                          usd={gasTransferCostUsd(
                            TRANSFER_GAS_UNITS,
                            snapshot.currentBaseFeeGwei + tiers[tier],
                            nativePrice,
                          )}
                          price={nativePrice}
                        />
                      </span>
                    )}
                  </div>
                ))}
                <div className={gasTierNote}>
                  {tiers
                    ? 'Priority fees · 25/50/75th pct rewards'
                    : 'Priority fees not returned by this RPC'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // First load with nothing fetched yet: a sparkline-shaped placeholder.
  if (own === undefined && feed.loading) {
    return (
      <div data-testid="gas-panel" className={gasPanelCard}>
        <Card>
          <CardHeader>
            <div className={cardHeaderRow}>
              <CardTitle>Gas</CardTitle>
              <span className={cx(skeletonBase, statValueSkeleton)} style={{ width: 120 }} />
            </div>
          </CardHeader>
          <CardContent>
            <div className={gasPanelRow}>
              <div className={gasTrendColumn}>
                <span className={cx(skeletonBase, gasSparkSkeleton)} data-testid="gas-skeleton" />
              </div>
              <div className={gasTierColumn}>
                <span className={cx(skeletonBase, skeletonLine)} style={{ width: '70%' }} />
                <span className={cx(skeletonBase, skeletonLine)} style={{ width: '55%' }} />
                <span className={cx(skeletonBase, skeletonLine)} style={{ width: '62%' }} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Settled without usable data (or the defensive never-throws escape hatch
  // of a hook-level error): the explicit unavailable state.
  const reason: GasUnavailableReason =
    own?.status === 'unavailable' ? own.reason : 'fetch-failed';
  return (
    <div data-testid="gas-panel" className={gasPanelCard}>
      <Card>
        <CardHeader>
          <div className={cardHeaderRow}>
            <CardTitle>Gas</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className={gasUnavailableStyle} data-testid="gas-unavailable">
            {GAS_UNAVAILABLE_COPY[reason]}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --- component ---

export default function Home() {
  const { params, router } = useMatched();

  // An unparseable :chainId param ("abc", "0x1", "1e5") is a broken link,
  // not an unsupported chain: parseChainIdParam returns null and the raw
  // param travels on to the unsupported state so it can say which of the
  // two problems this is. The guarded id 0 parks the feeds (no RPC traffic
  // for a chain that cannot render).
  const rawChainId = params.chainId;
  const parsedChainId = rawChainId === undefined ? 1 : parseChainIdParam(rawChainId);
  const currentChainId = parsedChainId ?? 0;
  const chainInfo = getChainInfo(currentChainId);
  const symbol = getChainSymbol(currentChainId);

  // Feeds take 0 on unsupported chains: their fetch guards non-positive ids
  // without an RPC call, so the unsupported state below stays offline
  // instead of polling a chain that cannot render.
  const feedChainId = chainInfo ? currentChainId : 0;
  const blocksFeed = useLatestBlocksFeed(feedChainId);
  const transactionsFeed = useLatestTransactionsFeed(feedChainId);
  // Gas history rides its own polled feed (60s cadence): a fee-history
  // failure must degrade only this panel, never the feeds above.
  const gasFeed = useGasHistory(feedChainId);
  // Live block stream (SSE enhancement): while it delivers blocks the
  // latest-blocks list gets fresher heads; the moment it fails it
  // silently stops mattering (the polled feed is the source of truth).
  const live = useLiveBlocks(feedChainId);

  // Live-mode merge: pushed blocks join the polled list at the head —
  // deduped by number, newest first, capped at the feed's list length.
  // On 'polling' (no stream, stream error, browser without EventSource)
  // the polled feed alone is rendered.
  const polledBlocks = blocksFeed.data?.blocks ?? [];
  const blocks = live.mode === 'live'
    ? mergeLiveBlocks(polledBlocks, live.blocks, HOME_FEED_ITEMS)
    : polledBlocks;
  // Newest head across both channels: the stream leads when connected,
  // but a catch-up poll that momentarily ran ahead still wins honestly.
  const liveHead = live.mode === 'live' && live.blocks[0] !== undefined
    ? BigInt(live.blocks[0].number)
    : null;
  const polledHead = blocksFeed.data?.latestBlockNumber ?? null;
  const latestBlockNumber = liveHead !== null && (polledHead === null || liveHead > polledHead)
    ? liveHead
    : polledHead;
  const gasPrice = blocksFeed.data?.gasPrice ?? null;
  const transactions = transactionsFeed.data ?? [];
  // True while either feed is still on its FIRST fetch (polledQuery's
  // loading is "in flight and nothing fetched yet"). The columns no longer
  // wait on this — each renders behind its own feed; it only holds back the
  // dead-RPC error card below until both feeds have settled.
  const loading = blocksFeed.loading || transactionsFeed.loading;

  // Either feed failing means live updates stopped. dataUpdatedAt is only
  // stamped on successful fetches (verified against react-toolroom's
  // result-commit path), so the oldest of the two bounds how old the data
  // still on screen is.
  const feedError = blocksFeed.error ?? transactionsFeed.error;
  const updatedAts = [blocksFeed.dataUpdatedAt, transactionsFeed.dataUpdatedAt].filter(
    (updatedAt): updatedAt is number => updatedAt !== undefined,
  );
  const lastUpdatedAt = updatedAts.length > 0 ? Math.min(...updatedAts) : undefined;
  // Stale: fetching fails but earlier data is still shown (warning banner).
  const showStaleBanner = feedError !== undefined && lastUpdatedAt !== undefined;
  // Dead: fetching fails and nothing was ever fetched (full-width error).
  const showFatalError = feedError !== undefined && lastUpdatedAt === undefined;
  // The dead branch fires only once BOTH feeds settle: while either is
  // still on its first fetch the page cannot know both lists are dead, and
  // a slow sibling must not be buried by its faster sibling's error.
  const settledFatal = showFatalError && !loading;

  const handleRetry = () => {
    void Promise.resolve(blocksFeed.refetch()).catch(() => undefined);
    void Promise.resolve(transactionsFeed.refetch()).catch(() => undefined);
  };

  // Remember the current valid chain as the landing target for the next
  // visit and for unknown-chain redirects.
  useEffect(() => {
    if (chainInfo) {
      rememberChainId(chainInfo.id);
    }
  }, [chainInfo]);

  // Chain switches replace the current entry (shared Wave A helper) so
  // hopping between chains never pile up history entries.
  const handleChainChange = (newChainId: number) => {
    void redirectReplace(router, `/chain/${newChainId}`).catch(() => undefined);
  };

  // Unknown chain deep link (an id the config cannot resolve, e.g.
  // /chain/999999): an explicit, honest state instead of the old silent
  // redirect to the viewer's remembered chain — a shared link must not
  // quietly open a different chain on someone else's browser. The state
  // names the requested id and offers recovery CTAs.
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

  const gasUsedPercent = blocks[0]
    ? ((Number(blocks[0].gasUsed) / Number(blocks[0].gasLimit)) * 100).toFixed(1)
    : null;

  // Stats-bar inputs. All four cards read the blocks feed, but each value
  // is null-checked on its own: an RPC that omits one figure (e.g. gas
  // price) blanks only its own card instead of failing the whole bar.
  const statsFeed = { loading: blocksFeed.loading, error: blocksFeed.error !== undefined };
  const latestBlockText = latestBlockNumber !== null ? formatNumber(latestBlockNumber) : null;
  const gasPriceText = gasPrice !== null ? `${formatFixed(gasPrice, 9, 2)} Gwei` : null;
  const latestTxCountText = blocks[0] ? formatNumber(blocks[0].transactionCount) : null;
  const gasUsedText = gasUsedPercent !== null ? `${gasUsedPercent}%` : null;

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <PageContainer>
        <div className={hero}>
          <h1 className={titleStyle}>{chainInfo.name} Explorer</h1>
          <p className={subtitleStyle}>
            Chain ID: {chainInfo.id} · {symbol}
            {getChainType(currentChainId) === 'testnet' && (
              <Badge variant="warning" size="sm" className={heroBadge}>
                Testnet
              </Badge>
            )}
          </p>
        </div>

        {/* Stats bar: each card independently loading / value / unavailable */}
        <div className={statsBar}>
          <StatCard label="Latest Block" value={latestBlockText} feed={statsFeed} />
          <StatCard label="Gas Price" value={gasPriceText} feed={statsFeed} />
          <StatCard label="Txns in Latest Block" value={latestTxCountText} feed={statsFeed} />
          <StatCard label="Gas Used (latest block)" value={gasUsedText} feed={statsFeed} />
        </div>

        {/* Gas window panel: RPC-direct fee history over the actual returned
            block range; degrades to an explicit unavailable state per its
            own feed and hides entirely with the unsupported-chain return. */}
        <GasPanel feed={gasFeed} chainId={currentChainId} />

        {/* Watchlist: per-browser tracked addresses matched against live
            blocks while this page is open (storage in util/watchlist.ts;
            the panel carries its own honest-scope copy). */}
        <Watchlist chainId={feedChainId} live={live.mode === 'live'} />

        {/* Stale branch: fetch failing but old data still on screen */}
        {showStaleBanner && lastUpdatedAt !== undefined && (
          <Alert variant="warning">
            <div className={staleBannerRow}>
              <span>
                Live data unavailable — showing data from {formatRelativeTime(lastUpdatedAt)}
              </span>
              <Button variant="outline" size="sm" onClick={handleRetry}>
                Retry
              </Button>
            </div>
          </Alert>
        )}

        {/* Dead branch: fetch failing, nothing ever fetched, and both feeds
            settled (see settledFatal) — the columns give way to it. */}
        {settledFatal && (
          <ErrorState
            message="Live data is unavailable and no previous data to show."
            onRetry={handleRetry}
          />
        )}

        {/* Columns render independently of each other: each waits only on
            its own feed (skeleton rows during its first load), so a slow
            RPC holds back neither its sibling column nor the page. */}
        {!settledFatal && (
          <div className={columnsLayout}>
            {/* Latest Blocks */}
            <Card>
              <CardHeader>
                <div className={cardHeaderRow}>
                  <CardTitle>Latest Blocks</CardTitle>
                  {/* Stream vs poll provenance for this list. 'Live' only
                      once a pushed block has actually arrived — an
                      open-but-silent stream still counts as polling. */}
                  <span
                    data-testid="live-mode-indicator"
                    title={
                      live.mode === 'live'
                        ? 'New blocks arrive over a server-sent event stream as they are mined.'
                        : 'Updating by polling every 12s — the live event stream is unavailable or not connected.'
                    }
                  >
                    <StatusBadge status={live.mode === 'live' ? 'online' : 'pending'}>
                      {live.mode === 'live' ? 'Live' : 'Polling'}
                    </StatusBadge>
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                {/* This column waits only on its own feed: blocks rows show
                    as soon as the blocks feed lands, regardless of the
                    transactions column's state. */}
                {blocksFeed.loading && <FeedSkeletonRows rows={HOME_FEED_SKELETON_ROWS} />}
                {!blocksFeed.loading && blocks.map(block => {
                  // Bor-style PoS chains report the zero address as miner;
                  // classify once so only a real producer gets a link.
                  const producer = describeBlockProducer(block.miner);
                  return (
                    <div key={block.number} className={listItem}>
                      <div className={listIcon}>Bk</div>
                      <div className={listBody}>
                        <div className={listRow}>
                          <TypedLink
                            to={`/chain/${currentChainId}/block/${block.number}`}
                            className={listPrimary}
                          >
                            {formatNumber(block.number)}
                          </TypedLink>
                          <span className={listMeta}>
                            {formatRelativeTime(block.timestamp)}
                          </span>
                        </div>
                        <div className={listRow}>
                          <span className={listSecondary}>
                            {producer.kind === 'validator' ? (
                              <>
                                Miner{' '}
                                <TypedLink
                                  to={`/chain/${currentChainId}/address/${producer.address}`}
                                  className={listPrimary}
                                  style={{ fontWeight: 'normal' }}
                                >
                                  {formatAddress(producer.address, 4)}
                                </TypedLink>
                              </>
                            ) : (
                              // Honest placeholder instead of a link to the
                              // meaningless zero-address page.
                              'Validator not exposed by this chain’s RPC'
                            )}
                          </span>
                          <span className={listValue}>{block.transactionCount} txns</span>
                        </div>
                        {block.baseFeePerGas && (
                          <div className={listSecondary}>
                            Base fee: {formatFixed(BigInt(block.baseFeePerGas), 9, 4)} Gwei · Size:{' '}
                            {formatNumber(block.sizeBytes ?? 0)} B
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <TypedLink to={`/chain/${currentChainId}/blocks`} className={viewAllLink}>
                  View all blocks →
                </TypedLink>
              </CardContent>
            </Card>

            {/* Latest Transactions */}
            <Card>
              <CardHeader>
                <div className={cardHeaderRow}>
                  <CardTitle>Latest Transactions</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {/* Independent of the blocks column: skeleton rows only
                    while THIS feed's first fetch runs. */}
                {transactionsFeed.loading && <FeedSkeletonRows rows={HOME_FEED_SKELETON_ROWS} />}
                {!transactionsFeed.loading && transactions.map(tx => (
                  <div key={tx.hash} className={listItem}>
                    <div className={listIcon}>Tx</div>
                    <div className={listBody}>
                      <div className={listRow}>
                        <TypedLink
                          to={`/chain/${currentChainId}/tx/${tx.hash}`}
                          className={listPrimary}
                        >
                          {formatHash(tx.hash, 6)}
                        </TypedLink>
                        <span className={listMeta}>
                          {tx.timestamp
                            ? formatRelativeTime(tx.timestamp)
                            : tx.blockNumber === null
                              ? 'Pending'
                              : `Block ${formatNumber(tx.blockNumber)}`}
                        </span>
                      </div>
                      <div className={listRow}>
                        <span className={listSecondary}>
                          From{' '}
                          <TypedLink
                            to={`/chain/${currentChainId}/address/${tx.fromAddress}`}
                            className={listPrimary}
                            style={{ fontWeight: 'normal' }}
                          >
                            {formatAddress(tx.fromAddress, 4)}
                          </TypedLink>
                          {tx.toAddress && (
                            <>
                              {' → '}
                              <TypedLink
                                to={`/chain/${currentChainId}/address/${tx.toAddress}`}
                                className={listPrimary}
                                style={{ fontWeight: 'normal' }}
                              >
                                {formatAddress(tx.toAddress, 4)}
                              </TypedLink>
                            </>
                          )}
                        </span>
                      </div>
                      <div className={listRow}>
                        <span className={listValue}>{formatValue(BigInt(tx.value), symbol)}</span>
                        {tx.gasUsed && tx.effectiveGasPrice && (
                          <span className={listSecondary}>
                            Fee:{' '}
                            {formatFixed(BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 18, 6)}{' '}
                            {symbol}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {!transactionsFeed.loading && transactions.length === 0 && (
                  <div className={listSecondary} style={{ padding: '20px 0', textAlign: 'center' }}>
                    No transactions in recent blocks
                  </div>
                )}
                <TypedLink to={`/chain/${currentChainId}/transactions`} className={viewAllLink}>
                  View all transactions →
                </TypedLink>
              </CardContent>
            </Card>
          </div>
        )}
      </PageContainer>
    </>
  );
}
