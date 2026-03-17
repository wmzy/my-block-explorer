import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { css } from "@linaria/core";
import { getChainInfo, getChainName, getChainSymbol } from "../config/chains";
import TopNavigation from "../components/TopNavigation";
import { useAddressData } from "../hooks/useAddressData";
import { formatRelativeTime } from "@/utils/format";

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

const txTableStyles = css`
  width: 100%;
  border-collapse: collapse;

  th {
    background: #f8f9fa;
    padding: 10px 12px;
    text-align: left;
    font-weight: 600;
    font-size: 13px;
    color: #666;
    border-bottom: 1px solid #e1e5e9;
  }

  td {
    padding: 10px 12px;
    border-bottom: 1px solid #f0f0f0;
    font-size: 13px;
    color: #1a1a1a;
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr:hover td {
    background: #f8f9fa;
  }
`;

const txLinkStyles = css`
  color: #4f46e5;
  text-decoration: none;
  font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas,
    monospace;
  font-size: 13px;

  &:hover {
    text-decoration: underline;
  }
`;

const directionBadge = css`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;

  &.in {
    background: #d1fae5;
    color: #065f46;
  }

  &.out {
    background: #fee2e2;
    color: #991b1b;
  }

  &.self {
    background: #e0e7ff;
    color: #3730a3;
  }
`;

const paginationStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;

  .page-info {
    color: #666;
    font-size: 13px;
  }

  .page-buttons {
    display: flex;
    gap: 8px;
  }

  button {
    padding: 4px 12px;
    border: 1px solid #e1e5e9;
    border-radius: 6px;
    background: white;
    color: #374151;
    font-size: 13px;
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

type TxRecord = {
  hash: string;
  blockNumber: string;
  fromAddress: string;
  toAddress: string;
  value: string;
  status: number;
  timestamp?: string;
};

export default function AddressPage() {
  const { chainId, address } = useParams<{
    chainId: string;
    address: string;
  }>();
  const navigate = useNavigate();

  const currentChainId = parseInt(chainId || "1");
  const chainInfo = getChainInfo(currentChainId);

  const addressData = useAddressData(currentChainId, address || "");

  const [transactions, setTransactions] = useState<TxRecord[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [txPage, setTxPage] = useState(1);
  const [txTotalPages, setTxTotalPages] = useState(1);
  const txLimit = 10;

  const fetchTransactions = useCallback(async () => {
    if (!address || !chainId) return;
    try {
      setTxLoading(true);
      setTxError(null);
      const response = await fetch(
        `/api/chains/${currentChainId}/addresses/${address}/transactions?page=${txPage}&limit=${txLimit}`
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setTransactions(data.data || data.transactions || []);
      if (data.pagination) {
        setTxTotalPages(data.pagination.totalPages || 1);
      }
    } catch (err) {
      setTxError(
        err instanceof Error ? err.message : "Failed to fetch transactions"
      );
    } finally {
      setTxLoading(false);
    }
  }, [currentChainId, address, txPage]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const getDirection = (tx: TxRecord) => {
    const lowerAddr = address?.toLowerCase();
    const from = tx.fromAddress?.toLowerCase();
    const to = tx.toAddress?.toLowerCase();
    if (from === lowerAddr && to === lowerAddr) return "self";
    if (to === lowerAddr) return "in";
    return "out";
  };

  const formatBalance = (balance: string, symbol: string) => {
    try {
      const balanceInEth = parseFloat(balance) / Math.pow(10, 18);
      return `${balanceInEth.toFixed(6)} ${symbol}`;
    } catch {
      return `${balance} wei`;
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const handleChainChange = (newChainId: number) => {
    navigate(`/chain/${newChainId}/address/${address}`, { replace: true });
  };

  // 计算总体加载和错误状态
  const isLoading =
    addressData.loading.persistent || addressData.loading.realTime;
  const hasError = addressData.error.persistent || addressData.error.realTime;
  const errorMessage =
    addressData.error.persistent || addressData.error.realTime;

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

  if (!address) {
    return (
      <>
        <TopNavigation
          currentChainId={currentChainId}
          onChainChange={handleChainChange}
        />
        <div className={pageStyles}>
          <div className={errorStyles}>Invalid address</div>
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
          <h1>Address Details</h1>
          <div className="chain-info">
            {getChainName(currentChainId)} • Chain ID: {currentChainId}
          </div>
        </div>

        {isLoading && (
          <div className={loadingStyles}>
            Loading address information...
            {addressData.loading.persistent && " (fetching contract info)"}
            {addressData.loading.realTime && " (fetching balance)"}
          </div>
        )}

        {hasError && <div className={errorStyles}>Error: {errorMessage}</div>}

        {(addressData.persistent || addressData.realTime) && (
          <>
            <div className={cardStyles}>
              <h2>Overview</h2>
              <div className={infoGridStyles}>
                <div className="info-item">
                  <span className="label">Address</span>
                  <span className="value">{address}</span>
                </div>

                {/* 实时数据 - 余额 */}
                <div className="info-item">
                  <span className="label">Balance</span>
                  <span className="value">
                    {addressData.realTime
                      ? `${addressData.realTime.balance} ${getChainSymbol(currentChainId)}`
                      : addressData.loading.realTime
                        ? "Loading..."
                        : addressData.error.realTime
                          ? "Error loading balance"
                          : "N/A"}
                  </span>
                </div>

                {/* 实时数据 - 交易数量 */}
                <div className="info-item">
                  <span className="label">Transaction Count</span>
                  <span className="value">
                    {addressData.realTime
                      ? addressData.realTime.transactionCount.toLocaleString()
                      : addressData.loading.realTime
                        ? "Loading..."
                        : addressData.error.realTime
                          ? "Error loading count"
                          : "N/A"}
                  </span>
                </div>

                {/* 持久化数据 - 地址类型 */}
                <div className="info-item">
                  <span className="label">Type</span>
                  <span className="value">
                    {addressData.persistent
                      ? addressData.persistent.isContract
                        ? "Contract"
                        : "Externally Owned Account (EOA)"
                      : addressData.loading.persistent
                        ? "Loading..."
                        : "Unknown"}
                  </span>
                </div>

                {/* 持久化数据 - 合约名称 */}
                {addressData.persistent?.isContract &&
                  addressData.persistent.contractName && (
                    <div className="info-item">
                      <span className="label">Contract Name</span>
                      <span className="value">
                        {addressData.persistent.contractName}
                      </span>
                    </div>
                  )}

                {/* 持久化数据 - 验证状态 */}
                {addressData.persistent?.isContract &&
                  addressData.persistent.verificationStatus && (
                    <div className="info-item">
                      <span className="label">Verification Status</span>
                      <span className="value">
                        {addressData.persistent.verificationStatus ===
                          "verified" && "✅ Verified"}
                        {addressData.persistent.verificationStatus ===
                          "partial" && "⚠️ Partially Verified"}
                        {addressData.persistent.verificationStatus ===
                          "unverified" && "❌ Unverified"}
                      </span>
                    </div>
                  )}

                {/* 持久化数据 - 源代码链接 */}
                {addressData.persistent?.isContract &&
                  addressData.persistent.sourceCodeAvailable && (
                    <div className="info-item">
                      <span className="label">Source Code</span>
                      <span className="value">
                        <a
                          href={`/chain/${currentChainId}/contract/${address}`}
                          style={{ color: "#007bff", textDecoration: "none" }}
                          onMouseOver={(e) =>
                            (e.target.style.textDecoration = "underline")
                          }
                          onMouseOut={(e) =>
                            (e.target.style.textDecoration = "none")
                          }
                        >
                          View Source Code →
                        </a>
                      </span>
                    </div>
                  )}

                {/* 持久化数据 - 合约创建信息 */}
                {addressData.persistent?.contractCreationBlock && (
                  <div className="info-item">
                    <span className="label">Created at Block</span>
                    <span className="value">
                      {addressData.persistent.contractCreationBlock.toLocaleString()}
                    </span>
                  </div>
                )}

                {addressData.persistent?.contractCreator && (
                  <div className="info-item">
                    <span className="label">Contract Creator</span>
                    <span className="value">
                      {formatAddress(addressData.persistent.contractCreator)}
                    </span>
                  </div>
                )}

                {/* 持久化数据 - 代理合约信息 */}
                {addressData.persistent?.isProxy && (
                  <>
                    <div className="info-item">
                      <span className="label">Proxy Type</span>
                      <span className="value">
                        {addressData.persistent.proxyType || "Standard Proxy"}
                      </span>
                    </div>
                    {addressData.persistent.implementationAddress && (
                      <div className="info-item">
                        <span className="label">Implementation</span>
                        <span className="value">
                          {formatAddress(
                            addressData.persistent.implementationAddress
                          )}
                        </span>
                      </div>
                    )}
                  </>
                )}

                {/* 实时数据 - 最新区块 */}
                {addressData.realTime && (
                  <div className="info-item">
                    <span className="label">Latest Block</span>
                    <span className="value">
                      {addressData.realTime.latestBlock.toLocaleString()}
                    </span>
                  </div>
                )}

                <div className="info-item">
                  <span className="label">Last Updated</span>
                  <span className="value">{new Date().toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className={cardStyles}>
              <h2>Recent Transactions</h2>
              {txLoading && (
                <div style={{ color: "#666", textAlign: "center", padding: 20 }}>
                  Loading transactions...
                </div>
              )}
              {txError && (
                <div style={{ color: "#c33", padding: "8px 0" }}>
                  {txError}
                </div>
              )}
              {!txLoading && !txError && transactions.length === 0 && (
                <div style={{ color: "#666", textAlign: "center", padding: 20 }}>
                  No transactions found
                </div>
              )}
              {transactions.length > 0 && (
                <>
                  <table className={txTableStyles}>
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
                      {transactions.map((tx) => {
                        const dir = getDirection(tx);
                        const symbol = getChainSymbol(currentChainId);
                        const valueEth = (() => {
                          try {
                            const v = parseFloat(tx.value) / 1e18;
                            if (v === 0) return `0 ${symbol}`;
                            if (v < 0.0001) return `<0.0001 ${symbol}`;
                            return `${v.toFixed(4)} ${symbol}`;
                          } catch {
                            return tx.value;
                          }
                        })();
                        const fmtAddr = (a: string) =>
                          a ? `${a.slice(0, 8)}...${a.slice(-6)}` : "N/A";
                        const fmtHash = (h: string) =>
                          h ? `${h.slice(0, 10)}...${h.slice(-8)}` : "";

                        return (
                          <tr key={tx.hash}>
                            <td>
                              <Link
                                to={`/chain/${currentChainId}/tx/${tx.hash}`}
                                className={txLinkStyles}
                              >
                                {fmtHash(tx.hash)}
                              </Link>
                            </td>
                            <td>
                              <Link
                                to={`/chain/${currentChainId}/block/${tx.blockNumber}`}
                                className={txLinkStyles}
                              >
                                {parseInt(tx.blockNumber).toLocaleString()}
                              </Link>
                            </td>
                            <td style={{ fontSize: 12, color: "#666" }}>
                              {tx.timestamp
                                ? formatRelativeTime(tx.timestamp)
                                : "N/A"}
                            </td>
                            <td>
                              <span className={`${directionBadge} ${dir}`}>
                                {dir === "in"
                                  ? "IN"
                                  : dir === "out"
                                    ? "OUT"
                                    : "SELF"}
                              </span>
                            </td>
                            <td>
                              <Link
                                to={`/chain/${currentChainId}/address/${tx.fromAddress}`}
                                className={txLinkStyles}
                              >
                                {fmtAddr(tx.fromAddress)}
                              </Link>
                            </td>
                            <td>
                              <Link
                                to={`/chain/${currentChainId}/address/${tx.toAddress}`}
                                className={txLinkStyles}
                              >
                                {fmtAddr(tx.toAddress)}
                              </Link>
                            </td>
                            <td style={{ fontFamily: "monospace", fontSize: 13 }}>
                              {valueEth}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className={paginationStyles}>
                    <span className="page-info">
                      Page {txPage} of {txTotalPages}
                    </span>
                    <div className="page-buttons">
                      <button
                        disabled={txPage <= 1}
                        onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                      >
                        Prev
                      </button>
                      <button
                        disabled={txPage >= txTotalPages}
                        onClick={() => setTxPage((p) => p + 1)}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
