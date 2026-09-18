import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';
import AddressView from '@/views/Address';

// Mutable per-test data consumed by the service mocks below: the page test
// pins view behavior, so the services layer is replaced with settled
// results the cases can reshape.
const mocks = vi.hoisted(() => {
  const testAddress = '0x1234567890abcdef1234567890abcdef12345678';
  const mockTransactions = [
    {
      hash: '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1',
      blockNumber: '18000001',
      fromAddress: testAddress,
      toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      value: '1000000000000000000',
      status: 1,
      timestamp: '2024-01-01T00:00:00Z',
    },
    {
      hash: '0xdef789abc123def789abc123def789abc123def789abc123def789abc123def7',
      blockNumber: '18000000',
      fromAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      toAddress: testAddress,
      value: '500000000000000000',
      status: 1,
      timestamp: '2024-01-01T00:00:00Z',
    },
  ];
  // The `address` member is reshaped per case (contract vs EOA envelope) —
  // typed loosely so partial records assign cleanly.
  type AddressRecord = {
    isContract: boolean;
    contractName?: string;
    verificationStatus?: 'verified' | 'unverified' | 'partial';
    sourceCodeAvailable?: boolean;
  };
  // Hook results reshaped per case (the checksum-error tests swap in
  // error-bearing shapes); typed so Error assignments stay legal.
  type RealTimeResult = {
    data?: {
      balance: string;
      balanceWei: string;
      transactionCount: number;
      latestBlock: number;
    };
    loading: boolean;
    fetching: boolean;
    error?: Error;
  };
  const settledRealTime: RealTimeResult = {
    data: {
      balance: '1.5',
      balanceWei: '1500000000000000000',
      transactionCount: 42,
      latestBlock: 18000000,
    },
    loading: false,
    fetching: false,
    error: undefined,
  };
  const addressInfo: {
    chainId: number;
    chainName: string;
    address: AddressRecord;
    timestamp: string;
  } = {
    chainId: 1,
    chainName: 'Ethereum',
    address: {
      isContract: false,
    },
    timestamp: '2026-01-01T00:00:00Z',
  };
  // Reshaped per case: honesty fields (coverage/reason/window) are
  // optional — the view must tolerate their absence (pre-coverage caches).
  // `method` is intentionally absent: the view never branches UI on it.
  type AddressTxPageMock = {
    transactions: typeof mockTransactions;
    total: number;
    coverage?: 'complete' | 'partial' | 'none';
    reason?:
      | 'no-transactions'
      | 'no-outgoing-transactions'
      | 'zero-balance'
      | 'search-failed';
    searchWindowBlocks?: number;
  };
  const initialAddressTxPage: AddressTxPageMock = {
    transactions: mockTransactions,
    total: mockTransactions.length,
  };
  return {
    testAddress,
    mockTransactions,
    addressInfo,
    realTime: settledRealTime,
    addressTxError: undefined as Error | undefined,
    addressTransactions: initialAddressTxPage,
    // Loading is per-case (the scanning-copy test flips it).
    txLoading: false,
    // Every useAddressTransactions call's positional args, captured by the
    // service mock — the Search-deeper tests assert the window arg (index 4).
    txQueryArgs: [] as unknown[],
    // Plain function (vi is unavailable inside vi.hoisted); tests spy on it
    // to assert the retry affordance.
    txRefetch: () => undefined,
    // Same for the realtime channel's refetch (Refresh honesty test).
    realTimeRefetch: () => undefined,
    // Reshaped per case by the ENS header tests.
    ens: { data: null as string | null, loading: false },
  };
});

vi.mock('../../../src/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">
      TopNav chain=
      {currentChainId}
    </div>
  ),
}));

vi.mock('../../../src/config/chains', () => ({
  getChainInfo: (chainId: number) => {
    if (chainId === 1) return { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } };
    return null;
  },
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Unknown'),
  getChainSymbol: (chainId: number) => (chainId === 1 ? 'ETH' : 'UNKNOWN'),
}));

vi.mock('@/services/addresses', () => ({
  useAddressInfo: () => ({
    data: mocks.addressInfo,
    loading: false,
    fetching: false,
    error: undefined,
  }),
  // Args captured on every render so tests can assert what the view asked
  // for — the Search-deeper escalation asserts the window arg (index 4).
  useAddressTransactions: (...args: unknown[]) => {
    mocks.txQueryArgs = args;
    return {
      data: mocks.addressTransactions,
      loading: mocks.txLoading,
      fetching: false,
      error: mocks.addressTxError,
      refetch: mocks.txRefetch,
    };
  },
}));

vi.mock('@/services/addressRealTime', () => ({
  // refetch is spread in here so per-test reshapes of mocks.realTime keep
  // the Refresh affordance wired without repeating it in every case.
  useRealTimeAddressData: () => ({ ...mocks.realTime, refetch: mocks.realTimeRefetch }),
  useContractCode: () => ({
    data: undefined,
    loading: false,
    fetching: false,
    error: undefined,
  }),
}));

vi.mock('@/services/ens', () => ({
  useEnsName: () => mocks.ens,
}));

vi.mock('@/utils/format', () => ({
  formatRelativeTime: () => '3 min ago',
}));

const routes = createRoutes([
  {
    path: '/chain/:chainId/address/:address',
    component: () => Promise.resolve(AddressView),
  },
]);

const renderPage = (path = `/chain/1/address/${mocks.testAddress}`) =>
  render(
    <MemoryRouter routes={routes} initialEntries={[path]}>
      <View />
    </MemoryRouter>,
  );

describe('Address view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addressInfo.address = {
      isContract: false,
      contractName: undefined,
      verificationStatus: undefined,
      sourceCodeAvailable: false,
    };
    mocks.addressTransactions = {
      transactions: mocks.mockTransactions,
      total: mocks.mockTransactions.length,
    };
    mocks.realTime = {
      data: {
        balance: '1.5',
        balanceWei: '1500000000000000000',
        transactionCount: 42,
        latestBlock: 18000000,
      },
      loading: false,
      fetching: false,
      error: undefined,
    };
    mocks.addressTxError = undefined;
    mocks.txLoading = false;
    mocks.txQueryArgs = [];
    mocks.ens = { data: null, loading: false };
  });

  it('renders TopNavigation', async () => {
    renderPage();
    expect(await screen.findByTestId('top-navigation')).toBeInTheDocument();
  });

  it('displays address details header', async () => {
    renderPage();
    expect(await screen.findByText('Address Details')).toBeInTheDocument();
    expect(screen.getByText(/Ethereum/)).toBeInTheDocument();
  });

  it('shows the resolved ENS name as the header label with the hex address still beneath', async () => {
    mocks.ens = { data: 'vitalik.eth', loading: false };

    renderPage();

    // The name takes the primary label slot...
    expect(
      await screen.findByRole('heading', { level: 1, name: 'vitalik.eth' }),
    ).toBeInTheDocument();
    expect(screen.getByText('ENS')).toBeInTheDocument();
    // ...while the full hex address stays visible in the header row (and in
    // the Overview card).
    expect(screen.getAllByText(mocks.testAddress).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('heading', { name: 'Address Details' })).not.toBeInTheDocument();
  });

  it('keeps the header layout unchanged when no ENS name resolves', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Address Details' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('ENS')).not.toBeInTheDocument();
  });

  it('Refresh refetches both the transaction history and the realtime balance read', async () => {
    // P1-7: 'Last updated' belongs to the realtime channel, so Refresh must
    // drive both queries, not just the tx history.
    const txRefetchSpy = vi.spyOn(mocks, 'txRefetch');
    const realTimeRefetchSpy = vi.spyOn(mocks, 'realTimeRefetch');

    renderPage();

    expect(await screen.findByText('Recent Transactions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(txRefetchSpy).toHaveBeenCalledTimes(1);
    expect(realTimeRefetchSpy).toHaveBeenCalledTimes(1);
  });

  it('shows address overview with balance', async () => {
    renderPage();

    await screen.findByText('Overview');
    expect(screen.getByText(mocks.testAddress)).toBeInTheDocument();
    expect(screen.getByText(/1\.5 ETH/)).toBeInTheDocument();
  });

  it('labels the nonce honestly as Outgoing Transactions (Nonce), never a total count', async () => {
    renderPage();

    await screen.findByText('Overview');
    // The RPC nonce counts outgoing transactions only — the label must say
    // so instead of the old lying 'Transaction Count'.
    expect(screen.getByText('Outgoing Transactions (Nonce)')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.queryByText('Transaction Count')).not.toBeInTheDocument();
  });

  it('renders Recent Transactions section', async () => {
    renderPage();

    expect(await screen.findByText('Recent Transactions')).toBeInTheDocument();
  });

  it('displays transaction direction badges', async () => {
    renderPage();

    await screen.findByText('Recent Transactions');
    const outBadges = screen.getAllByText('OUT');
    const inBadges = screen.getAllByText('IN');
    expect(outBadges.length).toBeGreaterThan(0);
    expect(inBadges.length).toBeGreaterThan(0);
  });

  it('renders a Success/Failed status badge per row', async () => {
    mocks.addressTransactions = {
      transactions: [
        { ...mocks.mockTransactions[0], status: 1 },
        { ...mocks.mockTransactions[1], status: 0 },
      ],
      total: 2,
    };

    renderPage();

    await screen.findByText('Recent Transactions');
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows the token/internal-tx indexing notice at every coverage level', async () => {
    // Default (no coverage tags) case first.
    renderPage();
    expect(
      await screen.findByText(
        /Token transfers \(ERC-20\/721\) and internal transactions are not indexed/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/native ETH activity only/)).toBeInTheDocument();
  });

  it('keeps the token-activity notice under complete coverage too', async () => {
    mocks.addressTransactions = {
      transactions: mocks.mockTransactions,
      total: 2,
      coverage: 'complete',
    };

    renderPage();

    expect(
      await screen.findByText(
        /Token transfers \(ERC-20\/721\) and internal transactions are not indexed/,
      ),
    ).toBeInTheDocument();
  });

  it('uses plain scanning copy while the history search runs', async () => {
    mocks.txLoading = true;

    renderPage();

    expect(await screen.findByText('Scanning recent chain history...')).toBeInTheDocument();
    // The old copy leaked the binary-search implementation jargon.
    expect(screen.queryByText(/binary search/i)).not.toBeInTheDocument();
  });

  it('paginates the transaction table', async () => {
    renderPage();

    expect(await screen.findByText('Page 1 of 1')).toBeInTheDocument();
  });

  it('links to the contract view for contract addresses', async () => {
    mocks.addressInfo.address = { isContract: true };

    renderPage();

    const link = (await screen.findByText('View Contract Details →')).closest('a');
    expect(link?.getAttribute('href')).toBe(`/chain/1/contract/${mocks.testAddress}`);
  });

  it('warns about an unknown data source instead of a trusted empty state when coverage is missing', async () => {
    // Pre-coverage cached payload: no coverage/method tags at all.
    mocks.addressTransactions = { transactions: [], total: 0 };

    renderPage();

    expect(
      await screen.findByText(/Transaction data source unknown/),
    ).toBeInTheDocument();
    expect(screen.getByText(/history may be incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/Verify on an external explorer/)).toBeInTheDocument();
    // External escape hatch mirrors the partial banner's link row.
    expect(screen.getAllByText('Routescan').length).toBe(2);
    expect(screen.queryByText('No transactions found')).not.toBeInTheDocument();
  });

  it('shows the partial-history banner above the table for heuristic coverage', async () => {
    mocks.addressTransactions = {
      transactions: mocks.mockTransactions,
      total: 42,
      coverage: 'partial',
      searchWindowBlocks: 600_000,
    };

    renderPage();

    expect(
      await screen.findByText(/Partial history - transactions are discovered heuristically/),
    ).toBeInTheDocument();
    expect(screen.getByText(/within the last 600,000 blocks/)).toBeInTheDocument();
    // External escape hatch: the banner adds a link row beyond the Overview
    // card's (Routescan appears in both).
    const routescanLinks = screen.getAllByText('Routescan');
    expect(routescanLinks.length).toBe(2);
  });

  it('Search deeper escalates the window: 4x the effective one, passed to the tx query', async () => {
    mocks.addressTransactions = {
      transactions: mocks.mockTransactions,
      total: 42,
      coverage: 'partial',
      searchWindowBlocks: 600_000,
    };

    renderPage();

    const deeper = await screen.findByRole('button', { name: 'Search deeper' });
    expect(deeper).toBeEnabled();
    // Pre-click: no window override requested (backend default).
    expect(mocks.txQueryArgs[4]).toBeUndefined();

    fireEvent.click(deeper);

    // 600,000 * 4 = 2,400,000 blocks — the view must refetch with it.
    expect(mocks.txQueryArgs[4]).toBe(2_400_000);
  });

  it('Search deeper disables at the RPC budget cap and explains why via title', async () => {
    mocks.addressTransactions = {
      transactions: mocks.mockTransactions,
      total: 42,
      coverage: 'partial',
      searchWindowBlocks: 50_000_000,
    };

    renderPage();

    const deeper = await screen.findByRole('button', { name: 'Search deeper' });
    expect(deeper).toBeDisabled();
    expect(deeper).toHaveAttribute('title', 'maximum RPC budget reached');
  });

  it('shows "No transactions on this page" — never the empty-state banners — when the page slid past the data', async () => {
    // total > 0 but this page is empty (e.g. a widened search shrank the
    // discovered set while the user sat on a later page).
    mocks.addressTransactions = {
      transactions: [],
      total: 25,
      coverage: 'partial',
      searchWindowBlocks: 600_000,
    };

    renderPage();

    expect(await screen.findByText('No transactions on this page')).toBeInTheDocument();
    // Coverage banner still explains the gap...
    expect(screen.getByText(/Partial history/)).toBeInTheDocument();
    // ...but none of the empty-state banners may fire.
    expect(screen.queryByText('No transactions found')).not.toBeInTheDocument();
    expect(screen.queryByText(/Transaction data source unknown/)).not.toBeInTheDocument();
    // Pagination stays (the way back to real data).
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
  });

  it('shows the honest zero-balance banner: sent count from the nonce, never a discovered-count claim', async () => {
    // New contract: total is the DISCOVERED count (0 here — nothing could
    // be scanned); the honest sent-count comes from the realtime nonce.
    mocks.addressTransactions = {
      transactions: [],
      total: 0,
      coverage: 'none',
      reason: 'zero-balance',
    };

    renderPage();

    expect(
      await screen.findByText(/This address has sent 42 transactions \(nonce\)\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Incoming activity cannot be scanned because the balance-history heuristic needs non-zero balance/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/token activity is never scanned/)).toBeInTheDocument();
    expect(screen.getAllByText('Routescan').length).toBe(2);
    expect(screen.queryByText('No transactions found')).not.toBeInTheDocument();
  });

  it('explains that nonce=0 only rules out OUTGOING transactions, never claims no history', async () => {
    mocks.addressTransactions = {
      transactions: [],
      total: 0,
      coverage: 'partial',
      reason: 'no-outgoing-transactions',
    };

    renderPage();

    expect(
      await screen.findByText(/No OUTGOING transactions found\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Incoming transactions are undetectable without a full indexer/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/check an external explorer/)).toBeInTheDocument();
    // The trusted empty state must NOT fire for a partial-coverage nonce=0.
    expect(screen.queryByText('No transactions found')).not.toBeInTheDocument();
    // Escape hatch: overview card + the single no-outgoing notice (the
    // generic partial banner no longer duplicates this case, so no
    // "Search deeper" dead button for a search that never ran).
    expect(screen.getAllByText('Routescan').length).toBe(2);
  });

  it('shows the search-failed banner with a retry affordance, never an empty result', async () => {
    mocks.addressTransactions = {
      transactions: [],
      total: 0,
      coverage: 'none',
      reason: 'search-failed',
    };
    const refetchSpy = vi.spyOn(mocks, 'txRefetch');

    renderPage();

    expect(
      await screen.findByText(/Transaction search failed \(timeout\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/this is NOT an empty result/)).toBeInTheDocument();
    expect(screen.queryByText('No transactions found')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry search' }));
    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the plain empty state for complete coverage', async () => {
    mocks.addressTransactions = {
      transactions: [],
      total: 0,
      coverage: 'complete',
      reason: 'no-transactions',
    };

    renderPage();

    expect(await screen.findByText('No transactions found')).toBeInTheDocument();
    expect(screen.queryByText(/Partial history/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Transaction data source unknown/)).not.toBeInTheDocument();
  });

  it('shows unsupported chain error for invalid chain', async () => {
    renderPage(`/chain/999/address/${mocks.testAddress}`);

    expect(await screen.findByText(/Unsupported chain ID/)).toBeInTheDocument();
  });

  it('shows checksum guidance instead of the raw 400 for a bad-checksum address', async () => {
    // Mixed-case bad checksum: the server validation (getValidatedAddress)
    // rejects with HTTP 400 'Invalid address'.
    mocks.realTime = {
      data: undefined,
      loading: false,
      fetching: false,
      error: new Error('Invalid address'),
    };

    renderPage();

    expect(
      await screen.findByText(/This address has an invalid checksum/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Try the all-lowercase form/)).toBeInTheDocument();
    expect(screen.getByText('Original error: Invalid address')).toBeInTheDocument();
    expect(screen.queryByText('Error: Invalid address')).not.toBeInTheDocument();
  });

  it('shows checksum guidance in the transactions card when the tx search rejects the address', async () => {
    mocks.addressTxError = new Error('Invalid address');

    renderPage();

    expect(await screen.findByText(/This address has an invalid checksum/)).toBeInTheDocument();
    expect(screen.getByText('Original error: Invalid address')).toBeInTheDocument();
    expect(screen.queryByText('No transactions found')).not.toBeInTheDocument();
  });

  it('keeps the plain error banner for unrelated failures', async () => {
    mocks.realTime = {
      data: undefined,
      loading: false,
      fetching: false,
      error: new Error('RPC timeout'),
    };

    renderPage();

    expect(await screen.findByText('Error: RPC timeout')).toBeInTheDocument();
    expect(screen.queryByText(/invalid checksum/i)).not.toBeInTheDocument();
  });
});
