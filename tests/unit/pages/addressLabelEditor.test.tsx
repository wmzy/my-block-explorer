// Address view label row: the "+ add label" affordance, the inline editor
// (input + note), the Save roundtrip through the mocked service, the 403
// admin-token hint, the network-failure path (editor stays open with the
// honest error), and the saved chip state. Plus the Export CSV toolbar
// affordance (href carries the window param; disabled-with-reason while
// the tx list is unsettled). Page-test style: services mocked, jsdom.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes, useSearchParams } from '@native-router/react';
import '@testing-library/jest-dom/vitest';
import AddressView from '@/views/Address';
import { ApiError } from '@/util/apiError';

const mocks = vi.hoisted(() => {
  const testAddress = '0x1234567890abcdef1234567890abcdef12345678';
  return {
    testAddress,
    // Per-case label-query state (reshaped below per test).
    labelQuery: {
      data: undefined as
      | { chainId: number; address: string; label: string; note: string | null }
      | undefined,
      loading: false,
      fetching: false,
      error: undefined as Error | undefined,
      refetch: vi.fn(async () => undefined),
    },
    saveLabel: vi.fn(),
    deleteLabel: vi.fn(),
    // Per-case tx-list state for the export affordance.
    txLoading: false,
    txError: undefined as Error | undefined,
    // Per-case discovered API base ('' = degraded/no backend).
    apiBase: 'http://localhost:8201',
  };
});

vi.mock('../../../src/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">TopNav chain={currentChainId}</div>
  ),
}));

vi.mock('../../../src/config/chains', () => ({
  getChainInfo: (chainId: number) => {
    if (chainId === 1) return { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } };
    return null;
  },
  getChainName: () => 'Ethereum',
  getChainSymbol: () => 'ETH',
  isChainSupported: (chainId: number) => chainId === 1,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
  POPULAR_CHAINS: [{ id: 1, name: 'Ethereum' }],
}));

vi.mock('@/services/addresses', () => ({
  useAddressInfo: () => ({
    data: {
      chainId: 1,
      chainName: 'Ethereum',
      address: { isContract: false },
      timestamp: '2026-01-01T00:00:00Z',
    },
    loading: false,
    fetching: false,
    error: undefined,
  }),
  useAddressTransactions: () => ({
    data: {
      transactions: [
        {
          hash: '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1',
          blockNumber: '18000001',
          fromAddress: mocks.testAddress,
          toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          value: '1000000000000000000',
          status: 1,
          timestamp: '2024-01-01T00:00:00Z',
        },
      ],
      total: 1,
      coverage: 'partial',
      searchWindowBlocks: 10_000_000,
    },
    loading: mocks.txLoading,
    fetching: false,
    error: mocks.txError,
    refetch: () => undefined,
  }),
}));

vi.mock('@/services/addressRealTime', () => ({
  useRealTimeAddressData: () => ({
    data: {
      balance: '1.5',
      balanceWei: '1500000000000000000',
      transactionCount: 42,
      latestBlock: 18000000,
    },
    loading: false,
    fetching: false,
    error: undefined,
    refetch: () => undefined,
  }),
  useContractCode: () => ({
    data: undefined,
    loading: false,
    fetching: false,
    error: undefined,
  }),
}));

vi.mock('@/services/ens', () => ({
  useEnsName: () => ({ data: null, loading: false }),
}));

vi.mock('@/services/tokenTransfers', () => ({
  useTokenTransfers: () => ({
    data: undefined,
    loading: false,
    fetching: false,
    error: undefined,
    refetch: () => undefined,
  }),
  requestTokenTransfersRefresh: () => undefined,
}));

// EOAs arm no token probes; undefined reads = "not a token / unsettled",
// so the Token Overview card stays out of these tests' way.
vi.mock('@/services/tokenMetadata', () => ({
  useTokenOverview: () => undefined,
}));

vi.mock('@/utils/format', () => ({
  formatRelativeTime: () => '3 min ago',
}));

vi.mock('@/util/apiBase', () => ({
  getApiBase: () => mocks.apiBase,
}));

// Partial mock: the pure target-guard stays real, the network-touching
// pieces become per-test spies.
vi.mock('@/services/labels', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/labels')>();
  return {
    ...actual,
    useAddressLabel: () => mocks.labelQuery,
    saveAddressLabel: mocks.saveLabel,
    deleteAddressLabel: mocks.deleteLabel,
  };
});

const routes = createRoutes([
  {
    path: '/chain/:chainId/address/:address',
    component: () => Promise.resolve(AddressView),
  },
]);

function SearchProbe() {
  const [params] = useSearchParams();
  return <div data-testid="search-probe">{params.toString()}</div>;
}

const renderPage = (path = `/chain/1/address/${mocks.testAddress}`) =>
  render(
    <MemoryRouter routes={routes} initialEntries={[path]}>
      <SearchProbe />
      <View />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.labelQuery = {
    data: undefined,
    loading: false,
    fetching: false,
    error: undefined,
    refetch: vi.fn(async () => undefined),
  };
  mocks.saveLabel.mockReset();
  mocks.deleteLabel.mockReset();
  mocks.txLoading = false;
  mocks.txError = undefined;
  mocks.apiBase = 'http://localhost:8201';
});

describe('Address label row', () => {
  it('offers the subtle add affordance while no label is saved', async () => {
    renderPage();
    expect(await screen.findByTestId('label-add')).toBeInTheDocument();
    expect(screen.queryByTestId('label-chip')).not.toBeInTheDocument();
  });

  it('waits (no affordance flash) while the label query loads', async () => {
    mocks.labelQuery.loading = true;
    renderPage();
    await screen.findByText('Balance');
    expect(screen.queryByTestId('label-add')).not.toBeInTheDocument();
  });

  it('shows a muted inline note when the label channel errors', async () => {
    mocks.labelQuery.error = new Error('backend down');
    renderPage();
    expect(await screen.findByTestId('label-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('label-add')).not.toBeInTheDocument();
  });

  it('renders the saved chip with the note as tooltip and the edit affordance', async () => {
    mocks.labelQuery.data = {
      chainId: 1,
      address: mocks.testAddress,
      label: 'Cold wallet',
      note: 'hardware backup',
    };
    renderPage();
    const chip = await screen.findByTestId('label-chip');
    expect(chip).toHaveTextContent('Cold wallet');
    expect(chip).toHaveAttribute('title', 'hardware backup');
    expect(screen.getByTestId('label-edit')).toBeInTheDocument();
  });

  it('happy path: edit → save (trimmed) → refetch → chip appears', async () => {
    mocks.saveLabel.mockImplementation(async () => {
      // Simulate the refetched query state after a successful PUT.
      mocks.labelQuery.data = {
        chainId: 1,
        address: mocks.testAddress,
        label: 'Cold wallet',
        note: 'hardware backup',
      };
      return mocks.labelQuery.data;
    });
    renderPage();

    fireEvent.click(await screen.findByTestId('label-add'));
    const input = await screen.findByTestId('label-input');
    const note = screen.getByTestId('label-note-input');
    // React controlled inputs: change events, not value assignment.
    fireEvent.change(input, { target: { value: '  Cold wallet  ' } });
    fireEvent.change(note, { target: { value: 'hardware backup' } });
    fireEvent.click(screen.getByTestId('label-save'));

    await waitFor(() =>
      expect(mocks.saveLabel).toHaveBeenCalledWith(
        1,
        mocks.testAddress,
        'Cold wallet',
        'hardware backup',
      ),
    );
    // PUT → refetch → chip replaces the editor.
    expect(await screen.findByTestId('label-chip')).toHaveTextContent('Cold wallet');
    expect(screen.queryByTestId('label-input')).not.toBeInTheDocument();
    expect(mocks.labelQuery.refetch).toHaveBeenCalled();
  });

  it('403: keeps the editor open with the admin-token hint', async () => {
    mocks.saveLabel.mockRejectedValue(new ApiError('Invalid admin token.', 403));
    renderPage();

    fireEvent.click(await screen.findByTestId('label-add'));
    fireEvent.change(screen.getByTestId('label-input'), {
      target: { value: 'Nope' },
    });
    fireEvent.click(screen.getByTestId('label-save'));

    const hint = await screen.findByTestId('label-editor-hint');
    expect(hint).toHaveTextContent(
      'Set the admin token in ⚙ RPC settings to edit labels',
    );
    // Editor (and the typed value) survive for a retry after settings.
    expect(screen.getByTestId('label-input')).toBeInTheDocument();
    expect(screen.getByTestId('label-input')).toHaveValue('Nope');
    expect(mocks.labelQuery.refetch).not.toHaveBeenCalled();
  });

  it('network failure: honest error message, editor stays open', async () => {
    mocks.saveLabel.mockRejectedValue(
      new ApiError('Backend not connected — indexed data unavailable', 0),
    );
    renderPage();

    fireEvent.click(await screen.findByTestId('label-add'));
    fireEvent.change(screen.getByTestId('label-input'), {
      target: { value: 'Retry me' },
    });
    fireEvent.click(screen.getByTestId('label-save'));

    const hint = await screen.findByTestId('label-editor-hint');
    expect(hint).toHaveTextContent('Backend not connected');
    expect(screen.getByTestId('label-input')).toHaveValue('Retry me');
  });

  it('disable-me: empty/whitespace label keeps Save disabled with the reason', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('label-add'));
    const save = screen.getByTestId('label-save');
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute(
      'title',
      'Label must be 1-64 characters after trimming',
    );
    expect(mocks.saveLabel).not.toHaveBeenCalled();
  });

  it('remove: deletes through the service and refetches', async () => {
    mocks.labelQuery.data = {
      chainId: 1,
      address: mocks.testAddress,
      label: 'Old',
      note: null,
    };
    renderPage();

    fireEvent.click(await screen.findByTestId('label-edit'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(mocks.deleteLabel).toHaveBeenCalledWith(1, mocks.testAddress),
    );
    await waitFor(() => expect(mocks.labelQuery.refetch).toHaveBeenCalled());
  });
});

describe('Export CSV toolbar affordance (transactions tab)', () => {
  it('links to the export endpoint carrying the current window param', async () => {
    renderPage(`/chain/1/address/${mocks.testAddress}?window=40000`);
    const link = await screen.findByTestId('tx-export-csv');
    expect(link).toHaveAttribute(
      'href',
      `http://localhost:8201/api/chains/1/addresses/${mocks.testAddress}/transactions/export?window=40000`,
    );
    expect(link).toHaveAttribute('download');
  });

  it('omits the window param when the URL carries none', async () => {
    renderPage();
    const link = await screen.findByTestId('tx-export-csv');
    expect(link).toHaveAttribute(
      'href',
      `http://localhost:8201/api/chains/1/addresses/${mocks.testAddress}/transactions/export`,
    );
  });

  it('is disabled with a reason while the tx list is loading', async () => {
    mocks.txLoading = true;
    renderPage();
    const link = await screen.findByTestId('tx-export-csv');
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(link).toHaveAttribute('title', 'Waiting for the transaction list to settle…');
    expect(link).not.toHaveAttribute('href');
  });

  it('is disabled with a reason when the tx list errored', async () => {
    mocks.txError = new Error('scan failed');
    renderPage();
    const link = await screen.findByTestId('tx-export-csv');
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(link).toHaveAttribute(
      'title',
      'The transaction list failed — export follows the list',
    );
  });

  it('is disabled when no backend is connected (no broken relative link)', async () => {
    mocks.apiBase = '';
    renderPage();
    const link = await screen.findByTestId('tx-export-csv');
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(link).not.toHaveAttribute('href');
  });

  it('does not render on the transfers tab', async () => {
    renderPage(`/chain/1/address/${mocks.testAddress}?tab=transfers`);
    await screen.findByText('TopNav chain=1');
    expect(screen.queryByTestId('tx-export-csv')).not.toBeInTheDocument();
  });
});
