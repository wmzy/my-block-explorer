import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { css } from "@linaria/core";
import { getChainInfo, getChainName, getChainSymbol } from "../config/chains";

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

type AddressInfo = {
  chainId: number;
  address: string;
  balance: string;
  transactionCount: number;
  isContract: boolean;
  firstSeenBlock?: string;
  lastSeenBlock?: string;
  lastQueried: string;
};

export default function AddressPage() {
  const { chainId, address } = useParams<{
    chainId: string;
    address: string;
  }>();
  const navigate = useNavigate();
  const [addressInfo, setAddressInfo] = useState<AddressInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentChainId = parseInt(chainId || "1");
  const chainInfo = getChainInfo(currentChainId);

  useEffect(() => {
    if (!address || !chainId) {
      setError("Invalid address or chain ID");
      setLoading(false);
      return;
    }

    fetchAddressInfo();
  }, [chainId, address]);

  const fetchAddressInfo = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `/api/chains/${currentChainId}/addresses/${address}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      setAddressInfo(data.address);
    } catch (err) {
      console.error("Failed to fetch address info:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch address information"
      );
    } finally {
      setLoading(false);
    }
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
        <h1>Address Details</h1>
        <div className="chain-info">
          {getChainName(currentChainId)} • Chain ID: {currentChainId}
        </div>
      </div>

      {loading && (
        <div className={loadingStyles}>Loading address information...</div>
      )}

      {error && <div className={errorStyles}>Error: {error}</div>}

      {addressInfo && (
        <>
          <div className={cardStyles}>
            <h2>Overview</h2>
            <div className={infoGridStyles}>
              <div className="info-item">
                <span className="label">Address</span>
                <span className="value">{addressInfo.address}</span>
              </div>
              <div className="info-item">
                <span className="label">Balance</span>
                <span className="value">
                  {formatBalance(
                    addressInfo.balance,
                    getChainSymbol(currentChainId)
                  )}
                </span>
              </div>
              <div className="info-item">
                <span className="label">Transaction Count</span>
                <span className="value">
                  {addressInfo.transactionCount.toLocaleString()}
                </span>
              </div>
              <div className="info-item">
                <span className="label">Type</span>
                <span className="value">
                  {addressInfo.isContract
                    ? "Contract"
                    : "Externally Owned Account (EOA)"}
                </span>
              </div>
              {addressInfo.isContract && addressInfo.contractName && (
                <div className="info-item">
                  <span className="label">Contract Name</span>
                  <span className="value">{addressInfo.contractName}</span>
                </div>
              )}
              {addressInfo.isContract && addressInfo.verificationStatus && (
                <div className="info-item">
                  <span className="label">Verification Status</span>
                  <span className="value">
                    {addressInfo.verificationStatus === "verified" &&
                      "✅ Verified"}
                    {addressInfo.verificationStatus === "partial" &&
                      "⚠️ Partially Verified"}
                    {addressInfo.verificationStatus === "unverified" &&
                      "❌ Unverified"}
                  </span>
                </div>
              )}
              {addressInfo.isContract && addressInfo.hasSourceCode && (
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
              {addressInfo.firstSeenBlock && (
                <div className="info-item">
                  <span className="label">First Seen Block</span>
                  <span className="value">{addressInfo.firstSeenBlock}</span>
                </div>
              )}
              {addressInfo.lastSeenBlock && (
                <div className="info-item">
                  <span className="label">Last Seen Block</span>
                  <span className="value">{addressInfo.lastSeenBlock}</span>
                </div>
              )}
              <div className="info-item">
                <span className="label">Last Updated</span>
                <span className="value">
                  {new Date(addressInfo.lastQueried).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <div className={cardStyles}>
            <h2>Recent Transactions</h2>
            <div style={{ color: "#666", fontStyle: "italic" }}>
              Transaction history will be implemented in the next update.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
