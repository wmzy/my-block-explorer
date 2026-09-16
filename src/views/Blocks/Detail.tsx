import { navigate } from '@native-router/core';
import { TypedLink, useMatched } from '@native-router/react';
import { formatGwei } from 'viem';

import TopNavigation from '@/components/TopNavigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { InfoGrid, InfoItem } from '@/components/ui/InfoGrid';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageContainer, PageHeader, BackButton } from '@/components/ui/PageLayout';
import { linkStyle } from '@/components/ui/DataTable';
import { getChainInfo, getChainName } from '@/config/chains';
import { useBlockByNumber } from '@/services/chainRpc';
import { formatRelativeTime } from '@/utils/format';

// Gas quantities are on-chain integers serialized as strings: format them
// BigInt-safe (parseInt would silently lose precision past 2^53).
const formatGas = (gas: string): string => {
  try {
    return BigInt(gas).toLocaleString();
  } catch {
    return gas;
  }
};

const formatBytes = (bytes?: number): string => {
  if (!bytes) return 'N/A';
  return `${bytes.toLocaleString()} bytes`;
};

export default function BlockDetail() {
  const { params, router } = useMatched();

  const currentChainId = Number.parseInt(params.chainId ?? '1', 10);
  const chainInfo = getChainInfo(currentChainId);
  const blockNumberStr = params.blockNumber ?? '';
  const parsedNumber = Number(blockNumberStr);
  const invalidNumber = !Number.isFinite(parsedNumber) || parsedNumber < 0;

  // The service fetch guards invalid numbers itself (no network), so the
  // hook runs unconditionally and the view reports the bad param.
  const { data: blockInfo, loading, error } = useBlockByNumber(
    currentChainId,
    blockNumberStr,
  );

  // Same-params refresh: the chain switch keeps the block number so the
  // detail view reloads for the new chain instead of landing on the home
  // page.
  const handleChainChange = (newChainId: number) => {
    void navigate(router, `/chain/${newChainId}/block/${blockNumberStr}`).catch(
      () => undefined,
    );
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
          title={`Block #${blockNumberStr}`}
          chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
        />

        {invalidNumber && <ErrorState message="Invalid block number or chain ID" />}

        {!invalidNumber && loading && <LoadingState message="Loading block information..." />}

        {!invalidNumber && error && (
          <ErrorState
            message={error instanceof Error ? error.message : 'Failed to fetch block information'}
          />
        )}

        {!invalidNumber && !loading && !error && blockInfo && (
          <Card>
            <CardHeader>
              <CardTitle>Block Details</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid>
                <InfoItem label="Block Number">
                  {Number(BigInt(blockInfo.number)).toLocaleString()}
                </InfoItem>
                <InfoItem label="Block Hash">{blockInfo.hash}</InfoItem>
                <InfoItem label="Parent Hash">{blockInfo.parentHash}</InfoItem>
                <InfoItem label="Timestamp">
                  {`${new Date(blockInfo.timestamp).toLocaleString()} (${formatRelativeTime(blockInfo.timestamp)})`}
                </InfoItem>
                <InfoItem label="Miner">{blockInfo.miner}</InfoItem>
                <InfoItem label="Gas Limit">{formatGas(blockInfo.gasLimit)}</InfoItem>
                <InfoItem label="Gas Used">{formatGas(blockInfo.gasUsed)}</InfoItem>
                {blockInfo.baseFeePerGas && (
                  <InfoItem label="Base Fee Per Gas">
                    {`${formatGwei(BigInt(blockInfo.baseFeePerGas))} gwei`}
                  </InfoItem>
                )}
                <InfoItem label="Transaction Count">
                  <TypedLink
                    to={`/chain/${currentChainId}/transactions`}
                    search={{ block: blockInfo.number }}
                    className={linkStyle}
                  >
                    View {blockInfo.transactionCount} Transactions →
                  </TypedLink>
                </InfoItem>
                <InfoItem label="Block Size">{formatBytes(blockInfo.sizeBytes)}</InfoItem>
                {blockInfo.difficulty && (
                  <InfoItem label="Difficulty">{blockInfo.difficulty}</InfoItem>
                )}
                {blockInfo.extraData && (
                  <InfoItem label="Extra Data">{blockInfo.extraData}</InfoItem>
                )}
              </InfoGrid>
            </CardContent>
          </Card>
        )}
      </PageContainer>
    </>
  );
}
