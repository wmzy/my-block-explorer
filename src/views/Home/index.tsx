import { useEffect } from 'react';
import { css, cx } from '@linaria/core';
import { Alert } from 'haze-ui';
import { TypedLink, useMatched } from '@native-router/react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
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
import { useLatestBlocksFeed, useLatestTransactionsFeed } from '@/services/homeFeed';
import { describeBlockProducer } from '@/utils/blockRpcData';
import { redirectReplace, rememberChainId } from './Landing';
import { UnsupportedChainState } from './UnsupportedChainState';

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
`;

// Message + Retry row inside the stale-data warning alert.
const staleBannerRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
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

  const blocks = blocksFeed.data?.blocks ?? [];
  const latestBlockNumber = blocksFeed.data?.latestBlockNumber ?? null;
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
