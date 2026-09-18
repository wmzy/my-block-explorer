import React, { useState, useEffect, useId } from 'react';
import { css } from '@linaria/core';
import { Dialog } from 'haze-ui';
import { useControl, type Control } from 'react-use-control';
import { toast } from 'sonner';
import { ApiError } from '../util/apiError';
import { get } from '../util/http';
import { clearAdminToken, hasAdminToken, setAdminToken } from '../util/adminAuth';
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

const adminNoticeStyles = css`
  background: #fff3cd;
  border: 1px solid #ffe69c;
  color: #664d03;
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 12px;
`;

// Saving an RPC config hot-reloads the server-wide RpcManager, so the
// custom-endpoint form carries a persistent heads-up that this affects
// every user of the backend, not just this browser.
const globalEffectHintStyles = css`
  background: #fff3cd;
  border: 1px solid #ffe69c;
  color: #664d03;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  margin-top: 8px;
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

  // Admin token entry: rpc-config writes are gated server-side by
  // ADMIN_TOKEN (reads are open), so the modal always offers the field
  // and flags a 403 from a save/delete with a notice.
  const [adminTokenInput, setAdminTokenInput] = useState('');
  const [adminTokenStored, setAdminTokenStored] = useState(() => hasAdminToken());
  const [saveForbidden, setSaveForbidden] = useState(false);

  const chainName = getChainName(chainId);
  const presets = getRpcPresets(chainId);
  const adminTokenInputId = useId();
  const customFormId = useId();

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
      // Reads are open server-side, so a failure here is a transport or
      // server problem, not the admin gate.
      console.error('Failed to load current config:', error);
      setCurrentConfig(null);
    }
  };

  const handleSaveAdminToken = async () => {
    const token = adminTokenInput.trim();
    if (!token) return;

    setAdminToken(token);
    setAdminTokenStored(true);
    setAdminTokenInput('');
    // The http layer picks the token up on the next request; drop any
    // stale save-403 notice and refetch so the config list updates.
    setSaveForbidden(false);

    // Verify instead of toasting success blindly: hit a requireAdminToken
    // endpoint (the http layer attaches the just-stored token) and report
    // what the server actually said.
    try {
      await get('/api/performance/events');
      toast.success('Admin token saved & verified.');
    }
    catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        // requireAdminToken fails closed, so a 403 covers both a wrong
        // token and a server with no ADMIN_TOKEN configured at all — the
        // status alone cannot tell them apart, so say exactly that.
        toast.error(
          'Token saved, but the server rejected it — wrong token, or the server has no ADMIN_TOKEN configured.',
        );
      }
      else {
        // Transport failure (e.g. the degraded-mode fast reject 'Backend
        // not connected — indexed data unavailable') or an unexpected
        // server error: surface the real message verbatim.
        toast.error(
          error instanceof ApiError
            ? error.message
            : 'Admin token saved, but verification failed.',
        );
      }
    }

    await loadCurrentConfig();
  };

  const handleClearAdminToken = async () => {
    clearAdminToken();
    setAdminTokenStored(false);
    setAdminTokenInput('');
    setSaveForbidden(false);
    toast.success('Admin token cleared.');
    await loadCurrentConfig();
  };

  const handlePresetSelect = async (preset: RpcPreset) => {
    if (preset.url.includes('YOUR_')) {
      // Preset URL is a template: the user must supply their own API key.
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
      // Test the connection first; a failed probe never reaches the save.
      const result = await testRpcConnection(url, chainId);
      setTestResult(result);

      if (result.status === 'failed') {
        toast.error(
          `RPC test failed: ${result.error}\n\nRecommended to verify RPC using:\ncast chain-id --rpc-url ${url}\ncast block-number --rpc-url ${url}`,
        );
        return;
      }

      // Verify the chain ID matches the explorer's target chain.
      if (result.detectedChainId && result.detectedChainId !== chainId) {
        toast.error(
          `Chain ID mismatch!\nExpected: ${chainId}\nActual: ${result.detectedChainId}\n\nPlease confirm the RPC URL corresponds to the correct chain.`,
        );
        return;
      }

      // Verify historical data support.
      if (!result.supportsHistory) {
        // eslint-disable-next-line no-alert
        const confirmContinue = window.confirm(
          'Warning: This RPC node does not support historical block data queries, which may affect contract creation info and other features.\n\nDo you want to continue saving anyway?',
        );
        if (!confirmContinue) {
          return;
        }
      }

      // Validate maxEventRange.
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

      // Save the config.
      await saveRpcConfig({
        chainId,
        name,
        url,
        maxEventRange: finalMaxEventRange,
      });
      setSaveForbidden(false);

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
      // A 403 means the server has ADMIN_TOKEN configured but this
      // browser's token is missing or wrong; flag it with the notice.
      if (error instanceof ApiError && error.status === 403) {
        setSaveForbidden(true);
      }
      if (error instanceof ApiError && error.status === 0) {
        // Transport-level failure: the ApiError message is the real
        // cause — most notably the degraded-mode fast reject ('Backend
        // not connected — indexed data unavailable'), which is a
        // diagnosis, not a network hiccup. Surface it instead of the
        // generic network advice.
        toast.error(error.message);
      }
      else {
        // The 403 body carries a server message explaining the gate;
        // show it verbatim. Anything else degrades to generic advice.
        toast.error(
          error instanceof ApiError && error.status === 403 && error.message
            ? error.message
            : 'Failed to save configuration. Please check your network connection.',
        );
      }
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
      setSaveForbidden(false);
      await loadCurrentConfig();
      onConfigSaved?.();
      toast.success('Reverted to default RPC node.');
    }
    catch (error) {
      console.error('Failed to remove config:', error);
      if (error instanceof ApiError && error.status === 403) {
        setSaveForbidden(true);
      }
      toast.error(
        error instanceof ApiError && error.status === 403 && error.message
          ? error.message
          : 'Failed to remove configuration.',
      );
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
    <Dialog open={open} onClose={handleClose} className={dialogContent}>
      <div className={headerStyles}>
        <h2>
          {chainName}
          {' '}
          RPC Configuration
        </h2>
        <button onClick={handleClose}>×</button>
      </div>

      {/* Current configuration status */}
      <div className={sectionStyles}>
        <h3>Current status</h3>
        <div className={currentConfigStyles}>
          {currentConfig
            ? (
                <>
                  <div className="status custom">✅ Using a custom RPC node</div>
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
                        📊 Event query range:
                        {' '}
                        {currentConfig.maxEventRange}
                        {' '}
                        blocks
                      </div>
                    )}
                  </div>
                  <div className="actions">
                    <button className="btn danger small" onClick={handleRemoveConfig}>
                      Revert to default
                    </button>
                  </div>
                </>
              )
            : (
                <div className="status default">🔄 Using the default RPC node</div>
              )}
        </div>
      </div>

      {!showCustomForm && (
        <>
          {/* Preset options */}
          {presets.length > 0 && (
            <div className={sectionStyles}>
              <h3>Recommended nodes</h3>
              <p>Pick a trusted RPC provider for better speed and stability</p>
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

          {/* Custom option */}
          <div className={sectionStyles}>
            <h3>Custom node</h3>
            <p>If you have a private RPC node or one from another provider</p>
            <div className={buttonStyles}>
              <button className="btn secondary" onClick={() => setShowCustomForm(true)}>
                Add custom RPC
              </button>
            </div>
            <div className={globalEffectHintStyles}>
              Saved RPC configs apply to this backend for ALL users, not just this browser.
            </div>
          </div>
        </>
      )}

      {/* Custom endpoint form */}
      {showCustomForm && (
        <div className={sectionStyles}>
          <h3>Add a custom RPC node</h3>
          <div className={globalEffectHintStyles}>
            Saved RPC configs apply to this backend for ALL users, not just this browser.
          </div>
          <form onSubmit={handleCustomSubmit} className={customFormStyles}>
            <div className="form-group">
              <label htmlFor={`${customFormId}-name`}>Node name</label>
              <input
                id={`${customFormId}-name`}
                type="text"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder="e.g. My private node"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor={`${customFormId}-url`}>RPC URL</label>
              <input
                id={`${customFormId}-url`}
                type="url"
                value={customUrl}
                onChange={e => setCustomUrl(e.target.value)}
                placeholder="https://your-rpc-endpoint.com"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor={`${customFormId}-max-range`}>Max event query range (optional)</label>
              <input
                id={`${customFormId}-max-range`}
                type="number"
                value={customMaxEventRange}
                onChange={e => setCustomMaxEventRange(e.target.value)}
                placeholder="e.g. 5000 (leave empty to auto-detect)"
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
                Maximum block range per event query. Smaller values are more
                stable; larger values are faster but may time out.
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
                          <strong>Connection successful</strong>
                          {' '}
                          (latency:
                          {' '}
                          {testResult.latency}
                          ms)
                        </div>
                        <div style={{ fontSize: '12px', lineHeight: '1.4' }}>
                          {testResult.detectedChainId && (
                            <div>
                              🔗 Chain ID:
                              {' '}
                              {testResult.detectedChainId}
                              {' '}
                              {testResult.detectedChainId === chainId ? '✅' : '❌'}
                            </div>
                          )}
                          <div>
                            📚 Historical data:
                            {testResult.supportsHistory ? '✅ supported' : '❌ not supported'}
                          </div>
                          {testResult.maxEventRange && (
                            <div>
                              📊 Recommended event range:
                              {testResult.maxEventRange}
                              {' '}
                              blocks
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
                          <strong>Connection failed</strong>
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
                          Verification commands:
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
                {loading ? 'Testing & saving...' : 'Test & save'}
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
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Admin token: rpc-config writes are gated server-side by ADMIN_TOKEN; reads are open */}
      <div className={sectionStyles}>
        <h3>Admin token</h3>
        {saveForbidden && (
          <div className={adminNoticeStyles}>
            Saving requires an admin token — the server has ADMIN_TOKEN
            configured but this browser's token is missing or wrong. Enter it
            below, then retry the save.
          </div>
        )}
        <div className={customFormStyles}>
          <div className="form-group">
            <label htmlFor={adminTokenInputId}>Admin token (stored in this browser)</label>
            <input
              id={adminTokenInputId}
              type="password"
              value={adminTokenInput}
              onChange={e => setAdminTokenInput(e.target.value)}
              placeholder="Must match the server's ADMIN_TOKEN"
              autoComplete="off"
            />
          </div>
        </div>
        <div className={`${buttonStyles} btn-group`}>
          <button
            type="button"
            className="btn primary small"
            onClick={handleSaveAdminToken}
            disabled={!adminTokenInput.trim()}
          >
            Save
          </button>
          <button
            type="button"
            className="btn secondary small"
            onClick={handleClearAdminToken}
            disabled={!adminTokenStored}
          >
            Clear
          </button>
        </div>
      </div>
    </Dialog>
  );
}
