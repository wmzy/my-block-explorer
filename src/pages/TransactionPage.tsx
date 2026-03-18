import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getChainInfo, getChainName, getChainSymbol } from "../config/chains";
import TopNavigation from "../components/TopNavigation";
import { getTransactionByHash, type RpcTransaction } from "@/utils/blockRpcData";
import { PageContainer, PageHeader, BackButton } from "@/components/ui/PageLayout";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { InfoGrid, InfoItem } from "@/components/ui/InfoGrid";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Badge } from "@/components/ui/Badge";

const getTxTypeText = (type: number) => {
  const types: Record<number, string> = { 0: "Legacy", 1: "EIP-2930", 2: "EIP-1559" };
  return types[type] ?? `Type ${type}`;
};

export default function TransactionPage() {
  const { chainId, txHash } = useParams<{ chainId: string; txHash: string }>();
  const navigate = useNavigate();
  const [txInfo, setTxInfo] = useState<RpcTransaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentChainId = parseInt(chainId || "1");
  const chainInfo = getChainInfo(currentChainId);

  useEffect(() => {
    if (!txHash || !chainId) {
      setError("Invalid transaction hash or chain ID");
      setLoading(false);
      return;
    }

    const fetchTransactionInfo = async () => {
      try {
        setLoading(true);
        setError(null);
        const tx = await getTransactionByHash(currentChainId, txHash);
        setTxInfo(tx);
      } catch (err) {
        console.error("Failed to fetch transaction info:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to fetch transaction information"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchTransactionInfo();
  }, [chainId, txHash, currentChainId]);

  const formatValue = (value: string, symbol: string) => {
    try {
      const valueInEth = parseFloat(value) / Math.pow(10, 18);
      return `${valueInEth.toFixed(6)} ${symbol}`;
    } catch {
      return `${value} wei`;
    }
  };

  const formatGas = (gas: string) => {
    try {
      return parseInt(gas).toLocaleString();
    } catch {
      return gas;
    }
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
          title="Transaction Details"
          chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
        />

        {loading && <LoadingState message="Loading transaction information..." />}

        {error && <ErrorState message={error} />}

        {txInfo && (
          <Card>
            <CardHeader>
              <CardTitle>Transaction Details</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid>
                <InfoItem label="Transaction Hash">{txInfo.hash}</InfoItem>
                <InfoItem label="Status">
                  <Badge
                    variant={txInfo.status === 1 ? "success" : "error"}
                    size="sm"
                  >
                    {txInfo.status === 1 ? "Success" : "Failed"}
                  </Badge>
                </InfoItem>
                <InfoItem label="Block Number">
                  {parseInt(txInfo.blockNumber).toLocaleString()}
                </InfoItem>
                <InfoItem label="Transaction Index">
                  {txInfo.transactionIndex}
                </InfoItem>
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
                  <InfoItem label="Gas Price">{formatGas(txInfo.gasPrice)} wei</InfoItem>
                )}
                {txInfo.maxFeePerGas && (
                  <InfoItem label="Max Fee Per Gas">
                    {formatGas(txInfo.maxFeePerGas)} wei
                  </InfoItem>
                )}
                {txInfo.maxPriorityFeePerGas && (
                  <InfoItem label="Max Priority Fee Per Gas">
                    {formatGas(txInfo.maxPriorityFeePerGas)} wei
                  </InfoItem>
                )}
                {txInfo.effectiveGasPrice && (
                  <InfoItem label="Effective Gas Price">
                    {formatGas(txInfo.effectiveGasPrice)} wei
                  </InfoItem>
                )}
                <InfoItem label="Nonce">{txInfo.nonce}</InfoItem>
                <InfoItem label="Transaction Type">
                  {getTxTypeText(txInfo.type)}
                </InfoItem>
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
