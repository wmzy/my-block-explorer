import React, { useState, useEffect } from "react";
import { css } from "@linaria/core";
import { Dialog } from "haze-ui";
import { getChainName } from "../config/chains";
import { getRpcPresets, type RpcPreset } from "../config/rpcPresets";
import {
  getRpcConfigs,
  saveRpcConfig,
  deleteRpcConfig,
  testRpcConnection,
  type RpcConfig,
  type RpcTestResult,
} from "../utils/rpcConfigService";

const dialogContent = css`
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  overflow-y: auto;
`;

const headerStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #eee;

  h2 {
    margin: 0;
    color: #333;
    font-size: 18px;
  }

  button {
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: #666;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;

    &:hover {
      background: #f5f5f5;
    }
  }
`;

const sectionStyles = css`
  margin-bottom: 24px;

  h3 {
    margin: 0 0 12px 0;
    font-size: 16px;
    color: #333;
  }

  p {
    margin: 0 0 16px 0;
    color: #666;
    font-size: 14px;
    line-height: 1.5;
  }
`;

const currentConfigStyles = css`
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;

    &.default {
      color: #6c757d;
    }

    &.custom {
      color: #28a745;
    }
  }

  .url {
    font-family: monospace;
    font-size: 13px;
    color: #495057;
    background: white;
    padding: 8px;
    border-radius: 4px;
    border: 1px solid #dee2e6;
    margin-bottom: 8px;
  }

  .actions {
    display: flex;
    gap: 8px;
  }
`;

const presetStyles = css`
  .preset-item {
    border: 1px solid #e9ecef;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 12px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      border-color: #007bff;
      background: #f8f9ff;
    }

    .preset-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;

      .preset-name {
        font-weight: 500;
        color: #333;
      }

      .preset-provider {
        font-size: 12px;
        color: #6c757d;
        background: #e9ecef;
        padding: 2px 8px;
        border-radius: 12px;
      }
    }

    .preset-url {
      font-family: monospace;
      font-size: 13px;
      color: #495057;
      margin-bottom: 4px;
    }

    .preset-description {
      font-size: 12px;
      color: #6c757d;
    }
  }
`;

const customFormStyles = css`
  .form-group {
    margin-bottom: 16px;

    label {
      display: block;
      margin-bottom: 6px;
      font-weight: 500;
      color: #333;
      font-size: 14px;
    }

    input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 14px;

      &:focus {
        outline: none;
        border-color: #007bff;
        box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
      }
    }
  }
`;

const buttonStyles = css`
  .btn {
    padding: 10px 16px;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;

    &.primary {
      background: #007bff;
      color: white;

      &:hover {
        background: #0056b3;
      }

      &:disabled {
        background: #6c757d;
        cursor: not-allowed;
      }
    }

    &.secondary {
      background: #6c757d;
      color: white;

      &:hover {
        background: #545b62;
      }
    }

    &.danger {
      background: #dc3545;
      color: white;

      &:hover {
        background: #c82333;
      }
    }

    &.small {
      padding: 6px 12px;
      font-size: 12px;
    }
  }

  .btn-group {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }
`;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  chainId: number;
  onConfigSaved?: () => void;
};

export default function RpcConfig({
  isOpen,
  onClose,
  chainId,
  onConfigSaved,
}: Props) {
  const [currentConfig, setCurrentConfig] = useState<RpcConfig | null>(null);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customMaxEventRange, setCustomMaxEventRange] = useState("");
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<RpcTestResult | null>(null);

  const chainName = getChainName(chainId);
  const presets = getRpcPresets(chainId);

  useEffect(() => {
    if (isOpen) {
      loadCurrentConfig();
    }
  }, [isOpen, chainId]);

  const loadCurrentConfig = async () => {
    try {
      const configs = await getRpcConfigs();
      const chainConfig = configs.find((c) => c.chainId === chainId);
      setCurrentConfig(chainConfig || null);
    } catch (error) {
      console.error("Failed to load current config:", error);
    }
  };

  const handlePresetSelect = async (preset: RpcPreset) => {
    if (preset.url.includes("YOUR_")) {
      // 需要用户输入API密钥
      setCustomName(preset.name);
      setCustomUrl(preset.url);
      setShowCustomForm(true);
      return;
    }

    await handleSaveConfig(preset.name, preset.url);
  };

  const handleSaveConfig = async (
    name: string,
    url: string,
    maxEventRange?: number
  ) => {
    setLoading(true);
    setTestResult(null);

    try {
      // 测试连接
      const result = await testRpcConnection(url, chainId);
      setTestResult(result);

      if (result.status === "failed") {
        alert(
          `RPC测试失败: ${result.error}\n\n建议使用以下命令验证RPC:\ncast chain-id --rpc-url ${url}\ncast block-number --rpc-url ${url}`
        );
        return;
      }

      // 验证链ID是否匹配
      if (result.chainId && result.chainId !== chainId) {
        alert(
          `链ID不匹配！\n期望: ${chainId}\n实际: ${result.chainId}\n\n请确认RPC URL对应正确的链。`
        );
        return;
      }

      // 验证历史数据支持
      if (!result.supportsHistory) {
        const confirmContinue = confirm(
          "警告：此RPC节点不支持历史区块数据查询，可能影响合约创建信息等功能。\n\n是否仍要继续保存？"
        );
        if (!confirmContinue) {
          return;
        }
      }

      // 验证maxEventRange
      const finalMaxEventRange = maxEventRange || result.maxEventRange;
      if (finalMaxEventRange && finalMaxEventRange > 10000) {
        const confirmRange = confirm(
          `事件查询范围设置为 ${finalMaxEventRange} 个区块，这可能导致查询超时。\n\n建议设置为 5000 以下。是否继续？`
        );
        if (!confirmRange) {
          return;
        }
      }

      // 保存配置
      await saveRpcConfig({
        chainId,
        name,
        url,
        maxEventRange: finalMaxEventRange,
      });

      await loadCurrentConfig();
      onConfigSaved?.();
      setShowCustomForm(false);
      setCustomName("");
      setCustomUrl("");
      setCustomMaxEventRange("");

      alert("RPC配置保存成功！");
    } catch (error) {
      console.error("Failed to save config:", error);
      alert("保存配置失败，请检查网络连接");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveConfig = async () => {
    if (!confirm("确定要移除自定义RPC配置吗？将恢复使用默认节点。")) {
      return;
    }

    try {
      await deleteRpcConfig(chainId);
      await loadCurrentConfig();
      onConfigSaved?.();
      alert("已恢复使用默认RPC节点");
    } catch (error) {
      console.error("Failed to remove config:", error);
      alert("移除配置失败");
    }
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customName.trim() && customUrl.trim()) {
      const maxEventRange = customMaxEventRange.trim()
        ? parseInt(customMaxEventRange.trim())
        : undefined;
      handleSaveConfig(customName.trim(), customUrl.trim(), maxEventRange);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className={dialogContent}>
        <div className={headerStyles}>
          <h2>{chainName} RPC Configuration</h2>
          <button onClick={onClose}>×</button>
        </div>

        {/* 当前配置状态 */}
        <div className={sectionStyles}>
          <h3>当前状态</h3>
          <div className={currentConfigStyles}>
            {currentConfig ? (
              <>
                <div className="status custom">✅ 使用自定义RPC节点</div>
                <div style={{ marginBottom: "8px" }}>
                  <div style={{ fontWeight: "500", marginBottom: "4px" }}>
                    {currentConfig.name}
                  </div>
                  <div className="url">{currentConfig.url}</div>
                  {currentConfig.maxEventRange && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#6c757d",
                        marginTop: "4px",
                      }}
                    >
                      📊 事件查询范围: {currentConfig.maxEventRange} 个区块
                    </div>
                  )}
                </div>
                <div className="actions">
                  <button
                    className="btn danger small"
                    onClick={handleRemoveConfig}
                  >
                    恢复默认
                  </button>
                </div>
              </>
            ) : (
              <div className="status default">🔄 使用默认RPC节点</div>
            )}
          </div>
        </div>

        {!showCustomForm && (
          <>
            {/* 预设选项 */}
            {presets.length > 0 && (
              <div className={sectionStyles}>
                <h3>推荐节点</h3>
                <p>选择一个可信的RPC提供商来提升访问速度和稳定性</p>
                <div className={presetStyles}>
                  {presets.map((preset, index) => (
                    <div
                      key={index}
                      className="preset-item"
                      onClick={() => handlePresetSelect(preset)}
                    >
                      <div className="preset-header">
                        <div className="preset-name">{preset.name}</div>
                        <div className="preset-provider">{preset.provider}</div>
                      </div>
                      <div className="preset-url">{preset.url}</div>
                      {preset.description && (
                        <div className="preset-description">
                          {preset.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 自定义选项 */}
            <div className={sectionStyles}>
              <h3>自定义节点</h3>
              <p>如果您有私有RPC节点或其他提供商的节点</p>
              <div className={buttonStyles}>
                <button
                  className="btn secondary"
                  onClick={() => setShowCustomForm(true)}
                >
                  添加自定义RPC
                </button>
              </div>
            </div>
          </>
        )}

        {/* 自定义表单 */}
        {showCustomForm && (
          <div className={sectionStyles}>
            <h3>添加自定义RPC节点</h3>
            <form onSubmit={handleCustomSubmit} className={customFormStyles}>
              <div className="form-group">
                <label>节点名称</label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="例如：我的私有节点"
                  required
                />
              </div>
              <div className="form-group">
                <label>RPC URL</label>
                <input
                  type="url"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="https://your-rpc-endpoint.com"
                  required
                />
              </div>
              <div className="form-group">
                <label>最大事件查询范围（可选）</label>
                <input
                  type="number"
                  value={customMaxEventRange}
                  onChange={(e) => setCustomMaxEventRange(e.target.value)}
                  placeholder="例如：5000（留空将自动检测）"
                  min="100"
                  max="50000"
                />
                <div
                  style={{
                    fontSize: "12px",
                    color: "#6c757d",
                    marginTop: "4px",
                  }}
                >
                  设置单次查询事件的最大区块范围。较小的值更稳定，较大的值查询更快但可能超时。
                </div>
              </div>

              {testResult && (
                <div
                  style={{
                    padding: "12px",
                    borderRadius: "6px",
                    marginBottom: "16px",
                    background:
                      testResult.status === "success" ? "#d4edda" : "#f8d7da",
                    color:
                      testResult.status === "success" ? "#155724" : "#721c24",
                    fontSize: "14px",
                  }}
                >
                  {testResult.status === "success" ? (
                    <div>
                      <div style={{ marginBottom: "8px" }}>
                        ✅ <strong>连接成功</strong> (延迟: {testResult.latency}
                        ms)
                      </div>
                      <div style={{ fontSize: "12px", lineHeight: "1.4" }}>
                        {testResult.chainId && (
                          <div>
                            🔗 链ID: {testResult.chainId}{" "}
                            {testResult.chainId === chainId ? "✅" : "❌"}
                          </div>
                        )}
                        <div>
                          📚 历史数据:{" "}
                          {testResult.supportsHistory ? "✅ 支持" : "❌ 不支持"}
                        </div>
                        {testResult.maxEventRange && (
                          <div>
                            📊 推荐事件范围: {testResult.maxEventRange} 个区块
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ marginBottom: "8px" }}>
                        ❌ <strong>连接失败</strong>
                      </div>
                      <div style={{ fontSize: "12px", color: "#721c24" }}>
                        {testResult.error}
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          marginTop: "8px",
                          fontFamily: "monospace",
                          background: "rgba(0,0,0,0.1)",
                          padding: "4px",
                          borderRadius: "3px",
                        }}
                      >
                        验证命令:
                        <br />
                        cast chain-id --rpc-url {customUrl}
                        <br />
                        cast block-number --rpc-url {customUrl}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className={`${buttonStyles} btn-group`}>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={loading}
                >
                  {loading ? "测试并保存中..." : "测试并保存"}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    setShowCustomForm(false);
                    setCustomName("");
                    setCustomUrl("");
                    setCustomMaxEventRange("");
                    setTestResult(null);
                  }}
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        )}
    </Dialog>
  );
}
