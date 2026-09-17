import { useEffect, useState } from 'react';
import { css } from '@linaria/core';
import { TypedLink, useMatched, useSearch } from '@native-router/react';
import { z } from 'zod';

import TopNavigation from '@/components/TopNavigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { DataTable, Pagination, linkStyle, monoStyle } from '@/components/ui/DataTable';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/LoadingState';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { getChainInfo, getChainName, getChainSymbol } from '@/config/chains';
import { redirectReplace } from '@/views/Home/Landing';
import { useLatestTransactions } from '@/services/chainRpc';
import { txCursorFromBlock } from '@/utils/blockRpcData';
import { formatEth, formatNumber, formatRelativeTime } from '@/utils/format';

const LIMIT = 20;

// Header row: the page title on the left, the Refresh control on the right
// (re-anchors the walk at the live chain head).
const listToolbar = css`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--haze-space-3);
`;

// Optional ?block=N deep link: the list starts at block N and pages down.
const searchSchema = z.object({
  block: z.coerce.number().int().min(0).optional().catch(undefined),
});

const formatHash = (hash: string): string => {
  if (!hash || hash.length < 16) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
};

const formatAddr = (addr: string): string => {
  if (!addr || addr.length < 10) return addr || 'N/A';
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
};

const formatValue = (value: string, symbol: string): string => {
  try {
    const wei = BigInt(value);
    if (wei === 0n) return `0 ${symbol}`;
    // 0.0001 ETH in integer wei — the display floor, compared exactly.
    if (wei < 10n ** 14n) return `<0.0001 ${symbol}`;
    return `${formatEth(wei, 4)} ${symbol}`;
  } catch {
    return `${value} wei`;
  }
};

// status: 1 → success, 0 → failed, -1 → pending (no receipt yet, NOT failed).
function TxStatusBadge({ status }: { status: number }) {
  if (status === 1) {
    return (
      <Badge variant="success" size="sm">
        Success
      </Badge>
    );
  }
  if (status === 0) {
    return (
      <Badge variant="error" size="sm">
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="default" size="sm">
      Pending
    </Badge>
  );
}

export default function TransactionsList() {
  const { params, router } = useMatched();
  const { block: blockParam } = useSearch(searchSchema);
  const [page, setPage] = useState(1);

  const currentChainId = Number.parseInt(params.chainId ?? '1', 10);
  const chainInfo = getChainInfo(currentChainId);
  const symbol = getChainSymbol(currentChainId);

  // Cursor pagination: page 1 is the head — or the ?block=N deep-link seed
  // (cursor = (N+1, 0): start at block N and walk down); every older page
  // resumes from the nextCursor its predecessor returned, so pages tile the
  // (blockNumber, transactionIndex) sequence with no duplicate and no gap.
  const initialCursor = blockParam !== undefined ? txCursorFromBlock(blockParam) : undefined;
  const [cursorStack, setCursorStack] = useState<readonly (bigint | undefined)[]>([
    initialCursor,
  ]);

  // The deep link seeds page 1 only; a changed ?block param re-seeds the
  // walk. Functional updates keep the mount pass a no-op.
  useEffect(() => {
    setCursorStack(prev => (prev[0] === initialCursor ? prev : [initialCursor]));
    setPage(prev => (prev === 1 ? prev : 1));
  }, [initialCursor]);

  // Head entry (no cursor): the Refresh vehicle. Its key never changes, so
  // headQuery.refetch() always targets the live head, and page 1 at the
  // head rides this instance so the refetched answer is displayed
  // immediately (a second hook instance on the same key would settle on its
  // own stores — see the polledQuery.ts header).
  const headQuery = useLatestTransactions(currentChainId, LIMIT);

  const pageCursor = cursorStack[page - 1];
  const pageQuery = useLatestTransactions(currentChainId, LIMIT, pageCursor);
  const query = page === 1 && pageCursor === undefined ? headQuery : pageQuery;
  const { data, loading, error, refetch } = query;
  const transactions = data?.transactions ?? [];

  const goOlder = () => {
    const next = data?.nextCursor;
    if (next === undefined) return;
    setCursorStack(prev => (prev.length > page ? prev : [...prev, next]));
    setPage(prev => prev + 1);
  };

  // Refresh re-anchors the walk at the live head (Blocks/List semantics):
  // truncate the cursor stack — page 1 becomes the live head again,
  // dropping any ?block= seed and every stale continuation cursor — and
  // refetch the head entry bypassing its cache slot. Older then resumes
  // from the refreshed head's own nextCursor.
  const handleRefresh = () => {
    setCursorStack([undefined]);
    setPage(1);
    void headQuery.refetch();
  };

  // Chain switches replace the current entry via the shared Wave A helper;
  // the list legitimately drops a ?block= deep-link param on switch (the
  // seeded block belongs to the old chain).
  const handleChainChange = (newChainId: number) => {
    void redirectReplace(router, `/chain/${newChainId}/transactions`).catch(() => undefined);
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
            title="Transactions"
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

        {loading && <TableSkeleton rows={10} cols={7} />}

        {error && (
          <ErrorState
            message={error instanceof Error ? error.message : 'Failed to fetch transactions'}
            onRetry={refetch}
          />
        )}

        {!loading && !error && transactions.length === 0 && (
          <ErrorState
            message={
              data?.hasMore === true
                ? 'No transactions in the scanned range — go older to continue'
                : 'No transactions found'
            }
          />
        )}

        {transactions.length > 0 && (
          <DataTable>
            <thead>
              <tr>
                <th>Txn Hash</th>
                <th>Block</th>
                <th>Age</th>
                <th>From</th>
                <th>To</th>
                <th>Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(tx => (
                <tr key={tx.hash}>
                  <td>
                    <CopyableHash
                      value={tx.hash}
                      truncated={formatHash(tx.hash)}
                      href={`/chain/${currentChainId}/tx/${tx.hash}`}
                    />
                  </td>
                  <td>
                    <TypedLink
                      to={`/chain/${currentChainId}/block/${tx.blockNumber}`}
                      className={linkStyle}
                    >
                      {formatNumber(BigInt(tx.blockNumber))}
                    </TypedLink>
                  </td>
                  <td>{tx.timestamp ? formatRelativeTime(tx.timestamp) : 'N/A'}</td>
                  <td>
                    <CopyableHash
                      value={tx.fromAddress}
                      truncated={formatAddr(tx.fromAddress)}
                      href={`/chain/${currentChainId}/address/${tx.fromAddress}`}
                    />
                  </td>
                  <td>
                    <CopyableHash
                      value={tx.toAddress}
                      truncated={formatAddr(tx.toAddress)}
                      href={`/chain/${currentChainId}/address/${tx.toAddress}`}
                    />
                  </td>
                  <td className={monoStyle}>{formatValue(tx.value, symbol)}</td>
                  <td>
                    <TxStatusBadge status={tx.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}

        {(transactions.length > 0 || data?.hasMore === true) && (
          <Pagination
            page={page}
            pageInfo={`Page ${page}${
              data?.latestBlockNumber !== undefined
                ? ` • Latest block: ${formatNumber(data.latestBlockNumber)}`
                : ''
            }`}
            hasPrev={page > 1}
            hasNext={data?.hasMore === true}
            onPrev={() => setPage(prev => Math.max(1, prev - 1))}
            onNext={goOlder}
            prevLabel="Newer"
            nextLabel="Older"
          />
        )}
      </PageContainer>
    </>
  );
}
