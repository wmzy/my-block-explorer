import React, { useState, useEffect } from "react";
import { css } from "@linaria/core";
import { Dialog } from "haze-ui";
import { getChainName } from "../config/chains";

type RpcValidationResult = {
  connected: boolean;
  chainIdMatch: boolean;
  supportsHistoricalData: boolean;
  maxEventRange: number | null;
  latency: number;
  error?: string;
};

type ChainRpcConfig = {
  url: string;
  maxEventBlockRange: number;
  isDefault: boolean;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  chainId: number;
  onConfigSaved?: () => void;
};

const overlayStyles = css`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
`;

const modalStyles = css`
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 700px;
  max-height: 80vh;
  overflow: hidden;
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.1),
    0 10px 10px -5px rgba(0, 0, 0, 0.04);
`;

const headerStyles = css`
  padding: 20px 24px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: space-between;

  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #111827;
  }

  .chain-info {
    font-size: 14px;
    color: #6b7280;
  }
`;

const closeButtonStyles = css`
  background: none;
  border: none;
  font-size: 24px;
  color: #6b7280;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;

  &:hover {
    background: #f3f4f6;
    color: #374151;
  }
`;

const contentStyles = css`
  padding: 24px;
  max-height: 60vh;
  overflow-y: auto;
`;

const formStyles = css`
  display: flex;
  flex-direction: column;
  gap: 20px;

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 8px;

    label {
      font-weight: 600;
      color: #374151;
      font-size: 14px;
    }

    .help-text {
      font-size: 13px;
      color: #6b7280;
      line-height: 1.4;
    }

    input,
    select {
      padding: 12px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font-size: 14px;

      &:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      &.error {
        border-color: #ef4444;
      }
    }
  }
`;

const validationStyles = css`
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  margin-top: 16px;

  .validation-title {
    font-weight: 600;
    color: #374151;
    margin: 0 0 12px 0;
    font-size: 14px;
  }

  .validation-item {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 13px;

    .status {
      font-size: 16px;
    }

    .label {
      flex: 1;
      color: #4b5563;
    }

    .value {
      font-weight: 500;
      color: #374151;
    }

    &.success .status {
      color: #10b981;
    }

    &.error .status {
      color: #ef4444;
    }

    &.testing .status {
      color: #f59e0b;
    }
  }
`;

const buttonStyles = css`
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.2s;

  &.primary {
    background: #3b82f6;
    color: white;

    &:hover:not(:disabled) {
      background: #2563eb;
    }
  }

  &.secondary {
    background: #f3f4f6;
    color: #374151;
    border: 1px solid #d1d5db;

    &:hover:not(:disabled) {
      background: #e5e7eb;
    }
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const actionsStyles = css`
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding-top: 20px;
  border-top: 1px solid #e5e7eb;
  margin-top: 24px;
`;

export default function ChainRpcConfig({
  isOpen,
  onClose,
  chainId,
  onConfigSaved,
}: Props) {
  const [rpcUrl, setRpcUrl] = useState("");
  const [maxEventBlockRange, setMaxEventBlockRange] = useState(10000);
  const [validation, setValidation] = useState<RpcValidationResult | null>(
    null
  );
  const [isValidating, setIsValidating] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<ChainRpcConfig | null>(
    null
  );

  const chainName = getChainName(chainId);

  useEffect(() => {
    if (isOpen) {
      loadCurrentConfig();
    }
  }, [isOpen, chainId]);

  const loadCurrentConfig = () => {
    try {
      const stored = localStorage.getItem(`rpc-config-${chainId}`);
      if (stored) {
        const config = JSON.parse(stored) as ChainRpcConfig;
        setCurrentConfig(config);
        setRpcUrl(config.url);
        setMaxEventBlockRange(config.maxEventBlockRange);
      } else {
        // 设置默认值
        const defaultUrls: Record<number, string> = {
          1: "https://eth.llamarpc.com",
          137: "https://polygon.llamarpc.com",
          42161: "https://arbitrum.llamarpc.com",
          10: "https://optimism.llamarpc.com",
          8453: "https://base.llamarpc.com",
          5000: "https://rpc.mantle.xyz",
          11155111: "https://ethereum-sepolia.publicnode.com",
        };
        setRpcUrl(defaultUrls[chainId] || "");
        setMaxEventBlockRange(10000);
      }
    } catch (error) {
      console.error("Failed to load RPC config:", error);
    }
  };

  const validateRpc = async () => {
    if (!rpcUrl) return;

    setIsValidating(true);
    setValidation(null);

    try {
      const startTime = Date.now();

      // 1. 测试基本连接和链ID
      const chainIdResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_chainId",
          params: [],
          id: 1,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!chainIdResponse.ok) {
        throw new Error(
          `HTTP ${chainIdResponse.status}: ${chainIdResponse.statusText}`
        );
      }

      const chainIdData = await chainIdResponse.json();
      const latency = Date.now() - startTime;

      if (chainIdData.error) {
        throw new Error(chainIdData.error.message);
      }

      const actualChainId = parseInt(chainIdData.result, 16);
      const chainIdMatch = actualChainId === chainId;

      // 2. 测试历史数据支持
      let supportsHistoricalData = false;
      try {
        const blockNumber = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_blockNumber",
            params: [],
            id: 2,
          }),
        });

        const blockData = await blockNumber.json();
        if (!blockData.error) {
          const currentBlock = parseInt(blockData.result, 16);
          const testBlock = Math.max(1, currentBlock - 1000); // 测试1000个区块前的数据

          const historicalTest = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "eth_getBlockByNumber",
              params: [`0x${testBlock.toString(16)}`, false],
              id: 3,
            }),
          });

          const historicalData = await historicalTest.json();
          supportsHistoricalData =
            !historicalData.error && historicalData.result !== null;
        }
      } catch (error) {
        console.warn("Historical data test failed:", error);
      }

      // 3. 测试事件查询范围
      let maxEventRange: number | null = null;
      try {
        const blockNumber = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_blockNumber",
            params: [],
            id: 4,
          }),
        });

        const blockData = await blockNumber.json();
        if (!blockData.error) {
          const currentBlock = parseInt(blockData.result, 16);
          const testRanges = [maxEventBlockRange, 5000, 1000, 100];

          for (const range of testRanges) {
            try {
              const fromBlock = Math.max(1, currentBlock - range);
              const eventTest = await fetch(rpcUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  jsonrpc: "2.0",
                  method: "eth_getLogs",
                  params: [
                    {
                      fromBlock: `0x${fromBlock.toString(16)}`,
                      toBlock: `0x${currentBlock.toString(16)}`,
                      topics: [
                        "0x0000000000000000000000000000000000000000000000000000000000000000",
                      ], // 不存在的topic
                    },
                  ],
                  id: 5,
                }),
                signal: AbortSignal.timeout(5000),
              });

              const eventData = await eventTest.json();
              if (!eventData.error) {
                maxEventRange = range;
                break;
              }
            } catch (error) {
              continue;
            }
          }
        }
      } catch (error) {
        console.warn("Event range test failed:", error);
      }

      setValidation({
        connected: true,
        chainIdMatch,
        supportsHistoricalData,
        maxEventRange,
        latency,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      setValidation({
        connected: false,
        chainIdMatch: false,
        supportsHistoricalData: false,
        maxEventRange: null,
        latency: 0,
        error: errorMessage,
      });
    } finally {
      setIsValidating(false);
    }
  };

  const saveConfig = () => {
    if (!validation?.connected || !validation?.chainIdMatch) {
      return;
    }

    const config: ChainRpcConfig = {
      url: rpcUrl,
      maxEventBlockRange: validation.maxEventRange || maxEventBlockRange,
      isDefault: false,
    };

    try {
      localStorage.setItem(`rpc-config-${chainId}`, JSON.stringify(config));
      onConfigSaved?.();
      onClose();
    } catch (error) {
      console.error("Failed to save RPC config:", error);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className={modalStyles}>
        <div className={headerStyles}>
          <div>
            <h2>配置 {chainName} RPC 节点</h2>
            <div className="chain-info">Chain ID: {chainId}</div>
          </div>
          <button className={closeButtonStyles} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={contentStyles}>
          <div className={formStyles}>
            <div className="form-group">
              <label>RPC URL</label>
              <input
                type="url"
                value={rpcUrl}
                onChange={(e) => setRpcUrl(e.target.value)}
                placeholder="https://..."
                className={validation?.error ? "error" : ""}
              />
              <div className="help-text">
                请输入支持 {chainName} 的 RPC
                节点地址。建议使用支持历史数据查询的专业服务商。
              </div>
            </div>

            <div className="form-group">
              <label>最大事件查询区块范围</label>
              <input
                type="number"
                value={maxEventBlockRange}
                onChange={(e) =>
                  setMaxEventBlockRange(parseInt(e.target.value) || 1000)
                }
                min="100"
                max="100000"
              />
              <div className="help-text">
                单次事件查询的最大区块范围。不同RPC节点有不同限制，一般在1000-10000之间。
              </div>
            </div>

            <div>
              <button
                className={`${buttonStyles} secondary`}
                onClick={validateRpc}
                disabled={!rpcUrl || isValidating}
                style={{ width: "100%" }}
              >
                {isValidating ? "验证中..." : "验证 RPC 节点"}
              </button>
            </div>

            {validation && (
              <div className={validationStyles}>
                <div className="validation-title">验证结果</div>

                <div
                  className={`validation-item ${validation.connected ? "success" : "error"}`}
                >
                  <span className="status">
                    {validation.connected ? "✅" : "❌"}
                  </span>
                  <span className="label">连接状态</span>
                  <span className="value">
                    {validation.connected
                      ? `已连接 (${validation.latency}ms)`
                      : "连接失败"}
                  </span>
                </div>

                <div
                  className={`validation-item ${validation.chainIdMatch ? "success" : "error"}`}
                >
                  <span className="status">
                    {validation.chainIdMatch ? "✅" : "❌"}
                  </span>
                  <span className="label">链 ID 匹配</span>
                  <span className="value">
                    {validation.chainIdMatch
                      ? "正确"
                      : `错误 (期望: ${chainId})`}
                  </span>
                </div>

                <div
                  className={`validation-item ${validation.supportsHistoricalData ? "success" : "error"}`}
                >
                  <span className="status">
                    {validation.supportsHistoricalData ? "✅" : "❌"}
                  </span>
                  <span className="label">历史数据支持</span>
                  <span className="value">
                    {validation.supportsHistoricalData ? "支持" : "不支持"}
                  </span>
                </div>

                <div
                  className={`validation-item ${validation.maxEventRange ? "success" : "error"}`}
                >
                  <span className="status">
                    {validation.maxEventRange ? "✅" : "❌"}
                  </span>
                  <span className="label">事件查询范围</span>
                  <span className="value">
                    {validation.maxEventRange
                      ? `${validation.maxEventRange} 区块`
                      : "不支持"}
                  </span>
                </div>

                {validation.error && (
                  <div className="validation-item error">
                    <span className="status">❌</span>
                    <span className="label">错误信息</span>
                    <span className="value">{validation.error}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={actionsStyles}>
            <button className={`${buttonStyles} secondary`} onClick={onClose}>
              取消
            </button>
            <button
              className={`${buttonStyles} primary`}
              onClick={saveConfig}
              disabled={!validation?.connected || !validation?.chainIdMatch}
            >
              保存配置
            </button>
          </div>
        </div>
    </Dialog>
  );
}
