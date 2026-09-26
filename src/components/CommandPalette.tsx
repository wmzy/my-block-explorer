// Global command palette (Ctrl/Cmd+K): one keystroke away from every page
// and power tool the explorer ships — including the ones with no topbar
// entry (SQL console, Ops, Signatures, Coverage legend, Broadcast). The
// component renders NOTHING until opened; the only persistent footprint is
// the global Ctrl/Cmd+K listener (and the topbar-trigger opener
// registration), both removed on unmount.
//
// Chain-scoped destinations need a chain: the optional `currentChainId`
// prop wins, then the remembered chain (the SAME reader the landing page
// uses — readRememberedChainId from @/views/Home/Landing, storage key
// 'be:lastChainId'), then the app's preferred entry chain (mainnet-first,
// same order as the '/' redirect). Hints always name the chain the action
// would open, so a fallback destination is never a surprise.
//
// Touch fallback: the palette is a keyboard affordance — hidden below
// 768px entirely (media query on the overlay), where the Tools hub page
// (/tools) lists every tool as tappable cards.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { css, cx } from '@linaria/core';
import { navigate } from '@native-router/core';
import { useRouter } from '@native-router/react';
import { getChainName } from '@/config/chains';
import { getPreferredChainId, readRememberedChainId } from '@/views/Home/Landing';
import {
  nextThemePreference,
  readThemePreference,
  setDocumentThemeAttribute,
  storeThemePreference,
} from '@/themePreference';

// --- Open control (module-scoped, dependency-light) ---
//
// The topbar trigger needs to open the palette without importing a React
// tree of its own, and a palette that is not mounted must make the call a
// no-op (nothing to open). A tiny registry of openers solves both: the
// component registers/unregisters around its mount lifecycle, everyone
// else just calls openCommandPalette().

type PaletteOpener = () => void;

const openers = new Set<PaletteOpener>();

function registerCommandPaletteOpener(opener: PaletteOpener): void {
  openers.add(opener);
}

function unregisterCommandPaletteOpener(opener: PaletteOpener): void {
  openers.delete(opener);
}

/**
 * Open the mounted command palette (topbar trigger, future call sites).
 * No palette mounted → no-op.
 */
export function openCommandPalette(): void {
  openers.forEach(opener => opener());
}

// --- Pure action model (exported for the unit tests) ---

export type PaletteAction = {
  id: string;
  title: string;
  /** One-line hint rendered under the title; chain actions name their chain. */
  hint: string;
  /** Navigation destination; absent for command-style actions (`run`). */
  to?: string;
  /** Renders the muted 'admin' chip (SQL console, Ops). */
  admin?: boolean;
  /** Imperative action for entries without a destination (theme toggle). */
  run?: () => void;
  /** Extra filter terms matched case-insensitively alongside the title. */
  keywords?: string[];
};

/**
 * The palette's full action list for one effective chain. Pure: the chain
 * id and its display name are resolved by the caller (prop → remembered →
 * preferred) so the tests never touch localStorage to pin the output.
 */
export function buildPaletteActions(chainId: number, chainName: string): PaletteAction[] {
  const on = `${chainName}`;
  return [
    {
      id: 'blocks',
      title: 'Blocks',
      hint: `Latest blocks on ${on}`,
      to: `/chain/${chainId}/blocks`,
      keywords: ['block list', 'height', 'finality'],
    },
    {
      id: 'transactions',
      title: 'Transactions',
      hint: `Recent transactions on ${on}`,
      to: `/chain/${chainId}/transactions`,
      keywords: ['tx list', 'txs', 'transfers'],
    },
    {
      id: 'pending',
      title: 'Pending',
      hint: `The node's pending pool on ${on} (live RPC)`,
      to: `/chain/${chainId}/pending`,
      keywords: ['mempool', 'txpool', 'pool', 'queued'],
    },
    {
      id: 'broadcast',
      title: 'Broadcast',
      hint: `Publish a signed raw transaction on ${on}`,
      to: `/chain/${chainId}/broadcast`,
      keywords: ['send', 'raw tx', 'publish', 'submit'],
    },
    {
      id: 'contracts',
      title: 'Contracts',
      hint: `Cached verified-contract directory on ${on}`,
      to: `/chain/${chainId}/contracts`,
      keywords: ['directory', 'verified', 'sources'],
    },
    {
      id: 'tokens',
      title: 'Tokens',
      hint: `Token directory on ${on}`,
      to: `/chain/${chainId}/tokens`,
      keywords: ['token list', 'erc20', 'erc721', 'nft'],
    },
    {
      id: 'charts',
      title: 'Charts',
      hint: `Daily charts sampled from RPC on ${on}`,
      to: `/chain/${chainId}/charts`,
      keywords: ['stats', 'history', 'fees'],
    },
    {
      id: 'search',
      title: 'Search',
      hint: 'Cross-chain search through the backend index',
      to: '/search',
      keywords: ['find', 'lookup', 'global'],
    },
    {
      id: 'signatures',
      title: 'Signatures',
      hint: 'Resolve function selectors and event topic0 hashes',
      to: '/signatures',
      keywords: ['selector', 'topic0', '4byte', 'abi'],
    },
    {
      id: 'tools',
      title: 'Tools',
      hint: 'Every tool on one page (the touch-friendly hub)',
      to: '/tools',
      keywords: ['hub', 'all tools', 'palette'],
    },
    {
      id: 'coverage',
      title: 'Coverage legend',
      hint: 'What the live / cached / sampled chips mean',
      to: '/about/coverage',
      keywords: ['about', 'vocabulary', 'badge'],
    },
    {
      id: 'sql',
      title: 'SQL console',
      hint: 'Read-only admin-gated queries against the explorer\'s DuckDB',
      to: '/sql',
      admin: true,
      keywords: ['query', 'database', 'duckdb'],
    },
    {
      id: 'ops',
      title: 'Ops',
      hint: 'Operator dashboard: storage, indexing, watch, rate limits',
      to: '/ops',
      admin: true,
      keywords: ['operator', 'dashboard', 'storage', 'backup'],
    },
    {
      id: 'theme',
      title: 'Toggle theme',
      hint: 'Cycle Light → Dark → System',
      run: cycleThemePreference,
      keywords: ['dark', 'light', 'appearance', 'mode'],
    },
  ];
}

/**
 * Case-insensitive substring filter over each action's title and keyword
 * list. Empty/whitespace query returns the full list (the palette opens
 * as a browsable menu, not an empty box).
 */
export function filterActions(actions: PaletteAction[], query: string): PaletteAction[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return actions;
  return actions.filter(action => {
    if (action.title.toLowerCase().includes(needle)) return true;
    return action.keywords?.some(keyword => keyword.toLowerCase().includes(needle)) ?? false;
  });
}

/**
 * Wrapping move for ↑/↓ keyboard navigation: (active + delta) mod count.
 * An empty list keeps index 0 (Enter is a no-op there by construction).
 */
export function nextActiveIndex(activeIndex: number, optionCount: number, delta: 1 | -1): number {
  if (optionCount <= 0) return 0;
  return (activeIndex + delta + optionCount) % optionCount;
}

// The theme action reuses the exact cycle the topbar control runs — same
// helpers, same storage key — so the two can never disagree.
export function cycleThemePreference(): void {
  const next = nextThemePreference(readThemePreference());
  setDocumentThemeAttribute(next);
  storeThemePreference(next);
}

// --- Styles ---

// Below 768px the palette is hidden entirely: it is a keyboard
// affordance, and the Tools hub page (/tools) is the touch fallback.
const overlay = css`
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 12vh var(--haze-space-4) var(--haze-space-4);

  @media (max-width: 767px) {
    display: none;
  }
`;

const dialogStyle = css`
  width: min(560px, 100%);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  box-shadow: var(--haze-shadow-lg);
  overflow: hidden;
`;

const inputStyle = css`
  border: none;
  border-bottom: 1px solid var(--haze-color-border);
  background: transparent;
  padding: var(--haze-space-4) var(--haze-space-5);
  font-family: var(--haze-font-sans);
  font-size: var(--haze-text-base);
  color: var(--haze-color-text);
  outline: none;

  &::placeholder {
    color: var(--haze-color-text-muted);
  }
`;

const listStyle = css`
  list-style: none;
  margin: 0;
  padding: var(--haze-space-2);
  overflow-y: auto;
  flex: 1;
`;

const optionStyle = css`
  display: flex;
  align-items: baseline;
  gap: var(--haze-space-2);
  padding: var(--haze-space-2) var(--haze-space-3);
  border-radius: var(--haze-radius-md);
  cursor: pointer;
`;

const optionActiveStyle = css`
  background: var(--haze-color-bg-muted);
`;

const optionTitleStyle = css`
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text);
  white-space: nowrap;
`;

// Same stance as the topbar's muted SQL/Ops entries: the chip marks the
// admin tier without hiding the entry (discoverable, honestly labeled).
const adminChipStyle = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-full);
  padding: 0 var(--haze-space-2);
  white-space: nowrap;
`;

const optionHintStyle = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  text-align: right;
`;

const emptyStyle = css`
  padding: var(--haze-space-4) var(--haze-space-3);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-muted);
`;

const footnoteStyle = css`
  border-top: 1px solid var(--haze-color-border);
  padding: var(--haze-space-2) var(--haze-space-5);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

// --- Component ---

export type CommandPaletteProps = {
  /** Chain context for chain-scoped destinations; falls back to the
   *  remembered chain, then the preferred entry chain. */
  currentChainId?: number;
};

// Referential stable empty list for the closed state (see below).
const NO_ACTIONS: PaletteAction[] = [];

export default function CommandPalette({ currentChainId }: CommandPaletteProps = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Actions are (re)built when the palette opens so the remembered-chain
  // fallback and the chain name are read at open time, not mount time —
  // a chain picked five minutes ago is stale context. While closed the
  // palette renders nothing, so the empty list costs nothing.
  const actions = useMemo(() => {
    if (!open) return NO_ACTIONS;
    const effectiveChainId = currentChainId ?? readRememberedChainId() ?? getPreferredChainId();
    return buildPaletteActions(effectiveChainId, getChainName(effectiveChainId));
  }, [currentChainId, open]);

  const filtered = useMemo(() => filterActions(actions, query), [actions, query]);

  // Clamps a stale index (e.g. it pointed past the end of a list that
  // just shrank) so highlight, aria-activedescendant and Enter all agree.
  const effectiveActive = Math.min(activeIndex, Math.max(filtered.length - 1, 0));

  // Global Ctrl/Cmd+K listener: attached for the component's whole
  // lifetime, removed on unmount (no leak).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Topbar-trigger bridge: registered while mounted, unregistered on
  // unmount so openCommandPalette() is a no-op with no palette around.
  useEffect(() => {
    const opener = () => setOpen(true);
    registerCommandPaletteOpener(opener);
    return () => unregisterCommandPaletteOpener(opener);
  }, []);

  // Every open starts fresh: empty query, first option, focus in the
  // input (the palette's single focus stop — the honest focus trap).
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    inputRef.current?.focus();
  }, [open]);

  const close = () => setOpen(false);

  const selectAction = (action: PaletteAction) => {
    close();
    if (action.to !== undefined) {
      navigate(router, action.to).catch(() => undefined);
    } else {
      action.run?.();
    }
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(nextActiveIndex(effectiveActive, filtered.length, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(nextActiveIndex(effectiveActive, filtered.length, -1));
    } else if (event.key === 'Enter') {
      const action = filtered[effectiveActive];
      if (action !== undefined) {
        event.preventDefault();
        selectAction(action);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      // Focus trap: the input is the only focusable element; there is no
      // second stop to cycle to, so Tab stays put instead of escaping to
      // the page behind the modal overlay.
      event.preventDefault();
    }
  };

  // Click on the scrim (not the dialog) closes — the standard modal
  // dismissal alongside Esc.
  const onOverlayMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) close();
  };

  // Nothing until opened — the listener above is the only footprint.
  if (!open) return null;

  const activeOptionId
    = filtered.length > 0 ? `command-palette-option-${effectiveActive}` : undefined;

  return (
    <div className={overlay} onMouseDown={onOverlayMouseDown}>
      <div
        className={dialogStyle}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          className={inputStyle}
          type="text"
          value={query}
          placeholder="Jump to a page or tool…"
          aria-label="Search actions"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-listbox"
          aria-activedescendant={activeOptionId}
          onChange={event => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onInputKeyDown}
        />
        <ul
          id="command-palette-listbox"
          role="listbox"
          aria-label="Actions"
          className={listStyle}
        >
          {filtered.map((action, index) => (
            <li
              key={action.id}
              id={`command-palette-option-${index}`}
              role="option"
              aria-selected={index === effectiveActive}
              className={cx(optionStyle, index === effectiveActive && optionActiveStyle)}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectAction(action)}
            >
              <span className={optionTitleStyle}>{action.title}</span>
              {action.admin === true && (
                <span className={adminChipStyle} title="Admin-gated — requires the server's admin token where configured">
                  admin
                </span>
              )}
              <span className={optionHintStyle}>{action.hint}</span>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className={emptyStyle} role="option" aria-selected="false" aria-disabled="true">
              No matching action — the Tools page lists every tool.
            </li>
          )}
        </ul>
        <div className={footnoteStyle}>↑ ↓ move · Enter open · Esc close</div>
      </div>
    </div>
  );
}
