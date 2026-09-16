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

const getTxTypeText = (type: number): string => {
  const types: Record<number, string> = { 0: 'Legacy', 1: 'EIP-2930', 2: 'EIP-1559' };
  return types[type] ?? `Type ${type}`;
};

const formatGas = (gas: string): string => {
  try {
    return parseInt(gas).toLocaleString();
  } catch {
    return gas;
  }
};

const formatValue = (value: string, symbol: string): string => {
  try {
    const valueInEth = parseFloat(value) / Math.pow(10, 18);
    return `${valueInEth.toFixed(6)} ${symbol}`;
  } catch {
    return `${value} wei`;
  }
};

export default function TransactionDetail() {
  const { params, router } = useMatched();

  const currentChainId = Number.parseInt(params.chainId ?? '1', 10);
  const chainInfo = getChainInfo(currentChainId);
  const txHash = params.txHash ?? '';

  // The service fetch guards an empty hash itself (no network), so the hook
  // runs unconditionally and the view reports the bad param.
  const { data: txInfo, loading, error } = useTransactionByHash(currentChainId, txHash);

  const handleChainChange = (newChainId: number) => {
    void navigate(router, `/chain/${newChainId}`).catch(() => undefined);
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
                  <Badge variant={txInfo.status === 1 ? 'success' : 'error'} size="sm">
                    {txInfo.status === 1 ? 'Success' : 'Failed'}
                  </Badge>
                </InfoItem>
                <InfoItem label="Block Number">{parseInt(txInfo.blockNumber).toLocaleString()}</InfoItem>
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
                    {formatGas(txInfo.gasPrice)}
                    {' '}
                    wei
                  </InfoItem>
                )}
                {txInfo.maxFeePerGas && (
                  <InfoItem label="Max Fee Per Gas">
                    {formatGas(txInfo.maxFeePerGas)}
                    {' '}
                    wei
                  </InfoItem>
                )}
                {txInfo.maxPriorityFeePerGas && (
                  <InfoItem label="Max Priority Fee Per Gas">
                    {formatGas(txInfo.maxPriorityFeePerGas)}
                    {' '}
                    wei
                  </InfoItem>
                )}
                {txInfo.effectiveGasPrice && (
                  <InfoItem label="Effective Gas Price">
                    {formatGas(txInfo.effectiveGasPrice)}
                    {' '}
                    wei
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
