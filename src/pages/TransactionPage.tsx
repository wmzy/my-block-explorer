import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { css } from "@linaria/core";
import { getChainInfo, getChainName, getChainSymbol } from "../config/chains";
import TopNavigation from "../components/TopNavigation";

const pageStyles = css`
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
`;

const headerStyles = css`
  margin-bottom: 30px;

  h1 {
    font-size: 24px;
    font-weight: 600;
    margin: 0 0 10px 0;
    color: #1a1a1a;
  }

  .chain-info {
    color: #666;
    font-size: 14px;
  }
`;

const cardStyles = css`
  background: white;
  border-radius: 12px;
  border: 1px solid #e1e5e9;
  padding: 24px;
  margin-bottom: 20px;

  h2 {
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 16px 0;
    color: #1a1a1a;
  }
`;

const infoGridStyles = css`
  display: grid;
  gap: 16px;

  .info-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid #f0f0f0;

    &:last-child {
      border-bottom: none;
    }
  }

  .label {
    font-weight: 500;
    color: #666;
  }

  .value {
    font-family:
      "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas,
      "Courier New", monospace;
    color: #1a1a1a;
    word-break: break-all;
  }
`;

const statusStyles = css`
  &.success {
    color: #28a745;
    font-weight: 600;
  }

  &.failed {
    color: #dc3545;
    font-weight: 600;
  }
`;

const loadingStyles = css`
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
  color: #666;
`;

const errorStyles = css`
  background: #fee;
  border: 1px solid #fcc;
  border-radius: 8px;
  padding: 16px;
  color: #c33;
  margin: 20px 0;
`;

const backButtonStyles = css`
  background: #f8f9fa;
  border: 1px solid #e1e5e9;
  border-radius: 8px;
  padding: 8px 16px;
  color: #666;
  text-decoration: none;
  font-size: 14px;
  margin-bottom: 20px;
  display: inline-block;

  &:hover {
    background: #e9ecef;
    color: #333;
  }
`;

type TransactionInfo = {
  chainId: number;
  hash: string;
  blockNumber: string;
  transactionIndex: number;
  fromAddress: string;
  toAddress: string;
  value: string;
  gasLimit: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
  nonce: string;
  status: number;
  type: number;
  timestamp?: string;
};

export default function TransactionPage() {
  const { chainId, txHash } = useParams<{ chainId: string; txHash: string }>();
  const navigate = useNavigate();
  const [txInfo, setTxInfo] = useState<TransactionInfo | null>(null);
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

    fetchTransactionInfo();
  }, [chainId, txHash]);

  const fetchTransactionInfo = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `/api/chains/${currentChainId}/transactions/${txHash}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      setTxInfo(data.transaction);
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

  const getStatusText = (status: number) => {
    return status === 1 ? "Success" : "Failed";
  };

  const getStatusClass = (status: number) => {
    return status === 1 ? "success" : "failed";
  };

  const getTxTypeText = (type: number) => {
    switch (type) {
      case 0:
        return "Legacy";
      case 1:
        return "EIP-2930";
      case 2:
        return "EIP-1559";
      default:
        return `Type ${type}`;
    }
  };

  const handleChainChange = (newChainId: number) => {
    navigate(`/chain/${newChainId}`, { replace: true });
  };

  if (!chainInfo) {
    return (
      <>
        <TopNavigation
          currentChainId={currentChainId}
          onChainChange={handleChainChange}
        />
        <div className={pageStyles}>
          <div className={errorStyles}>Unsupported chain ID: {chainId}</div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopNavigation
        currentChainId={currentChainId}
        onChainChange={handleChainChange}
      />
      <div className={pageStyles}>
        <button
          className={backButtonStyles}
          onClick={() => navigate(`/chain/${currentChainId}`)}
        >
          ← Back to Explorer
        </button>

      <div className={headerStyles}>
        <h1>Transaction Details</h1>
        <div className="chain-info">
          {getChainName(currentChainId)} • Chain ID: {currentChainId}
        </div>
      </div>

      {loading && (
        <div className={loadingStyles}>Loading transaction information...</div>
      )}

      {error && <div className={errorStyles}>Error: {error}</div>}

      {txInfo && (
        <div className={cardStyles}>
          <h2>Transaction Details</h2>
          <div className={infoGridStyles}>
            <div className="info-item">
              <span className="label">Transaction Hash</span>
              <span className="value">{txInfo.hash}</span>
            </div>
            <div className="info-item">
              <span className="label">Status</span>
              <span
                className={`value ${statusStyles} ${getStatusClass(txInfo.status)}`}
              >
                {getStatusText(txInfo.status)}
              </span>
            </div>
            <div className="info-item">
              <span className="label">Block Number</span>
              <span className="value">
                {parseInt(txInfo.blockNumber).toLocaleString()}
              </span>
            </div>
            <div className="info-item">
              <span className="label">Transaction Index</span>
              <span className="value">{txInfo.transactionIndex}</span>
            </div>
            <div className="info-item">
              <span className="label">From</span>
              <span className="value">{txInfo.fromAddress}</span>
            </div>
            <div className="info-item">
              <span className="label">To</span>
              <span className="value">{txInfo.toAddress}</span>
            </div>
            <div className="info-item">
              <span className="label">Value</span>
              <span className="value">
                {formatValue(txInfo.value, getChainSymbol(currentChainId))}
              </span>
            </div>
            <div className="info-item">
              <span className="label">Gas Limit</span>
              <span className="value">{formatGas(txInfo.gasLimit)}</span>
            </div>
            {txInfo.gasUsed && (
              <div className="info-item">
                <span className="label">Gas Used</span>
                <span className="value">{formatGas(txInfo.gasUsed)}</span>
              </div>
            )}
            {txInfo.gasPrice && (
              <div className="info-item">
                <span className="label">Gas Price</span>
                <span className="value">{formatGas(txInfo.gasPrice)} wei</span>
              </div>
            )}
            {txInfo.maxFeePerGas && (
              <div className="info-item">
                <span className="label">Max Fee Per Gas</span>
                <span className="value">
                  {formatGas(txInfo.maxFeePerGas)} wei
                </span>
              </div>
            )}
            {txInfo.maxPriorityFeePerGas && (
              <div className="info-item">
                <span className="label">Max Priority Fee Per Gas</span>
                <span className="value">
                  {formatGas(txInfo.maxPriorityFeePerGas)} wei
                </span>
              </div>
            )}
            {txInfo.effectiveGasPrice && (
              <div className="info-item">
                <span className="label">Effective Gas Price</span>
                <span className="value">
                  {formatGas(txInfo.effectiveGasPrice)} wei
                </span>
              </div>
            )}
            <div className="info-item">
              <span className="label">Nonce</span>
              <span className="value">{txInfo.nonce}</span>
            </div>
            <div className="info-item">
              <span className="label">Transaction Type</span>
              <span className="value">{getTxTypeText(txInfo.type)}</span>
            </div>
            {txInfo.timestamp && (
              <div className="info-item">
                <span className="label">Timestamp</span>
                <span className="value">
                  {new Date(txInfo.timestamp).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </>
  );
}
