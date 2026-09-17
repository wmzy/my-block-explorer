import { useEffect, useState } from 'react';
import { css } from '@linaria/core';
import { TypedLink, useMatched } from '@native-router/react';

import TopNavigation from '@/components/TopNavigation';
import { Button } from '@/components/ui/Button';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { DataTable, Pagination, linkStyle, monoStyle } from '@/components/ui/DataTable';
import { EmptyState, ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/LoadingState';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { getChainInfo, getChainName } from '@/config/chains';
import { redirectReplace } from '@/views/Home/Landing';
import { useLatestBlocks } from '@/services/chainRpc';
import { formatNumber, formatRelativeTime } from '@/utils/format';

const LIMIT = 20;

// Header row: the page title on the left, the pagination Refresh control
// on the right (re-anchors the walk at the live chain head).
const listToolbar = css`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--haze-space-3);
`;

// Gas quantities are on-chain integers serialized as strings; parse them
// BigInt-safe (parseInt would lose precision past 2^53).
const formatGasUsage = (used: string, limit: string): string => {
  try {
    const usedNum = Number(BigInt(used));
    const limitNum = Number(BigInt(limit));
    const percentage = ((usedNum / limitNum) * 100).toFixed(1);
    return `${formatNumber(usedNum)} (${percentage}%)`;
  } catch {
    return used;
  }
};

const formatMiner = (miner: string): string => {
  if (!miner || miner.length < 10) return miner;
  return `${miner.slice(0, 8)}...${miner.slice(-6)}`;
};

export default function BlocksList() {
  const { params, router } = useMatched();
  const [page, setPage] = useState(1);

  const currentChainId = Number.parseInt(params.chainId ?? '1', 10);
  const chainInfo = getChainInfo(currentChainId);

  // Pagination anchor: the chain head observed when the list was first
  // loaded for the current chain (or when Refresh was last clicked). The
  // head entry keeps revalidating in the background (focus/reconnect), but
  // every page cursor derives from this frozen value, so blocks mined while
  // the user pages never shift page contents under them.
  // `at` records the dataUpdatedAt of the head answer the anchor was taken
  // from — it distinguishes "the answer Refresh is waiting for" from the
  // one already frozen.
  const [anchor, setAnchor] = useState<{ chainId: number; head: bigint; at: number } | null>(
    null,
  );
  const [reanchorPending, setReanchorPending] = useState(false);

  // Head entry (no cursor): the anchor source. Its cached per-cursor entry
  // is shared with nothing — once an anchor exists all pages go through
  // anchored cursors below.
  const headQuery = useLatestBlocks(currentChainId, LIMIT);
  const latestBlockNumber = headQuery.data?.latestBlockNumber ?? null;
  const headUpdatedAt = headQuery.dataUpdatedAt;

  const anchored = anchor !== null && anchor.chainId === currentChainId ? anchor : null;

  // Anchor adoption: the first head answer for the current chain, or —
  // while a Refresh is pending — the first strictly newer head answer.
  // Plain background revalidation never re-anchors; only Refresh (below)
  // sets the pending flag.
  useEffect(() => {
    if (latestBlockNumber === null || headUpdatedAt === undefined) return;
    // A fresh frame starts at page 1 (covers a chain switch from deep in
    // the old chain's list).
    const adopt = () => {
      setAnchor({ chainId: currentChainId, head: latestBlockNumber, at: headUpdatedAt });
      setReanchorPending(false);
      setPage(1);
    };
    if (anchored === null) {
      adopt();
      return;
    }
    if (reanchorPending && anchored.at < headUpdatedAt) adopt();
  }, [anchored, reanchorPending, latestBlockNumber, headUpdatedAt, currentChainId]);

  // Every page cursor derives from the anchor (cursor = exclusive upper
  // bound): page N covers the LIMIT blocks ending at
  // anchoredHead - (N-1)*LIMIT. Page 1 therefore uses cursor
  // anchoredHead + 1 — the same blocks the head entry returned, but under
  // a frozen key that background revalidation of the head cannot shift.
  // Pre-anchor (first load) page 1 rides the head entry itself.
  const beforeBlock =
    anchored !== null ? anchored.head - BigInt((page - 1) * LIMIT) + 1n : undefined;
  const pageQuery = useLatestBlocks(currentChainId, LIMIT, beforeBlock);

  const query = page === 1 && anchored === null ? headQuery : pageQuery;
  const { data, loading, error, refetch } = query;
  const blocks = data?.blocks ?? [];

  // The frame's head for the pagination label: the frozen anchor once set
  // (it bounds the walk), else the live head.
  const frameHead = anchored?.head ?? latestBlockNumber;

  // Refresh re-anchors the walk at the live head: refetch the head entry
  // (bypassing its cache slot) and adopt the first newer answer; the page
  // restarts immediately while the refetch is in flight.
  const handleRefresh = () => {
    setPage(1);
    setReanchorPending(true);
    void headQuery.refetch();
  };

  // Chain switches replace the current entry (shared Wave A helper); the
  // list has no params worth keeping.
  const handleChainChange = (newChainId: number) => {
    void redirectReplace(router, `/chain/${newChainId}/blocks`).catch(() => undefined);
  };

  if (!chainInfo) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <PageContainer>
          <ErrorState message={`Unsupported chain ID: ${params.chainId ?? ''}`} />
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <PageContainer>
        <div className={listToolbar}>
          <PageHeader
            title="Blocks"
            chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={headQuery.fetching}
          >
            {headQuery.fetching ? 'Refreshing…' : '↻ Refresh'}
          </Button>
        </div>

        {loading && <TableSkeleton rows={10} cols={5} />}

        {error && (
          <ErrorState
            message={error instanceof Error ? error.message : 'Failed to fetch blocks'}
            onRetry={refetch}
          />
        )}

        {!loading && !error && blocks.length === 0 && <EmptyState message="No blocks found" />}

        {blocks.length > 0 && (
          <DataTable>
            <thead>
              <tr>
                <th>Block</th>
                <th>Age</th>
                <th>Txn</th>
                <th>Gas Used</th>
                <th>Miner</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map(block => (
                <tr key={block.number}>
                  <td>
                    <TypedLink
                      to={`/chain/${currentChainId}/block/${block.number}`}
                      className={linkStyle}
                    >
                      {formatNumber(BigInt(block.number))}
                    </TypedLink>
                  </td>
                  <td>{block.timestamp ? formatRelativeTime(block.timestamp) : 'N/A'}</td>
                  <td>{block.transactionCount}</td>
                  <td className={monoStyle}>{formatGasUsage(block.gasUsed, block.gasLimit)}</td>
                  <td>
                    <CopyableHash
                      value={block.miner}
                      truncated={formatMiner(block.miner)}
                      href={`/chain/${currentChainId}/address/${block.miner}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}

        {blocks.length > 0 && (
          <Pagination
            page={page}
            pageInfo={`Page ${page}${
              frameHead !== null ? ` • Latest block: ${formatNumber(Number(frameHead))}` : ''
            }`}
            hasPrev={page > 1}
            hasNext={blocks.length >= LIMIT}
            onPrev={() => setPage(p => Math.max(1, p - 1))}
            onNext={() => setPage(p => p + 1)}
            prevLabel="Newer"
            nextLabel="Older"
          />
        )}
      </PageContainer>
    </>
  );
}
