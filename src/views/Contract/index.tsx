import { useState, useEffect } from 'react';
import { css } from '@linaria/core';
import { useControl } from 'react-use-control';
import { z } from 'zod';
import { navigate } from '@native-router/core';
import { TypedLink, useMatched, useSearch, useSetSearch } from '@native-router/react';
import { getChainName, isChainSupported } from '@/config/chains';
import { getExternalToolLinks } from '@/config/externalTools';
import TopNavigation from '@/components/TopNavigation';
import RpcFunctionError from '@/components/RpcFunctionError';
import RpcConfig from '@/components/RpcConfig';
import { ExternalLinks } from '@/components/ui/ExternalLinks';
import { SourceCodeViewer } from '@/components/SourceCodeViewer';
import { post } from '@/util/http';
import { useContractCreation, useContractSource } from '@/services/contracts';
import { EventsPanel } from './EventsPanel';
import { ContractInteract } from './ContractInteract';
import { CustomAbiPanel, parseAbiString } from './CustomAbiPanel';
import { StoragePanel } from './StoragePanel';
import { OpenInIdeButton } from './OpenInIdeButton';
import { cardStyles, errorStyles, loadingStyles } from './styles';
import type { ContractABI, ContractCreationInfo, ContractSource } from './types';

const pageStyles = css`
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
      'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
    background: #f8f9fa;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 14px;
  }
`;

const tabsStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e1e5e9;
  margin-bottom: 20px;

  .tabs-left {
    display: flex;
  }

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

const proxyToggleStyles = css`
  display: flex;
  align-items: center;

  .toggle-label {
    font-size: 13px;
    color: #666;
    margin-right: 8px;
  }

  .toggle-group {
    display: flex;
    background: #f0f0f0;
    border-radius: 16px;
    padding: 2px;
  }

  .toggle-option {
    padding: 4px 12px;
    font-size: 13px;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: 14px;
    color: #666;
    transition: all 0.2s;

    &:hover {
      color: #1a1a1a;
    }

    &.active {
      background: white;
      color: #007bff;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
  }
`;

const customAbiBadgeStyles = css`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
  align-self: center;
  padding: 2px 10px;
  border-radius: 12px;
  background: #f0a500;
  border: 1px solid #d69200;
  color: white;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
`;

const customAbiBadgeClearStyles = css`
  border: none;
  background: none;
  padding: 0;
  color: white;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;

  &:hover {
    color: #fff3cd;
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
      'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
    color: #1a1a1a;
    word-break: break-all;
  }
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

// Tab state lives in the ?tab= search param (kept in the URL on tab clicks
// so reloads/back land on the same tab). Unknown values degrade to the
// default tab instead of failing the search parse.
const CONTRACT_TABS = ['source', 'abi', 'interact', 'events', 'storage'] as const;
type TabId = (typeof CONTRACT_TABS)[number];

const contractSearchSchema = z.object({
  tab: z.enum(CONTRACT_TABS).optional().catch(undefined),
});

const PROXY_TYPE_LABELS: Record<string, string> = {
  'transparent': 'EIP-1967 Transparent',
  'uups': 'UUPS',
  'beacon': 'Beacon',
  'minimal': 'Minimal',
  'zeppelinos': 'ZeppelinOS',
  'gnosis-safe': 'Gnosis Safe',
  'diamond': 'Diamond (EIP-2535)',
  'eip1167': 'EIP-1167 Clone',
  'unknown': 'Unknown',
};

// sessionStorage persistence for the pasted custom ABI (the raw string),
// scoped per chain + address so an ABI never leaks across contracts.
// Access is guarded — browsers can throw on sessionStorage in private
// modes or after storage policy changes.
const customAbiStorageKey = (chainId: number, address: string) =>
  `custom-abi:${chainId}:${address.toLowerCase()}`;

const readStoredCustomAbi = (chainId: number, address: string): string | null => {
  try {
    return sessionStorage.getItem(customAbiStorageKey(chainId, address));
  } catch {
    return null;
  }
};

// Renders under both /chain/:chainId/contract/:address and its /events
// subpath (same view per the route table); the subpath only changes the
// default tab when ?tab= is absent.
export default function Contract() {
  const { params, router, location } = useMatched();
  const setSearch = useSetSearch(contractSearchSchema);
  const { tab: tabParam } = useSearch(contractSearchSchema);

  const [refreshing, setRefreshing] = useState(false);
  const [, setShowRpcConfig, rpcConfigControl] = useControl<boolean>(null, false);
  const [contractTarget, setContractTarget] = useState<'proxy' | 'impl'>('impl');

  const chainId = params.chainId;
  const address = params.address;

  const tabFromUrl =
    tabParam ?? (location.pathname.endsWith('/events') ? ('events' as const) : undefined);
  const activeTab: TabId = tabFromUrl ?? 'source';

  const setActiveTab = (tab: TabId) => {
    void setSearch({ tab }, { replace: true });
  };

  const currentChainId = Number(chainId ?? 1);

  // Raw pasted ABI (exactly the string that was applied), lazily restored
  // from sessionStorage so a reload keeps the unlock.
  const [customAbiRaw, setCustomAbiRaw] = useState<string | null>(() =>
    readStoredCustomAbi(currentChainId, address ?? ''),
  );

  const {
    data: sourceResponse,
    loading: sourceLoading,
    error: sourceError,
    refetch: refetchSource,
  } = useContractSource(currentChainId, address ?? '');
  const {
    data: creationResponse,
    loading: creationLoading,
    error: creationError,
    refetch: refetchCreation,
  } = useContractCreation(currentChainId, address ?? '');

  const contractSource = sourceResponse?.contractSource as ContractSource | undefined;
  const creationInfo = creationResponse?.found
    ? (creationResponse?.creation as ContractCreationInfo | undefined) ?? null
    : null;
  const loading = sourceLoading;
  const error = sourceError?.message ?? null;

  const handleChainChange = (newChainId: number) => {
    void navigate(router, `/chain/${newChainId}/contract/${address ?? ''}`).catch(
      () => undefined,
    );
  };

  const isProxy = contractSource?.isProxy && !!contractSource?.implementationContract;

  // Thin adapter: server ABI strings live on the contract source payload
  // (implementation or proxy side) and inherit its verification status.
  const parseABI = (contract: ContractSource | null): ContractABI | null =>
    contract?.abi ? parseAbiString(contract.abi, contract.verificationStatus) : null;

  const proxyABI = parseABI(contractSource ?? null);
  const implABI = parseABI(contractSource?.implementationContract ?? null);
  // The server-side ABI counts as available only when it carries at least
  // one usable entry — unverified contracts answer with an empty ABI.
  const serverAbi = isProxy ? (contractTarget === 'impl' ? implABI : proxyABI) : proxyABI;
  const serverAbiUnavailable =
    !serverAbi ||
    (serverAbi.functions.length === 0 &&
      serverAbi.events.length === 0 &&
      serverAbi.errors.length === 0);
  // Without a server ABI the locally pasted one takes over, keeping the
  // ABI, Events and Interact views usable for unverified contracts.
  const effectiveABI = serverAbiUnavailable
    ? customAbiRaw
      ? parseAbiString(customAbiRaw, contractSource?.verificationStatus ?? 'unverified')
      : null
    : serverAbi;
  const customAbiActive = serverAbiUnavailable && !!effectiveABI;

  useEffect(() => {
    if (contractSource?.isProxy && contractSource?.implementationContract && !tabFromUrl) {
      setActiveTab('interact');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- proxies default to the interact tab once their layout is known
  }, [contractSource]);

  // The route reuses this component across chains/addresses (params change
  // without a remount): re-read the per-contract key whenever they change.
  useEffect(() => {
    setCustomAbiRaw(readStoredCustomAbi(currentChainId, address ?? ''));
  }, [currentChainId, address]);

  const handleApplyCustomAbi = (raw: string) => {
    setCustomAbiRaw(raw);
    try {
      sessionStorage.setItem(customAbiStorageKey(currentChainId, address ?? ''), raw);
    } catch {
      // Storage unavailable: the in-memory ABI still applies for this mount.
    }
  };

  const handleClearCustomAbi = () => {
    setCustomAbiRaw(null);
    try {
      sessionStorage.removeItem(customAbiStorageKey(currentChainId, address ?? ''));
    } catch {
      // Nothing to remove when storage is unavailable.
    }
  };

  const handleClearCache = async () => {
    if (!chainId || !address) return;

    setRefreshing(true);

    try {
      await post(`/api/chains/${currentChainId}/contracts/${address}/clear-cache`, {});
      await refetchSource();
      await refetchCreation();
    } catch (err) {
      console.error('Failed to clear cache:', err);
    } finally {
      setRefreshing(false);
    }
  };

  if (!chainId || !address) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <div className={pageStyles}>
          <div className={errorStyles}>Invalid contract address or chain ID</div>
        </div>
      </>
    );
  }

  if (!isChainSupported(currentChainId)) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <div className={pageStyles}>
          <div className={errorStyles}>
            Unsupported chain ID:
            {chainId}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <div className={pageStyles}>
        <button
          className={backButtonStyles}
          onClick={() =>
            void navigate(router, `/chain/${currentChainId}/address/${address}`).catch(
              () => undefined,
            )}
        >
          ← Back to Address
        </button>

        <div className={headerStyles}>
          <h1>Contract Source Code</h1>
          <div className="chain-info">
            {getChainName(currentChainId)} •<span className="address">{address}</span>
          </div>
        </div>

        {loading && <div className={loadingStyles}>Loading contract information...</div>}

        {error && (
          <div className={errorStyles}>
            Error:
            {error}
          </div>
        )}

        {contractSource && (
          <>
            <div className={cardStyles}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '16px',
                }}
              >
                <h2 style={{ margin: 0 }}>Contract Information</h2>
                <button
                  onClick={handleClearCache}
                  disabled={refreshing}
                  style={{
                    padding: '6px 12px',
                    background: refreshing ? '#e9ecef' : '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: refreshing ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {refreshing ? 'Refreshing...' : '↻ Force Refresh'}
                </button>
              </div>
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
                      {contractSource.optimizationEnabled ? 'Enabled' : 'Disabled'}
                      {contractSource.optimizationRuns &&
                        ` (${contractSource.optimizationRuns} runs)`}
                    </span>
                  </div>
                )}
                {contractSource.isProxy && (
                  <>
                    <div className="info-item">
                      <span className="label">Proxy Type</span>
                      <span className="value">
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 10px',
                            borderRadius: '4px',
                            background: '#e8f5e9',
                            color: '#2e7d32',
                            fontWeight: 600,
                            fontSize: '13px',
                          }}
                        >
                          {PROXY_TYPE_LABELS[contractSource.proxyType ?? 'unknown'] ??
                            contractSource.proxyType?.toUpperCase()}{' '}
                          Proxy
                        </span>
                      </span>
                    </div>
                    {contractSource.implementationAddress && (
                      <div className="info-item">
                        <span className="label">Implementation</span>
                        <span className="value">
                          <TypedLink
                            to={`/chain/${currentChainId}/contract/${contractSource.implementationAddress}`}
                            style={{ color: '#007bff', textDecoration: 'none' }}
                            onMouseOver={e =>
                              ((e.target as HTMLElement).style.textDecoration = 'underline')}
                            onMouseOut={e =>
                              ((e.target as HTMLElement).style.textDecoration = 'none')}
                          >
                            {contractSource.implementationContract?.name
                              ? `${contractSource.implementationContract.name} (${contractSource.implementationAddress})`
                              : contractSource.implementationAddress}
                          </TypedLink>
                        </span>
                      </div>
                    )}
                  </>
                )}

                {/* Contract Creation Information */}
                {creationInfo && (
                  <>
                    <div className="info-item">
                      <span className="label">Creation Transaction</span>
                      <span className="value">
                        <TypedLink
                          to={`/chain/${currentChainId}/tx/${creationInfo.txHash}`}
                          style={{ color: '#007bff', textDecoration: 'none' }}
                          onMouseOver={e =>
                            ((e.target as HTMLElement).style.textDecoration = 'underline')}
                          onMouseOut={e =>
                            ((e.target as HTMLElement).style.textDecoration = 'none')}
                        >
                          {creationInfo.txHash}
                        </TypedLink>
                      </span>
                    </div>
                    <div className="info-item">
                      <span className="label">Creation Block</span>
                      <span className="value">
                        <TypedLink
                          to={`/chain/${currentChainId}/block/${creationInfo.blockNumber}`}
                          style={{ color: '#007bff', textDecoration: 'none' }}
                          onMouseOver={e =>
                            ((e.target as HTMLElement).style.textDecoration = 'underline')}
                          onMouseOut={e =>
                            ((e.target as HTMLElement).style.textDecoration = 'none')}
                        >
                          #{creationInfo.blockNumber}
                        </TypedLink>
                      </span>
                    </div>
                    <div className="info-item">
                      <span className="label">Creator</span>
                      <span className="value">
                        <TypedLink
                          to={`/chain/${currentChainId}/address/${creationInfo.creator}`}
                          style={{ color: '#007bff', textDecoration: 'none' }}
                          onMouseOver={e =>
                            ((e.target as HTMLElement).style.textDecoration = 'underline')}
                          onMouseOut={e =>
                            ((e.target as HTMLElement).style.textDecoration = 'none')}
                        >
                          {creationInfo.creator}
                        </TypedLink>
                      </span>
                    </div>
                    <div className="info-item">
                      <span className="label">Creation Time</span>
                      <span className="value">
                        {new Date(creationInfo.timestamp * 1000).toLocaleString()}
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

                {/* RPC error notice */}
                {creationError && (
                  <RpcFunctionError
                    functionName="getContractCreationInfo"
                    chainId={currentChainId}
                    chainName={getChainName(currentChainId)}
                    error={creationError.message}
                    onConfigureRpc={() => setShowRpcConfig(true)}
                    onRetry={refetchCreation}
                  />
                )}

                <div className="info-item">
                  <span className="label">External Tools</span>
                  <span className="value">
                    <ExternalLinks links={getExternalToolLinks(currentChainId, address)} />
                  </span>
                </div>
              </div>
            </div>

            <div className={tabsStyles}>
              <div className="tabs-left">
                <button
                  className={`tab ${activeTab === 'source' ? 'active' : ''}`}
                  onClick={() => setActiveTab('source')}
                >
                  Source Code
                </button>
                <button
                  className={`tab ${activeTab === 'abi' ? 'active' : ''}`}
                  onClick={() => setActiveTab('abi')}
                >
                  ABI
                </button>
                {effectiveABI && effectiveABI.events.length > 0 && (
                  <button
                    className={`tab ${activeTab === 'events' ? 'active' : ''}`}
                    onClick={() => setActiveTab('events')}
                  >
                    Events ({effectiveABI.events.length})
                  </button>
                )}
                <button
                  className={`tab ${activeTab === 'storage' ? 'active' : ''}`}
                  onClick={() => setActiveTab('storage')}
                >
                  Storage
                </button>
                <button
                  className={`tab ${activeTab === 'interact' ? 'active' : ''}`}
                  onClick={() => setActiveTab('interact')}
                >
                  Interact
                </button>
                {customAbiActive && (
                  <span
                    className={customAbiBadgeStyles}
                    title="ABI views are using your pasted custom ABI"
                  >
                    <span>Custom ABI</span>
                    <button
                      type="button"
                      className={customAbiBadgeClearStyles}
                      aria-label="Clear custom ABI"
                      onClick={handleClearCustomAbi}
                    >
                      ×
                    </button>
                  </span>
                )}
              </div>
              {isProxy && (
                <div className={proxyToggleStyles}>
                  <span className="toggle-label">View:</span>
                  <div className="toggle-group">
                    <button
                      className={`toggle-option ${contractTarget === 'proxy' ? 'active' : ''}`}
                      onClick={() => setContractTarget('proxy')}
                    >
                      Proxy
                    </button>
                    <button
                      className={`toggle-option ${contractTarget === 'impl' ? 'active' : ''}`}
                      onClick={() => setContractTarget('impl')}
                    >
                      Implementation
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Paste-ABI unlock: shown whenever the server has no usable ABI */}
            {serverAbiUnavailable && (
              <CustomAbiPanel
                storedRaw={customAbiRaw ?? ''}
                onApply={handleApplyCustomAbi}
                onClear={handleClearCustomAbi}
              />
            )}

            {/* Source Code */}
            {activeTab === 'source' && (
              <div className={cardStyles}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '16px',
                  }}
                >
                  <h2 style={{ margin: 0 }}>
                    {isProxy
                      ? contractTarget === 'impl'
                        ? `Implementation Source (${contractSource.implementationContract?.name ?? 'Unknown'})`
                        : 'Proxy Contract Source'
                      : 'Source Code'}
                  </h2>
                  <OpenInIdeButton chainId={currentChainId} address={address} />
                </div>
                {contractTarget === 'impl' && contractSource.implementationContract?.sourceCode ? (
                  <SourceCodeViewer
                    sourceCode={contractSource.implementationContract.sourceCode}
                    sourceFiles={contractSource.implementationContract.sourceFiles}
                  />
                ) : contractSource.sourceCode ? (
                  <SourceCodeViewer
                    sourceCode={contractSource.sourceCode}
                    sourceFiles={contractSource.sourceFiles}
                  />
                ) : (
                  <div>No source code available</div>
                )}
              </div>
            )}

            {/* ABI */}
            {activeTab === 'abi' && (
              <div className={cardStyles}>
                <h2>
                  {isProxy
                    ? contractTarget === 'impl'
                      ? `Implementation ABI (${contractSource.implementationContract?.name ?? 'Unknown'})`
                      : 'Proxy Contract ABI'
                    : 'Contract ABI'}
                </h2>
                <SourceCodeViewer
                  sourceCode={
                    contractTarget === 'impl' && contractSource.implementationContract?.abi
                      ? JSON.stringify(
                          JSON.parse(contractSource.implementationContract.abi),
                          null,
                          2,
                        )
                      : contractSource.abi
                        ? JSON.stringify(JSON.parse(contractSource.abi), null, 2)
                        : 'No ABI available'
                  }
                />
              </div>
            )}

            {activeTab === 'events' && (
              <EventsPanel
                chainId={currentChainId}
                contractAddress={address as `0x${string}`}
                abiEvents={effectiveABI?.events ?? []}
                creationBlock={creationInfo?.blockNumber}
                abi={effectiveABI?.abi ? JSON.parse(effectiveABI.abi) : undefined}
              />
            )}

            {activeTab === 'storage' && (
              <StoragePanel
                chainId={currentChainId}
                address={address as `0x${string}`}
                contractSource={contractSource}
                contractTarget={contractTarget}
              />
            )}

            {activeTab === 'interact' && (
              <ContractInteract
                chainId={currentChainId}
                contractAddress={address}
                contractSource={contractSource}
                contractTarget={isProxy ? contractTarget : undefined}
                abiOverride={serverAbiUnavailable && customAbiRaw ? customAbiRaw : undefined}
              />
            )}
          </>
        )}

        {/* RPC configuration dialog */}
        <RpcConfig
          open={rpcConfigControl}
          chainId={currentChainId}
          onConfigSaved={() => {
            refetchCreation();
          }}
        />
      </div>
    </>
  );
}
