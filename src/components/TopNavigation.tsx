import React, { useState, useEffect, useMemo } from 'react';
import { navigate } from '@native-router/core';
import { useRouter } from '@native-router/react';
import { css, cx } from '@linaria/core';
import { Input, Button } from 'haze-ui';
import { useControl } from 'react-use-control';
import RpcConfig from './RpcConfig';
import {
  getChainInfo,
  getChainName,
  getSortedChains,
  searchChains,
  isPopularChain,
  getChainType,
} from '@/config/chains';
import { detectSearchType, sanitizeInput } from '@/utils/validation';
import { formatAddress } from '@/utils/format';
import { fetchChainSearch } from '@/services/search';
import { resolveEnsAddress } from '@/services/ensForward';
import {
  clearSearchHistory,
  readSearchHistory,
  recordSearchHistoryEntry,
  removeSearchHistoryEntry,
  type SearchHistoryEntry,
} from '@/services/searchHistory';

type TopNavigationProps = {
  currentChainId: number;
  onChainChange: (chainId: number) => void;
  onSearch?: (query: string) => void;
  searchPlaceholder?: string;
};

// --- Styles ---

const nav = css`
  background: var(--haze-color-bg);
  border-bottom: 1px solid var(--haze-color-border);
  box-shadow: var(--haze-shadow-sm);
  position: sticky;
  top: 0;
  z-index: 100;
`;

const navInner = css`
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 var(--haze-space-5);
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
`;

const logoStyle = css`
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
`;

const logoText = css`
  font-size: var(--haze-text-lg);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text);
`;

const searchArea = css`
  flex: 1;
  max-width: 400px;
  margin: 0 var(--haze-space-5);
  position: relative;
`;

const searchRow = css`
  display: flex;
  gap: var(--haze-space-2);
`;

const searchNoticeBox = css`
  margin-top: var(--haze-space-2);
  padding: var(--haze-space-2) var(--haze-space-3);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-secondary);
  background: var(--haze-color-bg-subtle);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--haze-space-2);
`;

const searchNoticeLink = css`
  border: none;
  background: transparent;
  color: var(--haze-color-primary);
  cursor: pointer;
  font-size: var(--haze-text-xs);
  font-weight: var(--haze-weight-medium);
  padding: 0;
  text-decoration: underline;
  font-family: var(--haze-font-sans);
  flex-shrink: 0;

  &:hover {
    text-decoration: none;
  }
`;

const rightControls = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
`;

// Chain selector styles
const selectorWrapper = css`
  position: relative;
`;

const selectorButton = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  padding: var(--haze-space-2) var(--haze-space-3);
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  cursor: pointer;
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-medium);
  min-width: 180px;
  height: 40px;
  font-family: var(--haze-font-sans);
  color: var(--haze-color-text);

  &:hover {
    border-color: var(--haze-color-border-hover);
  }
`;

const selectorContent = css`
  flex: 1;
  text-align: left;
`;

const selectorName = css`
  font-weight: var(--haze-weight-medium);
  font-size: var(--haze-text-xs);
  display: flex;
  align-items: center;
  gap: var(--haze-space-1);
`;

const selectorMeta = css`
  font-size: 11px;
  color: var(--haze-color-text-muted);
`;

const selectorArrow = css`
  transition: transform 0.2s;
  font-size: var(--haze-text-xs);
`;

const selectorArrowOpen = css`
  transform: rotate(180deg);
`;

const dropdown = css`
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: var(--haze-space-1);
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  box-shadow: var(--haze-shadow-lg);
  z-index: 1000;
  min-width: 320px;
  max-height: 400px;
  overflow: hidden;
`;

const dropdownSearch = css`
  padding: var(--haze-space-3);
  border-bottom: 1px solid var(--haze-color-bg-muted);
`;

const dropdownHint = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  margin-top: var(--haze-space-2);
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const dropdownList = css`
  max-height: 300px;
  overflow-y: auto;
`;

const dropdownEmpty = css`
  padding: var(--haze-space-5);
  text-align: center;
  color: var(--haze-color-text-muted);
`;

const chainItem = css`
  display: block;
  width: 100%;
  padding: var(--haze-space-3) var(--haze-space-4);
  text-align: left;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--haze-text-sm);
  border-bottom: 1px solid var(--haze-color-bg-subtle);
  font-family: var(--haze-font-sans);
  color: var(--haze-color-text);

  &:hover {
    background: var(--haze-color-bg-subtle);
  }
`;

const chainItemActive = css`
  background: var(--haze-color-primary-subtle);
`;

const chainItemRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const chainItemName = css`
  font-weight: var(--haze-weight-medium);
  display: flex;
  align-items: center;
  gap: var(--haze-space-1);
`;

const testnetBadge = css`
  font-size: 10px;
  background: color-mix(in srgb, var(--haze-color-warning) 15%, transparent);
  color: var(--haze-color-warning);
  padding: 2px var(--haze-space-2);
  border-radius: var(--haze-radius-full);
`;

const chainItemMeta = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

// Search history styles
const historyDropdown = css`
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: var(--haze-space-1);
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  box-shadow: var(--haze-shadow-lg);
  z-index: 1000;
  max-height: 360px;
  overflow-y: auto;
`;

const historyHeader = css`
  padding: var(--haze-space-2) var(--haze-space-3);
  font-size: 11px;
  color: var(--haze-color-text-muted);
  font-weight: var(--haze-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--haze-color-bg-muted);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--haze-space-2);
`;

const historyClearButton = css`
  border: none;
  background: transparent;
  color: var(--haze-color-primary);
  cursor: pointer;
  font-size: 11px;
  font-weight: var(--haze-weight-medium);
  padding: 0;
  text-decoration: underline;
  font-family: var(--haze-font-sans);
  text-transform: none;
  letter-spacing: normal;
  flex-shrink: 0;

  &:hover {
    text-decoration: none;
  }
`;

const historyItem = css`
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--haze-color-bg-subtle);

  &:last-child {
    border-bottom: none;
  }
`;

const historyEntryButton = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  flex: 1;
  min-width: 0;
  padding: var(--haze-space-2) var(--haze-space-3);
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text);
  text-align: left;
  font-family: var(--haze-font-sans);

  &:hover {
    background: var(--haze-color-bg-muted);
  }
`;

const historyRemoveButton = css`
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--haze-color-text-muted);
  padding: 0 var(--haze-space-3);
  font-size: var(--haze-text-sm);
  flex-shrink: 0;

  &:hover {
    color: var(--haze-color-text);
  }
`;

const historyQuery = css`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const historyQueryMono = css`
  font-family: var(--haze-font-mono);
`;

const historyType = css`
  font-size: 10px;
  padding: 2px var(--haze-space-2);
  border-radius: var(--haze-radius-sm);
  background: var(--haze-color-bg-muted);
  color: var(--haze-color-text-muted);
  flex-shrink: 0;
`;

// --- Components ---

function ChainSelector({
  currentChainId,
  onChainChange,
}: {
  currentChainId: number;
  onChainChange: (chainId: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!isOpen) setSearchTerm('');
  }, [isOpen]);

  const filteredChains = useMemo(() => {
    return searchTerm ? searchChains(searchTerm) : getSortedChains();
  }, [searchTerm]);

  const currentChain = getChainInfo(currentChainId);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (isOpen && !target.closest('[data-chain-selector]')) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className={selectorWrapper} data-chain-selector>
      <button onClick={() => setIsOpen(!isOpen)} className={selectorButton}>
        <div className={selectorContent}>
          <div className={selectorName}>
            {currentChain?.name ?? `Chain ${currentChainId}`}
            {getChainType(currentChainId) === 'testnet' && (
              <span className={testnetBadge}>Testnet</span>
            )}
          </div>
          <div className={selectorMeta}>
            ID: {currentChainId} • {currentChain?.nativeCurrency.symbol}
            {isPopularChain(currentChainId) && ' ⭐'}
          </div>
        </div>
        <span className={cx(selectorArrow, isOpen ? selectorArrowOpen : undefined)}>▼</span>
      </button>

      {isOpen && (
        <div className={dropdown}>
          <div className={dropdownSearch}>
            <Input
              placeholder="Search chain name, ID, or symbol..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') setIsOpen(false);
                else if (e.key === 'Enter' && filteredChains.length > 0) {
                  onChainChange(filteredChains[0].id);
                  setIsOpen(false);
                }
              }}
              autoFocus
            />
            {searchTerm && (
              <div className={dropdownHint}>
                <span>
                  Found
                  {filteredChains.length} chains
                </span>
                {filteredChains.length > 0 && <span>Press Enter to select first</span>}
              </div>
            )}
          </div>

          <div className={dropdownList}>
            {filteredChains.length === 0 ? (
              <div className={dropdownEmpty}>No matching chains found</div>
            ) : (
              filteredChains.map(chain => {
                const chainType = getChainType(chain.id);
                const isActive = currentChainId === chain.id;

                return (
                  <button
                    key={chain.id}
                    onClick={() => {
                      onChainChange(chain.id);
                      setIsOpen(false);
                      setSearchTerm('');
                    }}
                    className={cx(chainItem, isActive ? chainItemActive : undefined)}
                  >
                    <div className={chainItemRow}>
                      <div>
                        <div className={chainItemName}>
                          {chain.name}
                          {isPopularChain(chain.id) && <span>⭐</span>}
                          {chainType === 'testnet' && <span className={testnetBadge}>Testnet</span>}
                        </div>
                        <div className={chainItemMeta}>
                          ID: {chain.id} • {chain.nativeCurrency.symbol}
                        </div>
                      </div>
                      {isActive && <span style={{ color: 'var(--haze-color-primary)' }}>✓</span>}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Subset of the /api/chains/:id/search response this component acts on. The
// block payload's number arrives as a string (BigInt-safe serialization).
type ChainSearchResponse = {
  found?: boolean;
  type?: string;
  degraded?: boolean | null;
  data?: { number?: string | number } | null;
};

// Inline hint under the search box: 'miss' = definitive no-result on the
// current chain, 'failed' = a data source errored (degraded response),
// 'ens-resolved' / 'ens-not-found' / 'ens-failed' = outcome of a
// client-side ENS lookup (resolved on Ethereum; not-found is definitive,
// failed means the RPC never answered and is retryable). ens-resolved also
// carries the destination chain the address page opens on.
type SearchNotice =
  | { kind: 'miss'; query: string }
  | { kind: 'failed'; query: string }
  | { kind: 'ens-resolved'; query: string; address: string; chainId: number }
  | { kind: 'ens-not-found'; query: string }
  | { kind: 'ens-failed'; query: string };

export default function TopNavigation({
  currentChainId,
  onChainChange,
  onSearch,
  searchPlaceholder,
}: TopNavigationProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [, setShowRpcConfig, rpcConfigControl] = useControl<boolean>(null, false);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Recent searches live in this browser only (localStorage), never on the
  // server — the old global history endpoint leaked every visitor's
  // queries to everyone.
  const [history, setHistory] = useState<SearchHistoryEntry[]>(() => readSearchHistory());
  // Inline hint under the search box, cleared as soon as the input changes
  // (see SearchNotice for the kinds).
  const [searchNotice, setSearchNotice] = useState<SearchNotice | null>(null);
  const searchContainerRef = React.useRef<HTMLDivElement>(null);

  // Fire-and-forget in-app navigation; a superseded navigation rejects with
  // NavigationCancelledError, swallowed here as "stay on the old view".
  const goTo = (to: string) => {
    navigate(router, to).catch(() => undefined);
  };

  const chainInfo = getChainInfo(currentChainId);

  const handleSearchFocus = () => {
    setShowHistory(true);
    setHistory(readSearchHistory());
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (
        showHistory &&
        searchContainerRef.current &&
        !searchContainerRef.current.contains(target)
      ) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showHistory]);

  const filteredHistory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return history;
    return history.filter(item => item.query.toLowerCase().includes(q));
  }, [searchQuery, history]);

  const handleClearHistory = () => {
    setHistory(clearSearchHistory());
  };

  const handleRemoveHistoryEntry = (entry: SearchHistoryEntry) => {
    setHistory(removeSearchHistoryEntry(entry.query, entry.chainId));
  };

  // Shared query dispatcher for the search box and history items. It uses
  // the same sanitize/detect pair as every other surface (utils/validation
  // is the single source of truth): addresses and block numbers deep-link
  // straight to the target chain's pages; hashes need the per-chain search
  // API (transaction lookup first, block-hash fallback) to know which page
  // they belong to; anything else goes to the full Search view. Every
  // dispatch is recorded in the local (browser-only) search history —
  // history entries carry the chain they were run on, so re-running one
  // from the dropdown searches that chain again, not whichever chain is
  // currently selected.
  const navigateForQuery = async (rawQuery: string, chainId: number = currentChainId) => {
    const query = sanitizeInput(rawQuery.trim());
    const searchType = detectSearchType(query);

    // Every executed search is recorded — except ENS, whose outcome is not
    // known yet: a name that fails to resolve never went anywhere, so its
    // entry is recorded after a successful resolution instead (below).
    if (searchType !== 'ens') {
      setHistory(recordSearchHistoryEntry(query, chainId));
    }

    if (searchType === 'address') {
      goTo(`/chain/${chainId}/address/${query}`);
      return;
    }

    if (searchType === 'block') {
      goTo(`/chain/${chainId}/block/${query}`);
      return;
    }

    if (searchType === 'hash') {
      // Through the shared http layer (runtime-discovered api base), NOT a
      // raw same-origin fetch: in dev the same-origin /api is the Vite
      // bridge's own backend instance, which competes with the discovered
      // service for the single-writer DuckDB and serves different data.
      const data = await fetchChainSearch(chainId, query);
      const payload = data as ChainSearchResponse | undefined;

      if (payload?.found) {
        if (payload.type === 'transaction') {
          goTo(`/chain/${chainId}/tx/${query}`);
          return;
        }
        if (payload.type === 'block' && payload.data?.number !== undefined) {
          // The block detail route only accepts numbers, not hashes.
          goTo(`/chain/${chainId}/block/${String(payload.data.number)}`);
          return;
        }
      }

      // A degraded response means a data source errored — never worded as
      // a definitive "no results".
      setSearchNotice(
        payload?.degraded ? { kind: 'failed', query } : { kind: 'miss', query },
      );
      return;
    }

    if (searchType === 'ens') {
      // ENS names resolve in the browser against a mainnet client (where
      // the ENS registry lives); the resolved address is viewed on the
      // target chain. A definitive not-found is reported as such, an RPC
      // failure as a retryable failure — never one blurred copy for both.
      const outcome = await resolveEnsAddress(query);
      if (outcome.status === 'resolved') {
        // History only records the search now that it actually resolved
        // (see the upfront-record skip above).
        setHistory(recordSearchHistoryEntry(query, chainId));
        setSearchNotice({
          kind: 'ens-resolved',
          query,
          address: outcome.address,
          chainId,
        });
        goTo(`/chain/${chainId}/address/${outcome.address}`);
        return;
      }
      setSearchNotice(
        outcome.status === 'not-found'
          ? { kind: 'ens-not-found', query }
          : { kind: 'ens-failed', query },
      );
      return;
    }

    // Free text goes to the full Search view, carrying the target chain
    // as context (?chain=) so the global endpoint searches it and its
    // suggestions link back to that chain's pages.
    goTo(`/search?q=${encodeURIComponent(query)}&chain=${chainId}`);
  };

  const selectHistoryItem = (entry: SearchHistoryEntry) => {
    setSearchQuery(entry.query);
    setShowHistory(false);
    void navigateForQuery(entry.query, entry.chainId);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    setSearchNotice(null);
    try {
      if (onSearch) {
        setHistory(recordSearchHistoryEntry(sanitizeInput(searchQuery.trim()), currentChainId));
        await onSearch(searchQuery.trim());
      } else {
        await navigateForQuery(searchQuery);
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
      setShowHistory(false);
    }
  };

  return (
    <>
      <nav className={nav}>
        <div className={navInner}>
          <div onClick={() => goTo(`/chain/${currentChainId}`)} className={logoStyle}>
            <span style={{ fontSize: '24px' }}>🚀</span>
            <span className={logoText}>My Block Explorer</span>
          </div>

          <div ref={searchContainerRef} className={searchArea}>
            <div className={searchRow}>
              <Input
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setSearchNotice(null);
                }}
                onFocus={handleSearchFocus}
                placeholder={
                  searchPlaceholder ?? `Search on ${chainInfo?.name ?? 'current chain'}...`
                }
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSearch();
                  if (e.key === 'Escape') setShowHistory(false);
                }}
              />
              <Button variant="solid" size="md" onClick={handleSearch} disabled={loading}>
                {loading ? '...' : 'Search'}
              </Button>
            </div>

            {searchNotice !== null && (
              <div className={searchNoticeBox}>
                <span>
                  {searchNotice.kind === 'miss' &&
                    `Hash not found on ${chainInfo?.name ?? 'this chain'} — it may exist on another network`}
                  {searchNotice.kind === 'failed' &&
                    `Search failed on ${chainInfo?.name ?? 'this chain'} — a data source errored`}
                  {searchNotice.kind === 'ens-resolved' &&
                    `Resolved ${searchNotice.query} → ${formatAddress(searchNotice.address)} on Ethereum — opening on ${getChainName(searchNotice.chainId)}`}
                  {searchNotice.kind === 'ens-not-found' &&
                    `ENS name "${searchNotice.query}" not found (checked on Ethereum)`}
                  {searchNotice.kind === 'ens-failed' &&
                    `ENS resolution failed for "${searchNotice.query}" — Ethereum RPC did not answer`}
                </span>
                {(searchNotice.kind === 'miss' || searchNotice.kind === 'failed') && (
                  <button
                    type="button"
                    className={searchNoticeLink}
                    onClick={() =>
                      // No ?chain= on purpose: the hash's chain is unknown
                      // (it just missed here), so the Search view must ask
                      // which network to search next instead of re-running
                      // it on this one — the link opens the network picker.
                      goTo(`/search?q=${encodeURIComponent(searchNotice.query)}`)}
                  >
                    Choose a network →
                  </button>
                )}
                {searchNotice.kind === 'ens-failed' && (
                  <button
                    type="button"
                    className={searchNoticeLink}
                    onClick={() => void navigateForQuery(searchNotice.query)}
                  >
                    Retry
                  </button>
                )}
              </div>
            )}

            {showHistory && filteredHistory.length > 0 && (
              <div className={historyDropdown}>
                <div className={historyHeader}>
                  <span>Recent Searches</span>
                  <button type="button" className={historyClearButton} onClick={handleClearHistory}>
                    Clear
                  </button>
                </div>
                {filteredHistory.map(entry => (
                  <div
                    key={`${entry.chainId}-${entry.query}`}
                    className={historyItem}
                  >
                    <button
                      type="button"
                      className={historyEntryButton}
                      onClick={() => selectHistoryItem(entry)}
                    >
                      <span style={{ color: 'var(--haze-color-text-muted)' }}>🔍</span>
                      <span
                        className={cx(
                          historyQuery,
                          /^0x/.test(entry.query) ? historyQueryMono : undefined,
                        )}
                      >
                        {entry.query}
                      </span>
                      <span className={historyType}>{getChainName(entry.chainId)}</span>
                    </button>
                    <button
                      type="button"
                      className={historyRemoveButton}
                      aria-label={`Remove ${entry.query} from history`}
                      onClick={() => handleRemoveHistoryEntry(entry)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={rightControls}>
            <Button variant="outline" size="md" onClick={() => setShowRpcConfig(true)}>
              ⚙️ RPC
            </Button>
            <ChainSelector currentChainId={currentChainId} onChainChange={onChainChange} />
          </div>
        </div>
      </nav>

      <RpcConfig open={rpcConfigControl} chainId={currentChainId} />
    </>
  );
}
