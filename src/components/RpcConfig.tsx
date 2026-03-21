import React, { useState, useEffect } from 'react';
import { css } from '@linaria/core';
import { Dialog, type DialogProps } from 'haze-ui';
import { useControl, type Control } from 'react-use-control';
import { toast } from 'sonner';
import { getChainName } from '../config/chains';
import { getRpcPresets, type RpcPreset } from '../config/rpcPresets';
import {
  getRpcConfigs,
  saveRpcConfig,
  deleteRpcConfig,
  testRpcConnection,
  type RpcConfig,
  type RpcTestResult,
} from '../utils/rpcConfigService';

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
  open?: Control<boolean>;
  onClose?: () => void;
  chainId: number;
  onConfigSaved?: () => void;
};

export default function RpcConfig({ open, onClose, chainId, onConfigSaved }: Props) {
  const [isOpen, setOpen] = useControl(open, false);

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  const [currentConfig, setCurrentConfig] = useState<RpcConfig | null>(null);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customMaxEventRange, setCustomMaxEventRange] = useState('');
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
      const chainConfig = configs.find(c => c.chainId === chainId);
      setCurrentConfig(chainConfig ?? null);
    }
    catch (error) {
      console.error('Failed to load current config:', error);
    }
  };

  const handlePresetSelect = async (preset: RpcPreset) => {
    if (preset.url.includes('YOUR_')) {
      // 需要用户输入API密钥
      setCustomName(preset.name);
      setCustomUrl(preset.url);
      setShowCustomForm(true);
      return;
    }

    await handleSaveConfig(preset.name, preset.url);
  };

  const handleSaveConfig = async (name: string, url: string, maxEventRange?: number) => {
    setLoading(true);
    setTestResult(null);

    try {
      // 测试连接
      const result = await testRpcConnection(url, chainId);
      setTestResult(result);

      if (result.status === 'failed') {
        toast.error(
          `RPC test failed: ${result.error}\n\nRecommended to verify RPC using:\ncast chain-id --rpc-url ${url}\ncast block-number --rpc-url ${url}`,
        );
        return;
      }

      // 验证链ID是否匹配
      if (result.detectedChainId && result.detectedChainId !== chainId) {
        toast.error(
          `Chain ID mismatch!\nExpected: ${chainId}\nActual: ${result.detectedChainId}\n\nPlease confirm the RPC URL corresponds to the correct chain.`,
        );
        return;
      }

      // 验证历史数据支持
      if (!result.supportsHistory) {
        // eslint-disable-next-line no-alert
        const confirmContinue = window.confirm(
          'Warning: This RPC node does not support historical block data queries, which may affect contract creation info and other features.\n\nDo you want to continue saving anyway?',
        );
        if (!confirmContinue) {
          return;
        }
      }

      // 验证maxEventRange
      const finalMaxEventRange = maxEventRange ?? result.maxEventRange;
      if (finalMaxEventRange && finalMaxEventRange > 10000) {
        // eslint-disable-next-line no-alert
        const confirmRange = window.confirm(
          `Event query range set to ${finalMaxEventRange} blocks, which may cause query timeout.\n\nRecommended setting is below 5000. Continue anyway?`,
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
      setCustomName('');
      setCustomUrl('');
      setCustomMaxEventRange('');

      toast.success('RPC configuration saved successfully!');
    }
    catch (error) {
      console.error('Failed to save config:', error);
      toast.error('Failed to save configuration. Please check your network connection.');
    }
    finally {
      setLoading(false);
    }
  };

  const handleRemoveConfig = async () => {
    /* eslint-disable no-alert */
    const confirmed = window.confirm(
      'Are you sure you want to remove the custom RPC configuration? It will revert to using the default node.',
    );
    /* eslint-enable no-alert */
    if (!confirmed) {
      return;
    }

    try {
      await deleteRpcConfig(chainId);
      await loadCurrentConfig();
      onConfigSaved?.();
      toast.success('Reverted to default RPC node.');
    }
    catch (error) {
      console.error('Failed to remove config:', error);
      toast.error('Failed to remove configuration.');
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

  if (!isOpen) return null;

  return (
    <Dialog open={open as DialogProps['open']} onClose={handleClose} className={dialogContent}>
      <div className={headerStyles}>
        <h2>
          {chainName}
          {' '}
          RPC Configuration
        </h2>
        <button onClick={handleClose}>×</button>
      </div>

      {/* 当前配置状态 */}
      <div className={sectionStyles}>
        <h3>当前状态</h3>
        <div className={currentConfigStyles}>
          {currentConfig
            ? (
                <>
                  <div className="status custom">✅ 使用自定义RPC节点</div>
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ fontWeight: '500', marginBottom: '4px' }}>{currentConfig.name}</div>
                    <div className="url">{currentConfig.url}</div>
                    {currentConfig.maxEventRange && (
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#6c757d',
                          marginTop: '4px',
                        }}
                      >
                        📊 事件查询范围:
                        {' '}
                        {currentConfig.maxEventRange}
                        {' '}
                        个区块
                      </div>
                    )}
                  </div>
                  <div className="actions">
                    <button className="btn danger small" onClick={handleRemoveConfig}>
                      恢复默认
                    </button>
                  </div>
                </>
              )
            : (
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
                      <div className="preset-description">{preset.description}</div>
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
              <button className="btn secondary" onClick={() => setShowCustomForm(true)}>
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
                onChange={e => setCustomName(e.target.value)}
                placeholder="例如：我的私有节点"
                required
              />
            </div>
            <div className="form-group">
              <label>RPC URL</label>
              <input
                type="url"
                value={customUrl}
                onChange={e => setCustomUrl(e.target.value)}
                placeholder="https://your-rpc-endpoint.com"
                required
              />
            </div>
            <div className="form-group">
              <label>最大事件查询范围（可选）</label>
              <input
                type="number"
                value={customMaxEventRange}
                onChange={e => setCustomMaxEventRange(e.target.value)}
                placeholder="例如：5000（留空将自动检测）"
                min="100"
                max="50000"
              />
              <div
                style={{
                  fontSize: '12px',
                  color: '#6c757d',
                  marginTop: '4px',
                }}
              >
                设置单次查询事件的最大区块范围。较小的值更稳定，较大的值查询更快但可能超时。
              </div>
            </div>

            {testResult && (
              <div
                style={{
                  padding: '12px',
                  borderRadius: '6px',
                  marginBottom: '16px',
                  background: testResult.status === 'success' ? '#d4edda' : '#f8d7da',
                  color: testResult.status === 'success' ? '#155724' : '#721c24',
                  fontSize: '14px',
                }}
              >
                {testResult.status === 'success'
                  ? (
                      <div>
                        <div style={{ marginBottom: '8px' }}>
                          ✅
                          {' '}
                          <strong>连接成功</strong>
                          {' '}
                          (延迟:
                          {' '}
                          {testResult.latency}
                          ms)
                        </div>
                        <div style={{ fontSize: '12px', lineHeight: '1.4' }}>
                          {testResult.detectedChainId && (
                            <div>
                              🔗 链ID:
                              {' '}
                              {testResult.detectedChainId}
                              {' '}
                              {testResult.detectedChainId === chainId ? '✅' : '❌'}
                            </div>
                          )}
                          <div>
                            📚 历史数据:
                            {testResult.supportsHistory ? '✅ 支持' : '❌ 不支持'}
                          </div>
                          {testResult.maxEventRange && (
                            <div>
                              📊 推荐事件范围:
                              {testResult.maxEventRange}
                              {' '}
                              个区块
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  : (
                      <div>
                        <div style={{ marginBottom: '8px' }}>
                          ❌
                          {' '}
                          <strong>连接失败</strong>
                        </div>
                        <div style={{ fontSize: '12px', color: '#721c24' }}>{testResult.error}</div>
                        <div
                          style={{
                            fontSize: '11px',
                            marginTop: '8px',
                            fontFamily: 'monospace',
                            background: 'rgba(0,0,0,0.1)',
                            padding: '4px',
                            borderRadius: '3px',
                          }}
                        >
                          验证命令:
                          <br />
                          cast chain-id --rpc-url
                          {' '}
                          {customUrl}
                          <br />
                          cast block-number --rpc-url
                          {' '}
                          {customUrl}
                        </div>
                      </div>
                    )}
              </div>
            )}

            <div className={`${buttonStyles} btn-group`}>
              <button type="submit" className="btn primary" disabled={loading}>
                {loading ? '测试并保存中...' : '测试并保存'}
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setShowCustomForm(false);
                  setCustomName('');
                  setCustomUrl('');
                  setCustomMaxEventRange('');
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
