import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { css } from "@linaria/core";
import { getChainInfo, getChainName } from "../config/chains";

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

type BlockInfo = {
  chainId: number;
  number: string;
  hash: string;
  parentHash: string;
  timestamp: string;
  miner: string;
  gasLimit: string;
  gasUsed: string;
  baseFeePerGas?: string;
  transactionCount: number;
  sizeBytes?: number;
  difficulty?: string;
  extraData?: string;
};

export default function BlockPage() {
  const { chainId, blockNumber } = useParams<{
    chainId: string;
    blockNumber: string;
  }>();
  const navigate = useNavigate();
  const [blockInfo, setBlockInfo] = useState<BlockInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentChainId = parseInt(chainId || "1");
  const chainInfo = getChainInfo(currentChainId);

  useEffect(() => {
    if (!blockNumber || !chainId) {
      setError("Invalid block number or chain ID");
      setLoading(false);
      return;
    }

    fetchBlockInfo();
  }, [chainId, blockNumber]);

  const fetchBlockInfo = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `/api/chains/${currentChainId}/blocks/${blockNumber}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      setBlockInfo(data.block);
    } catch (err) {
      console.error("Failed to fetch block info:", err);
      setError(
        err instanceof Error ? err.message : "Failed to fetch block information"
      );
    } finally {
      setLoading(false);
    }
  };

  const formatGas = (gas: string) => {
    try {
      return parseInt(gas).toLocaleString();
    } catch {
      return gas;
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return "N/A";
    return `${bytes.toLocaleString()} bytes`;
  };

  if (!chainInfo) {
    return (
      <div className={pageStyles}>
        <div className={errorStyles}>Unsupported chain ID: {chainId}</div>
      </div>
    );
  }

  return (
    <div className={pageStyles}>
      <button
        className={backButtonStyles}
        onClick={() => navigate(`/chain/${currentChainId}`)}
      >
        ← Back to Explorer
      </button>

      <div className={headerStyles}>
        <h1>Block #{blockNumber}</h1>
        <div className="chain-info">
          {getChainName(currentChainId)} • Chain ID: {currentChainId}
        </div>
      </div>

      {loading && (
        <div className={loadingStyles}>Loading block information...</div>
      )}

      {error && <div className={errorStyles}>Error: {error}</div>}

      {blockInfo && (
        <div className={cardStyles}>
          <h2>Block Details</h2>
          <div className={infoGridStyles}>
            <div className="info-item">
              <span className="label">Block Number</span>
              <span className="value">
                {parseInt(blockInfo.number).toLocaleString()}
              </span>
            </div>
            <div className="info-item">
              <span className="label">Block Hash</span>
              <span className="value">{blockInfo.hash}</span>
            </div>
            <div className="info-item">
              <span className="label">Parent Hash</span>
              <span className="value">{blockInfo.parentHash}</span>
            </div>
            <div className="info-item">
              <span className="label">Timestamp</span>
              <span className="value">
                {new Date(blockInfo.timestamp).toLocaleString()}
              </span>
            </div>
            <div className="info-item">
              <span className="label">Miner</span>
              <span className="value">{blockInfo.miner}</span>
            </div>
            <div className="info-item">
              <span className="label">Gas Limit</span>
              <span className="value">{formatGas(blockInfo.gasLimit)}</span>
            </div>
            <div className="info-item">
              <span className="label">Gas Used</span>
              <span className="value">{formatGas(blockInfo.gasUsed)}</span>
            </div>
            {blockInfo.baseFeePerGas && (
              <div className="info-item">
                <span className="label">Base Fee Per Gas</span>
                <span className="value">
                  {formatGas(blockInfo.baseFeePerGas)} wei
                </span>
              </div>
            )}
            <div className="info-item">
              <span className="label">Transaction Count</span>
              <span className="value">
                {blockInfo.transactionCount.toLocaleString()}
              </span>
            </div>
            <div className="info-item">
              <span className="label">Block Size</span>
              <span className="value">{formatBytes(blockInfo.sizeBytes)}</span>
            </div>
            {blockInfo.difficulty && (
              <div className="info-item">
                <span className="label">Difficulty</span>
                <span className="value">{blockInfo.difficulty}</span>
              </div>
            )}
            {blockInfo.extraData && (
              <div className="info-item">
                <span className="label">Extra Data</span>
                <span className="value">{blockInfo.extraData}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
