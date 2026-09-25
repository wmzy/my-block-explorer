import React, { useContext, useState, useEffect, useMemo } from 'react';
import { navigate } from '@native-router/core';
import { useRouter } from '@native-router/react';
import { css, cx } from '@linaria/core';
import { Input, Button } from 'haze-ui';
import { useControl } from 'react-use-control';
import RpcConfig from './RpcConfig';
import { AddCustomChainForm } from './AddCustomChainForm';
import {
  getChainInfo,
  getChainName,
  getSortedChains,
  searchChains,
  isPopularChain,
  getChainType,
} from '@/config/chains';
import { detectSearchType, sanitizeInput } from '@/utils/validation';
import { createRpcClient } from '@/utils/realTimeData';
import { isBackendUnreachable } from '@/util/http';
import { formatAddress } from '@/utils/format';
import { fetchChainSearch } from '@/services/search';
import {
  resolveEnsAddress,
  ensDestinations,
  type EnsDestinations,
} from '@/services/ensForward';
import {
  clearSearchHistory,
  readSearchHistory,
  recordSearchHistoryEntry,
  removeSearchHistoryEntry,
  type SearchHistoryEntry,
} from '@/services/searchHistory';
import { ServiceDiscoveryContext } from '@/hooks/ServiceDiscoveryContext';
import {
  nextThemePreference,
  readThemePreference,
  setDocumentThemeAttribute,
  storeThemePreference,
  type ThemePreference,
} from '@/themePreference';

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

  /* Narrow screens: logo + search + chain selector cannot share one
     60px row — let the bar wrap and give each row breathing room. */
  @media (max-width: 768px) {
    flex-wrap: wrap;
    height: auto;
    padding: var(--haze-space-2) var(--haze-space-4);
    row-gap: var(--haze-space-2);
  }
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

// Page links beside the logo: the chain's blocks/transactions lists, the
// pending pool, the cached-contract directory and the charts page. Flex
// with a small gap keeps the group readable at any member count.
const navLinks = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-1);
`;

const navLink = css`
  border: none;
  background: transparent;
  padding: var(--haze-space-2);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
  cursor: pointer;
  border-radius: var(--haze-radius-md);

  &:hover {
    color: var(--haze-color-primary);
    background: var(--haze-color-primary-subtle);
  }
`;

// Admin-group variant of the page-link button: one size step smaller and
// muted, so the trailing SQL console reads as a secondary admin escape
// rather than a peer destination.
const navLinkMuted = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

// Vertical rule separating the admin group from the page links. Purely
// decorative (aria-hidden at the call site); collapsed on the wrapped
// mobile nav, where a rule between wrapping rows reads as noise.
const navDivider = css`
  width: 1px;
  align-self: stretch;
  margin: var(--haze-space-1) var(--haze-space-2);
  background: var(--haze-color-border);

  @media (max-width: 768px) {
    display: none;
  }
`;

const searchArea = css`
  flex: 1;
  max-width: 400px;
  margin: 0 var(--haze-space-5);
  position: relative;

  /* Owns a full row when the nav wraps below 768px. */
  @media (max-width: 768px) {
    flex: 1 1 100%;
    max-width: none;
    margin: 0;
  }
`;

const searchRow = css`
  display: flex;
  gap: var(--haze-space-2);

  /* Narrow screens: the haze Input renders a bare <input> and the search
     Button a plain <button> (~36px tall) — grow both to the 44px touch
     target and let the input take whatever width the row has left. */
  @media (max-width: 768px) {
    input {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 44px;
    }

    button {
      min-height: 44px;
    }
  }
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

// Right-hand action group of the notice box: primary action first,
// alternates (ENS destination on the viewing chain) to its right.
const searchNoticeActions = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  flex-shrink: 0;
`;

const rightControls = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);

  /* Narrow screens: the nowrap row (theme + RPC + 180px chain button +
     version chip) exceeds the viewport — let the controls wrap onto a
     second row, right-aligned under the search row. */
  @media (max-width: 768px) {
    flex-wrap: wrap;
    justify-content: flex-end;
    row-gap: var(--haze-space-2);
  }
`;

// Theme cycle control (Light → Dark → System). Icon-only at the RPC
// button's height so the two read as one row of controls; the accessible
// name carries the words the glyph cannot.
const themeToggle = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  flex-shrink: 0;
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  cursor: pointer;
  color: var(--haze-color-text-secondary);

  &:hover {
    border-color: var(--haze-color-border-hover);
    color: var(--haze-color-text);
  }
`;

const themeToggleIcon = css`
  width: 16px;
  height: 16px;
  display: block;
`;

// Backend version chip: muted, informational only — never competes with
// the controls beside it; the title carries the base URL (and the honest
// offline reading when nothing was discovered).
const versionChip = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  white-space: nowrap;
  cursor: help;
`;

// Chain selector styles
const selectorWrapper = css`
  position: relative;

  /* Narrow screens: un-position the wrapper so the dropdown's containing
     block becomes the sticky nav (full viewport width) instead of the
     wrapper — the picker can then span the screen, not the wrapped row. */
  @media (max-width: 768px) {
    position: static;
  }
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

  /* Narrow screens: anchored to the full-width nav (selectorWrapper goes
     static), the picker spans nearly the whole viewport below the wrapped
     bar — no off-screen clipping to the left of the right-anchored rule. */
  @media (max-width: 768px) {
    left: var(--haze-space-4);
    right: var(--haze-space-4);
    min-width: 0;
  }
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

// Ring on the keyboard-highlighted option — same family as the native
// :focus outline, so hover, highlight, and focus read as one interaction.
const chainItemHighlight = css`
  outline: 2px solid var(--haze-color-primary);
  outline-offset: -2px;
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

// Dropdown footer holding the custom-chain entry point: a quiet action
// row separated from the chain list, expanding into the shared
// AddCustomChainForm in place.
const dropdownFooter = css`
  border-top: 1px solid var(--haze-color-border);
  padding: var(--haze-space-3);
  background: var(--haze-color-bg-subtle);
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
  /* The expanded form + its feedback must fit inside the capped dropdown;
     overflow scrolls instead of clipping silently. */
  max-height: 300px;
  overflow-y: auto;
`;

const addChainButton = css`
  display: block;
  width: 100%;
  padding: var(--haze-space-2) var(--haze-space-3);
  text-align: left;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
  font-family: var(--haze-font-sans);
  border-radius: var(--haze-radius-md);

  &:hover {
    color: var(--haze-color-primary);
    background: var(--haze-color-primary-subtle);
  }
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
  // Index into filteredChains of the keyboard-highlighted option.
  // null = nothing highlighted: Enter must do nothing until the user
  // has actually moved the highlight (or clicked) — a bare Enter used
  // to blind-pick the first filter hit, switching chains unasked.
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  // Whether the dropdown footer shows the shared AddCustomChainForm
  // (register an EVM chain viem does not ship by pointing the explorer
  // at its RPC).
  const [showAddChain, setShowAddChain] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setHighlightedIndex(null);
      setShowAddChain(false);
    }
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

  const selectChain = (chainId: number) => {
    onChainChange(chainId);
    setIsOpen(false);
    setSearchTerm('');
    setHighlightedIndex(null);
  };

  // Arrow keys drive the option highlight (the caret must not move);
  // Enter confirms exactly the highlighted option and never falls back
  // to a first-hit pick when nothing is highlighted.
  const handleFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const count = filteredChains.length;
      if (count > 0) {
        setHighlightedIndex(prev =>
          prev === null
            ? step === 1
              ? 0
              : count - 1
            : (prev + step + count) % count,
        );
      }
    } else if (e.key === 'Enter') {
      const highlighted =
        highlightedIndex !== null ? filteredChains[highlightedIndex] : undefined;
      if (highlighted) selectChain(highlighted.id);
    }
  };

  const highlightedChain =
    highlightedIndex !== null ? filteredChains[highlightedIndex] : undefined;

  return (
    <div className={selectorWrapper} data-chain-selector>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={selectorButton}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
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
              onChange={e => {
                setSearchTerm(e.target.value);
                // The filter rebuilds the list — a stale highlight index
                // would point at the wrong chain (or past the end).
                setHighlightedIndex(null);
              }}
              onKeyDown={handleFilterKeyDown}
              aria-controls="chain-selector-listbox"
              aria-activedescendant={
                highlightedChain ? `chain-option-${highlightedChain.id}` : undefined
              }
              autoFocus
            />
            {searchTerm && (
              <div className={dropdownHint}>
                <span>
                  Found
                  {filteredChains.length} chains
                </span>
                {filteredChains.length > 0 && <span>↑↓ to highlight · Enter to select</span>}
              </div>
            )}
          </div>

          <div
            className={dropdownList}
            role="listbox"
            id="chain-selector-listbox"
            aria-label="Chains"
            style={showAddChain ? { display: 'none' } : undefined}
          >
            {filteredChains.length === 0 ? (
              <div className={dropdownEmpty}>No matching chains found</div>
            ) : (
              filteredChains.map((chain, index) => {
                const chainType = getChainType(chain.id);
                const isActive = currentChainId === chain.id;

                return (
                  <button
                    key={chain.id}
                    role="option"
                    aria-selected={isActive}
                    id={`chain-option-${chain.id}`}
                    // The current chain is a state of the list, not just a
                    // visual tick — screen readers announce it as current.
                    aria-current={isActive ? 'true' : undefined}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => selectChain(chain.id)}
                    className={cx(
                      chainItem,
                      isActive ? chainItemActive : undefined,
                      highlightedIndex === index ? chainItemHighlight : undefined,
                    )}
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
                      {isActive && (
                        <span aria-hidden="true" style={{ color: 'var(--haze-color-primary)' }}>
                          ✓
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className={dropdownFooter}>
            {showAddChain ? (
              <>
                <AddCustomChainForm
                  onAdded={chain => {
                    // The chain is registered locally by the service, so
                    // selecting it lands on a resolvable /chain/:id view.
                    selectChain(chain.chainId);
                  }}
                />
                <button
                  type="button"
                  className={addChainButton}
                  onClick={() => setShowAddChain(false)}
                >
                  ← Back to chain list
                </button>
              </>
            ) : (
              <button
                type="button"
                className={addChainButton}
                onClick={() => setShowAddChain(true)}
              >
                + Add chain via RPC
              </button>
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

// Runs one RPC probe and folds every failure mode (transport error, or a
// method missing on a limited client) into null, so the unreachable
// fallback below never surfaces probe noise as a user-facing error and
// simply treats an unanswerable probe as "could not confirm".
async function tryRpcProbe<T>(probe: () => Promise<T>): Promise<T | null> {
  try {
    return await probe();
  } catch {
    return null;
  }
}

// Inline hint under the search box: 'miss' = definitive no-result on the
// current chain, 'block-miss' = the same for a block number (verified
// against the chain before navigating — chains differ in height),
// 'failed' = a data source errored (degraded response, or a request that
// failed outright), 'unreachable' = the backend could not be reached at
// all (no HTTP response: offline / not connected — a different failure
// from a data source erroring, with a retry instead of a network
// escape; fallbackNote = the direct-RPC check of the selected chain ran
// and could not confirm the query, so the note says what that means:
// only this chain was checked, full cross-chain search needs the
// backend), 'ens-resolved' / 'ens-not-found' / 'ens-failed' = outcome of
// a client-side ENS lookup (resolved on Ethereum; not-found is
// definitive, failed means the RPC never answered and is retryable).
// ens-resolved also carries the destination choice: Ethereum (where the
// name resolved) as the primary, the chain the search ran on as the
// alternate.
type SearchNotice =
  | { kind: 'miss'; query: string }
  | { kind: 'block-miss'; query: string }
  | { kind: 'failed'; query: string }
  | { kind: 'unreachable'; query: string; fallbackNote?: boolean }
  | { kind: 'ens-resolved'; query: string; address: string; destinations: EnsDestinations }
  | { kind: 'ens-not-found'; query: string }
  | { kind: 'ens-failed'; query: string };

// Destination actions for a resolved ENS name in the inline notice:
// Ethereum (where the name resolved) is the primary; the chain the search
// ran on is the secondary, shown only when it differs. The click is what
// history records — the chain actually opened, never a default.
function EnsDestinationActions({
  destinations,
  onOpen,
}: {
  destinations: EnsDestinations;
  onOpen: (chainId: number) => void;
}) {
  const { primaryChainId, alternateChainId } = destinations;
  return (
    <>
      <button
        type="button"
        className={searchNoticeLink}
        onClick={() => onOpen(primaryChainId)}
      >
        Open on {getChainName(primaryChainId)} →
      </button>
      {alternateChainId !== null && (
        <button
          type="button"
          className={searchNoticeLink}
          onClick={() => onOpen(alternateChainId)}
        >
          on {getChainName(alternateChainId)} →
        </button>
      )}
    </>
  );
}

// Glyphs for the theme cycle control (inline SVG, not emoji, per project
// style): sun = Light, moon = Dark, monitor = System. Decorative — the
// button's accessible name lives on aria-label/title.
function ThemeIcon({ mode }: { mode: ThemePreference }) {
  const iconProps = {
    'className': themeToggleIcon,
    'viewBox': '0 0 24 24',
    'fill': 'none',
    'stroke': 'currentColor',
    'strokeWidth': 2,
    'strokeLinecap': 'round',
    'strokeLinejoin': 'round',
    'aria-hidden': true,
    'focusable': 'false',
  } as const;

  if (mode === 'light') {
    return (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    );
  }
  if (mode === 'dark') {
    return (
      <svg {...iconProps}>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  return (
    <svg {...iconProps}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

// Topbar theme control: cycles Light → Dark → System, applies the choice
// immediately (the data-theme attribute; theme.css owns the palettes) and
// persists it under 'be:theme' so the pre-mount init in src/index.tsx
// restores it on the next load. The label names both the current and the
// next mode so hover and screen readers answer 'what is this' and 'what
// happens on click' at once.
function ThemeToggle() {
  const [mode, setMode] = useState<ThemePreference>(readThemePreference);
  const next = nextThemePreference(mode);
  const label = `Theme: ${mode}. Switch to ${next}`;

  const cycleTheme = () => {
    setMode(next);
    storeThemePreference(next);
    setDocumentThemeAttribute(next);
  };

  return (
    <button
      type="button"
      className={themeToggle}
      aria-label={label}
      title={label}
      onClick={cycleTheme}
    >
      <ThemeIcon mode={mode} />
    </button>
  );
}

// Backend version chip, fed by the discovery layer's cached /api/health
// probe (ServiceInfo.version — no extra request, never blocks rendering).
// The context is read null-tolerantly instead of through the throwing
// useServiceDiscovery hook on purpose: the chip is a leaf informational
// element, and an absent provider (view tests render the topbar bare)
// simply means 'no discovery info', which is exactly the honest 'v?'
// state — not a crash. The title carries the base URL when a backend is
// known and says so plainly when it is not.
function BackendVersionChip() {
  const discovery = useContext(ServiceDiscoveryContext);
  const serviceInfo = discovery?.serviceInfo;
  const version = serviceInfo?.version;

  const title = serviceInfo
    ? `Backend ${serviceInfo.url}${version ? ` (v${version})` : ' - version unknown'}`
    : 'Backend offline - version unknown';

  return (
    <span className={versionChip} title={title}>
      v{version ?? '?'}
    </span>
  );
}

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

  // Backend-unreachable fallback for block-number and 32-byte-hash
  // queries: the selected chain's own public RPC can still verify them
  // without the backend. A block number is confirmed when the chain's
  // head has reached it; a hash is probed as a transaction first, then
  // as a block. 'skipped' = the chain has no usable RPC client (the
  // plain unreachable notice stands, no note); 'missed' = the probe ran
  // and could not confirm, and the notice gains an honest note that
  // only this one chain was checked — full cross-chain search needs the
  // backend. A confirmed hit navigates and lands in history exactly
  // like the verified backend path.
  const searchViaChainRpc = async (
    chainId: number,
    query: string,
    searchType: 'block' | 'hash',
  ): Promise<'navigated' | 'missed' | 'skipped'> => {
    let client: Awaited<ReturnType<typeof createRpcClient>>;
    try {
      client = await createRpcClient(chainId);
    } catch {
      return 'skipped';
    }

    if (searchType === 'block') {
      const blockNumber = BigInt(query);
      const head = await tryRpcProbe(() => client.getBlockNumber());
      if (head !== null && head >= blockNumber) {
        setHistory(recordSearchHistoryEntry(query, chainId));
        goTo(`/chain/${chainId}/block/${String(blockNumber)}`);
        return 'navigated';
      }
      return 'missed';
    }

    const hash = query as `0x${string}`;
    const tx = await tryRpcProbe(() => client.getTransaction({ hash }));
    if (tx !== null) {
      setHistory(recordSearchHistoryEntry(query, chainId));
      goTo(`/chain/${chainId}/tx/${query}`);
      return 'navigated';
    }
    const block = await tryRpcProbe(() => client.getBlock({ blockHash: hash }));
    if (block !== null) {
      setHistory(recordSearchHistoryEntry(query, chainId));
      goTo(`/chain/${chainId}/block/${String(block.number)}`);
      return 'navigated';
    }
    return 'missed';
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
  // is the single source of truth): addresses deep-link straight to the
  // target chain's page; block numbers and hashes are facts of exactly one
  // chain (and chains differ in height / tx sets), so they are verified
  // through the per-chain search API before anything navigates — a number
  // or hash that is not on this chain surfaces as an inline miss with a
  // network-picker escape hatch, never as a blind jump onto an error
  // page; anything else goes to the full Search view. History records at
  // landing time — the entry carries the chain the search actually
  // reached (or, for a verified block/hash, the chain it was found on) —
  // so re-running one from the dropdown searches that chain again, not
  // whichever chain is currently selected.
  const navigateForQuery = async (rawQuery: string, chainId: number = currentChainId) => {
    const query = sanitizeInput(rawQuery.trim());
    const searchType = detectSearchType(query);

    if (searchType === 'address') {
      setHistory(recordSearchHistoryEntry(query, chainId));
      goTo(`/chain/${chainId}/address/${query}`);
      return;
    }

    if (searchType === 'block') {
      // A block number only exists below a chain's head, and heads differ
      // wildly between chains: verify before navigating (same shape as
      // the hash branch below).
      // Through the shared http layer (runtime-discovered api base), NOT a
      // raw same-origin fetch: in dev the same-origin /api is the Vite
      // bridge's own backend instance, which competes with the discovered
      // service for the single-writer DuckDB and serves different data.
      let payload: ChainSearchResponse | undefined;
      try {
        payload = (await fetchChainSearch(chainId, query)) as
        | ChainSearchResponse
        | undefined;
      } catch (error) {
        // Offline: the selected chain's own RPC can still confirm the
        // number before the search gives up (see searchViaChainRpc).
        if (isBackendUnreachable(error)) {
          const outcome = await searchViaChainRpc(chainId, query, 'block');
          if (outcome === 'navigated') return;
          setSearchNotice({ kind: 'unreachable', query, fallbackNote: outcome === 'missed' });
        } else {
          setSearchNotice({ kind: 'failed', query });
        }
        return;
      }

      if (payload?.found && payload.type === 'block' && payload.data?.number !== undefined) {
        setHistory(recordSearchHistoryEntry(query, chainId));
        // The block detail route only accepts numbers, and the verified
        // payload carries the canonical one.
        goTo(`/chain/${chainId}/block/${String(payload.data.number)}`);
        return;
      }

      // A degraded response means a data source errored — never worded as
      // a definitive "no results".
      setSearchNotice(
        payload?.degraded ? { kind: 'failed', query } : { kind: 'block-miss', query },
      );
      return;
    }

    if (searchType === 'hash') {
      // Through the shared http layer (runtime-discovered api base), NOT a
      // raw same-origin fetch: in dev the same-origin /api is the Vite
      // bridge's own backend instance, which competes with the discovered
      // service for the single-writer DuckDB and serves different data.
      let data: unknown;
      try {
        data = await fetchChainSearch(chainId, query);
      } catch (error) {
        // Offline: the selected chain's own RPC can still resolve the
        // hash (tx first, then block) before the search gives up.
        if (isBackendUnreachable(error)) {
          const outcome = await searchViaChainRpc(chainId, query, 'hash');
          if (outcome === 'navigated') return;
          setSearchNotice({ kind: 'unreachable', query, fallbackNote: outcome === 'missed' });
        } else {
          setSearchNotice({ kind: 'failed', query });
        }
        return;
      }
      const payload = data as ChainSearchResponse | undefined;

      if (payload?.found) {
        if (payload.type === 'transaction') {
          setHistory(recordSearchHistoryEntry(query, chainId));
          goTo(`/chain/${chainId}/tx/${query}`);
          return;
        }
        if (payload.type === 'block' && payload.data?.number !== undefined) {
          // The block detail route only accepts numbers, not hashes.
          setHistory(recordSearchHistoryEntry(query, chainId));
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
      // the ENS registry lives). A resolved address is a fact of
      // Ethereum, so nothing navigates and no history is recorded yet:
      // the notice offers Ethereum (primary) and the chain the search
      // ran on (alternate), and history records whichever destination is
      // actually opened. A definitive not-found is reported as such, an
      // RPC failure as a retryable failure — never one blurred copy for
      // both.
      const outcome = await resolveEnsAddress(query);
      if (outcome.status === 'resolved') {
        setSearchNotice({
          kind: 'ens-resolved',
          query,
          address: outcome.address,
          destinations: ensDestinations(chainId),
        });
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
    // suggestions link back to that chain's pages. History is NOT
    // recorded here: the query's outcome is unknown until the view has
    // actually run it, so the Search view records the entry when it
    // navigates to a result (or the search lands on a chain).
    goTo(`/search?q=${encodeURIComponent(query)}&chain=${chainId}`);
  };

  const selectHistoryItem = (entry: SearchHistoryEntry) => {
    setSearchQuery(entry.query);
    setShowHistory(false);
    // Legacy entries predate per-chain recording: they re-run on the
    // currently selected chain instead of one they never carried.
    void navigateForQuery(entry.query, entry.chainId ?? currentChainId);
  };

  // Opens a resolved ENS address on the chain the user chose — the moment
  // history records the entry, with the destination actually opened (not
  // the chain the search happened to run on).
  const openEnsAddress = (query: string, address: string, targetChainId: number) => {
    setHistory(recordSearchHistoryEntry(query, targetChainId));
    setSearchNotice(null);
    goTo(`/chain/${targetChainId}/address/${address}`);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    setSearchNotice(null);
    try {
      if (onSearch) {
        // The parent handles dispatch; history is recorded here only for
        // queries whose destination is known up front (address deep-links
        // immediately, block/hash are facts of one chain). ENS is skipped
        // — its destination only exists after resolution — and free text
        // ('unknown') is skipped too: its outcome is unknown until the
        // Search view lands somewhere, and that landing is what records.
        const dispatchType = detectSearchType(sanitizeInput(searchQuery.trim()));
        if (
          dispatchType !== 'ens'
          && dispatchType !== 'unknown'
        ) {
          setHistory(recordSearchHistoryEntry(sanitizeInput(searchQuery.trim()), currentChainId));
        }
        await onSearch(searchQuery.trim());
      } else {
        await navigateForQuery(searchQuery);
      }
    } catch (error) {
      // A failed dispatch must be visible, not just logged: name what
      // broke. No HTTP response at all (backend offline / not connected)
      // is 'unreachable' with a retry; any other request failure is the
      // data-source wording — neither is ever worded as "no results".
      const query = sanitizeInput(searchQuery.trim());
      setSearchNotice(
        isBackendUnreachable(error)
          ? { kind: 'unreachable', query }
          : { kind: 'failed', query },
      );
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

          {/* In-app page links beside the logo, same navigation as the
              logo above: the block list, the transaction list, the node's
              pending pool, the cached-contract directory and the daily
              charts derived from live RPC sampling. */}
          <div className={navLinks}>
            <button
              type="button"
              className={navLink}
              onClick={() => goTo(`/chain/${currentChainId}/blocks`)}
            >
              Blocks
            </button>
            <button
              type="button"
              className={navLink}
              onClick={() => goTo(`/chain/${currentChainId}/transactions`)}
            >
              Transactions
            </button>
            <button
              type="button"
              className={navLink}
              onClick={() => goTo(`/chain/${currentChainId}/pending`)}
            >
              Pending
            </button>
            <button
              type="button"
              className={navLink}
              onClick={() => goTo(`/chain/${currentChainId}/contracts`)}
            >
              Contracts
            </button>
            <button
              type="button"
              className={navLink}
              onClick={() => goTo(`/chain/${currentChainId}/charts`)}
            >
              Charts
            </button>
            {/* Admin group, visually separated from the page links: the
                SQL console runs admin-gated read-only queries against the
                explorer's own DuckDB. Not chain-scoped (it queries the
                main database), so it links to the bare /sql path. */}
            <span className={navDivider} data-testid="nav-admin-divider" aria-hidden="true" />
            <button
              type="button"
              className={cx(navLink, navLinkMuted)}
              aria-label="SQL console (admin)"
              onClick={() => goTo('/sql')}
            >
              SQL
            </button>
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
                  {searchNotice.kind === 'block-miss' &&
                    `Block not found on ${chainInfo?.name ?? 'this chain'} — it may exist on another network`}
                  {searchNotice.kind === 'failed' &&
                    `Search failed on ${chainInfo?.name ?? 'this chain'} — a data source errored`}
                  {searchNotice.kind === 'unreachable' &&
                    (searchNotice.fallbackNote
                      ? `Search unavailable — cannot reach the explorer backend; direct RPC check of ${
                        chainInfo?.name ?? 'this chain'
                      } found no match (full cross-chain search requires the backend)`
                      : 'Search unavailable — cannot reach the explorer backend')}
                  {searchNotice.kind === 'ens-resolved' &&
                    `Resolved ${searchNotice.query} → ${formatAddress(searchNotice.address)} on Ethereum`}
                  {searchNotice.kind === 'ens-not-found' &&
                    `ENS name "${searchNotice.query}" not found (checked on Ethereum)`}
                  {searchNotice.kind === 'ens-failed' &&
                    `ENS resolution failed for "${searchNotice.query}" — Ethereum RPC did not answer`}
                </span>
                <span className={searchNoticeActions}>
                  {(searchNotice.kind === 'miss'
                    || searchNotice.kind === 'block-miss'
                    || searchNotice.kind === 'failed') && (
                    <button
                      type="button"
                      className={searchNoticeLink}
                      onClick={() =>
                        // No ?chain= on purpose: the query's chain is
                        // unknown (it just missed here), so the Search view
                        // must ask which network to search next instead of
                        // re-running it on this one — the link opens the
                        // network picker.
                        goTo(`/search?q=${encodeURIComponent(searchNotice.query)}`)}
                    >
                      Choose a network →
                    </button>
                  )}
                  {searchNotice.kind === 'unreachable' && (
                    <button
                      type="button"
                      className={searchNoticeLink}
                      onClick={() => void handleSearch()}
                    >
                      Retry
                    </button>
                  )}
                  {searchNotice.kind === 'ens-resolved' && (
                    <EnsDestinationActions
                      destinations={searchNotice.destinations}
                      onOpen={targetChainId => {
                        openEnsAddress(searchNotice.query, searchNotice.address, targetChainId);
                      }}
                    />
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
                </span>
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
                    key={`${entry.chainId ?? 'unscoped'}-${entry.query}`}
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
                      {/* Legacy entries carry no chain: the badge shows
                          where a click would run them now (the currently
                          selected chain), which is exactly what happens. */}
                      <span className={historyType}>
                        {getChainName(entry.chainId ?? currentChainId)}
                      </span>
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
            <ThemeToggle />
            <Button variant="outline" size="md" onClick={() => setShowRpcConfig(true)}>
              ⚙️ RPC
            </Button>
            <ChainSelector currentChainId={currentChainId} onChainChange={onChainChange} />
            <BackendVersionChip />
          </div>
        </div>
      </nav>

      <RpcConfig open={rpcConfigControl} chainId={currentChainId} />
    </>
  );
}
