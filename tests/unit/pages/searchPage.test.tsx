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
import { MemoryRouter, View, createRoutes } from '@native-router/react';
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

vi.mock('@/services/ensForward', () => ({
  resolveEnsAddress: mockResolveEnsAddress,
}));

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

const AddressPage = () => <div data-testid="address-page">address-page</div>;
const TxPage = () => <div data-testid="tx-page">tx-page</div>;
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
    expect(await screen.findByTestId('tx-page')).toBeInTheDocument();
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

  it('records ENS history only after a successful resolution and names the destination chain', async () => {
    mockResolveEnsAddress.mockResolvedValue({ status: 'resolved', address: VITALIK });

    renderSearch('/search?q=vitalik.eth&chain=137');

    expect(
      await screen.findByText(/Resolved vitalik\.eth → .* on Ethereum — opening on Polygon/),
    ).toBeInTheDocument();

    // Recorded with the destination chain, at resolution time — and the
    // address page opens on that chain after the confirmation delay.
    expect(mockRecordHistory).toHaveBeenCalledWith('vitalik.eth', 137);
    await waitFor(
      () => expect(screen.getByTestId('address-page')).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it('never records an unregistered ENS name', async () => {
    mockResolveEnsAddress.mockResolvedValue({ status: 'not-found' });

    renderSearch('/search?q=nosuchname.eth&chain=137');

    expect(
      await screen.findByText('ENS name "nosuchname.eth" not found (checked on Ethereum)'),
    ).toBeInTheDocument();
    // No redirect was ever scheduled, and no history was recorded.
    expect(mockRecordHistory).not.toHaveBeenCalled();
    expect(screen.queryByTestId('address-page')).not.toBeInTheDocument();
  });
});
