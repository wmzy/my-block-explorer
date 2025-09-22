import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { css } from "@linaria/core";
import { getChainName, isChainSupported } from "@/config/chains";

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
  verificationSource: "sourcify" | "etherscan" | "manual" | "unknown";
  verifiedAt?: string;
  lastChecked: string;
};

type ContractFunction = {
  name: string;
  type: string;
  inputs: any[];
  outputs: any[];
  signature: string;
};

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
    "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas,
    "Courier New", monospace;
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
  const [contractSource, setContractSource] = useState<ContractSource | null>(null);
  const [contractABI, setContractABI] = useState<ContractABI | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"source" | "abi" | "functions" | "events">("source");

  const currentChainId = parseInt(chainId || "1");

  useEffect(() => {
    if (!chainId || !address) return;

    fetchContractData();
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
        throw new Error(`HTTP ${sourceResponse.status}: ${sourceResponse.statusText}`);
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
        err instanceof Error ? err.message : "Failed to fetch contract information"
      );
    } finally {
      setLoading(false);
    }
  };

  if (!chainId || !address) {
    return (
      <div className={pageStyles}>
        <div className={errorStyles}>Invalid contract address or chain ID</div>
      </div>
    );
  }

  if (!isChainSupported(currentChainId)) {
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
        onClick={() => navigate(`/chain/${currentChainId}/address/${address}`)}
      >
        ← Back to Address
      </button>

      <div className={headerStyles}>
        <h1>Contract Source Code</h1>
        <div className="chain-info">
          {getChainName(currentChainId)} • <span className="address">{address}</span>
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
                <span className={`${statusBadgeStyles} ${contractSource.verificationStatus}`}>
                  {contractSource.verificationStatus}
                </span>
              </div>
              <div className="info-item">
                <span className="label">Verification Source</span>
                <span className="value">{contractSource.verificationSource}</span>
              </div>
              {contractSource.compilerVersion && (
                <div className="info-item">
                  <span className="label">Compiler Version</span>
                  <span className="value">{contractSource.compilerVersion}</span>
                </div>
              )}
              {contractSource.optimizationEnabled !== undefined && (
                <div className="info-item">
                  <span className="label">Optimization</span>
                  <span className="value">
                    {contractSource.optimizationEnabled ? "Enabled" : "Disabled"}
                    {contractSource.optimizationRuns && ` (${contractSource.optimizationRuns} runs)`}
                  </span>
                </div>
              )}
            </div>
          </div>

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
            {contractABI && contractABI.functions.length > 0 && (
              <button
                className={`tab ${activeTab === "functions" ? "active" : ""}`}
                onClick={() => setActiveTab("functions")}
              >
                Functions ({contractABI.functions.length})
              </button>
            )}
            {contractABI && contractABI.events.length > 0 && (
              <button
                className={`tab ${activeTab === "events" ? "active" : ""}`}
                onClick={() => setActiveTab("events")}
              >
                Events ({contractABI.events.length})
              </button>
            )}
          </div>

          {activeTab === "source" && (
            <div className={cardStyles}>
              <h2>Source Code</h2>
              {contractSource.sourceCode ? (
                <div className={codeStyles}>{contractSource.sourceCode}</div>
              ) : (
                <div>No source code available</div>
              )}
            </div>
          )}

          {activeTab === "abi" && (
            <div className={cardStyles}>
              <h2>Contract ABI</h2>
              <div className={codeStyles}>
                {contractSource.abi ? 
                  JSON.stringify(JSON.parse(contractSource.abi), null, 2) : 
                  "No ABI available"
                }
              </div>
            </div>
          )}

          {activeTab === "functions" && contractABI && (
            <div className={cardStyles}>
              <h2>Contract Functions</h2>
              {contractABI.functions.length > 0 ? (
                <div className={functionListStyles}>
                  {contractABI.functions.map((func, index) => (
                    <div key={index} className={`function-item ${func.type}`}>
                      <div className="function-signature">{func.signature}</div>
                      <span className="function-type">{func.type}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div>No functions found</div>
              )}
            </div>
          )}

          {activeTab === "events" && contractABI && (
            <div className={cardStyles}>
              <h2>Contract Events</h2>
              {contractABI.events.length > 0 ? (
                <div className={functionListStyles}>
                  {contractABI.events.map((event, index) => (
                    <div key={index} className="function-item">
                      <div className="function-signature">{event.signature}</div>
                      <span className="function-type">Event</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div>No events found</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
