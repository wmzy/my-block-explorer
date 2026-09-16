import { useState } from 'react';
import { navigate } from '@native-router/core';
import { TypedLink, useMatched } from '@native-router/react';

import TopNavigation from '@/components/TopNavigation';
import { Badge } from '@/components/ui/Badge';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { DataTable, Pagination, linkStyle, monoStyle } from '@/components/ui/DataTable';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/LoadingState';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { getChainInfo, getChainName, getChainSymbol } from '@/config/chains';
import { useLatestTransactions } from '@/services/chainRpc';
import { formatNumber, formatRelativeTime } from '@/utils/format';

const LIMIT = 20;
// 5-block cursor stride per page, matching the old RPC walk.
const PAGE_STRIDE = 5;

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
    const valueInEth = parseFloat(value) / Math.pow(10, 18);
    if (valueInEth === 0) return `0 ${symbol}`;
    if (valueInEth < 0.0001) return `<0.0001 ${symbol}`;
    return `${valueInEth.toFixed(4)} ${symbol}`;
  } catch {
    return `${value} wei`;
  }
};

export default function TransactionsList() {
  const { params, router } = useMatched();
  const [page, setPage] = useState(1);

  const currentChainId = Number.parseInt(params.chainId ?? '1', 10);
  const chainInfo = getChainInfo(currentChainId);
  const symbol = getChainSymbol(currentChainId);

  // Cursor pagination via the head entry (same two-query pattern as the
  // blocks list; see Blocks/List.tsx).
  const headQuery = useLatestTransactions(currentChainId, LIMIT);
  const latestBlockNumber = headQuery.data?.latestBlockNumber ?? null;
  const beforeBlock =
    latestBlockNumber !== null && page > 1
      ? latestBlockNumber - BigInt((page - 1) * PAGE_STRIDE)
      : undefined;
  const pageQuery = useLatestTransactions(currentChainId, LIMIT, beforeBlock);

  const query = page === 1 ? headQuery : pageQuery;
  const { data, loading, error, refetch } = query;
  const transactions = data?.transactions ?? [];

  const handleChainChange = (newChainId: number) => {
    void navigate(router, `/chain/${newChainId}/transactions`).catch(() => undefined);
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
        <PageHeader
          title="Transactions"
          chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
        />

        {loading && <TableSkeleton rows={10} cols={7} />}

        {error && (
          <ErrorState
            message={error instanceof Error ? error.message : 'Failed to fetch transactions'}
            onRetry={refetch}
          />
        )}

        {!loading && !error && transactions.length === 0 && (
          <ErrorState message="No transactions found" />
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
                      {formatNumber(parseInt(tx.blockNumber))}
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
                    <Badge variant={tx.status === 1 ? 'success' : 'error'} size="sm">
                      {tx.status === 1 ? 'Success' : 'Failed'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}

        {transactions.length > 0 && (
          <Pagination
            page={page}
            pageInfo={`Page ${page}${
              latestBlockNumber !== null
                ? ` • Latest block: ${formatNumber(Number(latestBlockNumber))}`
                : ''
            }`}
            hasPrev={page > 1}
            hasNext={transactions.length >= LIMIT}
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
