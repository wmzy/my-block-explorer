import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, View, createRoutes, useSearchParams } from '@native-router/react';
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
  // Token-transfers tab fixture: ERC-1155-only rows deliberately — the
  // real TokenTransfers component then renders without touching the RPC
  // enrichment path (the focused tokenTransfers test covers that).
  const tokenTransfersRow = {
    txHash: '0xfeed0000feed0000feed0000feed0000feed0000feed0000feed0000feed0000',
    blockNumber: 18_000_002,
    logIndex: 3,
    token: '0x9999999999999999999999999999999999999999',
    standard: 'erc1155-single' as const,
    from: testAddress,
    to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    value: '3',
    tokenIds: ['5'],
    amounts: ['3'],
    direction: 'out' as const,
  };
  const initialTokenTransfersPage = {
    transfers: [tokenTransfersRow],
    nextCursor: null,
    coverage: 'complete' as const,
    windowBlocks: 100_000,
  };
  return {
    testAddress,
    mockTransactions,
    addressInfo,
    realTime: settledRealTime,
    addressTxError: undefined as Error | undefined,
    addressTransactions: initialAddressTxPage,
    tokenTransfers: initialTokenTransfersPage,
    tokenTransfersLoading: false,
    tokenRefetch: () => undefined,
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

// The transfers tab renders the REAL TokenTransfers component against this
// settled page (ERC-1155 rows → no RPC enrichment, see the fixture above).
vi.mock('@/services/tokenTransfers', () => ({
  useTokenTransfers: () => ({
    data: mocks.tokenTransfers,
    loading: mocks.tokenTransfersLoading,
    fetching: false,
    error: undefined,
    refetch: mocks.tokenRefetch,
  }),
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

// Exposes the live search string so cases can pin ?page= round-trips
// through the URL (memory history is not window.location).
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
    mocks.tokenTransfers = {
      transfers: [
        {
          txHash: '0xfeed0000feed0000feed0000feed0000feed0000feed0000feed0000feed0000',
          blockNumber: 18_000_002,
          logIndex: 3,
          token: '0x9999999999999999999999999999999999999999',
          standard: 'erc1155-single',
          from: mocks.testAddress,
          to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          value: '3',
          tokenIds: ['5'],
          amounts: ['3'],
          direction: 'out',
        },
      ],
      nextCursor: null,
      coverage: 'complete',
      windowBlocks: 100_000,
    };
    mocks.tokenTransfersLoading = false;
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

    expect(await screen.findByRole('button', { name: 'Transactions' })).toBeInTheDocument();
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

  it('renders the activity card with the Transactions tab active by default', async () => {
    renderPage();

    // Segmented control replaces the old card title; the tx table (Value
    // column) is the default tab.
    expect(
      await screen.findByRole('group', { name: 'Recent activity' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Value' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Amount' })).not.toBeInTheDocument();
  });

  it('displays transaction direction badges', async () => {
    renderPage();

    await screen.findByRole('group', { name: 'Recent activity' });
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

    await screen.findByRole('group', { name: 'Recent activity' });
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows the indexing-scope notice at every coverage level', async () => {
    // Default (no coverage tags) case first. The notice still discloses
    // internal txs as uncovered while pointing token transfers at their
    // own tab.
    renderPage();
    expect(
      await screen.findByText(/Internal transactions are not indexed/),
    ).toBeInTheDocument();
    expect(screen.getByText(/native ETH activity only/)).toBeInTheDocument();
    expect(screen.getByText(/Token Transfers tab/)).toBeInTheDocument();
  });

  it('keeps the indexing-scope notice under complete coverage too', async () => {
    mocks.addressTransactions = {
      transactions: mocks.mockTransactions,
      total: 2,
      coverage: 'complete',
    };

    renderPage();

    expect(
      await screen.findByText(/Internal transactions are not indexed/),
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

  it('drives the tx pagination from ?page= and writes it back on Prev/Next', async () => {
    // total 25 with limit 10 → 3 pages; page 2's offset arg is index 3.
    mocks.addressTransactions = {
      transactions: [],
      total: 25,
      coverage: 'complete',
    };

    renderPage(`/chain/1/address/${mocks.testAddress}?page=2`);

    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    expect(mocks.txQueryArgs[3]).toBe(10);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
    expect(mocks.txQueryArgs[3]).toBe(20);
    // The page number landed in the URL (shareable/back-forward state).
    expect(screen.getByTestId('search-probe')).toHaveTextContent('page=3');

    fireEvent.click(screen.getByRole('button', { name: 'Prev' }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    expect(screen.getByTestId('search-probe')).toHaveTextContent('page=2');
  });

  it('degrades a malformed ?page= deep link to page 1 instead of throwing', async () => {
    renderPage(`/chain/1/address/${mocks.testAddress}?page=abc`);

    expect(await screen.findByText('Page 1 of 1')).toBeInTheDocument();
  });

  it('switches the activity card between Transactions and Token Transfers tabs', async () => {
    renderPage();

    // Transactions is the default tab: tx table (Value column), no
    // transfers table.
    expect(await screen.findByRole('columnheader', { name: 'Value' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Amount' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Token Transfers' }));

    // The real TokenTransfers component renders the mocked service data
    // (ERC-1155 row → no RPC enrichment path).
    expect(await screen.findByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.getByText('ID 5 × 3')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Value' })).not.toBeInTheDocument();
    // The tx-only indexing notice is scoped to the Transactions tab.
    expect(
      screen.queryByText(/Internal transactions are not indexed/),
    ).not.toBeInTheDocument();
    // Coverage honesty travels with the transfers tab: complete + window.
    expect(screen.getByText(/Scanned within the last 100,000 blocks/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }));

    expect(await screen.findByRole('columnheader', { name: 'Value' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Amount' })).not.toBeInTheDocument();
  });

  it('marks the active tab button with aria-pressed', async () => {
    renderPage();

    const txTab = await screen.findByRole('button', { name: 'Transactions' });
    const tokenTab = screen.getByRole('button', { name: 'Token Transfers' });
    expect(txTab).toHaveAttribute('aria-pressed', 'true');
    expect(tokenTab).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(tokenTab);
    expect(tokenTab).toHaveAttribute('aria-pressed', 'true');
    expect(txTab).toHaveAttribute('aria-pressed', 'false');
  });

  it('Refresh drives the transfers scan only on the Token Transfers tab', async () => {
    const txRefetchSpy = vi.spyOn(mocks, 'txRefetch');
    const tokenRefetchSpy = vi.spyOn(mocks, 'tokenRefetch');

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Token Transfers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(tokenRefetchSpy).toHaveBeenCalledTimes(1);
    expect(txRefetchSpy).not.toHaveBeenCalled();
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
