import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { css } from "@linaria/core";
import { getChainName, isChainSupported } from "@/config/chains";
import {
  parseContractFunctions,
  readContract,
  simulateContract,
  estimateContractGas,
  type ContractFunction,
} from "../utils/contractInteraction";
import TopNavigation from "../components/TopNavigation";
import RpcFunctionError from "../components/RpcFunctionError";
import RpcConfig from "../components/RpcConfig";
import EventTable from "../components/events/EventTable";
import EventStatistics from "../components/events/EventStatistics";

type ContractSource = {
  chainId: number;
  address: string;
  name?: string;
  compilerVersion?: string;
  optimizationEnabled?: boolean;
  optimizationRuns?: number;
  sourceCode: string;
  abi: string;
  constructorArguments?: string;
  verificationStatus: "verified" | "unverified" | "partial";
  verificationSource:
    | "sourcify"
    | "etherscan"
    | "mantle-explorer"
    | "manual"
    | "unknown";
  verifiedAt?: string;
  lastChecked: string;
  // Proxy contract support
  isProxy?: boolean;
  proxyType?: "transparent" | "uups" | "beacon" | "minimal" | "unknown";
  implementationAddress?: string;
  implementationContract?: ContractSource;
};

type ContractCreationInfo = {
  txHash: string;
  blockNumber: number;
  creator: string;
  timestamp: number;
  gasUsed: string;
  gasPrice: string;
};

// ContractFunction 类型现在从 contractInteraction 导入

type ContractEvent = {
  name: string;
  inputs: any[];
  signature: string;
};

type ContractABI = {
  abi: string;
  functions: ContractFunction[];
  events: ContractEvent[];
  errors: any[];
  verificationStatus: string;
};

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
    margin: 0 0 8px 0;
    color: #1a1a1a;
  }

  .chain-info {
    color: #666;
    font-size: 14px;
  }

  .address {
    font-family:
      "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas,
      "Courier New", monospace;
    background: #f8f9fa;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 14px;
  }
`;

const tabsStyles = css`
  display: flex;
  border-bottom: 1px solid #e1e5e9;
  margin-bottom: 20px;

  .tab {
    padding: 12px 20px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    color: #666;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;

    &:hover {
      color: #1a1a1a;
    }

    &.active {
      color: #007bff;
      border-bottom-color: #007bff;
    }
  }
`;

const cardStyles = css`
  background: white;
  border: 1px solid #e1e5e9;
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 20px;

  h2 {
    font-size: 18px;
    margin: 0 0 16px 0;
    color: #1a1a1a;
  }
`;

const codeStyles = css`
  background: #f8f9fa;
  border: 1px solid #e1e5e9;
  border-radius: 6px;
  padding: 16px;
  overflow-x: auto;
  font-family:
    "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New",
    monospace;
  font-size: 13px;
  line-height: 1.4;
  white-space: pre-wrap;
  max-height: 500px;
  overflow-y: auto;
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

const functionListStyles = css`
  .function-item {
    background: #f8f9fa;
    border: 1px solid #e1e5e9;
    border-radius: 6px;
    padding: 12px 16px;
    margin-bottom: 8px;

    .function-signature {
      font-family:
        "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas,
        "Courier New", monospace;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 4px;
    }

    .function-type {
      display: inline-block;
      background: #007bff;
      color: white;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 3px;
      text-transform: uppercase;
    }

    &.view .function-type {
      background: #28a745;
    }

    &.payable .function-type {
      background: #ffc107;
      color: #000;
    }
  }
`;

const loadingStyles = css`
  text-align: center;
  padding: 40px;
  color: #666;
`;

const errorStyles = css`
  background: #f8d7da;
  color: #721c24;
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 20px;
`;

const backButtonStyles = css`
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  color: #495057;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  margin-bottom: 20px;
  display: inline-block;

  &:hover {
    background: #e9ecef;
  }
`;

const statusBadgeStyles = css`
  display: inline-block;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;

  &.verified {
    background: #d4edda;
    color: #155724;
  }

  &.unverified {
    background: #f8d7da;
    color: #721c24;
  }

  &.partial {
    background: #fff3cd;
    color: #856404;
  }
`;

export default function ContractPage() {
  const { chainId, address } = useParams<{
    chainId: string;
    address: string;
  }>();
  const navigate = useNavigate();
  const [contractSource, setContractSource] = useState<ContractSource | null>(
    null
  );
  const [contractABI, setContractABI] = useState<ContractABI | null>(null);
  const [creationInfo, setCreationInfo] = useState<ContractCreationInfo | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creationLoading, setCreationLoading] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [showRpcConfig, setShowRpcConfig] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "source" | "abi" | "functions" | "events" | "interact" | "implementation"
  >("source");
  const [showImplementation, setShowImplementation] = useState(true); // 默认显示实现合约

  const currentChainId = parseInt(chainId || "1");

  const handleChainChange = (newChainId: number) => {
    navigate(`/chain/${newChainId}/contract/${address}`, { replace: true });
  };

  // 获取当前要显示的合约信息（代理或实现）
  const getCurrentContract = (): ContractSource | null => {
    if (!contractSource) return null;

    // 如果不是代理合约，直接返回原合约
    if (!contractSource.isProxy) return contractSource;

    // 如果是代理合约，根据 showImplementation 状态决定显示哪个
    if (showImplementation && contractSource.implementationContract) {
      return contractSource.implementationContract;
    }

    return contractSource;
  };

  // 获取当前合约的 ABI 信息
  const getCurrentContractABI = (): ContractABI | null => {
    const currentContract = getCurrentContract();
    if (!currentContract?.abi) return null;

    try {
      const abi = JSON.parse(currentContract.abi);
      const functions = abi.filter((item: any) => item.type === "function");
      const events = abi.filter((item: any) => item.type === "event");
      const errors = abi.filter((item: any) => item.type === "error");

      return {
        abi: currentContract.abi,
        functions: functions.map((f: any) => ({
          name: f.name,
          type: f.type,
          inputs: f.inputs || [],
          outputs: f.outputs || [],
          signature: `${f.name}(${(f.inputs || []).map((input: any) => input.type).join(", ")})`,
        })),
        events: events.map((e: any) => ({
          name: e.name,
          inputs: e.inputs || [],
          signature: `${e.name}(${(e.inputs || []).map((input: any) => input.type).join(", ")})`,
        })),
        errors,
        verificationStatus: currentContract.verificationStatus,
      };
    } catch (error) {
      console.error("Failed to parse ABI:", error);
      return null;
    }
  };

  useEffect(() => {
    if (!chainId || !address) return;

    fetchContractData();
    fetchContractCreationInfo();
  }, [chainId, address]);

  const fetchContractData = async () => {
    if (!chainId || !address) return;

    setLoading(true);
    setError(null);

    try {
      const [sourceResponse, abiResponse] = await Promise.all([
        fetch(`/api/chains/${currentChainId}/contracts/${address}/source`),
        fetch(`/api/chains/${currentChainId}/contracts/${address}/abi`),
      ]);

      if (!sourceResponse.ok) {
        if (sourceResponse.status === 404) {
          throw new Error("Contract not found or not verified");
        }
        throw new Error(
          `HTTP ${sourceResponse.status}: ${sourceResponse.statusText}`
        );
      }

      const sourceData = await sourceResponse.json();
      setContractSource(sourceData.contractSource);

      if (abiResponse.ok) {
        const abiData = await abiResponse.json();
        setContractABI({
          abi: abiData.abi,
          functions: abiData.functions,
          events: abiData.events,
          errors: abiData.errors,
          verificationStatus: abiData.verificationStatus,
        });
      }
    } catch (err) {
      console.error("Failed to fetch contract data:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch contract information"
      );
    } finally {
      setLoading(false);
    }
  };

  const fetchContractCreationInfo = async () => {
    if (!chainId || !address) return;

    setCreationLoading(true);
    setCreationError(null);

    try {
      const response = await fetch(
        `/api/chains/${currentChainId}/contracts/${address}/creation`
      );

      if (response.ok) {
        const data = await response.json();
        if (data.found) {
          setCreationInfo(data.creation);
        } else {
          // 没有找到创建信息，可能是RPC节点限制
          setCreationError(
            "无法获取合约创建信息，可能是RPC节点不支持历史状态查询"
          );
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        setCreationError(
          errorData.error || `HTTP ${response.status}: ${response.statusText}`
        );
      }
    } catch (err) {
      console.error("Failed to fetch contract creation info:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setCreationError(errorMessage);
    } finally {
      setCreationLoading(false);
    }
  };

  if (!chainId || !address) {
    return (
      <>
        <TopNavigation
          currentChainId={currentChainId}
          onChainChange={handleChainChange}
        />
        <div className={pageStyles}>
          <div className={errorStyles}>
            Invalid contract address or chain ID
          </div>
        </div>
      </>
    );
  }

  if (!isChainSupported(currentChainId)) {
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
          onClick={() =>
            navigate(`/chain/${currentChainId}/address/${address}`)
          }
        >
          ← Back to Address
        </button>

        <div className={headerStyles}>
          <h1>Contract Source Code</h1>
          <div className="chain-info">
            {getChainName(currentChainId)} •{" "}
            <span className="address">{address}</span>
          </div>
        </div>

        {loading && (
          <div className={loadingStyles}>Loading contract information...</div>
        )}

        {error && <div className={errorStyles}>Error: {error}</div>}

        {contractSource && (
          <>
            <div className={cardStyles}>
              <h2>Contract Information</h2>
              <div className={infoGridStyles}>
                {contractSource.name && (
                  <div className="info-item">
                    <span className="label">Contract Name</span>
                    <span className="value">{contractSource.name}</span>
                  </div>
                )}
                <div className="info-item">
                  <span className="label">Verification Status</span>
                  <span
                    className={`${statusBadgeStyles} ${contractSource.verificationStatus}`}
                  >
                    {contractSource.verificationStatus}
                  </span>
                </div>
                <div className="info-item">
                  <span className="label">Verification Source</span>
                  <span className="value">
                    {contractSource.verificationSource}
                  </span>
                </div>
                {contractSource.compilerVersion && (
                  <div className="info-item">
                    <span className="label">Compiler Version</span>
                    <span className="value">
                      {contractSource.compilerVersion}
                    </span>
                  </div>
                )}
                {contractSource.optimizationEnabled !== undefined && (
                  <div className="info-item">
                    <span className="label">Optimization</span>
                    <span className="value">
                      {contractSource.optimizationEnabled
                        ? "Enabled"
                        : "Disabled"}
                      {contractSource.optimizationRuns &&
                        ` (${contractSource.optimizationRuns} runs)`}
                    </span>
                  </div>
                )}
                {contractSource.isProxy && (
                  <div className="info-item">
                    <span className="label">Proxy Type</span>
                    <span className="value proxy-badge">
                      🔗 {contractSource.proxyType?.toUpperCase() || "UNKNOWN"}{" "}
                      Proxy
                    </span>
                  </div>
                )}
                {contractSource.implementationAddress && (
                  <div className="info-item">
                    <span className="label">Implementation</span>
                    <span className="value">
                      <a
                        href={`/chain/${currentChainId}/contract/${contractSource.implementationAddress}`}
                        style={{ color: "#007bff", textDecoration: "none" }}
                        onMouseOver={(e) =>
                          ((e.target as HTMLElement).style.textDecoration =
                            "underline")
                        }
                        onMouseOut={(e) =>
                          ((e.target as HTMLElement).style.textDecoration =
                            "none")
                        }
                      >
                        {contractSource.implementationAddress}
                      </a>
                    </span>
                  </div>
                )}

                {/* Contract Creation Information */}
                {creationInfo && (
                  <>
                    <div className="info-item">
                      <span className="label">Creation Transaction</span>
                      <span className="value">
                        <a
                          href={`/chain/${currentChainId}/tx/${creationInfo.txHash}`}
                          style={{ color: "#007bff", textDecoration: "none" }}
                          onMouseOver={(e) =>
                            ((e.target as HTMLElement).style.textDecoration =
                              "underline")
                          }
                          onMouseOut={(e) =>
                            ((e.target as HTMLElement).style.textDecoration =
                              "none")
                          }
                        >
                          {creationInfo.txHash}
                        </a>
                      </span>
                    </div>
                    <div className="info-item">
                      <span className="label">Creation Block</span>
                      <span className="value">
                        <a
                          href={`/chain/${currentChainId}/block/${creationInfo.blockNumber}`}
                          style={{ color: "#007bff", textDecoration: "none" }}
                          onMouseOver={(e) =>
                            ((e.target as HTMLElement).style.textDecoration =
                              "underline")
                          }
                          onMouseOut={(e) =>
                            ((e.target as HTMLElement).style.textDecoration =
                              "none")
                          }
                        >
                          #{creationInfo.blockNumber}
                        </a>
                      </span>
                    </div>
                    <div className="info-item">
                      <span className="label">Creator</span>
                      <span className="value">
                        <a
                          href={`/chain/${currentChainId}/address/${creationInfo.creator}`}
                          style={{ color: "#007bff", textDecoration: "none" }}
                          onMouseOver={(e) =>
                            ((e.target as HTMLElement).style.textDecoration =
                              "underline")
                          }
                          onMouseOut={(e) =>
                            ((e.target as HTMLElement).style.textDecoration =
                              "none")
                          }
                        >
                          {creationInfo.creator}
                        </a>
                      </span>
                    </div>
                    <div className="info-item">
                      <span className="label">Creation Time</span>
                      <span className="value">
                        {new Date(
                          creationInfo.timestamp * 1000
                        ).toLocaleString()}
                      </span>
                    </div>
                    <div className="info-item">
                      <span className="label">Gas Used</span>
                      <span className="value">
                        {parseInt(creationInfo.gasUsed).toLocaleString()} gas
                      </span>
                    </div>
                  </>
                )}

                {creationLoading && (
                  <div className="info-item">
                    <span className="label">Creation Info</span>
                    <span className="value">Loading...</span>
                  </div>
                )}

                {/* RPC错误提示 */}
                {creationError && (
                  <RpcFunctionError
                    functionName="getContractCreationInfo"
                    chainId={currentChainId}
                    chainName={getChainName(currentChainId)}
                    error={creationError}
                    onConfigureRpc={() => setShowRpcConfig(true)}
                    onRetry={fetchContractCreationInfo}
                  />
                )}
              </div>
            </div>

            {contractSource.isProxy &&
              contractSource.implementationContract && (
                <div className={cardStyles}>
                  <h2>Contract View</h2>
                  <div
                    style={{
                      display: "flex",
                      gap: "10px",
                      marginBottom: "20px",
                    }}
                  >
                    <button
                      onClick={() => setShowImplementation(false)}
                      style={{
                        padding: "8px 16px",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                        background: !showImplementation ? "#007bff" : "#fff",
                        color: !showImplementation ? "#fff" : "#333",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      Show Proxy Contract
                    </button>
                    <button
                      onClick={() => setShowImplementation(true)}
                      style={{
                        padding: "8px 16px",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                        background: showImplementation ? "#007bff" : "#fff",
                        color: showImplementation ? "#fff" : "#333",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      Show Implementation Contract
                    </button>
                  </div>
                  <div style={{ fontSize: "14px", color: "#666" }}>
                    Currently showing:{" "}
                    <strong>
                      {showImplementation
                        ? `Implementation (${contractSource.implementationContract.name || "Unknown"})`
                        : `Proxy (${contractSource.name || "Unknown"})`}
                    </strong>
                  </div>
                </div>
              )}

            <div className={tabsStyles}>
              <button
                className={`tab ${activeTab === "source" ? "active" : ""}`}
                onClick={() => setActiveTab("source")}
              >
                Source Code
              </button>
              <button
                className={`tab ${activeTab === "abi" ? "active" : ""}`}
                onClick={() => setActiveTab("abi")}
              >
                ABI
              </button>
              {(() => {
                const currentABI = getCurrentContractABI();
                return (
                  currentABI &&
                  currentABI.functions.length > 0 && (
                    <button
                      className={`tab ${activeTab === "functions" ? "active" : ""}`}
                      onClick={() => setActiveTab("functions")}
                    >
                      Functions ({currentABI.functions.length})
                    </button>
                  )
                );
              })()}
              {(() => {
                const currentABI = getCurrentContractABI();
                return (
                  currentABI &&
                  currentABI.events.length > 0 && (
                    <button
                      className={`tab ${activeTab === "events" ? "active" : ""}`}
                      onClick={() => setActiveTab("events")}
                    >
                      Events ({currentABI.events.length})
                    </button>
                  )
                );
              })()}
              {(() => {
                const currentABI = getCurrentContractABI();
                return (
                  currentABI &&
                  (currentABI.functions.length > 0 ||
                    currentABI.events.length > 0) && (
                    <button
                      className={`tab ${activeTab === "interact" ? "active" : ""}`}
                      onClick={() => setActiveTab("interact")}
                    >
                      Interact
                    </button>
                  )
                );
              })()}
            </div>

            {activeTab === "source" && (
              <div className={cardStyles}>
                <h2>Source Code</h2>
                {(() => {
                  const currentContract = getCurrentContract();
                  return currentContract?.sourceCode ? (
                    <div className={codeStyles}>
                      {currentContract.sourceCode}
                    </div>
                  ) : (
                    <div>No source code available</div>
                  );
                })()}
              </div>
            )}

            {activeTab === "abi" && (
              <div className={cardStyles}>
                <h2>Contract ABI</h2>
                <div className={codeStyles}>
                  {(() => {
                    const currentContract = getCurrentContract();
                    return currentContract?.abi
                      ? JSON.stringify(JSON.parse(currentContract.abi), null, 2)
                      : "No ABI available";
                  })()}
                </div>
              </div>
            )}

            {activeTab === "functions" && (
              <div className={cardStyles}>
                <h2>Contract Functions</h2>
                {(() => {
                  const currentABI = getCurrentContractABI();
                  return currentABI && currentABI.functions.length > 0 ? (
                    <div className={functionListStyles}>
                      {currentABI.functions.map((func, index) => (
                        <div
                          key={index}
                          className={`function-item ${func.type}`}
                        >
                          <div className="function-signature">
                            {func.name}(
                            {func.inputs
                              .map((input) => `${input.type} ${input.name}`)
                              .join(", ")}
                            )
                          </div>
                          <span className="function-type">{func.type}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div>No functions found</div>
                  );
                })()}
              </div>
            )}

            {activeTab === "events" && (
              <>
                <EventStatistics
                  chainId={currentChainId}
                  contractAddress={address!}
                />
                <EventTable
                  chainId={currentChainId}
                  contractAddress={address!}
                  abiEvents={getCurrentContractABI()?.events || []}
                  enableDynamicFiltering={true}
                />
              </>
            )}

            {activeTab === "interact" && (
              <ContractInteract
                chainId={currentChainId}
                contractAddress={address!}
                contractSource={getCurrentContract()}
              />
            )}
          </>
        )}

        {/* RPC 配置弹窗 */}
        <RpcConfig
          isOpen={showRpcConfig}
          onClose={() => setShowRpcConfig(false)}
          chainId={currentChainId}
          onConfigSaved={() => {
            setCreationError(null);
            fetchContractCreationInfo();
          }}
        />
      </div>
    </>
  );
}

// 合约交互组件
function ContractInteract({
  chainId,
  contractAddress,
  contractSource,
}: {
  chainId: number;
  contractAddress: string;
  contractSource: ContractSource | null;
}) {
  const [readFunctions, setReadFunctions] = useState<ContractFunction[]>([]);
  const [writeFunctions, setWriteFunctions] = useState<ContractFunction[]>([]);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>(
    {}
  );

  useEffect(() => {
    if (contractSource && contractSource.abi) {
      loadContractFunctions();
    }
  }, [chainId, contractAddress, contractSource]);

  const loadContractFunctions = async () => {
    try {
      setLoading(true);

      if (!contractSource) {
        return;
      }

      // 获取要使用的 ABI（代理合约使用实现合约的 ABI）
      let targetABI = contractSource.abi;
      if (contractSource.isProxy && contractSource.implementationContract) {
        targetABI = contractSource.implementationContract.abi;
      }

      // 直接解析 ABI 获取函数列表
      const { readFunctions, writeFunctions } =
        parseContractFunctions(targetABI);
      setReadFunctions(readFunctions);
      setWriteFunctions(writeFunctions);
    } catch (error) {
      console.error("Failed to load contract functions:", error);
    } finally {
      setLoading(false);
    }
  };

  const callReadFunction = async (functionName: string, args: any[]) => {
    const key = `${functionName}-${JSON.stringify(args)}`;

    try {
      setLoadingStates((prev) => ({ ...prev, [key]: true }));
      setErrors((prev) => ({ ...prev, [key]: "" }));

      if (!contractSource) {
        setErrors((prev) => ({
          ...prev,
          [key]: "Contract source not available",
        }));
        return;
      }

      // 获取目标合约地址（代理合约使用实现合约地址）
      let targetAddress = contractAddress;
      if (contractSource.isProxy && contractSource.implementationAddress) {
        targetAddress = contractSource.implementationAddress;
      }

      // 获取要使用的 ABI
      let targetABI = contractSource.abi;
      if (contractSource.isProxy && contractSource.implementationContract) {
        targetABI = contractSource.implementationContract.abi;
      }

      // 直接调用 RPC
      const result = await readContract({
        chainId,
        contractAddress: targetAddress,
        functionName,
        args,
        abi: targetABI,
      });

      if (result.success) {
        setResults((prev) => ({ ...prev, [key]: result.result }));
      } else {
        setErrors((prev) => ({
          ...prev,
          [key]: result.error || "Unknown error",
        }));
      }
    } catch (error) {
      console.error("Read function call failed:", error);
      setErrors((prev) => ({ ...prev, [key]: "Network error" }));
    } finally {
      setLoadingStates((prev) => ({ ...prev, [key]: false }));
    }
  };

  const simulateWriteFunction = async (
    functionName: string,
    args: any[],
    value?: string,
    from?: string
  ) => {
    const key = `${functionName}-${JSON.stringify(args)}-${value || ""}-${from || ""}`;

    try {
      setLoadingStates((prev) => ({ ...prev, [key]: true }));
      setErrors((prev) => ({ ...prev, [key]: "" }));

      if (!contractSource) {
        setErrors((prev) => ({
          ...prev,
          [key]: "Contract source not available",
        }));
        return;
      }

      // 获取目标合约地址（代理合约使用实现合约地址）
      let targetAddress = contractAddress;
      if (contractSource.isProxy && contractSource.implementationAddress) {
        targetAddress = contractSource.implementationAddress;
      }

      // 获取要使用的 ABI
      let targetABI = contractSource.abi;
      if (contractSource.isProxy && contractSource.implementationContract) {
        targetABI = contractSource.implementationContract.abi;
      }

      // 直接调用 RPC 模拟
      const result = await simulateContract({
        chainId,
        contractAddress: targetAddress,
        functionName,
        args,
        value: value ? BigInt(value) : undefined,
        from,
        abi: targetABI,
      });

      if (result.success) {
        setResults((prev) => ({
          ...prev,
          [key]: {
            result: result.result,
            gasUsed: result.gasUsed?.toString(),
          },
        }));
      } else {
        setErrors((prev) => ({
          ...prev,
          [key]: result.error || "Unknown error",
        }));
      }
    } catch (error) {
      console.error("Simulate function call failed:", error);
      setErrors((prev) => ({ ...prev, [key]: "Network error" }));
    } finally {
      setLoadingStates((prev) => ({ ...prev, [key]: false }));
    }
  };

  if (loading) {
    return (
      <div className={cardStyles}>
        <h2>Contract Interaction</h2>
        <div>Loading contract functions...</div>
      </div>
    );
  }

  if (!contractSource || !contractSource.abi) {
    return (
      <div className={cardStyles}>
        <h2>Contract Interaction</h2>
        <div>Contract ABI not available</div>
      </div>
    );
  }

  return (
    <>
      {/* Read Functions */}
      {readFunctions.length > 0 && (
        <div className={cardStyles}>
          <h2>Read Functions</h2>
          <div className={functionListStyles}>
            {readFunctions.map((func, index) => (
              <FunctionCallForm
                key={`read-${index}`}
                func={func}
                onCall={callReadFunction}
                results={results}
                errors={errors}
                loadingStates={loadingStates}
                type="read"
              />
            ))}
          </div>
        </div>
      )}

      {/* Write Functions */}
      {writeFunctions.length > 0 && (
        <div className={cardStyles}>
          <h2>Write Functions (Simulation)</h2>
          <div
            style={{ marginBottom: "20px", fontSize: "14px", color: "#666" }}
          >
            ⚠️ These are simulations only. To execute transactions, use a Web3
            wallet.
          </div>
          <div className={functionListStyles}>
            {writeFunctions.map((func, index) => (
              <FunctionCallForm
                key={`write-${index}`}
                func={func}
                onCall={simulateWriteFunction}
                results={results}
                errors={errors}
                loadingStates={loadingStates}
                type="write"
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// CSS样式定义
const functionFormStyles = css`
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  background: #fafafa;
`;

const functionNameStyles = css`
  font-weight: 600;
  margin-bottom: 12px;
`;

const functionNameReadStyles = css`
  ${functionNameStyles}
  color: #0066cc;
`;

const functionNameWriteStyles = css`
  ${functionNameStyles}
  color: #cc6600;
`;

const mutabilityStyles = css`
  font-size: 12px;
  font-weight: normal;
  margin-left: 8px;
  color: #666;
`;

const inputGroupStyles = css`
  margin-bottom: 12px;
`;

const labelStyles = css`
  display: block;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 4px;
  color: #333;
`;

const inputStyles = css`
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-family: monospace;
  font-size: 13px;
`;

const buttonReadStyles = css`
  background: #0066cc;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;

  &:hover:not(:disabled) {
    background: #0052a3;
  }

  &:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
`;

const buttonWriteStyles = css`
  background: #cc6600;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;

  &:hover:not(:disabled) {
    background: #b85c00;
  }

  &:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
`;

const resultSuccessStyles = css`
  margin-top: 12px;
  padding: 12px;
  background: #e8f5e8;
  border-radius: 4px;
  border: 1px solid #4caf50;
`;

const resultTitleStyles = css`
  font-size: 14px;
  font-weight: 600;
  color: #2e7d32;
  margin-bottom: 8px;
`;

const resultContentStyles = css`
  font-family: monospace;
  font-size: 12px;
  color: #1b5e20;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
`;

const functionErrorStyles = css`
  margin-top: 12px;
  padding: 12px;
  background: #ffebee;
  border-radius: 4px;
  border: 1px solid #f44336;
`;

const functionErrorTitleStyles = css`
  font-size: 14px;
  font-weight: 600;
  color: #c62828;
  margin-bottom: 8px;
`;

const functionErrorContentStyles = css`
  font-size: 13px;
  color: #b71c1c;
`;

// 函数调用表单组件
function FunctionCallForm({
  func,
  onCall,
  results,
  errors,
  loadingStates,
  type,
}: {
  func: ContractFunction;
  onCall: (name: string, args: any[], value?: string, from?: string) => void;
  results: Record<string, any>;
  errors: Record<string, string>;
  loadingStates: Record<string, boolean>;
  type: "read" | "write";
}) {
  const [args, setArgs] = useState<string[]>(func.inputs.map(() => ""));
  const [value, setValue] = useState("");
  const [from, setFrom] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // 转换参数类型
    const processedArgs = args.map((arg, index) => {
      const inputType = func.inputs[index].type;

      if (arg.trim() === "") return "";

      if (inputType.startsWith("uint") || inputType.startsWith("int")) {
        return arg;
      }

      if (inputType === "bool") {
        return arg.toLowerCase() === "true";
      }

      return arg;
    });

    if (type === "read") {
      onCall(func.name, processedArgs);
    } else {
      onCall(func.name, processedArgs, value || undefined, from || undefined);
    }
  };

  const getResultKey = () => {
    if (type === "read") {
      return `${func.name}-${JSON.stringify(args)}`;
    } else {
      return `${func.name}-${JSON.stringify(args)}-${value || ""}-${from || ""}`;
    }
  };

  const resultKey = getResultKey();
  const result = results[resultKey];
  const error = errors[resultKey];
  const isLoading = loadingStates[resultKey];

  return (
    <div className={functionFormStyles}>
      <div
        className={
          type === "read" ? functionNameReadStyles : functionNameWriteStyles
        }
      >
        {func.name}
        <span className={mutabilityStyles}>{func.stateMutability}</span>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Function Arguments */}
        {func.inputs.map((input, index) => (
          <div key={index} className={inputGroupStyles}>
            <label className={labelStyles}>
              {input.name} ({input.type})
            </label>
            <input
              type="text"
              value={args[index]}
              onChange={(e) => {
                const newArgs = [...args];
                newArgs[index] = e.target.value;
                setArgs(newArgs);
              }}
              placeholder={`Enter ${input.type}`}
              className={inputStyles}
            />
          </div>
        ))}

        {/* Write function additional fields */}
        {type === "write" && (
          <>
            {func.stateMutability === "payable" && (
              <div className={inputGroupStyles}>
                <label className={labelStyles}>Value (wei)</label>
                <input
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="0"
                  className={inputStyles}
                />
              </div>
            )}

            <div className={inputGroupStyles}>
              <label className={labelStyles}>From Address (optional)</label>
              <input
                type="text"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="0x..."
                className={inputStyles}
              />
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className={type === "read" ? buttonReadStyles : buttonWriteStyles}
        >
          {isLoading ? "Loading..." : type === "read" ? "Query" : "Simulate"}
        </button>

        {/* Results */}
        {result !== undefined && (
          <div className={resultSuccessStyles}>
            <div className={resultTitleStyles}>Result:</div>
            <pre className={resultContentStyles}>
              {typeof result === "object"
                ? JSON.stringify(result, null, 2)
                : String(result)}
            </pre>
          </div>
        )}

        {/* Errors */}
        {error && (
          <div className={functionErrorStyles}>
            <div className={functionErrorTitleStyles}>Error:</div>
            <div className={functionErrorContentStyles}>{error}</div>
          </div>
        )}
      </form>
    </div>
  );
}
