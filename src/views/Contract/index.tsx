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
import { BackendOfflineState } from '@/components/ui/ErrorState';
import { SourceCodeViewer } from '@/components/SourceCodeViewer';
import { post, isBackendUnreachable } from '@/util/http';
import { ApiError } from '@/util/apiError';
import { useServiceDiscovery } from '@/hooks/ServiceDiscoveryContext';
import { redirectReplace } from '@/views/Home/Landing';
import { UnsupportedChainState } from '@/views/Home/UnsupportedChainState';
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

// One-time notice for a stored custom ABI silently shadowed by a server
// ABI that appeared after the paste (the contract got verified): the paste
// stays in localStorage but is no longer used. Amber palette matches the
// other custom-ABI affordances on this page.
const shadowNoticeStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
  padding: 12px 16px;
  background: #fff8e6;
  border: 1px solid #f0a500;
  border-radius: 6px;
  font-size: 14px;
  color: #8a6d3b;
`;

const shadowNoticeActionsStyles = css`
  display: flex;
  gap: 8px;
`;

const shadowNoticeButtonStyles = css`
  padding: 6px 14px;
  font-size: 13px;
  border-radius: 4px;
  cursor: pointer;

  &.primary {
    background: #f0a500;
    border: 1px solid #d69200;
    color: white;
    font-weight: 500;

    &:hover {
      background: #d69200;
    }
  }

  &.secondary {
    background: transparent;
    border: 1px solid #e1e5e9;
    color: #8a6d3b;

    &:hover {
      background: #fdf3dd;
    }
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

// Unverified guidance cell in the info grid: the Sourcify deep link plus
// the pointer that closes the verify-and-return loop (the backend caches
// unverified lookups for an hour; Force Refresh bypasses it immediately).
const verifyCellStyles = css`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  text-align: right;
`;

const verifyLinkStyles = css`
  color: #007bff;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const verifyHintStyles = css`
  font-size: 12px;
  color: #666;
  word-break: normal;
`;

// Force Refresh outcome banner inside the contract information card; the
// palette matches the verification status badges above it.
const cacheNoticeStyles = css`
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;

  &.ok {
    background: #d4edda;
    color: #155724;
  }

  &.error {
    background: #f8d7da;
    color: #721c24;
  }
`;

// Inline unlock pointer rendered by the ABI/Interact tabs when the contract
// has no server ABI and nothing pasted yet.
const abiUnlockStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 16px;
  background: #fff8e6;
  border: 1px solid #f0a500;
  border-radius: 6px;
  font-size: 14px;
  color: #8a6d3b;
`;

const abiUnlockButtonStyles = css`
  padding: 6px 14px;
  font-size: 13px;
  border: 1px solid #f0a500;
  border-radius: 4px;
  background: #f0a500;
  color: white;
  font-weight: 500;
  cursor: pointer;

  &:hover {
    background: #d69200;
    border-color: #d69200;
  }
`;

// Shown by the ABI/Interact/Events tab panels when the contract has no
// usable ABI (or none with event definitions): the panel below the tab bar
// is the only way to unlock the surface, so the pointer jumps focus
// straight to its textarea. onFocusPanel is omitted when no custom ABI
// panel is rendered (a server ABI without event definitions has nothing to
// focus).
function AbiUnlockHint({
  title,
  message,
  focusLabel,
  onFocusPanel,
}: {
  title: string;
  message: string;
  focusLabel?: string;
  onFocusPanel?: () => void;
}) {
  return (
    <div className={cardStyles}>
      <h2>{title}</h2>
      <div className={abiUnlockStyles}>
        <span>{message}</span>
        {onFocusPanel && (
          <button type="button" className={abiUnlockButtonStyles} onClick={onFocusPanel}>
            {focusLabel ?? 'Open custom ABI panel'}
          </button>
        )}
      </div>
    </div>
  );
}

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

// Deep link into Sourcify's verification UI with chain and address
// prefilled (its /widget route reads ?chainId= and ?address=; a chain
// Sourcify does not list degrades to a chain picker there). Mirrors the
// backend's Sourcify server v2 integration in ContractSourceService.
const sourcifyVerifyUrl = (chainId: number, address: string) =>
  `https://verify.sourcify.dev/widget?chainId=${chainId}&address=${address}`;

// localStorage persistence for the pasted custom ABI (the raw string),
// scoped per chain + address so an ABI never leaks across contracts.
// localStorage (not sessionStorage) keeps the unlock across browser
// sessions. Access is guarded — browsers can throw on storage in private
// modes or after storage policy changes.
const customAbiStorageKey = (chainId: number, address: string) =>
  `custom-abi:${chainId}:${address.toLowerCase()}`;

const readStoredCustomAbi = (chainId: number, address: string): string | null => {
  const key = customAbiStorageKey(chainId, address);
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) return stored;
    // One-time migration from the legacy sessionStorage entry: adopt it
    // into localStorage and drop the legacy copy so it cannot resurrect
    // after a Clear.
    const legacy = sessionStorage.getItem(key);
    if (legacy !== null) {
      localStorage.setItem(key, legacy);
      sessionStorage.removeItem(key);
      return legacy;
    }
    return null;
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
  // Visible outcome of the last Force Refresh: success notice or failure
  // reason (403 gets the admin-token pointer). Null until one exists.
  const [cacheNotice, setCacheNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null,
  );
  // Increments to focus + scroll the custom ABI panel's textarea (the
  // unlock pointers rendered by the locked ABI/Interact tabs).
  const [abiFocusSignal, setAbiFocusSignal] = useState(0);
  // Session-only dismissal of the shadowed-custom-ABI notice: Keep hides
  // the banner without touching the stored paste (view state is enough —
  // a fresh mount or contract switch may legitimately re-show it).
  const [shadowNoticeDismissed, setShadowNoticeDismissed] = useState(false);
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
  // from localStorage so a reload keeps the unlock.
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

  // Backend-offline recovery: reuse the discovery layer's reconnect (the
  // same mechanism the connection badge uses) and refetch once a backend
  // answers — a plain Retry would just fast-fail again while the API base
  // is unset.
  const { reconnect } = useServiceDiscovery();
  const [retryingConnection, setRetryingConnection] = useState(false);
  const handleRetryConnection = async () => {
    if (retryingConnection) return;
    setRetryingConnection(true);
    try {
      const service = await reconnect();
      if (service) void refetchSource();
    } finally {
      setRetryingConnection(false);
    }
  };

  // Chain switches replace the current entry via the shared Wave A helper,
  // keeping the address param so the same contract reloads on the target
  // chain without pushing a history entry.
  const handleChainChange = (newChainId: number) => {
    void redirectReplace(router, `/chain/${newChainId}/contract/${address ?? ''}`).catch(
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
  // A stored custom ABI that a server ABI now shadows (verification
  // succeeded after the paste): the paste is silently unused and would
  // linger in localStorage forever — the notice below makes that state
  // explicit instead of the badge quietly disappearing.
  const customAbiShadowed = !!customAbiRaw?.trim() && !serverAbiUnavailable;
  // ABI-dependent tabs with nothing to show: no server ABI and no pasted
  // ABI applied. The tab shell keeps the tabs clickable; the panels below
  // render the unlock pointer instead of their bare empty states.
  const abiLocked = serverAbiUnavailable && !effectiveABI;
  // The Events tab is always rendered (indexed ranges are queryable
  // without an ABI); the count badge and decoded table need ABI events.
  const abiHasEvents = !!effectiveABI && effectiveABI.events.length > 0;

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
    // A notice from the previous contract never carries over.
    setCacheNotice(null);
    // A fresh contract deserves a fresh shadow notice if its paste is
    // shadowed too.
    setShadowNoticeDismissed(false);
  }, [currentChainId, address]);

  const handleApplyCustomAbi = (raw: string) => {
    setCustomAbiRaw(raw);
    try {
      const key = customAbiStorageKey(currentChainId, address ?? '');
      localStorage.setItem(key, raw);
      // Drop any legacy sessionStorage copy so it cannot resurrect a
      // cleared ABI on the next load.
      sessionStorage.removeItem(key);
    } catch {
      // Storage unavailable: the in-memory ABI still applies for this mount.
    }
  };

  const handleClearCustomAbi = () => {
    setCustomAbiRaw(null);
    try {
      const key = customAbiStorageKey(currentChainId, address ?? '');
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      // Nothing to remove when storage is unavailable.
    }
  };

  const handleClearCache = async () => {
    if (!chainId || !address) return;

    setRefreshing(true);
    setCacheNotice(null);

    try {
      await post(`/api/chains/${currentChainId}/contracts/${address}/clear-cache`, {});
      await refetchSource();
      await refetchCreation();
      setCacheNotice({ kind: 'ok', text: 'Cache cleared — reloading source' });
    } catch (err) {
      console.error('Failed to clear cache:', err);
      setCacheNotice({
        kind: 'error',
        text:
          err instanceof ApiError && err.status === 403
            ? 'Requires admin token — set it via ⚙️ RPC → Admin token. The server must have ADMIN_TOKEN configured.'
            : 'Failed to clear cache — the explorer API is unreachable or returned an error.',
      });
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
          {/* Same recovery state as Home/Blocks: the deep link names a
              chain this explorer has no configuration for, so offer the
              deterministic CTAs instead of a bare error dead end. */}
          <UnsupportedChainState chainId={currentChainId} />
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

        {sourceError && isBackendUnreachable(sourceError) ? (
          <BackendOfflineState
            onRetryConnection={() => void handleRetryConnection()}
            retryConnectionPending={retryingConnection}
          />
        ) : (
          error && (
            <div className={errorStyles}>
              Error:
              {error}
            </div>
          )
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
              {cacheNotice && (
                <div role="status" className={`${cacheNoticeStyles} ${cacheNotice.kind}`}>
                  {cacheNotice.text}
                </div>
              )}
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
                {contractSource.verificationStatus === 'unverified' && (
                  <div className="info-item">
                    <span className="label">Verify this contract</span>
                    <span className="value">
                      <span className={verifyCellStyles}>
                        <a
                          className={verifyLinkStyles}
                          href={sourcifyVerifyUrl(currentChainId, address ?? '')}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Verify at Sourcify ↗
                        </a>
                        <span className={verifyHintStyles}>
                          Verified there? ↻ Force Refresh above pulls it in immediately
                        </span>
                      </span>
                    </span>
                  </div>
                )}
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

            {/* A server ABI that appeared after the paste silently shadows
                it; the one-time notice names the state and offers the
                explicit choice (Clear frees the stale localStorage entry,
                Keep only hides the banner for this session). */}
            {customAbiShadowed && !shadowNoticeDismissed && (
              <div role="status" className={shadowNoticeStyles}>
                <span>
                  This contract is now verified server-side — your pasted custom ABI is no
                  longer used.
                </span>
                <div className={shadowNoticeActionsStyles}>
                  <button
                    type="button"
                    className={`${shadowNoticeButtonStyles} primary`}
                    onClick={handleClearCustomAbi}
                  >
                    Clear custom ABI
                  </button>
                  <button
                    type="button"
                    className={`${shadowNoticeButtonStyles} secondary`}
                    onClick={() => setShadowNoticeDismissed(true)}
                  >
                    Keep
                  </button>
                </div>
              </div>
            )}

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
                <button
                  className={`tab ${activeTab === 'events' ? 'active' : ''}`}
                  onClick={() => setActiveTab('events')}
                >
                  Events{abiHasEvents ? ` (${effectiveABI.events.length})` : ''}
                </button>
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
                {(customAbiActive || customAbiShadowed) && (
                  <span
                    className={customAbiBadgeStyles}
                    title={
                      customAbiActive
                        ? 'ABI views are using your pasted custom ABI'
                        : 'Your pasted custom ABI is stored but not used while a verified source is available'
                    }
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
                focusSignal={abiFocusSignal}
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
            {activeTab === 'abi' &&
              (abiLocked ? (
                <AbiUnlockHint
                  title="Paste an ABI to unlock this tab"
                  message="No ABI is available for this contract. Use the custom ABI panel below the tab bar to paste one."
                  onFocusPanel={() => setAbiFocusSignal(n => n + 1)}
                />
              ) : (
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
              ))}

            {activeTab === 'events' && (
              <>
                {/* Without ABI event definitions the table below shows raw
                    (undecoded) rows; the pointer explains what unlocks
                    decoding + filtering. Indexed ranges and statistics stay
                    reachable either way. */}
                {!abiHasEvents && (
                  <AbiUnlockHint
                    title="Paste an ABI with event definitions"
                    message={
                      abiLocked
                        ? 'No ABI is available for this contract. Use the custom ABI panel below the tab bar to paste an ABI with event definitions to decode and filter events.'
                        : 'The current ABI has no event definitions. Paste an ABI with event definitions to decode and filter events.'
                    }
                    onFocusPanel={
                      serverAbiUnavailable ? () => setAbiFocusSignal(n => n + 1) : undefined
                    }
                  />
                )}
                <EventsPanel
                  chainId={currentChainId}
                  contractAddress={address as `0x${string}`}
                  abiEvents={effectiveABI?.events ?? []}
                  creationBlock={creationInfo?.blockNumber}
                  abi={effectiveABI?.abi ? JSON.parse(effectiveABI.abi) : undefined}
                />
              </>
            )}

            {activeTab === 'storage' && (
              <StoragePanel
                chainId={currentChainId}
                address={address as `0x${string}`}
                contractSource={contractSource}
                contractTarget={contractTarget}
              />
            )}

            {activeTab === 'interact' &&
              (abiLocked ? (
                <AbiUnlockHint
                  title="Paste an ABI to unlock this tab"
                  message="No ABI is available for this contract. Use the custom ABI panel below the tab bar to paste one."
                  onFocusPanel={() => setAbiFocusSignal(n => n + 1)}
                />
              ) : (
                <ContractInteract
                  chainId={currentChainId}
                  contractAddress={address}
                  contractSource={contractSource}
                  contractTarget={isProxy ? contractTarget : undefined}
                  abiOverride={serverAbiUnavailable && customAbiRaw ? customAbiRaw : undefined}
                />
              ))}
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
