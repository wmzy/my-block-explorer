import React, { useState, useEffect, useId, useRef } from 'react';
import { css } from '@linaria/core';
import { Dialog } from 'haze-ui';
import { useControl, type Control } from 'react-use-control';
import { toast } from 'sonner';
import { ApiError } from '../util/apiError';
import { get } from '../util/http';
import { clearAdminToken, hasAdminToken, setAdminToken } from '../util/adminAuth';
import {
  DEFAULT_IPFS_GATEWAY,
  getIpfsGateway,
  normalizeIpfsGateway,
  setIpfsGateway,
} from '@/services/nftMetadata';
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
import { parseBackup, planRestore, type RestorePlan } from '@/util/localBackup';
import {
  collectBackupParts,
  executeRestore,
  exportBackupFile,
  type RestoreReport,
} from '@/services/backupRestore';

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

// Backup confirmation (what a restore WILL do) and the post-restore
// per-section summary share one panel look: quiet box, tight list.
const backupPanelStyles = css`
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 12px 14px;
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.5;
  color: #495057;

  strong {
    display: block;
    margin-bottom: 6px;
    color: #333;
  }

  ul {
    margin: 0;
    padding-left: 18px;
  }

  li {
    margin-bottom: 4px;
  }

  .note {
    margin-top: 6px;
    color: #664d03;
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

  // Admin token entry: rpc-config writes are gated server-side by
  // ADMIN_TOKEN (reads are open), so the modal always offers the field
  // and flags a 403 from a save/delete with a notice.
  const [adminTokenInput, setAdminTokenInput] = useState('');
  const [adminTokenStored, setAdminTokenStored] = useState(() => hasAdminToken());
  const [saveForbidden, setSaveForbidden] = useState(false);

  // IPFS gateway: browser-local preference the NFT metadata service uses
  // to rewrite ipfs:// URIs into https URLs. Initialized from the stored
  // value; Save persists the normalized form, Reset falls back to the
  // default gateway.
  const [ipfsGatewayInput, setIpfsGatewayInput] = useState(() => getIpfsGateway());
  const [ipfsGatewayStored, setIpfsGatewayStored] = useState(() => getIpfsGateway());

  // Backup & restore: the local-data portability section. Export gathers
  // backend + browser parts and downloads explorer-backup.json; import
  // parses the file, shows the exact write plan for confirmation, then
  // executes it with per-section reporting.
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<RestorePlan | null>(null);
  const [pendingRestoreNotes, setPendingRestoreNotes] = useState<string[]>([]);
  const [restoreReport, setRestoreReport] = useState<RestoreReport | null>(null);
  const [restoring, setRestoring] = useState(false);

  const chainName = getChainName(chainId);
  const presets = getRpcPresets(chainId);
  const adminTokenInputId = useId();
  const customFormId = useId();
  const ipfsGatewayInputId = useId();

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

  // Persists the normalized gateway (trailing slashes trimmed, scheme
  // defaulted to https). NftMetadata resolution keys its cache by gateway,
  // so the next resolution picks the new value up without a reload.
  const handleSaveIpfsGateway = () => {
    const gateway = normalizeIpfsGateway(ipfsGatewayInput);
    if (!gateway) return;
    setIpfsGateway(gateway);
    setIpfsGatewayInput(gateway);
    setIpfsGatewayStored(gateway);
    toast.success('IPFS gateway saved.');
  };

  const handleResetIpfsGateway = () => {
    setIpfsGateway('');
    setIpfsGatewayStored(DEFAULT_IPFS_GATEWAY);
    setIpfsGatewayInput(DEFAULT_IPFS_GATEWAY);
    toast.success(`IPFS gateway reset to ${DEFAULT_IPFS_GATEWAY}.`);
  };

  // Export: collectBackupParts absorbs every expected failure into the
  // file's notes field (backend unreachable, admin gate, redacted URLs),
  // so a landing here means the download itself failed.
  const handleExportBackup = async () => {
    setBackupBusy(true);
    setBackupMessage(null);
    try {
      const parts = await collectBackupParts();
      exportBackupFile(parts);
      if (parts.notes && parts.notes.length > 0) {
        toast.success(`Backup exported — with notes:\n${parts.notes.join('\n')}`);
      }
      else {
        toast.success('Backup exported to explorer-backup.json.');
      }
    }
    catch (error) {
      console.error('Backup export failed:', error);
      toast.error('Backup export failed.');
    }
    finally {
      setBackupBusy(false);
    }
  };

  const handleBackupFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files !== null ? input.files[0] : undefined;
    // Reset so picking the same file again re-fires onChange.
    input.value = '';
    if (file === undefined) return;

    setBackupMessage(null);
    setPendingRestore(null);
    setPendingRestoreNotes([]);
    setRestoreReport(null);

    let text: string;
    try {
      text = await file.text();
    }
    catch {
      setBackupMessage('The file could not be read.');
      return;
    }
    const parsed = parseBackup(text);
    if (!parsed.ok) {
      setBackupMessage(parsed.error.message);
      return;
    }
    setPendingRestoreNotes(parsed.file.notes ?? []);
    setPendingRestore(planRestore(parsed.file, key => {
      try {
        return localStorage.getItem(key);
      }
      catch {
        return null;
      }
    }));
  };

  const handleExecuteRestore = async () => {
    if (pendingRestore === null || restoring) return;
    setRestoring(true);
    try {
      const report = await executeRestore(pendingRestore);
      setRestoreReport(report);
      setPendingRestore(null);
      setPendingRestoreNotes([]);
    }
    catch (error) {
      // executeRestore absorbs per-item failures into its report; a
      // throw here is an unexpected crash and lands verbatim.
      console.error('Restore failed:', error);
      setBackupMessage(error instanceof Error ? error.message : 'Restore failed.');
    }
    finally {
      setRestoring(false);
    }
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
      {/* IPFS gateway: browser-local preference the NFT metadata service
          reads when rewriting ipfs:// token/image URIs to https */}
      <div className={sectionStyles}>
        <h3>IPFS gateway</h3>
        <p>
          Gateway used to rewrite <code>ipfs://</code> NFT metadata and image URIs
          into browser-fetchable https URLs. Stored in this browser only.
        </p>
        <div className={customFormStyles}>
          <div className="form-group">
            <label htmlFor={ipfsGatewayInputId}>IPFS gateway (stored in this browser)</label>
            <input
              id={ipfsGatewayInputId}
              type="text"
              value={ipfsGatewayInput}
              onChange={e => setIpfsGatewayInput(e.target.value)}
              placeholder={DEFAULT_IPFS_GATEWAY}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
        <div className={`${buttonStyles} btn-group`}>
          <button
            type="button"
            className="btn primary small"
            onClick={handleSaveIpfsGateway}
            disabled={
              !ipfsGatewayInput.trim()
              || normalizeIpfsGateway(ipfsGatewayInput) === ipfsGatewayStored
            }
          >
            Save gateway
          </button>
          <button
            type="button"
            className="btn secondary small"
            onClick={handleResetIpfsGateway}
            disabled={ipfsGatewayStored === DEFAULT_IPFS_GATEWAY}
          >
            Reset to default
          </button>
        </div>
      </div>
      {/* Backup & restore: one-click portability of the user's local
          data — labels and custom chains from the backend, browser
          preferences from localStorage (the single-user promise: your
          data is yours). */}
      <div className={sectionStyles}>
        <h3>Backup &amp; restore</h3>
        <p>
          Export your address labels, custom chains and this browser's
          preferences (watchlist, theme, IPFS gateway, custom ABIs, private
          notes) to one JSON file, and restore them here or on another
          machine.
        </p>
        <div className={`${buttonStyles} btn-group`}>
          <button
            type="button"
            className="btn primary small"
            onClick={handleExportBackup}
            disabled={backupBusy}
          >
            {backupBusy ? 'Exporting…' : 'Export backup'}
          </button>
          <button
            type="button"
            className="btn secondary small"
            onClick={() => backupFileInputRef.current?.click()}
            disabled={restoring}
          >
            Restore from file…
          </button>
        </div>
        <input
          ref={backupFileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={handleBackupFileChosen}
        />
        {backupMessage !== null && (
          <div className={backupPanelStyles} data-testid="backup-message">
            <strong>Backup file not accepted</strong>
            <div>{backupMessage}</div>
          </div>
        )}
        {pendingRestore !== null && (
          <div className={backupPanelStyles} data-testid="restore-confirm">
            <strong>Restore this backup?</strong>
            <ul>
              <li>
                {pendingRestore.labelPuts.length}
                {' '}
                address label(s) will be saved to the backend
              </li>
              <li>
                {pendingRestore.chainPosts.length}
                {' '}
                custom chain(s) will be re-registered (each RPC is probed
                server-side)
              </li>
              <li>
                {pendingRestore.storageWrites.length}
                {' '}
                browser preference key(s) will be written
                {pendingRestore.storageWrites.some(w => w.overwrites)
                  ? ` (${pendingRestore.storageWrites.filter(w => w.overwrites).length} overwriting current values)`
                  : ''}
              </li>
            </ul>
            {pendingRestore.labelPuts.length === 0
              && pendingRestore.chainPosts.length === 0
              && pendingRestore.storageWrites.length === 0 && (
              <div className="note">
                Nothing to change — this browser already matches the backup.
              </div>
            )}
            {pendingRestoreNotes.map(noteLine => (
              <div className="note" key={noteLine}>
                ℹ️
                {' '}
                {noteLine}
              </div>
            ))}
            <div className={`${buttonStyles} btn-group`}>
              <button
                type="button"
                className="btn primary small"
                onClick={handleExecuteRestore}
                disabled={
                  restoring
                  || (pendingRestore.labelPuts.length === 0
                    && pendingRestore.chainPosts.length === 0
                    && pendingRestore.storageWrites.length === 0)
                }
              >
                {restoring ? 'Restoring…' : 'Restore now'}
              </button>
              <button
                type="button"
                className="btn secondary small"
                onClick={() => {
                  setPendingRestore(null);
                  setPendingRestoreNotes([]);
                }}
                disabled={restoring}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {restoreReport !== null && (
          <div className={backupPanelStyles} data-testid="restore-report">
            <strong>Restore summary</strong>
            <ul>
              <li>
                Browser preferences:
                {' '}
                {restoreReport.storage.written}
                {' '}
                written
                {restoreReport.storage.failures.length > 0
                  ? `, ${restoreReport.storage.failures.length} failed`
                  : ''}
                {restoreReport.storage.written > 0 ? ' — reload the page to apply them' : ''}
              </li>
              {restoreReport.storage.failures.map(failure => (
                <li key={failure.key}>
                  ⚠️
                  {' '}
                  {failure.key}
                  :
                  {' '}
                  {failure.message}
                </li>
              ))}
              <li>
                Labels:
                {' '}
                {restoreReport.labels.restored}
                {' '}
                of
                {' '}
                {restoreReport.labels.attempted}
                {' '}
                restored
              </li>
              {restoreReport.labels.adminDenied && (
                <li>
                  ⚠️ Admin token required — labels were not restored. Save
                  the token under &quot;Admin token&quot;, then restore again.
                </li>
              )}
              {restoreReport.labels.failures.map(failure => (
                <li key={failure.address}>
                  ⚠️
                  {' '}
                  {failure.address}
                  :
                  {' '}
                  {failure.message}
                </li>
              ))}
              <li>
                Custom chains:
                {' '}
                {restoreReport.chains.registered}
                {' '}
                of
                {' '}
                {restoreReport.chains.attempted}
                {' '}
                registered
              </li>
              {restoreReport.chains.adminDenied && (
                <li>
                  ⚠️ Admin token required — custom chains were not registered.
                </li>
              )}
              {restoreReport.chains.failures.map(failure => (
                <li key={failure.name}>
                  ⚠️
                  {' '}
                  {failure.name}
                  :
                  {' '}
                  {failure.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}
