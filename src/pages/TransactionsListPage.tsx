import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getChainInfo, getChainName, getChainSymbol } from '../config/chains';
import TopNavigation from '../components/TopNavigation';
import { formatNumber, formatRelativeTime } from '@/utils/format';
import { getLatestTransactions, type RpcTransaction } from '@/utils/blockRpcData';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { DataTable, Pagination, linkStyle, monoStyle } from '@/components/ui/DataTable';
import { TableSkeleton } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Badge } from '@/components/ui/Badge';
import { CopyableHash } from '@/components/ui/CopyableHash';

export default function TransactionsListPage() {
  const { chainId } = useParams<{ chainId: string }>();
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<RpcTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [latestBlockNumber, setLatestBlockNumber] = useState<bigint | null>(null);
  const limit = 20;

  const currentChainId = parseInt(chainId ?? '1');
  const chainInfo = getChainInfo(currentChainId);
  const symbol = getChainSymbol(currentChainId);

  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const beforeBlock =
        latestBlockNumber && page > 1 ? latestBlockNumber - BigInt((page - 1) * 5) : undefined;

      const result = await getLatestTransactions(currentChainId, limit, beforeBlock);
      setTransactions(result.transactions);
      if (page === 1) {
        setLatestBlockNumber(result.latestBlockNumber);
      }
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch transactions');
    } finally {
      setLoading(false);
    }
  }, [currentChainId, page, latestBlockNumber]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const handleChainChange = (newChainId: number) => {
    navigate(`/chain/${newChainId}/transactions`, { replace: true });
  };

  const formatHash = (hash: string) => {
    if (!hash || hash.length < 16) return hash;
    return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
  };

  const formatAddr = (addr: string) => {
    if (!addr || addr.length < 10) return addr || 'N/A';
    return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
  };

  const formatValue = (value: string) => {
    try {
      const valueInEth = parseFloat(value) / Math.pow(10, 18);
      if (valueInEth === 0) return `0 ${symbol}`;
      if (valueInEth < 0.0001) return `<0.0001 ${symbol}`;
      return `${valueInEth.toFixed(4)} ${symbol}`;
    } catch {
      return `${value} wei`;
    }
  };

  if (!chainInfo) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <PageContainer>
          <ErrorState message={`Unsupported chain ID: ${chainId}`} />
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

        {error && <ErrorState message={error} onRetry={fetchTransactions} />}

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
                    <Link
                      to={`/chain/${currentChainId}/block/${tx.blockNumber}`}
                      className={linkStyle}
                    >
                      {formatNumber(parseInt(tx.blockNumber))}
                    </Link>
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
                  <td className={monoStyle}>{formatValue(tx.value)}</td>
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
            pageInfo={`Page ${page}${latestBlockNumber !== null ? ` • Latest block: ${formatNumber(Number(latestBlockNumber))}` : ''}`}
            hasPrev={page > 1}
            hasNext={transactions.length >= limit}
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
