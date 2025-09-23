import React, { useState, useEffect } from "react";
import { css } from "@linaria/core";
import { getChainName } from "../config/chains";
import {
  getRpcConfigs,
  saveRpcConfig,
  deleteRpcConfig,
  testRpcConnection,
  type RpcConfig,
  type RpcTestResult,
} from "../utils/rpcConfigService";

const modalOverlayStyles = css`
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
`;

const modalContentStyles = css`
  background: white;
  border-radius: 8px;
  padding: 24px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
`;

const headerStyles = css`
  display: flex;
  justify-content: between;
  align-items: center;
  margin-bottom: 20px;

  h2 {
    margin: 0;
    color: #333;
  }

  button {
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: #666;

    &:hover {
      color: #333;
    }
  }
`;

const configListStyles = css`
  margin-bottom: 20px;

  .config-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
    margin-bottom: 8px;

    .config-info {
      flex: 1;

      .config-name {
        font-weight: 600;
        color: #333;
      }

      .config-url {
        font-size: 14px;
        color: #666;
        margin-top: 4px;
      }

      .config-status {
        font-size: 12px;
        margin-top: 4px;

        &.success {
          color: #28a745;
        }

        &.failed {
          color: #dc3545;
        }

        &.testing {
          color: #ffc107;
        }
      }
    }

    .config-actions {
      display: flex;
      gap: 8px;

      button {
        padding: 4px 8px;
        border: 1px solid #ddd;
        border-radius: 4px;
        background: white;
        cursor: pointer;
        font-size: 12px;

        &:hover {
          background: #f8f9fa;
        }

        &.test {
          color: #007bff;
          border-color: #007bff;
        }

        &.delete {
          color: #dc3545;
          border-color: #dc3545;
        }
      }
    }
  }
`;

const addFormStyles = css`
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 16px;

  .form-group {
    margin-bottom: 12px;

    label {
      display: block;
      margin-bottom: 4px;
      font-weight: 600;
      color: #333;
    }

    input {
      width: 100%;
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;

      &:focus {
        outline: none;
        border-color: #007bff;
        box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
      }
    }
  }

  .form-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;

    button {
      padding: 8px 16px;
      border: 1px solid #ddd;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;

      &.primary {
        background: #007bff;
        color: white;
        border-color: #007bff;

        &:hover {
          background: #0056b3;
        }

        &:disabled {
          background: #6c757d;
          border-color: #6c757d;
          cursor: not-allowed;
        }
      }

      &.secondary {
        background: white;
        color: #333;

        &:hover {
          background: #f8f9fa;
        }
      }
    }
  }
`;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  chainId: number;
  onConfigSaved?: () => void;
};

export default function BackendRpcConfig({
  isOpen,
  onClose,
  chainId,
  onConfigSaved,
}: Props) {
  const [configs, setConfigs] = useState<RpcConfig[]>([]);
  const [testResults, setTestResults] = useState<Map<string, RpcTestResult>>(
    new Map()
  );
  const [showAddForm, setShowAddForm] = useState(false);
  const [newConfig, setNewConfig] = useState({
    name: "",
    url: "",
    maxEventRange: 10000,
  });
  const [loading, setLoading] = useState(false);

  const chainName = getChainName(chainId);

  useEffect(() => {
    if (isOpen) {
      loadConfigs();
    }
  }, [isOpen]);

  const loadConfigs = async () => {
    try {
      const allConfigs = await getRpcConfigs();
      setConfigs(allConfigs.filter((config) => config.chainId === chainId));
    } catch (error) {
      console.error("Failed to load RPC configs:", error);
    }
  };

  const handleTest = async (config: RpcConfig) => {
    setTestResults((prev) =>
      new Map(prev).set(config.id, { status: "testing" })
    );

    try {
      const result = await testRpcConnection(config.url, chainId);
      setTestResults((prev) => new Map(prev).set(config.id, result));
    } catch (error) {
      setTestResults((prev) =>
        new Map(prev).set(config.id, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  };

  const handleDelete = async (config: RpcConfig) => {
    if (!confirm(`确定要删除 ${config.name} 吗？`)) {
      return;
    }

    try {
      await deleteRpcConfig(chainId);
      await loadConfigs();
      onConfigSaved?.();
    } catch (error) {
      alert(
        `删除失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const handleAdd = async () => {
    if (!newConfig.name.trim() || !newConfig.url.trim()) {
      alert("请填写完整信息");
      return;
    }

    setLoading(true);
    try {
      // 先测试连接
      const testResult = await testRpcConnection(newConfig.url, chainId);
      if (testResult.status === "failed") {
        alert(`RPC测试失败: ${testResult.error}`);
        return;
      }

      // 保存配置
      await saveRpcConfig({
        chainId,
        name: newConfig.name,
        url: newConfig.url,
        supportsHistory: testResult.supportsHistory,
        maxEventRange: newConfig.maxEventRange,
      });

      // 重新加载配置
      await loadConfigs();
      setShowAddForm(false);
      setNewConfig({ name: "", url: "", maxEventRange: 10000 });
      onConfigSaved?.();
    } catch (error) {
      alert(
        `保存失败: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={modalOverlayStyles} onClick={onClose}>
      <div className={modalContentStyles} onClick={(e) => e.stopPropagation()}>
        <div className={headerStyles}>
          <h2>配置 {chainName} RPC 节点</h2>
          <button onClick={onClose}>×</button>
        </div>

        <div className={configListStyles}>
          {configs.length === 0 ? (
            <p style={{ textAlign: "center", color: "#666", margin: "20px 0" }}>
              暂无自定义RPC配置，将使用默认节点
            </p>
          ) : (
            configs.map((config) => {
              const testResult = testResults.get(config.id);
              return (
                <div key={config.id} className="config-item">
                  <div className="config-info">
                    <div className="config-name">{config.name}</div>
                    <div className="config-url">{config.url}</div>
                    {testResult && (
                      <div className={`config-status ${testResult.status}`}>
                        {testResult.status === "testing" && "测试中..."}
                        {testResult.status === "success" && (
                          <>
                            ✅ 连接成功 ({testResult.latency}ms)
                            {testResult.supportsHistory && " • 支持历史数据"}
                            {testResult.maxEventRange &&
                              ` • 事件范围: ${testResult.maxEventRange}`}
                          </>
                        )}
                        {testResult.status === "failed" &&
                          `❌ ${testResult.error}`}
                      </div>
                    )}
                  </div>
                  <div className="config-actions">
                    <button
                      className="test"
                      onClick={() => handleTest(config)}
                      disabled={testResult?.status === "testing"}
                    >
                      测试
                    </button>
                    <button
                      className="delete"
                      onClick={() => handleDelete(config)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {showAddForm ? (
          <div className={addFormStyles}>
            <div className="form-group">
              <label>节点名称</label>
              <input
                type="text"
                value={newConfig.name}
                onChange={(e) =>
                  setNewConfig({ ...newConfig, name: e.target.value })
                }
                placeholder="例如: Alchemy 节点"
              />
            </div>
            <div className="form-group">
              <label>RPC URL</label>
              <input
                type="url"
                value={newConfig.url}
                onChange={(e) =>
                  setNewConfig({ ...newConfig, url: e.target.value })
                }
                placeholder="https://..."
              />
            </div>
            <div className="form-group">
              <label>最大事件查询范围（区块数）</label>
              <input
                type="number"
                value={newConfig.maxEventRange}
                onChange={(e) =>
                  setNewConfig({
                    ...newConfig,
                    maxEventRange: parseInt(e.target.value) || 10000,
                  })
                }
                placeholder="10000"
                min="100"
                max="100000"
              />
            </div>
            <div className="form-actions">
              <button
                className="secondary"
                onClick={() => setShowAddForm(false)}
              >
                取消
              </button>
              <button
                className="primary"
                onClick={handleAdd}
                disabled={loading}
              >
                {loading ? "测试并保存..." : "保存"}
              </button>
            </div>
          </div>
        ) : (
          <button
            style={{
              width: "100%",
              padding: "12px",
              border: "2px dashed #ddd",
              borderRadius: "4px",
              background: "white",
              color: "#666",
              cursor: "pointer",
              fontSize: "14px",
            }}
            onClick={() => setShowAddForm(true)}
          >
            + 添加自定义RPC节点
          </button>
        )}
      </div>
    </div>
  );
}
