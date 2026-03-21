import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getChainInfo, getChainName } from '../config/chains';
import TopNavigation from '../components/TopNavigation';
import { getBlockByNumber, type RpcBlock } from '@/utils/blockRpcData';
import { PageContainer, PageHeader, BackButton } from '@/components/ui/PageLayout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { InfoGrid, InfoItem } from '@/components/ui/InfoGrid';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';

export default function BlockPage() {
  const { chainId, blockNumber } = useParams<{
    chainId: string;
    blockNumber: string;
  }>();
  const navigate = useNavigate();
  const [blockInfo, setBlockInfo] = useState<RpcBlock | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentChainId = parseInt(chainId ?? '1');
  const chainInfo = getChainInfo(currentChainId);

  useEffect(() => {
    if (!blockNumber || !chainId) {
      setError('Invalid block number or chain ID');
      setLoading(false);
      return;
    }

    const fetchBlockInfo = async () => {
      try {
        setLoading(true);
        setError(null);
        const block = await getBlockByNumber(currentChainId, BigInt(blockNumber));
        setBlockInfo(block);
      }
      catch (err) {
        console.error('Failed to fetch block info:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch block information');
      }
      finally {
        setLoading(false);
      }
    };

    fetchBlockInfo();
  }, [chainId, blockNumber, currentChainId]);

  const formatGas = (gas: string) => {
    try {
      return parseInt(gas).toLocaleString();
    }
    catch {
      return gas;
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return 'N/A';
    return `${bytes.toLocaleString()} bytes`;
  };

  const handleChainChange = (newChainId: number) => {
    navigate(`/chain/${newChainId}`, { replace: true });
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
        <BackButton onClick={() => navigate(`/chain/${currentChainId}`)} />

        <PageHeader
          title={`Block #${blockNumber}`}
          chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
        />

        {loading && <LoadingState message="Loading block information..." />}

        {error && <ErrorState message={error} />}

        {blockInfo && (
          <Card>
            <CardHeader>
              <CardTitle>Block Details</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid>
                <InfoItem label="Block Number">
                  {parseInt(blockInfo.number).toLocaleString()}
                </InfoItem>
                <InfoItem label="Block Hash">{blockInfo.hash}</InfoItem>
                <InfoItem label="Parent Hash">{blockInfo.parentHash}</InfoItem>
                <InfoItem label="Timestamp">
                  {new Date(blockInfo.timestamp).toLocaleString()}
                </InfoItem>
                <InfoItem label="Miner">{blockInfo.miner}</InfoItem>
                <InfoItem label="Gas Limit">{formatGas(blockInfo.gasLimit)}</InfoItem>
                <InfoItem label="Gas Used">{formatGas(blockInfo.gasUsed)}</InfoItem>
                {blockInfo.baseFeePerGas && (
                  <InfoItem label="Base Fee Per Gas">
                    {formatGas(blockInfo.baseFeePerGas)}
                    {' '}
                    wei
                  </InfoItem>
                )}
                <InfoItem label="Transaction Count">
                  {blockInfo.transactionCount.toLocaleString()}
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
