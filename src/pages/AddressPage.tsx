import { useParams, useNavigate } from "react-router-dom";
import { css } from "@linaria/core";
import { getChainInfo, getChainName, getChainSymbol } from "../config/chains";
import TopNavigation from "../components/TopNavigation";
import { useAddressData } from "../hooks/useAddressData";

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

export default function AddressPage() {
  const { chainId, address } = useParams<{
    chainId: string;
    address: string;
  }>();
  const navigate = useNavigate();

  const currentChainId = parseInt(chainId || "1");
  const chainInfo = getChainInfo(currentChainId);

  // 使用新的数据分离架构
  const addressData = useAddressData(currentChainId, address || "");

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
              <div style={{ color: "#666", fontStyle: "italic" }}>
                Transaction history will be implemented in the next update.
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
