import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { css } from "@linaria/core";
import { getChainInfo, getChainName } from "../config/chains";
import TopNavigation from "../components/TopNavigation";
import { formatNumber, formatRelativeTime } from "@/utils/format";
import { getLatestBlocks, type RpcBlock } from "@/utils/blockRpcData";

const pageStyles = css`
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
`;

const headerStyles = css`
  margin-bottom: 24px;

  h1 {
    font-size: 24px;
    font-weight: 600;
    margin: 0 0 8px 0;
    color: #1a1a1a;
  }

  .chain-info {
    color: #666;
    font-size: 14px;
  }
`;

const tableContainerStyles = css`
  background: white;
  border-radius: 12px;
  border: 1px solid #e1e5e9;
  overflow: hidden;
`;

const tableStyles = css`
  width: 100%;
  border-collapse: collapse;

  th {
    background: #f8f9fa;
    padding: 12px 16px;
    text-align: left;
    font-weight: 600;
    font-size: 13px;
    color: #666;
    border-bottom: 1px solid #e1e5e9;
    white-space: nowrap;
  }

  td {
    padding: 12px 16px;
    border-bottom: 1px solid #f0f0f0;
    font-size: 14px;
    color: #1a1a1a;
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr:hover td {
    background: #f8f9fa;
  }
`;

const linkStyles = css`
  color: #4f46e5;
  text-decoration: none;
  font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas,
    monospace;

  &:hover {
    text-decoration: underline;
  }
`;

const paginationStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-top: 1px solid #e1e5e9;
  background: #f8f9fa;

  .page-info {
    color: #666;
    font-size: 14px;
  }

  .page-buttons {
    display: flex;
    gap: 8px;
  }

  button {
    padding: 6px 16px;
    border: 1px solid #e1e5e9;
    border-radius: 6px;
    background: white;
    color: #374151;
    font-size: 14px;
    cursor: pointer;

    &:hover:not(:disabled) {
      background: #f0f0f0;
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
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

const monoStyles = css`
  font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas,
    monospace;
  font-size: 13px;
`;

export default function BlocksListPage() {
  const { chainId } = useParams<{ chainId: string }>();
  const navigate = useNavigate();
  const [blocks, setBlocks] = useState<RpcBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [latestBlockNumber, setLatestBlockNumber] = useState<bigint | null>(null);
  const limit = 20;

  const currentChainId = parseInt(chainId || "1");
  const chainInfo = getChainInfo(currentChainId);

  const fetchBlocks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const beforeBlock =
        latestBlockNumber && page > 1
          ? latestBlockNumber - BigInt((page - 1) * limit) + 1n
          : undefined;

      const result = await getLatestBlocks(currentChainId, limit, beforeBlock);
      setBlocks(result.blocks);
      if (page === 1) {
        setLatestBlockNumber(result.latestBlockNumber);
      }
    } catch (err) {
      console.error("Failed to fetch blocks:", err);
      setError(
        err instanceof Error ? err.message : "Failed to fetch blocks"
      );
    } finally {
      setLoading(false);
    }
  }, [currentChainId, page, latestBlockNumber]);

  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

  const handleChainChange = (newChainId: number) => {
    navigate(`/chain/${newChainId}/blocks`, { replace: true });
  };

  const formatGasUsage = (used: string, limit: string) => {
    try {
      const usedNum = parseInt(used);
      const limitNum = parseInt(limit);
      const percentage = ((usedNum / limitNum) * 100).toFixed(1);
      return `${formatNumber(usedNum)} (${percentage}%)`;
    } catch {
      return used;
    }
  };

  const formatMiner = (miner: string) => {
    if (!miner || miner.length < 10) return miner;
    return `${miner.slice(0, 8)}...${miner.slice(-6)}`;
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
        <div className={headerStyles}>
          <h1>Blocks</h1>
          <div className="chain-info">
            {getChainName(currentChainId)} • Chain ID: {currentChainId}
          </div>
        </div>

        {loading && (
          <div className={loadingStyles}>Loading blocks...</div>
        )}

        {error && (
          <div className={errorStyles}>
            Error: {error}
            <button
              onClick={fetchBlocks}
              style={{ marginLeft: 12, cursor: "pointer" }}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && blocks.length === 0 && (
          <div className={loadingStyles}>No blocks found</div>
        )}

        {blocks.length > 0 && (
          <div className={tableContainerStyles}>
            <table className={tableStyles}>
              <thead>
                <tr>
                  <th>Block</th>
                  <th>Age</th>
                  <th>Txn</th>
                  <th>Gas Used</th>
                  <th>Miner</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((block) => (
                  <tr key={block.number}>
                    <td>
                      <Link
                        to={`/chain/${currentChainId}/block/${block.number}`}
                        className={linkStyles}
                      >
                        {formatNumber(parseInt(block.number))}
                      </Link>
                    </td>
                    <td>
                      {block.timestamp
                        ? formatRelativeTime(block.timestamp)
                        : "N/A"}
                    </td>
                    <td>{block.transactionCount}</td>
                    <td className={monoStyles}>
                      {formatGasUsage(block.gasUsed, block.gasLimit)}
                    </td>
                    <td>
                      <Link
                        to={`/chain/${currentChainId}/address/${block.miner}`}
                        className={linkStyles}
                      >
                        {formatMiner(block.miner)}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className={paginationStyles}>
              <span className="page-info">
                Page {page}
                {latestBlockNumber !== null &&
                  ` • Latest block: ${formatNumber(Number(latestBlockNumber))}`}
              </span>
              <div className="page-buttons">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Newer
                </button>
                <button
                  disabled={blocks.length < limit}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Older
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
