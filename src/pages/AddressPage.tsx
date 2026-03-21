import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { css } from '@linaria/core';
import { getChainInfo, getChainName, getChainSymbol } from '../config/chains';
import TopNavigation from '../components/TopNavigation';
import { useAddressData } from '../hooks/useAddressData';
import { formatRelativeTime } from '@/utils/format';
import { PageContainer, PageHeader, BackButton } from '@/components/ui/PageLayout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { InfoGrid, InfoItem } from '@/components/ui/InfoGrid';
import { DataTable, Pagination, linkStyle } from '@/components/ui/DataTable';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { Alert } from 'haze-ui';

const headerRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--haze-space-4);
`;

const infoNote = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  margin-bottom: var(--haze-space-3);
  padding: var(--haze-space-2) var(--haze-space-3);
  background: color-mix(in srgb, var(--haze-color-success) 10%, transparent);
  border-radius: var(--haze-radius-md);
  border: 1px solid color-mix(in srgb, var(--haze-color-success) 25%, transparent);
`;

type TxRecord = {
  hash: string;
  blockNumber: string;
  fromAddress: string;
  toAddress: string;
  value: string;
  status: number;
  timestamp?: string;
};

export default function AddressPage() {
  const { chainId, address } = useParams<{
    chainId: string;
    address: string;
  }>();
  const navigate = useNavigate();

  const currentChainId = parseInt(chainId ?? '1');
  const chainInfo = getChainInfo(currentChainId);

  const addressData = useAddressData(currentChainId, address ?? '');

  const [transactions, setTransactions] = useState<TxRecord[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [txPage, setTxPage] = useState(1);
  const [txTotalPages, setTxTotalPages] = useState(1);
  const [txMethod, setTxMethod] = useState<string>('');
  const [txTotal, setTxTotal] = useState(0);
  const txLimit = 10;

  const fetchTransactions = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!address || !chainId) return;
      try {
        if (!opts?.silent) setTxLoading(true);
        setTxError(null);
        const response = await fetch(
          `/api/chains/${currentChainId}/addresses/${address}/transactions?page=${txPage}&limit=${txLimit}`,
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        setTransactions(data.data ?? data.transactions ?? []);
        setTxMethod(data.method ?? '');
        setTxTotal(data.total ?? data.pagination?.total ?? 0);
        if (data.pagination) {
          setTxTotalPages(data.pagination.totalPages ?? 1);
        }
      }
      catch (err) {
        setTxError(err instanceof Error ? err.message : 'Failed to fetch transactions');
      }
      finally {
        setTxLoading(false);
      }
    },
    [currentChainId, address, txPage],
  );

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const getDirection = (tx: TxRecord) => {
    const lowerAddr = address?.toLowerCase();
    const from = tx.fromAddress?.toLowerCase();
    const to = tx.toAddress?.toLowerCase();
    if (from === lowerAddr && to === lowerAddr) return 'self';
    if (to === lowerAddr) return 'in';
    return 'out';
  };

  const directionVariant = { in: 'success', out: 'error', self: 'info' } as const;
  const directionLabel = { in: 'IN', out: 'OUT', self: 'SELF' } as const;

  const formatAddr = (a: string) => (a ? `${a.slice(0, 8)}...${a.slice(-6)}` : 'N/A');
  const formatHash = (h: string) => (h ? `${h.slice(0, 10)}...${h.slice(-8)}` : '');

  const formatTxValue = (value: string) => {
    const symbol = getChainSymbol(currentChainId);
    try {
      const v = parseFloat(value) / 1e18;
      if (v === 0) return `0 ${symbol}`;
      if (v < 0.0001) return `<0.0001 ${symbol}`;
      return `${v.toFixed(4)} ${symbol}`;
    }
    catch {
      return value;
    }
  };

  const handleChainChange = (newChainId: number) => {
    navigate(`/chain/${newChainId}/address/${address}`, { replace: true });
  };

  const isInitialLoading
    = addressData.loading.persistent
      && addressData.loading.realTime
      && !addressData.persistent
      && !addressData.realTime;
  const hasError = addressData.error.persistent ?? addressData.error.realTime;
  const errorMessage = addressData.error.persistent ?? addressData.error.realTime;
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

  if (!address) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <PageContainer>
          <ErrorState message="Invalid address" />
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <PageContainer>
        <BackButton onClick={() => navigate(`/chain/${currentChainId}`)} />

        <PageHeader
          title="Address Details"
          chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
        />

        {isInitialLoading && <LoadingState message="Loading address information..." />}

        {hasError && !isInitialLoading && <ErrorState message={`Error: ${errorMessage}`} />}

        {!isInitialLoading && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <InfoGrid>
                  <InfoItem label="Address">{address}</InfoItem>

                  <InfoItem label="Balance">
                    {addressData.realTime
                      ? `${addressData.realTime.balance} ${getChainSymbol(currentChainId)}`
                      : addressData.loading.realTime
                        ? 'Loading...'
                        : addressData.error.realTime
                          ? 'Error loading balance'
                          : 'N/A'}
                  </InfoItem>

                  <InfoItem label="Transaction Count">
                    {addressData.realTime
                      ? addressData.realTime.transactionCount.toLocaleString()
                      : addressData.loading.realTime
                        ? 'Loading...'
                        : addressData.error.realTime
                          ? 'Error loading count'
                          : 'N/A'}
                  </InfoItem>

                  <InfoItem label="Type">
                    {addressData.persistent
                      ? addressData.persistent.isContract
                        ? 'Contract'
                        : 'Externally Owned Account (EOA)'
                      : addressData.loading.persistent
                        ? 'Loading...'
                        : 'Unknown'}
                  </InfoItem>

                  {addressData.persistent?.isContract && addressData.persistent.contractName && (
                    <InfoItem label="Contract Name">{addressData.persistent.contractName}</InfoItem>
                  )}

                  {addressData.persistent?.isContract
                    && addressData.persistent.verificationStatus && (
                    <InfoItem label="Verification Status">
                      {addressData.persistent.verificationStatus === 'verified' && 'Verified'}
                      {addressData.persistent.verificationStatus === 'partial'
                        && 'Partially Verified'}
                      {addressData.persistent.verificationStatus === 'unverified' && 'Unverified'}
                    </InfoItem>
                  )}

                  {addressData.persistent?.isContract && (
                    <InfoItem label="Contract">
                      <Link
                        to={`/chain/${currentChainId}/contract/${address}`}
                        className={linkStyle}
                      >
                        View Contract Details →
                      </Link>
                    </InfoItem>
                  )}

                  {addressData.persistent?.contractCreationBlock && (
                    <InfoItem label="Created at Block">
                      {addressData.persistent.contractCreationBlock.toLocaleString()}
                    </InfoItem>
                  )}

                  {addressData.persistent?.contractCreator && (
                    <InfoItem label="Contract Creator">
                      {formatAddr(addressData.persistent.contractCreator)}
                    </InfoItem>
                  )}

                  {addressData.persistent?.isProxy && (
                    <>
                      <InfoItem label="Proxy Type">
                        {addressData.persistent.proxyType ?? 'Standard Proxy'}
                      </InfoItem>
                      {addressData.persistent.implementationAddress && (
                        <InfoItem label="Implementation">
                          {formatAddr(addressData.persistent.implementationAddress)}
                        </InfoItem>
                      )}
                    </>
                  )}

                  {addressData.realTime && (
                    <InfoItem label="Latest Block">
                      {addressData.realTime.latestBlock.toLocaleString()}
                    </InfoItem>
                  )}

                  <InfoItem label="Last Updated">{new Date().toLocaleString()}</InfoItem>
                </InfoGrid>
              </CardContent>
            </Card>

            <Card
              className={css`
                margin-top: var(--haze-space-5);
              `}
            >
              <CardHeader>
                <div className={headerRow}>
                  <CardTitle as="h2">Recent Transactions</CardTitle>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => fetchTransactions()}
                    loading={txLoading}
                  >
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {txLoading && (
                  <LoadingState message="Searching for transactions via binary search..." />
                )}

                {txError && <ErrorState message={txError} />}

                {!txLoading
                  && !txError
                  && transactions.length === 0
                  && txTotal > 0
                  && txMethod === 'binary-search-skipped' && (
                  <Alert variant="info">
                    Cannot discover transactions for this address. This address has
                    {' '}
                    {txTotal}
                    {' '}
                    nonce but 0 native token balance.
                  </Alert>
                )}

                {!txLoading
                  && !txError
                  && transactions.length === 0
                  && txTotal > 0
                  && txMethod !== 'binary-search-skipped' && (
                  <Alert variant="warning">
                    No transactions found in recent blocks. This address has
                    {' '}
                    {txTotal}
                    {' '}
                    transactions, but they may be outside the search range.
                  </Alert>
                )}

                {!txLoading && !txError && transactions.length === 0 && txTotal === 0 && (
                  <Alert variant="info">No transactions found</Alert>
                )}

                {!txLoading && transactions.length > 0 && txMethod === 'binary-search' && (
                  <div className={infoNote}>
                    Found
                    {' '}
                    {transactions.length}
                    {' '}
                    of ~
                    {txTotal}
                    {' '}
                    transactions via balance-change binary
                    search.
                  </div>
                )}

                {transactions.length > 0 && (
                  <>
                    <DataTable>
                      <thead>
                        <tr>
                          <th>Txn Hash</th>
                          <th>Block</th>
                          <th>Age</th>
                          <th>Direction</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((tx) => {
                          const dir = getDirection(tx);
                          return (
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
                                  {parseInt(tx.blockNumber).toLocaleString()}
                                </Link>
                              </td>
                              <td>{tx.timestamp ? formatRelativeTime(tx.timestamp) : 'N/A'}</td>
                              <td>
                                <Badge variant={directionVariant[dir]} size="sm">
                                  {directionLabel[dir]}
                                </Badge>
                              </td>
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
                              <td
                                className={css`
                                  font-family: var(--haze-font-mono);
                                  font-size: var(--haze-text-xs);
                                `}
                              >
                                {formatTxValue(tx.value)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </DataTable>
                    <Pagination
                      page={txPage}
                      pageInfo={`Page ${txPage} of ${txTotalPages}`}
                      hasPrev={txPage > 1}
                      hasNext={txPage < txTotalPages}
                      onPrev={() => setTxPage(p => Math.max(1, p - 1))}
                      onNext={() => setTxPage(p => p + 1)}
                    />
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </PageContainer>
    </>
  );
}
