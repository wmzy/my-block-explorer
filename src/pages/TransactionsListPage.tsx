import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { css } from "@linaria/core";
import { getChainInfo, getChainName, getChainSymbol } from "../config/chains";
import TopNavigation from "../components/TopNavigation";
import { formatNumber, formatRelativeTime } from "@/utils/format";

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

const statusBadge = css`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;

  &.success {
    background: #d1fae5;
    color: #065f46;
  }

  &.failed {
    background: #fee2e2;
    color: #991b1b;
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

type TransactionSummary = {
  hash: string;
  blockNumber: string;
  fromAddress: string;
  toAddress: string;
  value: string;
  status: number;
  timestamp?: string;
  gasUsed?: string;
  gasPrice?: string;
};

export default function TransactionsListPage() {
  const { chainId } = useParams<{ chainId: string }>();
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<TransactionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 20;

  const currentChainId = parseInt(chainId || "1");
  const chainInfo = getChainInfo(currentChainId);
  const symbol = getChainSymbol(currentChainId);

  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `/api/chains/${currentChainId}/transactions?page=${page}&limit=${limit}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      setTransactions(data.data || data.transactions || []);
      const pagination = data.pagination;
      if (pagination) {
        setTotalPages(pagination.totalPages || 1);
      }
    } catch (err) {
      console.error("Failed to fetch transactions:", err);
      setError(
        err instanceof Error ? err.message : "Failed to fetch transactions"
      );
    } finally {
      setLoading(false);
    }
  }, [currentChainId, page]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const handleChainChange = (newChainId: number) => {
    navigate(`/chain/${newChainId}/transactions`, { replace: true });
  };

  const formatHash = (hash: string) => {
    if (!hash || hash.length < 16) return hash;
    return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
  };

  const formatAddr = (addr: string) => {
    if (!addr || addr.length < 10) return addr || "N/A";
    return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
  };

  const formatValue = (value: string) => {
    try {
      const valueInEth = parseFloat(value) / Math.pow(10, 18);
      if (valueInEth === 0) return `0 ${symbol}`;
      if (valueInEth < 0.0001) return `<0.0001 ${symbol}`;
      return `${valueInEth.toFixed(4)} ${symbol}`;
    } catch {
      return `${value} wei`;
    }
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
          <h1>Transactions</h1>
          <div className="chain-info">
            {getChainName(currentChainId)} • Chain ID: {currentChainId}
          </div>
        </div>

        {loading && (
          <div className={loadingStyles}>Loading transactions...</div>
        )}

        {error && (
          <div className={errorStyles}>
            Error: {error}
            <button
              onClick={fetchTransactions}
              style={{ marginLeft: 12, cursor: "pointer" }}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && transactions.length === 0 && (
          <div className={loadingStyles}>No transactions found</div>
        )}

        {transactions.length > 0 && (
          <div className={tableContainerStyles}>
            <table className={tableStyles}>
              <thead>
                <tr>
                  <th>Txn Hash</th>
                  <th>Block</th>
                  <th>Age</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.hash}>
                    <td>
                      <Link
                        to={`/chain/${currentChainId}/tx/${tx.hash}`}
                        className={linkStyles}
                      >
                        {formatHash(tx.hash)}
                      </Link>
                    </td>
                    <td>
                      <Link
                        to={`/chain/${currentChainId}/block/${tx.blockNumber}`}
                        className={linkStyles}
                      >
                        {formatNumber(parseInt(tx.blockNumber))}
                      </Link>
                    </td>
                    <td>
                      {tx.timestamp
                        ? formatRelativeTime(tx.timestamp)
                        : "N/A"}
                    </td>
                    <td>
                      <Link
                        to={`/chain/${currentChainId}/address/${tx.fromAddress}`}
                        className={linkStyles}
                      >
                        {formatAddr(tx.fromAddress)}
                      </Link>
                    </td>
                    <td>
                      <Link
                        to={`/chain/${currentChainId}/address/${tx.toAddress}`}
                        className={linkStyles}
                      >
                        {formatAddr(tx.toAddress)}
                      </Link>
                    </td>
                    <td className={monoStyles}>{formatValue(tx.value)}</td>
                    <td>
                      <span
                        className={`${statusBadge} ${tx.status === 1 ? "success" : "failed"}`}
                      >
                        {tx.status === 1 ? "Success" : "Failed"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className={paginationStyles}>
              <span className="page-info">
                Page {page} of {totalPages}
              </span>
              <div className="page-buttons">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
