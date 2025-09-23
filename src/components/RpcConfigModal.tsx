import React, { useState, useEffect } from "react";
import { css } from "@linaria/core";
import type { RpcConfig, RpcStatus } from "../types/rpc";
import {
  getRpcConfigs,
  saveRpcConfig,
  deleteRpcConfig,
  testRpcConnection,
} from "../utils/rpcConfig";
import { getChainName } from "../config/chains";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  chainId?: number;
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
  max-width: 600px;
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

const sectionStyles = css`
  margin-bottom: 24px;

  h3 {
    margin: 0 0 12px 0;
    font-size: 16px;
    font-weight: 600;
    color: #374151;
  }
`;

const rpcListStyles = css`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const rpcItemStyles = css`
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;

  &.active {
    border-color: #3b82f6;
    background: #eff6ff;
  }

  &.error {
    border-color: #ef4444;
    background: #fef2f2;
  }
`;

const rpcInfoStyles = css`
  flex: 1;

  .name {
    font-weight: 500;
    color: #111827;
    margin-bottom: 4px;
  }

  .url {
    font-size: 14px;
    color: #6b7280;
    font-family:
      "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas,
      "Courier New", monospace;
    margin-bottom: 4px;
  }

  .status {
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 4px;

    &.connected {
      color: #059669;
    }

    &.error {
      color: #dc2626;
    }

    &.testing {
      color: #d97706;
    }
  }
`;

const rpcActionsStyles = css`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const buttonStyles = css`
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;

  &.primary {
    background: #3b82f6;
    color: white;

    &:hover {
      background: #2563eb;
    }
  }

  &.secondary {
    background: #f3f4f6;
    color: #374151;

    &:hover {
      background: #e5e7eb;
    }
  }

  &.danger {
    background: #ef4444;
    color: white;

    &:hover {
      background: #dc2626;
    }
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const formStyles = css`
  display: flex;
  flex-direction: column;
  gap: 16px;

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;

    label {
      font-weight: 500;
      color: #374151;
      font-size: 14px;
    }

    input,
    select {
      padding: 10px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;

      &:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }
    }
  }

  .form-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
  }
`;

export default function RpcConfigModal({ isOpen, onClose, chainId }: Props) {
  const [configs, setConfigs] = useState<RpcConfig[]>([]);
  const [statuses, setStatuses] = useState<Map<string, RpcStatus>>(new Map());
  const [showAddForm, setShowAddForm] = useState(false);
  const [newConfig, setNewConfig] = useState({
    chainId: chainId || 1,
    name: "",
    url: "",
  });
  const [testing, setTesting] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) {
      loadConfigs();
    }
  }, [isOpen]);

  const loadConfigs = () => {
    const allConfigs = getRpcConfigs();
    setConfigs(allConfigs);

    // 测试所有配置的连接状态
    allConfigs.forEach((config) => {
      testConnection(config);
    });
  };

  const testConnection = async (config: RpcConfig) => {
    const key = `${config.chainId}-${config.url}`;
    setTesting((prev) => new Set([...prev, key]));

    try {
      const status = await testRpcConnection(config);
      setStatuses((prev) => new Map([...prev, [key, status]]));
    } catch (error) {
      console.error("Failed to test RPC connection:", error);
    } finally {
      setTesting((prev) => {
        const newSet = new Set(prev);
        newSet.delete(key);
        return newSet;
      });
    }
  };

  const handleAddConfig = async () => {
    if (!newConfig.name || !newConfig.url) {
      return;
    }

    const config: RpcConfig = {
      chainId: newConfig.chainId,
      name: newConfig.name,
      url: newConfig.url,
      isDefault: false,
      isCustom: true,
    };

    saveRpcConfig(config);
    setNewConfig({ chainId: chainId || 1, name: "", url: "" });
    setShowAddForm(false);
    loadConfigs();
  };

  const handleDeleteConfig = (config: RpcConfig) => {
    if (config.isDefault) {
      return; // 不能删除默认配置
    }

    deleteRpcConfig(config.chainId, config.url);
    loadConfigs();
  };

  const getStatusDisplay = (config: RpcConfig) => {
    const key = `${config.chainId}-${config.url}`;
    const status = statuses.get(key);
    const isTesting = testing.has(key);

    if (isTesting) {
      return <span className="status testing">🔄 测试中...</span>;
    }

    if (!status) {
      return <span className="status">⏳ 等待测试</span>;
    }

    switch (status.status) {
      case "connected":
        return (
          <span className="status connected">
            ✅ 已连接 {status.latency && `(${status.latency}ms)`}
          </span>
        );
      case "error":
        return (
          <span className="status error">❌ 连接失败: {status.error}</span>
        );
      default:
        return <span className="status">❓ 未知状态</span>;
    }
  };

  const getItemClassName = (config: RpcConfig) => {
    const key = `${config.chainId}-${config.url}`;
    const status = statuses.get(key);

    if (status?.status === "connected") {
      return "active";
    } else if (status?.status === "error") {
      return "error";
    }
    return "";
  };

  if (!isOpen) return null;

  return (
    <div className={overlayStyles} onClick={onClose}>
      <div className={modalStyles} onClick={(e) => e.stopPropagation()}>
        <div className={headerStyles}>
          <h2>RPC 节点配置</h2>
          <button className={closeButtonStyles} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={contentStyles}>
          <div className={sectionStyles}>
            <h3>当前 RPC 配置</h3>
            <div className={rpcListStyles}>
              {configs.map((config) => (
                <div
                  key={`${config.chainId}-${config.url}`}
                  className={`${rpcItemStyles} ${getItemClassName(config)}`}
                >
                  <div className={rpcInfoStyles}>
                    <div className="name">
                      {config.name}
                      {config.isDefault && (
                        <span style={{ color: "#3b82f6", fontSize: "12px" }}>
                          {" "}
                          (默认)
                        </span>
                      )}
                    </div>
                    <div className="url">{config.url}</div>
                    <div className="chain">
                      链 ID: {config.chainId} ({getChainName(config.chainId)})
                    </div>
                    {getStatusDisplay(config)}
                  </div>

                  <div className={rpcActionsStyles}>
                    <button
                      className={`${buttonStyles} secondary`}
                      onClick={() => testConnection(config)}
                      disabled={testing.has(`${config.chainId}-${config.url}`)}
                    >
                      测试
                    </button>
                    {!config.isDefault && (
                      <button
                        className={`${buttonStyles} danger`}
                        onClick={() => handleDeleteConfig(config)}
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={sectionStyles}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
              }}
            >
              <h3>添加自定义 RPC</h3>
              {!showAddForm && (
                <button
                  className={`${buttonStyles} primary`}
                  onClick={() => setShowAddForm(true)}
                >
                  + 添加 RPC
                </button>
              )}
            </div>

            {showAddForm && (
              <div className={formStyles}>
                <div className="form-group">
                  <label>链 ID</label>
                  <select
                    value={newConfig.chainId}
                    onChange={(e) =>
                      setNewConfig((prev) => ({
                        ...prev,
                        chainId: parseInt(e.target.value),
                      }))
                    }
                  >
                    <option value={1}>Ethereum (1)</option>
                    <option value={137}>Polygon (137)</option>
                    <option value={42161}>Arbitrum One (42161)</option>
                    <option value={10}>Optimism (10)</option>
                    <option value={8453}>Base (8453)</option>
                    <option value={5000}>Mantle (5000)</option>
                    <option value={11155111}>Sepolia (11155111)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>名称</label>
                  <input
                    type="text"
                    value={newConfig.name}
                    onChange={(e) =>
                      setNewConfig((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                    placeholder="例如: Alchemy, Infura, QuickNode"
                  />
                </div>

                <div className="form-group">
                  <label>RPC URL</label>
                  <input
                    type="url"
                    value={newConfig.url}
                    onChange={(e) =>
                      setNewConfig((prev) => ({ ...prev, url: e.target.value }))
                    }
                    placeholder="https://..."
                  />
                </div>

                <div className="form-actions">
                  <button
                    className={`${buttonStyles} secondary`}
                    onClick={() => {
                      setShowAddForm(false);
                      setNewConfig({
                        chainId: chainId || 1,
                        name: "",
                        url: "",
                      });
                    }}
                  >
                    取消
                  </button>
                  <button
                    className={`${buttonStyles} primary`}
                    onClick={handleAddConfig}
                    disabled={!newConfig.name || !newConfig.url}
                  >
                    添加
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
