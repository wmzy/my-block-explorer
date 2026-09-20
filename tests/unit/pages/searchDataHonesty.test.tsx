// Search view honesty contract for failures and chain-less suggestions:
// suggestion lines link only to a chain the response itself names (its
// suggestionsChainId), falling back to the resolved search context — with
// neither, every line renders as inert text instead of linking to a
// guessed chain (the old hardcode linked them to mainnet). A backend that
// cannot be reached at all renders the attribution copy with a Retry that
// re-runs the search, never a bare transport error. An ENS 'no-rpc'
// outcome (missing Ethereum RPC configuration) renders its honest copy
// WITHOUT a Retry — retrying cannot conjure an endpoint. Chain-picker
// options and example badges are keyboard-operable (Enter/Space trigger
// exactly like a click).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes, useMatched } from '@native-router/react';
import '@testing-library/jest-dom';

import Search from '@/views/Search';
import { ApiError } from '@/util/apiError';

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
const RECENT_TX = `0x${'1'.repeat(64)}`;
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
// not just "navigated" but WHICH chain's page.
const AddressPage = () => {
  const { params } = useMatched();
  return <div data-testid={`address-chain-${params.chainId}`}>address-page</div>;
};
const TxPage = () => {
  const { params } = useMatched();
  return <div data-testid={`tx-chain-${params.chainId}`}>tx-page</div>;
};
const BlockPage = () => {
  const { params } = useMatched();
  return <div data-testid={`block-chain-${params.chainNumber}`}>block-page</div>;
};

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

// A miss whose suggestions name their own chain. searchedChainId is
// deliberately absent: nothing on the page claims a chain context, so the
// links below can only come from suggestionsChainId itself.
const suggestionsOnOwnChain = {
  found: false,
  type: 'unknown',
  query: 'hello world',
  suggestions: [
    'Latest block number: 42',
    `Latest block hash: 0x${'a'.repeat(64)}`,
    'Recent transactions:',
    RECENT_TX,
    'Enter a valid block number, transaction hash, or address',
  ],
  suggestionsChainId: 137,
};

describe('Search view failure/suggestion honesty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadRememberedChainId.mockReturnValue(undefined);
  });

  it('links suggestion lines to the chain the response names, not a guessed one', async () => {
    mockFetchSearch.mockResolvedValue(suggestionsOnOwnChain);
    const { container } = renderSearch('/search?q=hello%20world');

    await waitFor(() => {
      expect(mockFetchSearch).toHaveBeenCalledWith('hello world', undefined);
    });

    const hrefs = await waitFor(() => {
      const list = [...container.querySelectorAll('a')].map(a => a.getAttribute('href') ?? '');
      expect(list.length).toBeGreaterThan(0);
      return list;
    });
    expect(hrefs).toContain('/chain/137/block/42');
    expect(hrefs).toContain(`/chain/137/tx/${RECENT_TX}`);
    // The old behavior hard-linked chain 1 here — none of that survives.
    expect(hrefs.every(href => !href.startsWith('/chain/1/'))).toBe(true);
    // No chain was claimed for the page itself (no searchedChainId echo).
    expect(screen.queryByText(/^Searched on /)).not.toBeInTheDocument();
    expect(mockRecordHistory).not.toHaveBeenCalled();
  });

  it('renders suggestions as inert text when no chain context exists at all', async () => {
    mockFetchSearch.mockResolvedValue({ ...suggestionsOnOwnChain, suggestionsChainId: undefined });
    const { container } = renderSearch('/search?q=hello%20world');

    await waitFor(() => {
      expect(screen.getByText('Latest block number: 42')).toBeInTheDocument();
    });
    // Not a single link — including none to mainnet.
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it('attributes an unreachable backend and offers a retry that re-runs the search', async () => {
    mockFetchSearch.mockRejectedValue(new ApiError('Failed to fetch', 0));
    renderSearch('/search?q=hello%20world');

    expect(
      await screen.findByText('Search unavailable — cannot reach the explorer backend'),
    ).toBeInTheDocument();
    // The raw transport message must not be the user-facing copy.
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mockFetchSearch).toHaveBeenCalledTimes(2);
    });
    expect(mockFetchSearch).toHaveBeenNthCalledWith(2, 'hello world', undefined);
  });

  it('keeps other request failures on their own message without a retry button', async () => {
    mockFetchSearch.mockRejectedValue(new ApiError('chain halted', 503));
    renderSearch('/search?q=hello%20world');

    expect(await screen.findByText('chain halted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('renders the ENS no-rpc outcome honestly and without a Retry', async () => {
    mockResolveEnsAddress.mockResolvedValue({ status: 'no-rpc' });
    renderSearch('/search?q=vitalik.eth');

    expect(
      await screen.findByText(
        'ENS resolution unavailable for "vitalik.eth" — this explorer has no Ethereum RPC endpoint configured',
      ),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: 'Retry' })).toHaveLength(0);
  });

  it('keeps the ENS RPC-failure outcome retryable', async () => {
    mockResolveEnsAddress.mockResolvedValue({ status: 'failed' });
    renderSearch('/search?q=vitalik.eth');

    expect(
      await screen.findByText('ENS resolution failed for "vitalik.eth" — Ethereum RPC did not answer'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('activates a chain-picker option with Enter and searches that chain', async () => {
    mockFetchSearch.mockResolvedValue(needsChainResponse);
    mockFetchChainSearch.mockResolvedValue({
      found: true,
      type: 'transaction',
      data: { hash: TX_HASH, chainId: 1 },
      chainId: 1,
    });
    renderSearch(`/search?q=${TX_HASH}`);

    const ethereumOption = await screen.findByRole('button', { name: /Ethereum/ });
    await fireEvent.keyDown(ethereumOption, { key: 'Enter' });

    await waitFor(() => {
      expect(mockFetchChainSearch).toHaveBeenCalledWith(1, TX_HASH);
    });
    expect(await screen.findByTestId('tx-chain-1')).toBeInTheDocument();
  });

  it('activates an example badge with Space and searches its pinned chain', async () => {
    mockFetchChainSearch.mockResolvedValue({
      found: true,
      type: 'address',
      data: { address: VITALIK, chainId: 1 },
      chainId: 1,
    });
    renderSearch('/search');

    const addressBadge = await screen.findByRole('button', { name: 'Address' });
    await fireEvent.keyDown(addressBadge, { key: ' ' });

    await waitFor(() => {
      expect(mockFetchChainSearch).toHaveBeenCalledWith(1, VITALIK);
    });
    expect(await screen.findByTestId('address-chain-1')).toBeInTheDocument();
  });
});
