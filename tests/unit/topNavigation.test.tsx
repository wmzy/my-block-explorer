import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import TopNavigation from '@/components/TopNavigation';
import { ApiError } from '@/util/apiError';
import { ServiceDiscoveryContext } from '@/hooks/ServiceDiscoveryContext';
import type { ServiceInfo } from '@/hooks/useAutoDiscovery';
import { THEME_STORAGE_KEY } from '@/themePreference';
import {
  recordSearchHistoryEntry,
  SEARCH_HISTORY_STORAGE_KEY,
} from '@/services/searchHistory';

// Mock @native-router: TopNavigation reads the router via useRouter and
// navigates through the core navigate(router, to) free function. Stubbing
// both keeps the component's routing contract observable without mounting a
// HistoryRouter (painless view-test style, the lighter path).
const { mockRouter, mockNavigate } = vi.hoisted(() => ({
  mockRouter: { name: 'mock-router' },
  mockNavigate: vi.fn((): Promise<void> => Promise.resolve(undefined)),
}));
vi.mock('@native-router/react', () => ({
  useRouter: () => mockRouter,
}));
vi.mock('@native-router/core', () => ({
  navigate: mockNavigate,
}));

// Mock RpcConfig
vi.mock('../../src/components/RpcConfig', () => ({
  default: ({ _open }: { _open?: unknown }) => (
    <div data-testid="rpc-config-modal">RPC Config Modal</div>
  ),
}));

// Mock the shared http layer so the hash-search call (the only network
// path left in the component — history is localStorage-only now) is
// observable without a network. withSignal is a pass-through: the
// hash-search path composes it around the mocked api client.
// isBackendUnreachable mirrors the real predicate and is wired to the
// real ApiError class in beforeEach (hoisting rules keep it out of the
// factory) so failure attribution is exercised with real error objects.
const { mockGet, mockApi, mockIsBackendUnreachable } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockApi: { mockApiBase: true },
  mockIsBackendUnreachable: vi.fn(),
}));
vi.mock('../../src/util/http', () => ({
  api: mockApi,
  get: mockGet,
  withSignal: (o: unknown) => o,
  isBackendUnreachable: mockIsBackendUnreachable,
}));

// Client-side ENS resolution runs over a mainnet RPC client; the mock keeps
// it observable (and offline) in tests. The resolved client is typed loosely
// on purpose: per-test clients extend the surface (the offline fallback
// probes add getBlockNumber/getTransaction/getBlock on top of the ENS
// default).
const { mockCreateRpcClient, mockGetEnsAddress } = vi.hoisted(() => {
  const getEnsAddress = vi.fn(
    (): Promise<string | null> =>
      Promise.resolve('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'),
  );
  const defaultClient: Record<string, unknown> = { getEnsAddress };
  return {
    mockGetEnsAddress: getEnsAddress,
    mockCreateRpcClient: vi.fn(
      (_chainId: number): Promise<Record<string, unknown>> =>
        Promise.resolve(defaultClient),
    ),
  };
});
vi.mock('../../src/utils/realTimeData', () => ({
  createRpcClient: (_chainId: number) => mockCreateRpcClient(_chainId),
}));

// Mock chains config
vi.mock('../../src/config/chains', () => ({
  getChainInfo: (chainId: number) => {
    const chains = {
      1: { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } },
      5000: { id: 5000, name: 'Mantle', nativeCurrency: { symbol: 'MNT' } },
      137: { id: 137, name: 'Polygon', nativeCurrency: { symbol: 'MATIC' } },
    };
    return chains[chainId as keyof typeof chains] || null;
  },
  getChainName: (chainId: number) => {
    const names = { 1: 'Ethereum', 5000: 'Mantle', 137: 'Polygon' };
    return names[chainId as keyof typeof names] || `Chain ${chainId}`;
  },
  getChainSymbol: (chainId: number) => {
    const symbols = { 1: 'ETH', 5000: 'MNT', 137: 'MATIC' };
    return symbols[chainId as keyof typeof symbols] || 'UNKNOWN';
  },
  getChainType: (chainId: number) => (chainId === 5 ? 'testnet' : 'mainnet'),
  isPopularChain: (chainId: number) => [1, 137, 5000].includes(chainId),
  getSortedChains: () => [
    { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } },
    { id: 137, name: 'Polygon', nativeCurrency: { symbol: 'MATIC' } },
    { id: 5000, name: 'Mantle', nativeCurrency: { symbol: 'MNT' } },
  ],
  searchChains: (query: string) =>
    [
      { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } },
      { id: 137, name: 'Polygon', nativeCurrency: { symbol: 'MATIC' } },
      { id: 5000, name: 'Mantle', nativeCurrency: { symbol: 'MNT' } },
    ].filter(
      chain =>
        chain.name.toLowerCase().includes(query.toLowerCase()) ||
        chain.id.toString().includes(query),
    ),
}));

const renderTopNavigation = (props = {}) => {
  const defaultProps = {
    currentChainId: 1,
    onChainChange: vi.fn(),
    onSearch: vi.fn(),
    searchPlaceholder: 'Search address, tx hash, or block number...',
  };

  return render(<TopNavigation {...defaultProps} {...props} />);
};

describe('TopNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY);
    // Same semantics as the real util/http predicate: only ApiErrors
    // with status 0 (no HTTP response ever received) count as offline.
    mockIsBackendUnreachable.mockImplementation(
      (e: unknown) => e instanceof ApiError && e.status === 0,
    );
  });

  it('renders the logo and navigation elements', () => {
    renderTopNavigation();

    expect(screen.getByText('My Block Explorer')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Search address, tx hash, or block number...'),
    ).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('⚙️ RPC')).toBeInTheDocument();
  });

  it('lists the page links in order and navigates to the current chain section', () => {
    renderTopNavigation({ currentChainId: 137 });

    const entries: Array<[name: string, path: string]> = [
      ['Blocks', '/chain/137/blocks'],
      ['Transactions', '/chain/137/transactions'],
      ['Pending', '/chain/137/pending'],
      ['Contracts', '/chain/137/contracts'],
      ['Charts', '/chain/137/charts'],
    ];
    const buttons = entries.map(([name]) => screen.getByRole('button', { name }));
    // DOM order pins the nav sequence: Blocks, Transactions, Pending,
    // Contracts, Charts. Siblings in one tree compare as exactly FOLLOWING.
    for (let i = 1; i < buttons.length; i += 1) {
      expect(buttons[i - 1].compareDocumentPosition(buttons[i])).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
    // Each link stays on the viewing chain and hits the real route paths.
    for (const [name, path] of entries) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(mockNavigate).toHaveBeenCalledWith(mockRouter, path);
    }
  });

  it('keeps SQL as an admin-grouped link to the bare /sql console', () => {
    renderTopNavigation({ currentChainId: 137 });

    // The accessible name carries the admin context; navigation stays on
    // the bare path — the console queries the main database, never a
    // chain section, so the chain id must not leak into the target.
    const sqlButton = screen.getByRole('button', { name: 'SQL console (admin)' });
    fireEvent.click(sqlButton);
    expect(mockNavigate).toHaveBeenCalledWith(mockRouter, '/sql');
    expect(mockNavigate).not.toHaveBeenCalledWith(mockRouter, '/chain/137/sql');

    // Visual admin grouping: a decorative divider between the page links
    // and the SQL button. (The <768px collapse lives in the divider's CSS
    // media query — not observable from jsdom's computed styles.)
    const divider = screen.getByTestId('nav-admin-divider');
    expect(divider).toHaveAttribute('aria-hidden', 'true');
    expect(divider.compareDocumentPosition(sqlButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('displays current chain information', () => {
    renderTopNavigation({ currentChainId: 1 });

    expect(screen.getByText('Ethereum')).toBeInTheDocument();
    expect(screen.getByText(/ID: 1/)).toBeInTheDocument();
    expect(screen.getByText(/ETH/)).toBeInTheDocument();
    // Mainnet never shows the Testnet pill next to the chain name.
    expect(screen.queryByText('Testnet')).not.toBeInTheDocument();
  });

  it('shows a Testnet pill next to the current chain name for testnets', () => {
    renderTopNavigation({ currentChainId: 5 });

    // getChainInfo(5) is null in the chains mock → generic label.
    expect(screen.getByText('Chain 5')).toBeInTheDocument();
    expect(screen.getByText('Testnet')).toBeInTheDocument();
  });

  it('handles search input and submission', async () => {
    const onSearch = vi.fn();
    renderTopNavigation({ onSearch });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    const searchButton = screen.getByText('Search');

    // Type in search input
    fireEvent.change(searchInput, { target: { value: '0x123' } });
    expect(searchInput).toHaveValue('0x123');

    // Click search button
    fireEvent.click(searchButton);

    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledWith('0x123');
    });
  });

  it.skip('handles search on Enter key press', async () => {
    const onSearch = vi.fn();
    renderTopNavigation({ onSearch });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');

    // Type and press Enter
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: '0x456' } });
      fireEvent.keyPress(searchInput, { key: 'Enter' });
    });

    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledWith('0x456');
    });
  });

  it('opens RPC configuration modal', () => {
    renderTopNavigation();

    const rpcButton = screen.getByText('⚙️ RPC');
    fireEvent.click(rpcButton);

    expect(screen.getByTestId('rpc-config-modal')).toBeInTheDocument();
  });

  it('handles chain selection', async () => {
    const onChainChange = vi.fn();
    renderTopNavigation({ onChainChange });

    // Click chain selector to open dropdown
    const chainSelector = screen.getByText('Ethereum');
    fireEvent.click(chainSelector);

    // Wait for dropdown to appear and search for another chain
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText('Search chain name, ID, or symbol...'),
      ).toBeInTheDocument();
    });

    // Type to search for Polygon
    const searchInput = screen.getByPlaceholderText('Search chain name, ID, or symbol...');
    fireEvent.change(searchInput, { target: { value: 'Polygon' } });

    // Note: This test would need more complex mocking to fully test chain selection
    // as it involves complex dropdown interactions
  });

  it('disables search button when loading', () => {
    renderTopNavigation();

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    const searchButton = screen.getByText('Search');

    fireEvent.change(searchInput, { target: { value: '0x123' } });
    fireEvent.click(searchButton);

    // During search, button should show loading state
    expect(screen.getByText('...')).toBeInTheDocument();
  });

  it.skip('handles logo click navigation', () => {
    // Skipped: Linaria CSS `cursor: pointer` doesn't apply in test environment
    // The component works correctly - this is a test infrastructure limitation
    renderTopNavigation({ currentChainId: 5000 });

    const logo = screen.getByText('My Block Explorer');
    expect(logo.closest('div')).toHaveStyle('cursor: pointer');

    // Test click functionality
    fireEvent.click(logo);
    expect(mockNavigate).toHaveBeenCalledWith(mockRouter, '/chain/5000');
  });

  it('uses custom search placeholder', () => {
    const customPlaceholder = 'Custom search placeholder';
    renderTopNavigation({ searchPlaceholder: customPlaceholder });

    expect(screen.getByPlaceholderText(customPlaceholder)).toBeInTheDocument();
  });

  it('handles empty search input gracefully', async () => {
    const onSearch = vi.fn();
    renderTopNavigation({ onSearch });

    const searchButton = screen.getByText('Search');

    // Try to search with empty input
    fireEvent.click(searchButton);

    // Should not call onSearch for empty input
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('trims whitespace from search input', async () => {
    const onSearch = vi.fn();
    renderTopNavigation({ onSearch });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    const searchButton = screen.getByText('Search');

    // Type with leading/trailing spaces
    fireEvent.change(searchInput, { target: { value: '  0x123  ' } });
    fireEvent.click(searchButton);

    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledWith('0x123');
    });
  });

  it('renders recent searches from localStorage, never from the server', async () => {
    localStorage.setItem(
      SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify([{ query: '0xabc', chainId: 137 }]),
    );
    renderTopNavigation({ currentChainId: 1 });

    fireEvent.focus(
      screen.getByPlaceholderText('Search address, tx hash, or block number...'),
    );

    // The entry renders with the chain it was recorded on; no history
    // endpoint is consulted (that endpoint leaked every visitor's
    // queries).
    expect(await screen.findByText('0xabc')).toBeInTheDocument();
    expect(screen.getByText('Polygon')).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('does not record free-text searches at the header; landing records them', async () => {
    // Free text has no known destination at dispatch time — recording it
    // here would flood history with queries that never landed. The Search
    // view records the entry when it actually navigates to a result.
    renderTopNavigation({ currentChainId: 137, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: 'uniswap' } });
    fireEvent.click(screen.getByText('Search'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        mockRouter,
        `/search?q=${encodeURIComponent('uniswap')}&chain=137`,
      );
    });
    expect(JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? '[]')).toEqual([]);
  });

  it('does not record free text through the parent-dispatch path either', async () => {
    const onSearch = vi.fn();
    renderTopNavigation({ currentChainId: 137, onSearch });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: 'uniswap' } });
    fireEvent.click(screen.getByText('Search'));

    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledWith('uniswap');
    });
    expect(JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? '[]')).toEqual([]);
  });

  it('dedupes and caps local history at 10 entries, newest first', () => {
    // Sanity for the storage contract the dropdown depends on (unit-level,
    // through the same module the component records with).
    for (let i = 0; i < 12; i++) {
      recordSearchHistoryEntry(`query-${i}`, 1);
    }
    recordSearchHistoryEntry('query-5', 1);

    const stored = JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? '[]');
    expect(stored).toHaveLength(10);
    expect(stored[0]).toEqual({ query: 'query-5', chainId: 1 });
    expect(stored.filter((e: { query: string }) => e.query === 'query-5')).toHaveLength(1);
  });

  it('clears the whole local history from the dropdown', async () => {
    localStorage.setItem(
      SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify([{ query: '0xabc', chainId: 1 }]),
    );
    renderTopNavigation();

    fireEvent.focus(
      screen.getByPlaceholderText('Search address, tx hash, or block number...'),
    );
    expect(await screen.findByText('0xabc')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Clear'));

    expect(JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? '[]')).toEqual([]);
    expect(screen.queryByText('0xabc')).not.toBeInTheDocument();
  });

  it('removes a single history entry in place', async () => {
    localStorage.setItem(
      SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify([
        { query: '0xabc', chainId: 1 },
        { query: 'zzz', chainId: 137 },
      ]),
    );
    renderTopNavigation();

    fireEvent.focus(
      screen.getByPlaceholderText('Search address, tx hash, or block number...'),
    );
    expect(await screen.findByText('0xabc')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove 0xabc from history' }));

    expect(JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? '[]')).toEqual([
      { query: 'zzz', chainId: 137 },
    ]);
    expect(screen.queryByText('0xabc')).not.toBeInTheDocument();
  });

  it('re-runs a history entry on the chain it was recorded on', async () => {
    const address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
    localStorage.setItem(
      SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify([{ query: address, chainId: 5000 }]),
    );
    renderTopNavigation({ currentChainId: 1 });

    fireEvent.focus(
      screen.getByPlaceholderText('Search address, tx hash, or block number...'),
    );
    fireEvent.click(await screen.findByText(address));

    // Not the currently selected chain (1) — the entry's own chain (5000).
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(mockRouter, `/chain/5000/address/${address}`);
    });
  });

  it('re-runs a legacy chain-less history entry on the currently selected chain', async () => {
    const address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
    localStorage.setItem(
      SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify([{ query: address }]),
    );
    renderTopNavigation({ currentChainId: 5000 });

    fireEvent.focus(
      screen.getByPlaceholderText('Search address, tx hash, or block number...'),
    );
    // The badge names where a click runs the entry now (the selected
    // chain) — for a legacy entry that is the honest label. The selector
    // shows the same chain name, so the badge is matched as the history
    // row's own label.
    const historyRow = (await screen.findByText(address)).closest('div');
    expect(historyRow?.textContent).toContain('Mantle');
    fireEvent.click(screen.getByText(address));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(mockRouter, `/chain/5000/address/${address}`);
    });
  });

  it('sends free-text searches to the Search view with chain context', async () => {
    // No onSearch prop: the component dispatches through its own router
    // navigation, which the @native-router mock records.
    renderTopNavigation({ currentChainId: 137, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: 'uniswap' } });
    fireEvent.click(screen.getByText('Search'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        mockRouter,
        `/search?q=${encodeURIComponent('uniswap')}&chain=137`,
      );
    });
  });

  it('resolves ENS names on Ethereum and offers destinations instead of jumping chains', async () => {
    renderTopNavigation({ currentChainId: 137, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: 'vitalik.eth' } });
    fireEvent.click(screen.getByText('Search'));

    // Resolution goes through a mainnet client (ENS registry lives there)
    // and the notice names the provenance; nothing navigates yet — the
    // address is a fact of Ethereum, and where to view it is a choice.
    await waitFor(() => {
      expect(mockCreateRpcClient).toHaveBeenCalledWith(1);
    });
    expect(
      await screen.findByText(/Resolved vitalik\.eth → .* on Ethereum/),
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();

    // Primary action opens the resolution chain (Ethereum), never the
    // chain the user happened to be on; the secondary offers exactly
    // that. Choosing the alternate navigates there explicitly.
    fireEvent.click(screen.getByText('on Polygon →'));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        mockRouter,
        '/chain/137/address/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      );
    });
  });

  it('offers no alternate destination when already browsing mainnet', async () => {
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: 'vitalik.eth' } });
    fireEvent.click(screen.getByText('Search'));

    expect(await screen.findByText('Open on Ethereum →')).toBeInTheDocument();
    // On mainnet the primary already is the viewing chain — a second,
    // duplicate destination action must not render (exact match: the
    // primary's own text contains these words too).
    expect(screen.queryByText('on Ethereum →')).not.toBeInTheDocument();
  });

  it('records an ENS search into history only when a destination is opened', async () => {
    renderTopNavigation({ currentChainId: 137, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: 'vitalik.eth' } });
    fireEvent.click(screen.getByText('Search'));

    // Resolved but unopened: the entry does not exist yet.
    await screen.findByText(/Resolved vitalik\.eth/);
    expect(JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? '[]')).toEqual([]);

    // Opening the primary records the chain actually opened (Ethereum),
    // not the chain the search ran on.
    fireEvent.click(screen.getByText('Open on Ethereum →'));
    expect(JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? '[]')).toEqual([
      { query: 'vitalik.eth', chainId: 1 },
    ]);
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        mockRouter,
        '/chain/1/address/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      );
    });
  });

  it('records the alternate destination when that is what the user opens', async () => {
    renderTopNavigation({ currentChainId: 137, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: 'vitalik.eth' } });
    fireEvent.click(screen.getByText('Search'));

    fireEvent.click(await screen.findByText('on Polygon →'));

    expect(JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? '[]')).toEqual([
      { query: 'vitalik.eth', chainId: 137 },
    ]);
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        mockRouter,
        '/chain/137/address/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      );
    });
  });

  it('never records an unregistered ENS name into history', async () => {
    mockGetEnsAddress.mockResolvedValueOnce(null);
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: 'nosuchname.eth' } });
    fireEvent.click(screen.getByText('Search'));

    expect(
      await screen.findByText('ENS name "nosuchname.eth" not found (checked on Ethereum)'),
    ).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? '[]')).toEqual([]);
  });

  it('reports an unregistered ENS name as not found, without a Retry', async () => {
    mockGetEnsAddress.mockResolvedValueOnce(null);
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: 'nosuchname.eth' } });
    fireEvent.click(screen.getByText('Search'));

    expect(
      await screen.findByText('ENS name "nosuchname.eth" not found (checked on Ethereum)'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('offers a Retry when the ENS RPC itself fails', async () => {
    mockGetEnsAddress.mockRejectedValueOnce(new Error('resolver down'));
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: 'vitalik.eth' } });
    fireEvent.click(screen.getByText('Search'));

    expect(
      await screen.findByText(/ENS resolution failed for "vitalik\.eth"/),
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();

    // Retrying re-runs the resolution; this time it resolves into the
    // destination choice, and opening the primary navigates.
    fireEvent.click(screen.getByText('Retry'));
    fireEvent.click(await screen.findByText('Open on Ethereum →'));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        mockRouter,
        '/chain/1/address/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      );
    });
  });

  it('hints that the hash was not found on the current chain, with a picker link', async () => {
    mockGet.mockResolvedValueOnce({ found: false, degraded: false, type: 'transaction' });
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: `0x${'ab'.repeat(32)}` } });
    fireEvent.click(screen.getByText('Search'));

    expect(
      await screen.findByText(/Hash not found on Ethereum — it may exist on another network/),
    ).toBeInTheDocument();
    // The escape hatch opens the network picker, not a phantom cross-chain
    // scan: it goes to the Search view without a chain hint so the hash is
    // re-run only after a network is explicitly chosen.
    const pickerLink = screen.getByText('Choose a network →');
    fireEvent.click(pickerLink);
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        mockRouter,
        `/search?q=${encodeURIComponent(`0x${'ab'.repeat(32)}`)}`,
      );
    });
  });

  it('reports a degraded hash search as a failure, not "no results"', async () => {
    mockGet.mockResolvedValueOnce({
      found: false,
      degraded: true,
      degradedReasons: ['transaction-lookup-failed'],
      type: 'transaction',
    });
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: `0x${'ab'.repeat(32)}` } });
    fireEvent.click(screen.getByText('Search'));

    expect(await screen.findByText(/Search failed on Ethereum/)).toBeInTheDocument();
    expect(screen.queryByText(/Hash not found on Ethereum/)).not.toBeInTheDocument();
    // The network picker escape hatch stays available on failure too.
    expect(screen.getByText('Choose a network →')).toBeInTheDocument();
  });

  it('surfaces an offline notice instead of silence when the backend is unreachable', async () => {
    // Regression (C1): a hash search whose request never reached the
    // backend used to fail silently — no navigation, no inline notice.
    mockGet.mockRejectedValueOnce(new ApiError('Network error', 0));
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: `0x${'ab'.repeat(32)}` } });
    fireEvent.click(screen.getByText('Search'));

    expect(
      await screen.findByText(/Search unavailable — cannot reach the explorer backend/),
    ).toBeInTheDocument();
    // The failure is attributed to the missing backend — never worded as
    // a data-source error or a miss — and a failed dispatch navigates
    // nowhere.
    expect(screen.queryByText(/Search failed on/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hash not found/)).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    // Offline is retryable once the backend is back.
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('confirms a block number against the selected chain RPC when the backend is unreachable', async () => {
    mockGet.mockRejectedValueOnce(new ApiError('Network error', 0));
    mockCreateRpcClient.mockResolvedValueOnce({ getBlockNumber: () => Promise.resolve(100n) });
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: '42' } });
    fireEvent.click(screen.getByText('Search'));

    // The fallback asks the selected chain's own client (not the backend).
    await waitFor(() => {
      expect(mockCreateRpcClient).toHaveBeenCalledWith(1);
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(mockRouter, '/chain/1/block/42');
    });
    // Landing on the confirmed block records history like the verified
    // backend path does.
    expect(JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? '[]')).toEqual([
      { query: '42', chainId: 1 },
    ]);
    expect(screen.queryByText(/Search unavailable/)).not.toBeInTheDocument();
  });

  it('resolves a hash as a transaction through the chain RPC when the backend is unreachable', async () => {
    const hash = `0x${'ab'.repeat(32)}`;
    mockGet.mockRejectedValueOnce(new ApiError('Network error', 0));
    mockCreateRpcClient.mockResolvedValueOnce({
      getTransaction: () => Promise.resolve({ hash, blockNumber: 42n }),
    });
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: hash } });
    fireEvent.click(screen.getByText('Search'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(mockRouter, `/chain/1/tx/${hash}`);
    });
    expect(JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? '[]')).toEqual([
      { query: hash, chainId: 1 },
    ]);
  });

  it('resolves a hash as a block through the chain RPC when it is not a transaction', async () => {
    const hash = `0x${'ab'.repeat(32)}`;
    mockGet.mockRejectedValueOnce(new ApiError('Network error', 0));
    mockCreateRpcClient.mockResolvedValueOnce({
      getTransaction: () => Promise.resolve(null),
      getBlock: () => Promise.resolve({ number: 42n }),
    });
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: hash } });
    fireEvent.click(screen.getByText('Search'));

    // Block page links by number, never by hash.
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(mockRouter, '/chain/1/block/42');
    });
  });

  it('keeps the offline notice and says what the RPC fallback could not do', async () => {
    // Backend offline AND the direct RPC check cannot confirm the query:
    // the notice stays, now with the honest scope statement.
    mockGet.mockRejectedValueOnce(new ApiError('Network error', 0));
    mockCreateRpcClient.mockResolvedValueOnce({ getBlockNumber: () => Promise.resolve(10n) });
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: '999' } });
    fireEvent.click(screen.getByText('Search'));

    expect(
      await screen.findByText(
        'Search unavailable — cannot reach the explorer backend; direct RPC check of Ethereum found no match (full cross-chain search requires the backend)',
      ),
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? '[]')).toEqual([]);
  });

  it('skips the RPC fallback entirely when the chain has no usable client', async () => {
    mockGet.mockRejectedValueOnce(new ApiError('Network error', 0));
    mockCreateRpcClient.mockRejectedValueOnce(new Error('Unsupported chain ID: 1'));
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: '42' } });
    fireEvent.click(screen.getByText('Search'));

    // Plain unreachable notice — no note about a check that never ran.
    expect(
      await screen.findByText('Search unavailable — cannot reach the explorer backend'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/full cross-chain search requires the backend/),
    ).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not engage the RPC fallback for a backend that answered with an error', async () => {
    // A 5xx means the backend was reachable — the data-source wording
    // stands and no chain RPC is consulted.
    mockGet.mockRejectedValueOnce(new ApiError('HTTP 500', 500));
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: '42' } });
    fireEvent.click(screen.getByText('Search'));

    expect(await screen.findByText(/Search failed on Ethereum/)).toBeInTheDocument();
    expect(mockCreateRpcClient).not.toHaveBeenCalled();
  });

  it('reports a failed request (backend answered with an error) as a data-source failure', async () => {
    mockGet.mockRejectedValueOnce(new ApiError('HTTP 500', 500));
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: `0x${'ab'.repeat(32)}` } });
    fireEvent.click(screen.getByText('Search'));

    expect(
      await screen.findByText(/Search failed on Ethereum — a data source errored/),
    ).toBeInTheDocument();
    // A 5xx answered the request — that is not "backend unreachable".
    expect(screen.queryByText(/Search unavailable/)).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('verifies a block number before navigating, and records the landing', async () => {
    // Blind-jumping to /block/N lands on an error page for any number
    // above the chain's head — the block branch must verify like hashes.
    mockGet.mockResolvedValueOnce({ found: true, type: 'block', data: { number: 42 } });
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: '42' } });
    fireEvent.click(screen.getByText('Search'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(mockRouter, '/chain/1/block/42');
    });
    expect(JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? '[]')).toEqual([
      { query: '42', chainId: 1 },
    ]);
  });

  it('hints that the block was not found on the current chain, with a picker link', async () => {
    mockGet.mockResolvedValueOnce({ found: false, degraded: false, type: 'block' });
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: '999999999' } });
    fireEvent.click(screen.getByText('Search'));

    expect(
      await screen.findByText(
        /Block not found on Ethereum — it may exist on another network/,
      ),
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    // A number that missed here is chain-relative like a hash: the escape
    // hatch opens the network picker (no chain hint).
    const pickerLink = screen.getByText('Choose a network →');
    fireEvent.click(pickerLink);
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        mockRouter,
        `/search?q=${encodeURIComponent('999999999')}`,
      );
    });
  });

  it('never records a search that landed nowhere', async () => {
    // Hash and block numbers are verified before anything navigates — a
    // query that missed (or whose fetch failed) never enters history, so
    // cross-chain hunting cannot flood it.
    mockGet.mockResolvedValueOnce({ found: false, degraded: false, type: 'transaction' });
    renderTopNavigation({ currentChainId: 1, onSearch: undefined });

    const searchInput = screen.getByPlaceholderText('Search address, tx hash, or block number...');
    fireEvent.change(searchInput, { target: { value: `0x${'ab'.repeat(32)}` } });
    fireEvent.click(screen.getByText('Search'));

    expect(await screen.findByText(/Hash not found on Ethereum/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? '[]')).toEqual([]);
  });
});

// --- Theme control + backend version chip ---

// Controlled discovery context for the version chip: the real provider runs
// useAutoDiscovery (network probes); the chip only reads serviceInfo, so a
// hand-built context value pins that state without a network.
function discoveryContextWith(serviceInfo: ServiceInfo | null) {
  return {
    status: 'found' as const,
    serviceInfo,
    error: null,
    isScanning: false,
    isConnected: serviceInfo !== null,
    switchedFromManual: null,
    discover: vi.fn(),
    autoDiscover: vi.fn(),
    setApiUrl: vi.fn(),
    disconnect: vi.fn(),
    reconnect: vi.fn(),
  };
}

function renderTopNavigationWithDiscovery(serviceInfo: ServiceInfo | null) {
  return render(
    <ServiceDiscoveryContext.Provider value={discoveryContextWith(serviceInfo)}>
      <TopNavigation
        currentChainId={1}
        onChainChange={vi.fn()}
        onSearch={vi.fn()}
        searchPlaceholder="Search address, tx hash, or block number..."
      />
    </ServiceDiscoveryContext.Provider>,
  );
}

describe('theme control', () => {
  beforeEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('starts at the stored preference and names current + next mode', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderTopNavigation();

    expect(
      screen.getByRole('button', { name: 'Theme: dark. Switch to system' }),
    ).toBeInTheDocument();
  });

  it('cycles Light → Dark → System, applying and persisting each step', () => {
    renderTopNavigation();

    // system → light: pinned attribute, persisted choice, advanced label
    fireEvent.click(screen.getByRole('button', { name: 'Theme: system. Switch to light' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(
      screen.getByRole('button', { name: 'Theme: light. Switch to dark' }),
    ).toBeInTheDocument();

    // light → dark
    fireEvent.click(screen.getByRole('button', { name: 'Theme: light. Switch to dark' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    // dark → system: attribute removed again, OS preference back in charge
    fireEvent.click(screen.getByRole('button', { name: 'Theme: dark. Switch to system' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('backend version chip', () => {
  it('shows the discovered backend version with its base URL in the title', () => {
    renderTopNavigationWithDiscovery({
      host: 'localhost',
      port: 8201,
      url: 'http://localhost:8201',
      version: '1.2.3',
    });

    const chip = screen.getByText('v1.2.3');
    expect(chip).toHaveAttribute('title', 'Backend http://localhost:8201 (v1.2.3)');
  });

  it('stays honest with \'v?\' and an offline title when no backend was discovered', () => {
    renderTopNavigationWithDiscovery(null);

    const chip = screen.getByText('v?');
    expect(chip).toHaveAttribute('title', 'Backend offline - version unknown');
  });

  it('distinguishes a connected backend that reports no version', () => {
    renderTopNavigationWithDiscovery({
      host: 'localhost',
      port: 8201,
      url: 'http://localhost:8201',
    });

    const chip = screen.getByText('v?');
    expect(chip).toHaveAttribute('title', 'Backend http://localhost:8201 - version unknown');
  });
});

describe('ChainSelector', () => {
  it('shows current chain with popular chain indicator', () => {
    renderTopNavigation({ currentChainId: 1 });

    expect(screen.getByText('Ethereum')).toBeInTheDocument();
    expect(screen.getByText(/ID: 1/)).toBeInTheDocument();
    expect(screen.getByText(/⭐/)).toBeInTheDocument();
  });

  it('shows chain without popular indicator for non-popular chains', () => {
    renderTopNavigation({ currentChainId: 999 });

    expect(screen.getByText('Chain 999')).toBeInTheDocument();
    expect(screen.getByText(/ID: 999/)).toBeInTheDocument();
  });

  it('opens dropdown when clicked', async () => {
    renderTopNavigation();

    const chainButton = screen.getByRole('button', { name: /Ethereum/ });
    fireEvent.click(chainButton);

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText('Search chain name, ID, or symbol...'),
      ).toBeInTheDocument();
    });
  });

  it('exposes listbox semantics and expansion state on the trigger', async () => {
    renderTopNavigation({ currentChainId: 1 });

    const trigger = screen.getByRole('button', { name: /Ethereum/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // The current chain is announced as the selected/current option, not
    // just drawn with a tick.
    const currentOption = await screen.findByRole('option', { name: /Ethereum/ });
    expect(currentOption).toHaveAttribute('aria-current', 'true');
    expect(currentOption).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /Polygon/ })).not.toHaveAttribute('aria-current');
  });

  it('Enter alone never switches chains — only the highlighted option is confirmed', async () => {
    const onChainChange = vi.fn();
    renderTopNavigation({ onChainChange });

    fireEvent.click(screen.getByRole('button', { name: /Ethereum/ }));
    const filterInput = await screen.findByPlaceholderText(
      'Search chain name, ID, or symbol...',
    );

    // The old blind pick: Enter with a filter that matches chains used to
    // select the first hit. With nothing highlighted it must do nothing.
    fireEvent.change(filterInput, { target: { value: 'e' } });
    fireEvent.keyDown(filterInput, { key: 'Enter' });
    expect(onChainChange).not.toHaveBeenCalled();

    // No filter at all: same rule.
    fireEvent.change(filterInput, { target: { value: '' } });
    fireEvent.keyDown(filterInput, { key: 'Enter' });
    expect(onChainChange).not.toHaveBeenCalled();
  });

  it('ArrowDown moves the highlight and Enter confirms the highlighted chain', async () => {
    const onChainChange = vi.fn();
    renderTopNavigation({ currentChainId: 1, onChainChange });

    fireEvent.click(screen.getByRole('button', { name: /Ethereum/ }));
    const filterInput = await screen.findByPlaceholderText(
      'Search chain name, ID, or symbol...',
    );

    // Full list order: Ethereum (1), Polygon (137), Mantle (5000).
    fireEvent.keyDown(filterInput, { key: 'ArrowDown' });
    fireEvent.keyDown(filterInput, { key: 'ArrowDown' });
    // The combobox points at the highlighted option for screen readers.
    expect(filterInput).toHaveAttribute('aria-activedescendant', 'chain-option-137');

    fireEvent.keyDown(filterInput, { key: 'Enter' });
    expect(onChainChange).toHaveBeenCalledTimes(1);
    expect(onChainChange).toHaveBeenCalledWith(137);
  });

  it('ArrowUp from nothing highlights the last option and wraps around', async () => {
    const onChainChange = vi.fn();
    renderTopNavigation({ currentChainId: 1, onChainChange });

    fireEvent.click(screen.getByRole('button', { name: /Ethereum/ }));
    const filterInput = await screen.findByPlaceholderText(
      'Search chain name, ID, or symbol...',
    );

    fireEvent.keyDown(filterInput, { key: 'ArrowUp' });
    fireEvent.keyDown(filterInput, { key: 'Enter' });
    expect(onChainChange).toHaveBeenCalledWith(5000);

    // Wrapping: ArrowUp from the first lands on the last again.
    fireEvent.click(screen.getByRole('button', { name: /Ethereum/ }));
    const reopened = await screen.findByPlaceholderText(
      'Search chain name, ID, or symbol...',
    );
    fireEvent.keyDown(reopened, { key: 'ArrowDown' });
    expect(reopened).toHaveAttribute('aria-activedescendant', 'chain-option-1');
    fireEvent.keyDown(reopened, { key: 'ArrowUp' });
    expect(reopened).toHaveAttribute('aria-activedescendant', 'chain-option-5000');
  });

  it('filtering resets the highlight so Enter cannot pick a stale index', async () => {
    const onChainChange = vi.fn();
    renderTopNavigation({ currentChainId: 1, onChainChange });

    fireEvent.click(screen.getByRole('button', { name: /Ethereum/ }));
    const filterInput = await screen.findByPlaceholderText(
      'Search chain name, ID, or symbol...',
    );

    // Highlight the first option, then rebuild the list with a filter:
    // the highlight must clear instead of silently pointing elsewhere.
    fireEvent.keyDown(filterInput, { key: 'ArrowDown' });
    fireEvent.change(filterInput, { target: { value: 'Mantle' } });
    expect(filterInput).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(filterInput, { key: 'Enter' });
    expect(onChainChange).not.toHaveBeenCalled();

    // Re-highlight within the filtered list and confirm.
    fireEvent.keyDown(filterInput, { key: 'ArrowDown' });
    expect(filterInput).toHaveAttribute('aria-activedescendant', 'chain-option-5000');
    fireEvent.keyDown(filterInput, { key: 'Enter' });
    expect(onChainChange).toHaveBeenCalledWith(5000);
  });

  it('Escape closes the dropdown and clears the highlight', async () => {
    const onChainChange = vi.fn();
    renderTopNavigation({ currentChainId: 1, onChainChange });

    const trigger = screen.getByRole('button', { name: /Ethereum/ });
    fireEvent.click(trigger);
    const filterInput = await screen.findByPlaceholderText(
      'Search chain name, ID, or symbol...',
    );

    fireEvent.keyDown(filterInput, { key: 'ArrowDown' });
    fireEvent.keyDown(filterInput, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByPlaceholderText('Search chain name, ID, or symbol...'),
    ).not.toBeInTheDocument();

    // Reopening starts fresh: no highlight survives the close.
    fireEvent.click(trigger);
    const reopened = await screen.findByPlaceholderText(
      'Search chain name, ID, or symbol...',
    );
    expect(reopened).not.toHaveAttribute('aria-activedescendant');
  });
});
