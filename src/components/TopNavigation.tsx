import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { css, cx } from '@linaria/core';
import { Input, Button } from 'haze-ui';
import { useControl } from 'react-use-control';
import RpcConfig from './RpcConfig';
import {
  getChainInfo,
  getSortedChains,
  searchChains,
  isPopularChain,
  getChainType,
} from '@/config/chains';

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
`;

const historyItem = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  width: 100%;
  padding: var(--haze-space-2) var(--haze-space-3);
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text);
  text-align: left;
  border-bottom: 1px solid var(--haze-color-bg-subtle);
  font-family: var(--haze-font-sans);

  &:hover {
    background: var(--haze-color-bg-muted);
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
          <div className={selectorName}>{currentChain?.name ?? `Chain ${currentChainId}`}</div>
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

type SearchHistoryItem = {
  query: string;
  searchType?: string;
  searchedAt: string;
};

export default function TopNavigation({
  currentChainId,
  onChainChange,
  onSearch,
  searchPlaceholder,
}: TopNavigationProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [, setShowRpcConfig, rpcConfigControl] = useControl<boolean>(null, false);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const searchContainerRef = React.useRef<HTMLDivElement>(null);

  const chainInfo = getChainInfo(currentChainId);

  const fetchSearchHistory = React.useCallback(async () => {
    try {
      const response = await fetch('/api/search/history?limit=50');
      if (!response.ok) return;
      const data = await response.json();
      setSearchHistory(data.history ?? []);
      setHistoryLoaded(true);
    } catch {
      // silently fail
    }
  }, []);

  const handleSearchFocus = () => {
    setShowHistory(true);
    if (!historyLoaded) fetchSearchHistory();
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
    if (!q) return searchHistory;
    return searchHistory.filter(item => item.query.toLowerCase().includes(q));
  }, [searchQuery, searchHistory]);

  const selectHistoryItem = (query: string) => {
    setSearchQuery(query);
    setShowHistory(false);

    // Navigate directly based on query pattern
    if (query.startsWith('0x') && query.length === 42) {
      navigate(`/chain/${currentChainId}/address/${query}`);
    } else if (query.startsWith('0x') && query.length === 66) {
      navigate(`/chain/${currentChainId}/tx/${query}`);
    } else if (/^\d+$/.test(query)) {
      navigate(`/chain/${currentChainId}/block/${query}`);
    } else {
      navigate(`/search?q=${encodeURIComponent(query)}`);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    try {
      if (onSearch) {
        await onSearch(searchQuery.trim());
      } else {
        const query = searchQuery.trim();

        if (query.startsWith('0x') && query.length === 42) {
          navigate(`/chain/${currentChainId}/address/${query}`);
        } else if (query.startsWith('0x') && query.length === 66) {
          navigate(`/chain/${currentChainId}/tx/${query}`);
        } else if (/^\d+$/.test(query)) {
          navigate(`/chain/${currentChainId}/block/${query}`);
        } else {
          const response = await fetch(
            `/api/chains/${currentChainId}/search?q=${encodeURIComponent(query)}`,
          );
          const data = await response.json();

          if (data.found && data.data) {
            switch (data.type) {
              case 'address':
                navigate(`/chain/${currentChainId}/address/${query}`);
                break;
              case 'transaction':
                navigate(`/chain/${currentChainId}/tx/${query}`);
                break;
              case 'block':
                navigate(`/chain/${currentChainId}/block/${query}`);
                break;
            }
          }
        }
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
      setShowHistory(false);
      setHistoryLoaded(false);
    }
  };

  return (
    <>
      <nav className={nav}>
        <div className={navInner}>
          <div onClick={() => navigate(`/chain/${currentChainId}`)} className={logoStyle}>
            <span style={{ fontSize: '24px' }}>🚀</span>
            <span className={logoText}>My Block Explorer</span>
          </div>

          <div ref={searchContainerRef} className={searchArea}>
            <div className={searchRow}>
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
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

            {showHistory && filteredHistory.length > 0 && (
              <div className={historyDropdown}>
                <div className={historyHeader}>Recent Searches</div>
                {filteredHistory.map((item, idx) => (
                  <button
                    key={`${item.query}-${idx}`}
                    onClick={() => selectHistoryItem(item.query)}
                    className={historyItem}
                  >
                    <span style={{ color: 'var(--haze-color-text-muted)' }}>🔍</span>
                    <span
                      className={cx(
                        historyQuery,
                        /^0x/.test(item.query) ? historyQueryMono : undefined,
                      )}
                    >
                      {item.query}
                    </span>
                    {item.searchType && <span className={historyType}>{item.searchType}</span>}
                  </button>
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
