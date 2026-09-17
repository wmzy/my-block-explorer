import { useEffect } from 'react';
import { css } from '@linaria/core';
import { Alert } from 'haze-ui';
import { TypedLink, useMatched } from '@native-router/react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import TopNavigation from '@/components/TopNavigation';
import { getChainInfo, getChainSymbol } from '@/config/chains';
import {
  formatNumber,
  formatAddress,
  formatHash,
  formatRelativeTime,
  formatEth,
} from '@/utils/format';
import { PageContainer } from '@/components/ui/PageLayout';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { useLatestBlocksFeed, useLatestTransactionsFeed } from '@/services/homeFeed';
import { redirectReplace, rememberChainId, resolveLandingChainPath } from './Landing';

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

// --- component ---

export default function Home() {
  const { params, router } = useMatched();

  const currentChainId = params.chainId ? parseInt(params.chainId, 10) : 1;
  const chainInfo = getChainInfo(currentChainId);
  const symbol = getChainSymbol(currentChainId);

  const blocksFeed = useLatestBlocksFeed(currentChainId);
  const transactionsFeed = useLatestTransactionsFeed(currentChainId);

  const blocks = blocksFeed.data?.blocks ?? [];
  const latestBlockNumber = blocksFeed.data?.latestBlockNumber ?? null;
  const gasPrice = blocksFeed.data?.gasPrice ?? null;
  const transactions = transactionsFeed.data ?? [];
  // Old page showed the loading banner until the initial fetch of both
  // lists settled.
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

  // Unknown chain: replace the bad entry with the landing target
  // (remembered valid chain, else preferred chain) instead of pushing on
  // top of it, so the back button never resurfaces the unknown chain.
  useEffect(() => {
    if (!chainInfo) {
      redirectReplace(router, resolveLandingChainPath()).catch(() => undefined);
    }
  }, [chainInfo, router]);

  // Chain switches replace the current entry (shared Wave A helper) so
  // hopping between chains never pile up history entries.
  const handleChainChange = (newChainId: number) => {
    void redirectReplace(router, `/chain/${newChainId}`).catch(() => undefined);
  };

  if (!chainInfo) return null;

  const gasUsedPercent = blocks[0]
    ? ((Number(blocks[0].gasUsed) / Number(blocks[0].gasLimit)) * 100).toFixed(1)
    : null;

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <PageContainer>
        <div className={hero}>
          <h1 className={titleStyle}>{chainInfo.name} Explorer</h1>
          <p className={subtitleStyle}>
            Chain ID: {chainInfo.id} · {symbol}
          </p>
        </div>

        {/* Stats bar */}
        <div className={statsBar}>
          <Card className={statItem}>
            <div className={statValueStyle}>
              {latestBlockNumber !== null ? formatNumber(latestBlockNumber) : '—'}
            </div>
            <div className={statLabelStyle}>Latest Block</div>
          </Card>
          <Card className={statItem}>
            <div className={statValueStyle}>
              {gasPrice !== null ? `${formatFixed(gasPrice, 9, 2)} Gwei` : '—'}
            </div>
            <div className={statLabelStyle}>Gas Price</div>
          </Card>
          <Card className={statItem}>
            <div className={statValueStyle}>
              {blocks[0] ? formatNumber(blocks[0].transactionCount) : '—'}
            </div>
            <div className={statLabelStyle}>Txns in Latest Block</div>
          </Card>
          <Card className={statItem}>
            <div className={statValueStyle}>
              {gasUsedPercent !== null ? `${gasUsedPercent}%` : '—'}
            </div>
            <div className={statLabelStyle}>Gas Used (latest block)</div>
          </Card>
        </div>

        {/* Stale branch: fetch failing but old data still on screen */}
        {showStaleBanner && lastUpdatedAt !== undefined && (
          <Alert variant="warning">
            <div className={staleBannerRow}>
              <span>
                Live data unavailable — showing data from{' '}
                {formatRelativeTime(lastUpdatedAt)}
              </span>
              <Button variant="outline" size="sm" onClick={handleRetry}>
                Retry
              </Button>
            </div>
          </Alert>
        )}

        {loading && <LoadingState message="Loading blockchain data..." />}

        {/* Dead branch: fetch failing and nothing ever fetched */}
        {!loading && showFatalError && (
          <ErrorState
            message="Live data is unavailable and no previous data to show."
            onRetry={handleRetry}
          />
        )}

        {!loading && !showFatalError && (
          <div className={columnsLayout}>
            {/* Latest Blocks */}
            <Card>
              <CardHeader>
                <div className={cardHeaderRow}>
                  <CardTitle>Latest Blocks</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {blocks.map(block => (
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
                        <span className={listMeta}>{formatRelativeTime(block.timestamp)}</span>
                      </div>
                      <div className={listRow}>
                        <span className={listSecondary}>
                          Miner{' '}
                          <TypedLink
                            to={`/chain/${currentChainId}/address/${block.miner}`}
                            className={listPrimary}
                            style={{ fontWeight: 'normal' }}
                          >
                            {formatAddress(block.miner, 4)}
                          </TypedLink>
                        </span>
                        <span className={listValue}>{block.transactionCount} txns</span>
                      </div>
                      {block.baseFeePerGas && (
                        <div className={listSecondary}>
                          Base fee: {formatFixed(BigInt(block.baseFeePerGas), 9, 4)} Gwei ·
                          Size: {formatNumber(block.sizeBytes ?? 0)} B
                        </div>
                      )}
                    </div>
                  </div>
                ))}
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
                {transactions.map(tx => (
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
                        <span className={listValue}>
                          {formatEth(tx.value)} {symbol}
                        </span>
                        {tx.gasUsed && tx.effectiveGasPrice && (
                          <span className={listSecondary}>
                            Fee:{' '}
                            {formatFixed(
                              BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice),
                              18,
                              6,
                            )}{' '}
                            {symbol}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {transactions.length === 0 && (
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
