// Search view behavioral contract for chain context honesty: a chain-
// relative query (tx/block hash) runs on the explicit context (?chain= or
// an in-view pinned chain) and navigates straight to the entity; with no
// explicit context — even when a chain is merely remembered — it comes
// back as needsChain and the network picker appears, claiming no 'Searched
// on' line and recording no history. ENS searches record history only
// after a successful resolution and the confirmation banner names BOTH the
// resolution provenance (Ethereum) and the destination chain.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes, useMatched } from '@native-router/react';
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
  supportedChains: [
    { chainId: 1, name: 'Ethereum' },
    { chainId: 137, name: 'Polygon' },
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

const renderSearch = (initial: string) =>
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
    expect(screen.queryByText('Select Network')).not.toBeInTheDocument();
    expect(mockFetchChainSearch).not.toHaveBeenCalled();
  });

  it('shows the network picker (and claims nothing) when no chain context exists', async () => {
    mockFetchSearch.mockResolvedValue(needsChainResponse);

    renderSearch(`/search?q=${TX_HASH}`);

    await waitFor(() => {
      expect(mockFetchSearch).toHaveBeenCalledWith(TX_HASH, undefined);
    });

    expect(await screen.findByText('Select Network')).toBeInTheDocument();
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
    expect(await screen.findByText('Select Network')).toBeInTheDocument();
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
    expect(await screen.findByText('Select Network')).toBeInTheDocument();
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
});
