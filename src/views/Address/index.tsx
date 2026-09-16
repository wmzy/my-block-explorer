import { useState } from 'react';
import { css } from '@linaria/core';
import { TypedLink, useMatched } from '@native-router/react';
import { navigate } from '@native-router/core';
import { formatUnits } from 'viem';
import { Alert } from 'haze-ui';
import { getChainInfo, getChainName, getChainSymbol } from '@/config/chains';
import TopNavigation from '@/components/TopNavigation';
import { useAddressInfo, useAddressTransactions } from '@/services/addresses';
import {
  useContractCode,
  useRealTimeAddressData,
} from '@/services/addressRealTime';
import { formatRelativeTime } from '@/utils/format';
import { getExternalToolLinks } from '@/config/externalTools';
import { PageContainer, PageHeader, BackButton } from '@/components/ui/PageLayout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { InfoGrid, InfoItem } from '@/components/ui/InfoGrid';
import { DataTable, Pagination, linkStyle } from '@/components/ui/DataTable';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { ExternalLinks } from '@/components/ui/ExternalLinks';

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

const transactionsCard = css`
  margin-top: var(--haze-space-5);
`;

const valueCell = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
`;

// Serialized transaction row as the API returns it (formatTransactionForApi):
// numeric fields arrive as strings over JSON.
type TxRecord = {
  hash: string;
  blockNumber: string;
  fromAddress: string;
  toAddress: string;
  value: string;
  status: number;
  timestamp?: string;
};

// The services layer types this endpoint loosely (AddressInfo from
// @/types); the server actually responds with a wrapper whose `address`
// member carries the persistent fields (isContract, contractName,
// verificationStatus, creation/proxy info). The view reads through these
// runtime shapes instead.
type AddressInfoEnvelope = {
  address?: {
    isContract: boolean;
    contractName?: string;
    verificationStatus?: 'verified' | 'unverified' | 'partial';
    contractCreationBlock?: number;
    contractCreator?: string;
    isProxy?: boolean;
    proxyType?: string;
    implementationAddress?: string;
  };
};

type AddressTxPage = {
  transactions: TxRecord[];
  total: number;
  method?: string;
};

export default function Address() {
  const { params, router } = useMatched();

  const currentChainId = Number.parseInt(params.chainId ?? '1', 10);
  const chainInfo = getChainInfo(currentChainId);
  const address = params.address ?? '';

  // All hooks run before the guard returns below (rules of hooks); invalid
  // args are gated inside the service fetches (zero network).
  const infoQuery = useAddressInfo(currentChainId, address);
  const realTimeQuery = useRealTimeAddressData(currentChainId, address);
  // Contract-code fallback: when the persistent channel fails, the code
  // read still decides Contract vs EOA (the old hook's fallback path).
  // Costs one extra eth_getCode per address view; cached 24h.
  const codeQuery = useContractCode(currentChainId, address);

  const [txPage, setTxPage] = useState(1);
  const txLimit = 10;
  const txQuery = useAddressTransactions(
    currentChainId,
    address,
    txLimit,
    (txPage - 1) * txLimit,
  );

  const persistent =
    (infoQuery.data as AddressInfoEnvelope | undefined)?.address;
  const code = codeQuery.data;
  // Persistent record wins; the RPC code read only decides when the
  // persistent channel settled without data.
  const isContract = persistent
    ? persistent.isContract
    : code !== undefined
      ? Boolean(code && code !== '0x' && code.length > 2)
      : undefined;

  // Old error semantics: the persistent error only surfaces when the code
  // fallback failed too; the realtime error surfaces on its own.
  const persistentError =
    infoQuery.error !== undefined && codeQuery.error !== undefined
      ? infoQuery.error
      : undefined;
  const hasError = persistentError ?? realTimeQuery.error;
  const errorMessage =
    persistentError?.message ?? realTimeQuery.error?.message;

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

  // BigInt-safe block number display; falls back to the raw string when a
  // row arrives without a parseable number (pending txs).
  const formatBlockNumber = (n: string) => {
    try {
      return Number(BigInt(n)).toLocaleString();
    } catch {
      return n;
    }
  };

  const formatTxValue = (value: string) => {
    const symbol = getChainSymbol(currentChainId);
    try {
      // BigInt-safe wei → whole-token conversion honoring the chain's
      // native-currency decimals (most are 18; parseFloat/1e18 would both
      // hardcode the wrong divisor and lose precision past 2^53).
      const decimals = chainInfo?.nativeCurrency.decimals ?? 18;
      const v = Number(formatUnits(BigInt(value), decimals));
      if (v === 0) return `0 ${symbol}`;
      if (v < 0.0001) return `<0.0001 ${symbol}`;
      return `${v.toFixed(4)} ${symbol}`;
    } catch {
      return value;
    }
  };

  // Native-router navigate has no replace mode from views — the chain
  // switch pushes a history entry (the old page replaced it).
  const handleChainChange = (newChainId: number) => {
    void navigate(router, `/chain/${newChainId}/address/${address}`).catch(
      () => undefined,
    );
  };

  const isInitialLoading =
    infoQuery.loading &&
    realTimeQuery.loading &&
    !infoQuery.data &&
    !realTimeQuery.data;

  if (!chainInfo) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <PageContainer>
          <ErrorState message={`Unsupported chain ID: ${params.chainId}`} />
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

  const txData = txQuery.data as AddressTxPage | undefined;
  const transactions = txData?.transactions ?? [];
  const txTotal = txData?.total ?? 0;
  const txMethod = txData?.method ?? '';
  const txTotalPages = Math.max(1, Math.ceil(txTotal / txLimit));

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <PageContainer>
        <BackButton
          onClick={() => {
            void navigate(router, `/chain/${currentChainId}`).catch(() => undefined);
          }}
        />

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
                    {realTimeQuery.data
                      ? `${realTimeQuery.data.balance} ${getChainSymbol(currentChainId)}`
                      : realTimeQuery.loading
                        ? 'Loading...'
                        : realTimeQuery.error
                          ? 'Error loading balance'
                          : 'N/A'}
                  </InfoItem>

                  <InfoItem label="Transaction Count">
                    {realTimeQuery.data
                      ? realTimeQuery.data.transactionCount.toLocaleString()
                      : realTimeQuery.loading
                        ? 'Loading...'
                        : realTimeQuery.error
                          ? 'Error loading count'
                          : 'N/A'}
                  </InfoItem>

                  <InfoItem label="Type">
                    {isContract !== undefined
                      ? isContract
                        ? 'Contract'
                        : 'Externally Owned Account (EOA)'
                      : infoQuery.loading || codeQuery.loading
                        ? 'Loading...'
                        : 'Unknown'}
                  </InfoItem>

                  {persistent?.isContract && persistent.contractName && (
                    <InfoItem label="Contract Name">{persistent.contractName}</InfoItem>
                  )}

                  {persistent?.isContract && persistent.verificationStatus && (
                    <InfoItem label="Verification Status">
                      {persistent.verificationStatus === 'verified' && 'Verified'}
                      {persistent.verificationStatus === 'partial' && 'Partially Verified'}
                      {persistent.verificationStatus === 'unverified' && 'Unverified'}
                    </InfoItem>
                  )}

                  {persistent?.isContract && (
                    <InfoItem label="Contract">
                      <TypedLink
                        to={`/chain/${currentChainId}/contract/${address}`}
                        className={linkStyle}
                      >
                        View Contract Details →
                      </TypedLink>
                    </InfoItem>
                  )}

                  {persistent?.contractCreationBlock && (
                    <InfoItem label="Created at Block">
                      {persistent.contractCreationBlock.toLocaleString()}
                    </InfoItem>
                  )}

                  {persistent?.contractCreator && (
                    <InfoItem label="Contract Creator">
                      <TypedLink
                        to={`/chain/${currentChainId}/address/${persistent.contractCreator}`}
                        className={linkStyle}
                      >
                        {formatAddr(persistent.contractCreator)}
                      </TypedLink>
                    </InfoItem>
                  )}

                  {persistent?.isProxy && (
                    <>
                      <InfoItem label="Proxy Type">
                        {persistent.proxyType ?? 'Standard Proxy'}
                      </InfoItem>
                      {persistent.implementationAddress && (
                        <InfoItem label="Implementation">
                          {formatAddr(persistent.implementationAddress)}
                        </InfoItem>
                      )}
                    </>
                  )}

                  {realTimeQuery.data && (
                    <InfoItem label="Latest Block">
                      {realTimeQuery.data.latestBlock.toLocaleString()}
                    </InfoItem>
                  )}

                  {realTimeQuery.data && (
                    <InfoItem label="Last Updated">
                      Updated {formatRelativeTime(realTimeQuery.data.lastUpdatedAt)}
                    </InfoItem>
                  )}

                  <InfoItem label="External Tools">
                    <ExternalLinks links={getExternalToolLinks(currentChainId, address)} />
                  </InfoItem>
                </InfoGrid>
              </CardContent>
            </Card>

            <Card className={transactionsCard}>
              <CardHeader>
                <div className={headerRow}>
                  <CardTitle as="h2">Recent Transactions</CardTitle>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void txQuery.refetch();
                    }}
                    loading={txQuery.fetching}
                  >
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {txQuery.loading && (
                  <LoadingState message="Searching for transactions via binary search..." />
                )}

                {txQuery.error && (
                  <ErrorState message={txQuery.error.message} />
                )}

                {!txQuery.loading &&
                  !txQuery.error &&
                  transactions.length === 0 &&
                  txTotal > 0 &&
                  txMethod === 'binary-search-skipped' && (
                  <Alert variant="info">
                    This address has {txTotal} transactions but no native token balance.
                    Transaction history is discovered by scanning balance changes; contract
                    interactions and token transfers may not appear.
                  </Alert>
                )}

                {!txQuery.loading &&
                  !txQuery.error &&
                  transactions.length === 0 &&
                  txTotal > 0 &&
                  txMethod !== 'binary-search-skipped' && (
                  <Alert variant="warning">
                    No transactions found in recent blocks. This address has {txTotal}{' '}
                    transactions, but they may be outside the search range.
                  </Alert>
                )}

                {!txQuery.loading && !txQuery.error && transactions.length === 0 && txTotal === 0 && (
                  <Alert variant="info">No transactions found</Alert>
                )}

                {!txQuery.loading && transactions.length > 0 && txMethod === 'binary-search' && (
                  <div className={infoNote}>
                    Found {transactions.length} of ~{txTotal} transactions via balance-change binary
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
                        {transactions.map(tx => {
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
                                <TypedLink
                                  to={`/chain/${currentChainId}/block/${tx.blockNumber}`}
                                  className={linkStyle}
                                >
                                  {formatBlockNumber(tx.blockNumber)}
                                </TypedLink>
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
                              <td className={valueCell}>{formatTxValue(tx.value)}</td>
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
