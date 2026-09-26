// Command palette contract: the pure action model (filter, keyboard-index
// wrap, action list with admin chips + chain-scoped destinations), the
// open paths (global Ctrl/Cmd+K listener and the exported
// openCommandPalette control used by the topbar trigger), dialog a11y
// semantics (role=dialog + aria-modal + labelled combobox input +
// listbox/option with aria-activedescendant), Enter navigation, Escape
// close, the remembered/preferred chain fallback order, and the theme
// action reusing the shared themePreference cycle. The router is stubbed
// (painless view-test style) so navigation stays observable without a
// HistoryRouter; the remembered-chain reader is stubbed to pin the
// fallback order without localStorage.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import CommandPalette, {
  buildPaletteActions,
  cycleThemePreference,
  filterActions,
  nextActiveIndex,
  openCommandPalette,
} from '@/components/CommandPalette';
import { THEME_STORAGE_KEY } from '@/themePreference';

const { mockRouter, mockNavigate, mockReadRememberedChainId } = vi.hoisted(() => ({
  mockRouter: { name: 'mock-router' },
  mockNavigate: vi.fn((): Promise<void> => Promise.resolve(undefined)),
  mockReadRememberedChainId: vi.fn<() => number | undefined>(),
}));

vi.mock('@native-router/react', () => ({
  useRouter: () => mockRouter,
}));
vi.mock('@native-router/core', () => ({
  navigate: mockNavigate,
}));

// Pin the remembered/preferred chain inputs: the fallback ORDER is the
// contract under test, not the localStorage reader itself (that has its
// own coverage via the Landing tests).
vi.mock('@/views/Home/Landing', () => ({
  readRememberedChainId: () => mockReadRememberedChainId(),
  getPreferredChainId: () => 1,
}));

vi.mock('@/config/chains', () => ({
  getChainName: (chainId: number) => {
    if (chainId === 1) return 'Ethereum';
    if (chainId === 137) return 'Polygon';
    if (chainId === 5000) return 'Mantle';
    return `Chain ${chainId}`;
  },
}));

const openWithMetaK = () => fireEvent.keyDown(window, { key: 'k', metaKey: true });
const openWithCtrlK = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

const paletteInput = () => screen.getByLabelText('Search actions');

beforeEach(() => {
  vi.clearAllMocks();
  mockReadRememberedChainId.mockReturnValue(undefined);
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

// --- Pure helpers ---

describe('filterActions', () => {
  const actions = buildPaletteActions(1, 'Ethereum');

  it('returns the full list for an empty or whitespace-only query', () => {
    // The palette opens as a browsable menu, not an empty box.
    expect(filterActions(actions, '')).toHaveLength(actions.length);
    expect(filterActions(actions, '   ')).toHaveLength(actions.length);
  });

  it('matches case-insensitively on the title', () => {
    expect(filterActions(actions, 'SQL').map(action => action.id)).toEqual(['sql']);
    expect(filterActions(actions, 'sql').map(action => action.id)).toEqual(['sql']);
    expect(filterActions(actions, 'coverage').map(action => action.id)).toEqual(['coverage']);
  });

  it('matches on keywords beyond the title', () => {
    // 'mempool' appears only as a Pending keyword; 'topic0' only as a
    // Signatures keyword.
    expect(filterActions(actions, 'mempool').map(action => action.id)).toEqual(['pending']);
    expect(filterActions(actions, 'topic0').map(action => action.id)).toEqual(['signatures']);
    expect(filterActions(actions, 'duckdb').map(action => action.id)).toEqual(['sql']);
  });

  it('returns an empty list when nothing matches, trimmed first', () => {
    expect(filterActions(actions, 'zzz')).toEqual([]);
    expect(filterActions(actions, ' zzz ')).toEqual([]);
  });
});

describe('nextActiveIndex', () => {
  it('moves forward and wraps from the last option back to the first', () => {
    expect(nextActiveIndex(0, 3, 1)).toBe(1);
    expect(nextActiveIndex(2, 3, 1)).toBe(0);
  });

  it('moves backward and wraps from the first option to the last', () => {
    expect(nextActiveIndex(1, 3, -1)).toBe(0);
    expect(nextActiveIndex(0, 3, -1)).toBe(2);
  });

  it('keeps index 0 for an empty list (Enter must be a no-op, not NaN)', () => {
    expect(nextActiveIndex(5, 0, 1)).toBe(0);
    expect(nextActiveIndex(5, 0, -1)).toBe(0);
  });
});

describe('buildPaletteActions', () => {
  it('scopes the chain pages to the given chain and names it in the hint', () => {
    const actions = buildPaletteActions(137, 'Polygon');
    const blocks = actions.find(action => action.id === 'blocks');
    expect(blocks?.to).toBe('/chain/137/blocks');
    expect(blocks?.hint).toContain('Polygon');

    const pending = actions.find(action => action.id === 'pending');
    expect(pending?.to).toBe('/chain/137/pending');
  });

  it('leaves the global tools un-scoped with their exact destinations', () => {
    const actions = buildPaletteActions(1, 'Ethereum');
    const byId = new Map(actions.map(action => [action.id, action.to]));
    expect(byId.get('search')).toBe('/search');
    expect(byId.get('signatures')).toBe('/signatures');
    expect(byId.get('tools')).toBe('/tools');
    expect(byId.get('coverage')).toBe('/about/coverage');
    expect(byId.get('sql')).toBe('/sql');
    expect(byId.get('ops')).toBe('/ops');
  });

  it('marks exactly the SQL console and Ops as admin', () => {
    const actions = buildPaletteActions(1, 'Ethereum');
    expect(actions.filter(action => action.admin).map(action => action.id)).toEqual([
      'sql',
      'ops',
    ]);
  });

  it('gives the theme action a run command instead of a destination', () => {
    const theme = buildPaletteActions(1, 'Ethereum').find(action => action.id === 'theme');
    expect(theme?.to).toBeUndefined();
    expect(typeof theme?.run).toBe('function');
  });

  it('cycles the theme through the shared themePreference helpers', () => {
    // Fresh storage reads as 'system'; the cycle pins 'light' on the
    // document and persists it under the shared key the topbar uses.
    cycleThemePreference();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    cycleThemePreference();
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});

// --- Component ---

describe('CommandPalette', () => {
  it('renders nothing until opened, then opens on Cmd+K with dialog semantics', () => {
    render(<CommandPalette />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openWithMetaK();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Command palette');

    const input = paletteInput();
    expect(input).toHaveAttribute('role', 'combobox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox', { name: 'Actions' })).toBeInTheDocument();
  });

  it('also opens on Ctrl+K and via the exported openCommandPalette control', () => {
    const { unmount } = render(<CommandPalette />);
    openWithCtrlK();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(paletteInput(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // The topbar trigger path: the exported control opens the mounted
    // palette (act-wrapped — it is a bare setState with no DOM event).
    act(() => {
      openCommandPalette();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Unmount removes both the listener and the opener: neither open path
    // may throw or resurrect anything afterwards.
    unmount();
    expect(() => {
      openWithMetaK();
      openCommandPalette();
    }).not.toThrow();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('offers the full action list on open with admin chips on SQL and Ops', () => {
    render(<CommandPalette />);
    openWithMetaK();

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(buildPaletteActions(1, 'Ethereum').length);

    const sql = screen.getByRole('option', { name: /SQL console/ });
    expect(within(sql).getByText('admin')).toBeInTheDocument();
    const ops = screen.getByRole('option', { name: /^Ops/ });
    expect(within(ops).getByText('admin')).toBeInTheDocument();
    const blocks = screen.getByRole('option', { name: /^Blocks/ });
    expect(within(blocks).queryByText('admin')).not.toBeInTheDocument();
  });

  it('filters the list case-insensitively as you type and shows an honest empty state', () => {
    render(<CommandPalette />);
    openWithMetaK();

    fireEvent.change(paletteInput(), { target: { value: 'SIG' } });
    let options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Signatures');

    fireEvent.change(paletteInput(), { target: { value: 'zzz' } });
    options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent(/No matching action/);
    // No activedescendant may point into an empty list.
    expect(paletteInput()).not.toHaveAttribute('aria-activedescendant');
  });

  it('moves the active option with arrows (aria-activedescendant tracks it) and Enter navigates', () => {
    render(<CommandPalette />);
    openWithMetaK();

    const input = paletteInput();
    expect(input).toHaveAttribute('aria-activedescendant', 'command-palette-option-0');
    expect(screen.getByRole('option', { name: /^Blocks/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'command-palette-option-1');
    expect(screen.getByRole('option', { name: /^Transactions/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: /^Blocks/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );

    // Up twice from index 1 wraps 1 → 0 → last option (Toggle theme).
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const last = screen.getAllByRole('option').length - 1;
    expect(input).toHaveAttribute('aria-activedescendant', `command-palette-option-${last}`);

    // Down twice wraps last → 0 → 1 (Transactions); Enter navigates + closes.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith(mockRouter, '/chain/1/transactions');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Enter picks the surviving option after filtering shrinks the list', () => {
    render(<CommandPalette />);
    openWithMetaK();

    // Walk the highlight deep into the full list, then filter down to a
    // single option: Enter must pick the survivor, never undefined.
    const input = paletteInput();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.change(input, { target: { value: 'broadcast' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith(mockRouter, '/chain/1/broadcast');
  });

  it('closes on Escape and reopens fresh (query and highlight reset)', () => {
    render(<CommandPalette />);
    openWithMetaK();

    fireEvent.change(paletteInput(), { target: { value: 'theme' } });
    fireEvent.keyDown(paletteInput(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openWithMetaK();
    const input = paletteInput();
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('aria-activedescendant', 'command-palette-option-0');
    expect(screen.getAllByRole('option')).toHaveLength(
      buildPaletteActions(1, 'Ethereum').length,
    );
  });

  it('resolves the effective chain as prop → remembered chain → preferred chain', () => {
    // Remembered chain without a prop (one palette at a time: every
    // mounted instance answers the global Cmd+K).
    mockReadRememberedChainId.mockReturnValue(137);
    const bare = render(<CommandPalette />);
    openWithMetaK();
    fireEvent.keyDown(paletteInput(), { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith(mockRouter, '/chain/137/blocks');
    bare.unmount();

    // An explicit prop outranks the remembered chain.
    render(<CommandPalette currentChainId={5000} />);
    openWithMetaK();
    fireEvent.keyDown(paletteInput(), { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith(mockRouter, '/chain/5000/blocks');
  });

  it('runs the theme cycle through the palette instead of navigating', () => {
    render(<CommandPalette />);
    openWithMetaK();

    fireEvent.change(paletteInput(), { target: { value: 'theme' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(paletteInput(), { key: 'Enter' });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
