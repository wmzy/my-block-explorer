import { useState } from 'react';
import { navigate } from '@native-router/core';
import { TypedLink, useMatched } from '@native-router/react';

import TopNavigation from '@/components/TopNavigation';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { DataTable, Pagination, linkStyle, monoStyle } from '@/components/ui/DataTable';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState, TableSkeleton } from '@/components/ui/LoadingState';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { getChainInfo, getChainName } from '@/config/chains';
import { useLatestBlocks } from '@/services/chainRpc';
import { formatNumber, formatRelativeTime } from '@/utils/format';

const LIMIT = 20;

const formatGasUsage = (used: string, limit: string): string => {
  try {
    const usedNum = parseInt(used);
    const limitNum = parseInt(limit);
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

  // Cursor pagination via the head entry: the head query (no cursor) doubles
  // as page 1 and yields latestBlockNumber, which page N uses to compute its
  // beforeBlock cursor. Both pages share the per-cursor cache entries.
  const headQuery = useLatestBlocks(currentChainId, LIMIT);
  const latestBlockNumber = headQuery.data?.latestBlockNumber ?? null;
  const beforeBlock =
    latestBlockNumber !== null && page > 1
      ? latestBlockNumber - BigInt((page - 1) * LIMIT) + 1n
      : undefined;
  const pageQuery = useLatestBlocks(currentChainId, LIMIT, beforeBlock);

  const query = page === 1 ? headQuery : pageQuery;
  const { data, loading, error, refetch } = query;
  const blocks = data?.blocks ?? [];

  const handleChainChange = (newChainId: number) => {
    void navigate(router, `/chain/${newChainId}/blocks`).catch(() => undefined);
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
          title="Blocks"
          chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
        />

        {loading && <TableSkeleton rows={10} cols={5} />}

        {error && (
          <ErrorState
            message={error instanceof Error ? error.message : 'Failed to fetch blocks'}
            onRetry={refetch}
          />
        )}

        {!loading && !error && blocks.length === 0 && <LoadingState message="No blocks found" />}

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
                      {formatNumber(parseInt(block.number))}
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
              latestBlockNumber !== null
                ? ` • Latest block: ${formatNumber(Number(latestBlockNumber))}`
                : ''
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
