import { navigate } from '@native-router/core';
import { useMatched } from '@native-router/react';

import TopNavigation from '@/components/TopNavigation';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { InfoGrid, InfoItem } from '@/components/ui/InfoGrid';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageContainer, PageHeader, BackButton } from '@/components/ui/PageLayout';
import { getChainInfo, getChainName, getChainSymbol } from '@/config/chains';
import { useTransactionByHash } from '@/services/chainRpc';
import { formatEth, formatGasPrice, formatNumber } from '@/utils/format';

const getTxTypeText = (type: number): string => {
  const types: Record<number, string> = {
    0: 'Legacy',
    1: 'EIP-2930',
    2: 'EIP-1559',
    3: 'EIP-4844 (Blob)',
  };
  return types[type] ?? `Type ${type}`;
};

// Gas amounts are plain unit counts: BigInt-parse first (block gas figures
// stay far below Number.MAX_SAFE_INTEGER, so the Number step is exact).
const formatGas = (gas: string): string => {
  try {
    return Number(BigInt(gas)).toLocaleString();
  } catch {
    return gas;
  }
};

const formatValue = (value: string, symbol: string): string => {
  try {
    return `${formatEth(value, 6)} ${symbol}`;
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

export default function TransactionDetail() {
  const { params, router } = useMatched();

  const currentChainId = Number.parseInt(params.chainId ?? '1', 10);
  const chainInfo = getChainInfo(currentChainId);
  const txHash = params.txHash ?? '';

  // The service fetch guards an empty hash itself (no network), so the hook
  // runs unconditionally and the view reports the bad param.
  const { data: txInfo, loading, error } = useTransactionByHash(currentChainId, txHash);

  const handleChainChange = (newChainId: number) => {
    // Same-params refresh: the hash is chain-agnostic, so switching chains
    // re-resolves this exact transaction on the target chain's RPC instead
    // of kicking the user back to the chain home page.
    void navigate(router, `/chain/${newChainId}/tx/${txHash}`).catch(() => undefined);
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
        <BackButton
          onClick={() => void navigate(router, `/chain/${currentChainId}`).catch(() => undefined)}
        />

        <PageHeader
          title="Transaction Details"
          chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
        />

        {!txHash && <ErrorState message="Invalid transaction hash or chain ID" />}

        {txHash && loading && <LoadingState message="Loading transaction information..." />}

        {txHash && error && (
          <ErrorState
            message={
              error instanceof Error ? error.message : 'Failed to fetch transaction information'
            }
          />
        )}

        {txHash && !loading && !error && txInfo && (
          <Card>
            <CardHeader>
              <CardTitle>Transaction Details</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid>
                <InfoItem label="Transaction Hash">{txInfo.hash}</InfoItem>
                <InfoItem label="Status">
                  <TxStatusBadge status={txInfo.status} />
                </InfoItem>
                <InfoItem label="Block Number">
                  {formatNumber(BigInt(txInfo.blockNumber))}
                </InfoItem>
                <InfoItem label="Transaction Index">{txInfo.transactionIndex}</InfoItem>
                <InfoItem label="From">{txInfo.fromAddress}</InfoItem>
                <InfoItem label="To">{txInfo.toAddress}</InfoItem>
                <InfoItem label="Value">
                  {formatValue(txInfo.value, getChainSymbol(currentChainId))}
                </InfoItem>
                <InfoItem label="Gas Limit">{formatGas(txInfo.gasLimit)}</InfoItem>
                {txInfo.gasUsed && (
                  <InfoItem label="Gas Used">{formatGas(txInfo.gasUsed)}</InfoItem>
                )}
                {txInfo.gasPrice && (
                  <InfoItem label="Gas Price">
                    {formatGasPrice(txInfo.gasPrice)}
                    {' '}
                    gwei
                  </InfoItem>
                )}
                {txInfo.maxFeePerGas && (
                  <InfoItem label="Max Fee Per Gas">
                    {formatGasPrice(txInfo.maxFeePerGas)}
                    {' '}
                    gwei
                  </InfoItem>
                )}
                {txInfo.maxPriorityFeePerGas && (
                  <InfoItem label="Max Priority Fee Per Gas">
                    {formatGasPrice(txInfo.maxPriorityFeePerGas)}
                    {' '}
                    gwei
                  </InfoItem>
                )}
                {txInfo.maxFeePerBlobGas && (
                  <InfoItem label="Max Fee Per Blob Gas">
                    {formatGasPrice(txInfo.maxFeePerBlobGas)}
                    {' '}
                    gwei
                  </InfoItem>
                )}
                {txInfo.blobVersionedHashes && txInfo.blobVersionedHashes.length > 0 && (
                  <InfoItem label="Blob Versioned Hashes">
                    {txInfo.blobVersionedHashes.join(', ')}
                  </InfoItem>
                )}
                {txInfo.effectiveGasPrice && (
                  <InfoItem label="Effective Gas Price">
                    {formatGasPrice(txInfo.effectiveGasPrice)}
                    {' '}
                    gwei
                  </InfoItem>
                )}
                <InfoItem label="Nonce">{txInfo.nonce}</InfoItem>
                <InfoItem label="Transaction Type">{getTxTypeText(txInfo.type)}</InfoItem>
                {txInfo.timestamp && (
                  <InfoItem label="Timestamp">
                    {new Date(txInfo.timestamp).toLocaleString()}
                  </InfoItem>
                )}
              </InfoGrid>
            </CardContent>
          </Card>
        )}
      </PageContainer>
    </>
  );
}
