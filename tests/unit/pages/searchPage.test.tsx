// Search view behavioral contract for chain context honesty: a chain-
// relative query (tx/block hash) runs on the explicit context (?chain= or
// an in-view pinned chain) and navigates straight to the entity; with no
// explicit context — even when a chain is merely remembered — it comes
// back as needsChain and the network picker appears, claiming no 'Searched
// on' line and recording no history. A chain picked in the picker is
// claimed (context line, history entry) only after that chain's search
// actually returns. The picker renders the response's own curation scope
// ('popular'), filters by name/ID/symbol, and its empty state points at
// the direct /chain/:id route for unlisted networks. ENS searches record
// history only after a successful resolution and the confirmation banner
// names BOTH the resolution provenance (Ethereum) and the destination
// chain.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes, useMatched, useRouter } from '@native-router/react';
import { navigate } from '@native-router/core';
import '@testing-library/jest-dom';
import Search from '@/views/Search';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">chain:{currentChainId}</div>
  ),
}));

const { mockFetchSearch, mockFetchChainSearch, mockResolveEnsAddress,
  mockRecordHistory, mockReadRememberedChainId } = vi.hoisted(() => ({
  mockFetchSearch: vi.fn(),
  mockFetchChainSearch: vi.fn(),
  mockResolveEnsAddress: vi.fn(),
  mockRecordHistory: vi.fn(),
  mockReadRememberedChainId: vi.fn(),
}));

vi.mock('@/services/search', () => ({
  fetchSearch: mockFetchSearch,
  fetchChainSearch: mockFetchChainSearch,
}));

vi.mock('@/services/ensForward', async (importOriginal) => {
  // Only the RPC-backed resolution is stubbed; the pure destination
  // decision stays the real one.
  const actual = await importOriginal<typeof import('@/services/ensForward')>();
  return { ...actual, resolveEnsAddress: mockResolveEnsAddress };
});

vi.mock('@/services/searchHistory', () => ({
  recordSearchHistoryEntry: mockRecordHistory,
}));

vi.mock('@/views/Home/Landing', () => ({
  readRememberedChainId: mockReadRememberedChainId,
}));

const TX_HASH = '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060';
const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

const needsChainResponse = {
  found: false,
  needsChain: true,
  type: 'transaction',
  query: TX_HASH,
  scope: 'popular',
  supportedChains: [
    { chainId: 1, name: 'Ethereum', symbol: 'ETH' },
    { chainId: 137, name: 'Polygon', symbol: 'MATIC' },
  ],
};

// Page stubs expose the chain they were opened on, so tests can assert
// not just "navigated to the address page" but WHICH chain's page.
const AddressPage = () => {
  const { params } = useMatched();
  return <div data-testid={`address-chain-${params.chainId}`}>address-page</div>;
};
const TxPage = () => {
  const { params } = useMatched();
  return <div data-testid={`tx-chain-${params.chainId}`}>tx-page</div>;
};
const BlockPage = () => <div data-testid="block-page">block-page</div>;

// Stand-in for the header's dispatch: navigates exactly like
// TopNavigation's goTo (push, full URL), so tests can drive the
// mounted-view URL changes the deep-link guard must react to.
const NavButton = ({ to }: { to: string }) => {
  const router = useRouter();
  return (
    <button type="button" onClick={() => { void navigate(router, to); }}>
      {`go:${to}`}
    </button>
  );
};

const renderSearch = (initial: string, navTargets: string[] = []) =>
  render(
    <MemoryRouter
      routes={createRoutes([
        { path: '/search', component: () => Search },
        { path: '/chain/:chainId/address/:address', component: () => AddressPage },
        { path: '/chain/:chainId/tx/:hash', component: () => TxPage },
        { path: '/chain/:chainId/block/:blockNumber', component: () => BlockPage },
      ])}
      initialEntries={[initial]}
    >
      <View />
      {navTargets.map(to => (
        <NavButton key={to} to={to} />
      ))}
    </MemoryRouter>,
  );

describe('Search view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadRememberedChainId.mockReturnValue(undefined);
  });

  it('navigates a hash search straight to the entity when ?chain= context exists', async () => {
    mockFetchSearch.mockResolvedValue({
      found: true,
      type: 'transaction',
      query: TX_HASH,
      searchedChainId: 137,
      data: { hash: TX_HASH, chainId: 137 },
    });

    renderSearch(`/search?q=${TX_HASH}&chain=137`);

    // The hint is forwarded to the global endpoint; no picker involved.
    await waitFor(() => {
      expect(mockFetchSearch).toHaveBeenCalledWith(TX_HASH, 137);
    });
    expect(await screen.findByTestId('tx-chain-137')).toBeInTheDocument();
    expect(screen.queryByText('Popular networks')).not.toBeInTheDocument();
    expect(mockFetchChainSearch).not.toHaveBeenCalled();
  });

  it('shows the network picker (and claims nothing) when no chain context exists', async () => {
    mockFetchSearch.mockResolvedValue(needsChainResponse);

    renderSearch(`/search?q=${TX_HASH}`);

    await waitFor(() => {
      expect(mockFetchSearch).toHaveBeenCalledWith(TX_HASH, undefined);
    });

    expect(await screen.findByText('Popular networks')).toBeInTheDocument();
    // Picker suppressions: no 'Searched on' claim, no history entry.
    expect(screen.queryByText(/Searched on/)).not.toBeInTheDocument();
    expect(mockRecordHistory).not.toHaveBeenCalled();
  });

  it('asks for a network even when a chain is merely remembered, not declared', async () => {
    // A remembered chain is a viewing default, not declared context: for a
    // chain-relative fact like a tx hash, guessing it would turn a wrong
    // guess into a false "no results".
    mockReadRememberedChainId.mockReturnValue(137);
    mockFetchSearch.mockResolvedValue(needsChainResponse);

    renderSearch('/search');
    const input = await screen.findByPlaceholderText(
      'Enter address, tx hash, or block number...',
    );
    fireEvent.change(input, { target: { value: TX_HASH } });
    fireEvent.click(screen.getByText('Search'));

    await waitFor(() => {
      expect(mockFetchSearch).toHaveBeenCalledWith(TX_HASH, undefined);
    });
    expect(await screen.findByText('Popular networks')).toBeInTheDocument();
    expect(mockRecordHistory).not.toHaveBeenCalled();
  });

  it('offers ENS destinations and records history only for the one opened', async () => {
    mockResolveEnsAddress.mockResolvedValue({ status: 'resolved', address: VITALIK });

    renderSearch('/search?q=vitalik.eth&chain=137');

    // The banner names the resolution provenance (Ethereum) and offers
    // the destination choice: Ethereum primary, the chain the search ran
    // on (Polygon) as the secondary. Nothing has opened yet — no history.
    expect(
      await screen.findByText(/Resolved vitalik\.eth → .* on Ethereum/),
    ).toBeInTheDocument();
    expect(screen.getByText('Open on Ethereum')).toBeInTheDocument();
    expect(screen.getByText('on Polygon')).toBeInTheDocument();
    expect(mockRecordHistory).not.toHaveBeenCalled();
    expect(screen.queryByTestId(/address-chain-/)).not.toBeInTheDocument();

    // Opening the alternate records the chain actually opened — not a
    // default, not the resolution chain.
    fireEvent.click(screen.getByText('on Polygon'));
    expect(mockRecordHistory).toHaveBeenCalledWith('vitalik.eth', 137);
    expect(await screen.findByTestId('address-chain-137')).toBeInTheDocument();
  });

  it('opens the primary ENS destination on Ethereum (the resolution chain)', async () => {
    mockResolveEnsAddress.mockResolvedValue({ status: 'resolved', address: VITALIK });

    renderSearch('/search?q=vitalik.eth&chain=137');

    fireEvent.click(await screen.findByText('Open on Ethereum'));

    expect(mockRecordHistory).toHaveBeenCalledWith('vitalik.eth', 1);
    // The address page opened on chain 1 — the chain the name resolved
    // on — not the chain the search ran on (137).
    expect(await screen.findByTestId('address-chain-1')).toBeInTheDocument();
  });

  it('offers no alternate ENS destination when the search ran on mainnet', async () => {
    mockResolveEnsAddress.mockResolvedValue({ status: 'resolved', address: VITALIK });

    renderSearch('/search?q=vitalik.eth&chain=1');

    expect(await screen.findByText('Open on Ethereum')).toBeInTheDocument();
    expect(screen.queryByText('on Ethereum')).not.toBeInTheDocument();
  });

  it('never records an unregistered ENS name', async () => {
    mockResolveEnsAddress.mockResolvedValue({ status: 'not-found' });

    renderSearch('/search?q=nosuchname.eth&chain=137');

    expect(
      await screen.findByText('ENS name "nosuchname.eth" not found (checked on Ethereum)'),
    ).toBeInTheDocument();
    // No redirect was ever scheduled, and no history was recorded.
    expect(mockRecordHistory).not.toHaveBeenCalled();
    expect(screen.queryByTestId(/address-chain-/)).not.toBeInTheDocument();
  });

  it('offers Try another network after a hash miss on a ?chain= context', async () => {
    // The hash was searched on the declared chain (137) and definitively
    // missed there — that is a fact of one chain, not a dead end.
    mockFetchSearch.mockResolvedValueOnce({
      found: false,
      type: 'transaction',
      query: TX_HASH,
      searchedChainId: 137,
    });

    renderSearch(`/search?q=${TX_HASH}&chain=137`);

    expect(await screen.findByText(/No results found/)).toBeInTheDocument();
    const tryAnother = await screen.findByText('Try another network');
    expect(tryAnother).toBeInTheDocument();

    // Choosing another network drops the chain constraint and re-runs the
    // query unscoped: the global endpoint answers with needsChain and the
    // network picker takes over.
    mockFetchSearch.mockResolvedValueOnce(needsChainResponse);
    fireEvent.click(tryAnother);

    await waitFor(() => {
      expect(mockFetchSearch).toHaveBeenLastCalledWith(TX_HASH, undefined);
    });
    expect(await screen.findByText('Popular networks')).toBeInTheDocument();
    // The page no longer claims the chain the miss ran on.
    expect(screen.queryByText('Searched on Polygon')).not.toBeInTheDocument();
  });

  it('names the failed lookups when the response is degraded', async () => {
    mockFetchSearch.mockResolvedValueOnce({
      found: false,
      type: 'transaction',
      query: TX_HASH,
      searchedChainId: 137,
      degraded: true,
      degradedReasons: ['transaction-lookup-failed', 'block-lookup-failed'],
    });

    renderSearch(`/search?q=${TX_HASH}&chain=137`);

    // The miss is not definitive: the banner humanizes the response's own
    // reasons and keeps the retry affordance.
    expect(
      await screen.findByText(/a data source errored \(transaction lookup, block lookup\)/),
    ).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.queryByText(/No results found/)).not.toBeInTheDocument();
    // A degraded miss is not a chain-relative dead end either.
    expect(screen.getByText('Try another network')).toBeInTheDocument();
  });

  it('claims the picked chain and records history only after the picker search returns', async () => {
    // Backend unreachable: the picker's chain fetch rejects — the page
    // must show the failure without claiming any 'Searched on' chain,
    // recording history or otherwise acting on a search that never ran.
    mockFetchSearch.mockResolvedValue(needsChainResponse);
    mockFetchChainSearch.mockRejectedValueOnce(new Error('backend unreachable'));

    renderSearch(`/search?q=${TX_HASH}`);
    fireEvent.click(await screen.findByText('Polygon'));

    expect(await screen.findByText(/backend unreachable/)).toBeInTheDocument();
    expect(screen.queryByText(/Searched on/)).not.toBeInTheDocument();
    expect(mockRecordHistory).not.toHaveBeenCalled();
  });

  it('records the picked chain once its search lands and navigates to the entity', async () => {
    mockFetchSearch.mockResolvedValue(needsChainResponse);
    mockFetchChainSearch.mockResolvedValueOnce({
      found: true,
      type: 'transaction',
      chainId: 137,
      data: { hash: TX_HASH, chainId: 137 },
    });

    renderSearch(`/search?q=${TX_HASH}`);
    fireEvent.click(await screen.findByText('Polygon'));

    // History carries the chain the search actually landed on, recorded
    // after the fetch — not when the option was clicked.
    expect(await screen.findByTestId('tx-chain-137')).toBeInTheDocument();
    expect(mockRecordHistory).toHaveBeenCalledWith(TX_HASH, 137);
  });

  it('filters the picker by native symbol and explains unmatched networks', async () => {
    mockFetchSearch.mockResolvedValue(needsChainResponse);

    renderSearch(`/search?q=${TX_HASH}`);
    await screen.findByText('Popular networks');

    // The placeholder promises symbol filtering — typing a symbol (not a
    // name or ID substring) must surface its chain.
    const filter = screen.getByPlaceholderText('Filter networks by name, ID, or symbol...');
    fireEvent.change(filter, { target: { value: 'matic' } });

    expect(screen.getByText('Polygon')).toBeInTheDocument();
    expect(screen.queryByText('Ethereum')).not.toBeInTheDocument();

    // No match within the scoped list is not a dead end: the empty state
    // points at the direct route for unlisted networks.
    fireEvent.change(filter, { target: { value: 'zzz' } });
    expect(await screen.findByText(/open them directly at \/chain\//)).toBeInTheDocument();
  });

  it('re-runs the search when ?q= changes while the view is mounted', async () => {
    // Regression (P1-1): a header search issued from /search itself
    // navigates to /search?q=new — the mounted view used to ignore every
    // later ?q= change after its first deep-link search.
    mockFetchSearch.mockImplementation(async (q: string, chainId?: number) => ({
      found: false,
      type: 'text',
      query: q,
      searchedChainId: chainId,
    }));

    renderSearch('/search?q=uniswap', ['/search?q=chainlink&chain=1']);

    expect(await screen.findByText('No results found for "uniswap"')).toBeInTheDocument();
    expect(mockFetchSearch).toHaveBeenCalledTimes(1);

    // The header navigation to a new query re-runs the search, with the
    // forwarded chain as context.
    fireEvent.click(screen.getByText('go:/search?q=chainlink&chain=1'));

    expect(await screen.findByText('No results found for "chainlink"')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockFetchSearch).toHaveBeenLastCalledWith('chainlink', 1);
    });
    // The second search resolved on chain 1 and said so...
    expect(await screen.findByText('Searched on Ethereum')).toBeInTheDocument();
    // ...and syncing that resolved chain into the URL must not count as
    // a fresh deep link: exactly two searches, no same-q duplicate.
    expect(mockFetchSearch).toHaveBeenCalledTimes(2);
  });

  it('re-runs the same query unscoped when ?chain= is dropped (Choose a network)', async () => {
    // The header miss notice's 'Choose a network →' escape navigates to
    // /search?q=<hash> WITHOUT ?chain= — the same q as the scoped miss
    // already on screen. Dropping the chain must re-run the search
    // unscoped so the global endpoint answers with the network picker.
    mockFetchSearch.mockImplementation(async (q: string, chainId?: number) =>
      chainId === 137
        ? { found: false, type: 'transaction', query: q, searchedChainId: 137 }
        : needsChainResponse);

    renderSearch(`/search?q=${TX_HASH}&chain=137`, [`/search?q=${TX_HASH}`]);

    expect(await screen.findByText(/No results found/)).toBeInTheDocument();

    fireEvent.click(screen.getByText(`go:/search?q=${TX_HASH}`));

    await waitFor(() => {
      expect(mockFetchSearch).toHaveBeenLastCalledWith(TX_HASH, undefined);
    });
    expect(await screen.findByText('Popular networks')).toBeInTheDocument();
  });
});
