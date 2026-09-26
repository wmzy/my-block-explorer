import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes, useSearchParams } from '@native-router/react';
import { getAddress } from 'viem';
import { ApiError } from '@/util/apiError';
import '@testing-library/jest-dom/vitest';
import AddressView from '@/views/Address';
import { resetPricesForTests } from '@/services/prices';

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
    // Additive deep-scan job riding the payload (typed opaque: the page
    // reads it defensively through parseScanJob, never structurally).
    deepScan?: unknown;
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
    // Per-case persistent-channel (address-info) error — the offline
    // attribution and type-fallback tests swap in ApiError status 0.
    infoError: undefined as Error | undefined,
    // Per-case RPC code-read error (classification fallback channel).
    contractCodeError: undefined as Error | undefined,
    // Per-case RPC eth_getCode result (the classification fallback
    // channel): undefined = not read yet, '0x' = EOA, bytecode = contract.
    contractCode: undefined as string | undefined,
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
    // The Overview's SummaryStatsRow consumes the balance-history page
    // (same cached response the chart card renders). Undefined by
    // default so every other describe keeps the card's pre-existing
    // no-data rendering; the summary-stats describe seeds it per case.
    balanceHistoryPage: undefined as
    | {
      chainId: number;
      address: string;
      transactions: typeof mockTransactions;
      total: number;
    }
    | undefined,
    balanceLoading: false,
    balanceError: undefined as Error | undefined,
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
  getChainName: (chainId: number) =>
    chainId === 1 ? 'Ethereum' : chainId === 137 ? 'Polygon' : 'Unknown',
  getChainSymbol: (chainId: number) => (chainId === 1 ? 'ETH' : 'UNKNOWN'),
  // Consumed by the Landing helpers behind UnsupportedChainState
  // (getPreferredChainId must not fall back to the remembered chain).
  isChainSupported: (chainId: number) => chainId === 1,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
  // In-card recovery links rendered by UnsupportedChainState.
  POPULAR_CHAINS: [
    { id: 1, name: 'Ethereum' },
    { id: 137, name: 'Polygon' },
  ],
}));

vi.mock('@/services/addresses', () => ({
  useAddressInfo: () => ({
    data: mocks.addressInfo,
    loading: false,
    fetching: false,
    error: mocks.infoError,
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
  // The RPC code read (contract-classification fallback channel): data is
  // per-case so the contract-link tests can pin the RPC-only path.
  useContractCode: () => ({
    data: mocks.contractCode,
    loading: false,
    fetching: false,
    error: mocks.contractCodeError,
  }),
}));

vi.mock('@/services/ens', () => ({
  useEnsName: () => mocks.ens,
}));

// The Deep Scan panel rides the transactions tab; its network hook is
// mocked to a settled no-job state so the page test stays offline, while
// the pure payload parsers (scanJobFromTxPayload — read by the coverage
// derivation below) stay REAL: the defensive deepScan-field read keeps
// being exercised through the page itself.
vi.mock('@/services/addressScan', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/addressScan')>();
  return {
    ...actual,
    useScanJob: () => ({
      data: null,
      loading: false,
      fetching: false,
      error: undefined,
      failureCount: 0,
      stale: false,
      dataUpdatedAt: undefined,
      refetch: () => undefined,
    }),
  };
});

// The transfers tab renders the REAL TokenTransfers component against this
// settled page (ERC-1155 rows → no RPC enrichment, see the fixture above).
// requestTokenTransfersRefresh is a runtime import of that component
// (cache-bypass latch for Retry/Refresh) — the factory mock must provide it.
vi.mock('@/services/tokenTransfers', () => ({
  useTokenTransfers: () => ({
    data: mocks.tokenTransfers,
    loading: mocks.tokenTransfersLoading,
    fetching: false,
    error: undefined,
    refetch: mocks.tokenRefetch,
  }),
  requestTokenTransfersRefresh: () => undefined,
}));

// Partial: the real formatters stay (the Balance-over-time card renders
// settled fixture data through formatNumber once the summary-stats
// harness seeds its page — see the BalanceHistory partial mock below).
vi.mock('@/utils/format', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/format')>()),
  formatRelativeTime: () => '3 min ago',
}));

// The internal tab's REAL component fires browser RPC traces and has its
// own focused test file; here it is stubbed so the page test pins the
// plumbing — tab state, query gating, and the tx rows passed through.
vi.mock('@/views/Address/InternalTxns', () => ({
  default: (props: {
    chainId: number;
    address: string;
    transactions: ReadonlyArray<{ hash: string }>;
    txLoading: boolean;
    txError: string | undefined;
    txPage: number;
  }) => (
    <div
      data-testid="internal-txns-stub"
      data-chain={props.chainId}
      data-address={props.address}
      data-hashes={props.transactions.map(tx => tx.hash).join(',')}
      data-loading={String(props.txLoading)}
      data-page={String(props.txPage)}
    />
  ),
}));

// The Overview's SummaryStatsRow reads the balance-history page through
// the SAME exported hook the real Balance-over-time card consumes (one
// cache entry in production — zero extra requests). Only the hook is
// stubbed here, per-case fixture data with no http layer; the card
// component, withBlockTimes and everything else stay real.
vi.mock('@/views/Address/BalanceHistory', async importOriginal => {
  const actual = await importOriginal<typeof import('@/views/Address/BalanceHistory')>();
  return {
    ...actual,
    useBalanceHistoryQuery: () => ({
      data: mocks.balanceHistoryPage,
      loading: mocks.balanceLoading,
      fetching: false,
      error: mocks.balanceError,
      refetch: () => undefined,
    }),
  };
});

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
    mocks.infoError = undefined;
    mocks.contractCodeError = undefined;
    mocks.contractCode = undefined;
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

    await screen.findByRole('heading', { name: 'Overview' });
    expect(screen.getByText(mocks.testAddress)).toBeInTheDocument();
    expect(screen.getByText(/1\.5 ETH/)).toBeInTheDocument();
  });

  it('labels the nonce honestly as Outgoing Transactions (Nonce), never a total count', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Overview' });
    // The RPC nonce counts outgoing transactions only — the label must say
    // so instead of the old lying 'Transaction Count'.
    expect(screen.getByText('Outgoing Transactions (Nonce)')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.queryByText('Transaction Count')).not.toBeInTheDocument();
  });

  it('marks the nonce with an inline partial-history hint routing to the Transactions tab', async () => {
    renderPage();

    // The hint sits beside the count and explains the partial-discovery
    // semantics instead of restating the tx-tab banners in the Overview.
    const hint = await screen.findByRole('button', {
      name: 'About transaction history coverage',
    });
    expect(hint).toHaveAttribute(
      'title',
      'Transaction history is partially discovered — see the Transactions tab',
    );

    // One click routes to the tx tab from wherever the user sits.
    fireEvent.click(screen.getByRole('button', { name: 'Token Transfers' }));
    expect(
      await screen.findByRole('columnheader', { name: 'Amount' }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'About transaction history coverage' }),
    );
    expect(
      await screen.findByRole('columnheader', { name: 'Value' }),
    ).toBeInTheDocument();
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
    // the external-only scope while pointing internal transfers and token
    // transfers at their own tabs.
    renderPage();
    expect(
      await screen.findByText(/external transactions only/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Internal Txns tab/)).toBeInTheDocument();
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
      await screen.findByText(/external transactions only/),
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

    // Default payload carries no coverage tags → the discovered total
    // renders as a floor, not an exact count.
    expect(
      await screen.findByText('Page 1 of 1 • At least 2 transactions discovered'),
    ).toBeInTheDocument();
  });

  it('drives the tx pagination from ?page= and writes it back on Prev/Next', async () => {
    // total 25 with limit 10 → 3 pages; page 2's offset arg is index 3.
    mocks.addressTransactions = {
      transactions: [],
      total: 25,
      coverage: 'complete',
    };

    renderPage(`/chain/1/address/${mocks.testAddress}?page=2`);

    // Complete coverage may read as an exact total.
    expect(await screen.findByText('Page 2 of 3 • 25 transactions')).toBeInTheDocument();
    expect(mocks.txQueryArgs[3]).toBe(10);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 3 of 3 • 25 transactions')).toBeInTheDocument();
    expect(mocks.txQueryArgs[3]).toBe(20);
    // The page number landed in the URL (shareable/back-forward state).
    expect(screen.getByTestId('search-probe')).toHaveTextContent('page=3');

    fireEvent.click(screen.getByRole('button', { name: 'Prev' }));
    expect(await screen.findByText('Page 2 of 3 • 25 transactions')).toBeInTheDocument();
    expect(screen.getByTestId('search-probe')).toHaveTextContent('page=2');
  });

  it('degrades a malformed ?page= deep link to page 1 instead of throwing', async () => {
    renderPage(`/chain/1/address/${mocks.testAddress}?page=abc`);

    expect(
      await screen.findByText('Page 1 of 1 • At least 2 transactions discovered'),
    ).toBeInTheDocument();
  });

  it('converges a beyond-data ?page= deep link to the deepest valid page', async () => {
    // 25 discovered txs at 10 per page → page 3 is the deepest valid page;
    // a shared ?page=5 link must not land on (or keep) an empty page.
    mocks.addressTransactions = {
      transactions: [],
      total: 25,
      coverage: 'complete',
    };

    renderPage(`/chain/1/address/${mocks.testAddress}?page=5`);

    // The URL is pinned via replace to the page actually shown — no
    // shareable/refreshable empty page, no Prev-walking back.
    await waitFor(() =>
      expect(screen.getByTestId('search-probe')).toHaveTextContent('page=3'),
    );
    expect(
      await screen.findByText('Page 3 of 3 • 25 transactions'),
    ).toBeInTheDocument();
  });

  it('keeps a mid-flight empty page as the fallback instead of converging', async () => {
    // While a (re)fetch is in flight the URL must not move — the race-born
    // transient empty page stays covered by the empty-page row, never by
    // a replace that could fight the pending response.
    mocks.addressTransactions = {
      transactions: [],
      total: 25,
      coverage: 'complete',
    };
    mocks.txLoading = true;

    renderPage(`/chain/1/address/${mocks.testAddress}?page=5`);

    expect(
      await screen.findByText('Scanning recent chain history...'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('search-probe')).toHaveTextContent('page=5');
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

  it('writes the tab choice into ?tab= so it survives refresh and sharing', async () => {
    renderPage();

    expect(screen.getByTestId('search-probe')).toHaveTextContent(/^$/);

    fireEvent.click(await screen.findByRole('button', { name: 'Token Transfers' }));

    await screen.findByRole('columnheader', { name: 'Amount' });
    expect(screen.getByTestId('search-probe')).toHaveTextContent('tab=transfers');

    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }));

    await screen.findByRole('columnheader', { name: 'Value' });
    expect(screen.getByTestId('search-probe')).toHaveTextContent('tab=transactions');
  });

  it('renders the transfers tab from a ?tab=transfers deep link', async () => {
    renderPage(`/chain/1/address/${mocks.testAddress}?tab=transfers`);

    expect(await screen.findByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Value' })).not.toBeInTheDocument();
  });

  it('lands a ?ttPage= deep link on the transfers tab', async () => {
    renderPage(`/chain/1/address/${mocks.testAddress}?ttPage=2`);

    // The page number only exists on the transfers tab, so the deep link
    // selects it even without an explicit ?tab=.
    expect(await screen.findByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Value' })).not.toBeInTheDocument();
  });

  it('lets an explicit ?tab=transactions win over a deep-linked ?ttPage=', async () => {
    renderPage(`/chain/1/address/${mocks.testAddress}?tab=transactions&ttPage=2`);

    expect(await screen.findByRole('columnheader', { name: 'Value' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Amount' })).not.toBeInTheDocument();
  });

  it('renders the Internal Txns tab from a ?tab=internal deep link', async () => {
    renderPage(`/chain/1/address/${mocks.testAddress}?tab=internal`);

    const tab = await screen.findByRole('button', { name: 'Internal Txns' });
    expect(tab).toHaveAttribute('aria-pressed', 'true');

    // The tab content receives the tx tab's OWN rows (no refetch of the
    // heuristic scan) plus the page number for its scope label.
    const stub = await screen.findByTestId('internal-txns-stub');
    expect(stub).toHaveAttribute('data-chain', '1');
    expect(stub).toHaveAttribute('data-address', mocks.testAddress);
    expect(stub).toHaveAttribute('data-page', '1');
    expect(stub).toHaveAttribute(
      'data-hashes',
      mocks.mockTransactions.map(tx => tx.hash).join(','),
    );

    // The tx table itself does not render on this tab.
    expect(screen.queryByRole('columnheader', { name: 'Value' })).not.toBeInTheDocument();
  });

  it('arms the tx history scan for the internal tab — its traces read those rows', async () => {
    // Complement of the transfers-only gate below: the internal tab
    // consumes the discovered window, so the scan must run (chainId arg
    // real, not the disabled-key 0).
    renderPage(`/chain/1/address/${mocks.testAddress}?tab=internal`);

    await screen.findByTestId('internal-txns-stub');
    expect(mocks.txQueryArgs[0]).toBe(1);
  });

  it('marks the active tab button with aria-pressed', async () => {
    renderPage();

    const txTab = await screen.findByRole('button', { name: 'Transactions' });
    const tokenTab = screen.getByRole('button', { name: 'Token Transfers' });
    expect(txTab).toHaveAttribute('aria-pressed', 'true');
    expect(tokenTab).toHaveAttribute('aria-pressed', 'false');

    // The tab rides the URL, so the pressed state flips once the write
    // lands — await it instead of asserting synchronously.
    fireEvent.click(tokenTab);
    expect(
      await screen.findByRole('button', { name: 'Token Transfers', pressed: true }),
    ).toBeInTheDocument();
    expect(txTab).toHaveAttribute('aria-pressed', 'false');
  });

  it('Refresh drives the transfers scan only on the Token Transfers tab', async () => {
    const txRefetchSpy = vi.spyOn(mocks, 'txRefetch');
    const tokenRefetchSpy = vi.spyOn(mocks, 'tokenRefetch');

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Token Transfers' }));
    // The tab switch is a URL write (async): wait for the transfers table
    // before Refresh so the button acts on the transfers tab.
    await screen.findByRole('columnheader', { name: 'Amount' });
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

  it('renders the contract link from the RPC classification alone when the persistent record says EOA', async () => {
    // Stale/failed persistent channel: the code read still found bytecode,
    // and the link is a navigation affordance — either channel suffices.
    mocks.addressInfo.address = { isContract: false };
    mocks.contractCode = '0x608060405234801561000f57600080fd5b50';

    renderPage();

    const link = (await screen.findByText('View Contract Details →')).closest('a');
    expect(link?.getAttribute('href')).toBe(`/chain/1/contract/${mocks.testAddress}`);
    // Backend-data rows stay gated on the persistent channel: an RPC-only
    // classification must not fabricate contract name/verification rows.
    expect(screen.queryByText('Contract Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Verification Status')).not.toBeInTheDocument();
  });

  it('keeps the contract link hidden when the code read says EOA', async () => {
    mocks.contractCode = '0x';

    renderPage();

    await screen.findByRole('heading', { name: 'Overview' });
    expect(screen.queryByText('View Contract Details →')).not.toBeInTheDocument();
  });

  it('shows Delegated EOA (EIP-7702) with the delegate in a tooltip and no contract link', async () => {
    // The persistent channel files "has code" under isContract=true, but
    // the RPC designator read is the authoritative 7702 signal.
    mocks.addressInfo.address = { isContract: true };
    const delegate = `0x${'ab'.repeat(20)}`;
    mocks.contractCode = `0xef0100${delegate.slice(2)}`;

    renderPage();

    const type = await screen.findByText('Delegated EOA (EIP-7702)');
    // The tooltip carries the checksummed delegation target.
    expect(type.closest('span')).toHaveAttribute(
      'title',
      `EIP-7702 delegation — code is executed by ${getAddress(delegate)}`,
    );
    // A delegated EOA deploys nothing at this address: no contract page.
    expect(screen.queryByText('View Contract Details →')).not.toBeInTheDocument();
  });

  it('classifies a delegated EOA from the RPC designator alone', async () => {
    // Persistent record still says EOA (delegated after sync): the live
    // designator read wins, and the contract link stays hidden even though
    // the old either-channel rule would have shown it for non-empty code.
    mocks.addressInfo.address = { isContract: false };
    mocks.contractCode = `0xef0100${'cd'.repeat(20)}`;

    renderPage();

    expect(await screen.findByText('Delegated EOA (EIP-7702)')).toBeInTheDocument();
    expect(screen.queryByText('View Contract Details →')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Externally Owned Account (EOA)'),
    ).not.toBeInTheDocument();
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

    // 600,000 * 4 = 2,400,000 blocks — the URL write settles
    // asynchronously (navigate), so await the refetch with it.
    await waitFor(() => expect(mocks.txQueryArgs[4]).toBe(2_400_000));
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

  it('writes the deepened window into ?window= where it survives pagination', async () => {
    mocks.addressTransactions = {
      transactions: mocks.mockTransactions,
      total: 25,
      coverage: 'partial',
      searchWindowBlocks: 600_000,
    };

    renderPage(`/chain/1/address/${mocks.testAddress}?page=2`);

    fireEvent.click(await screen.findByRole('button', { name: 'Search deeper' }));

    // 600,000 * 4 = 2,400,000 — lands in the URL next to ?page= (merge,
    // not clobber). The write is a pushed history entry like ?page=, so
    // back/forward steps between the shallow and deepened windows.
    await waitFor(() =>
      expect(screen.getByTestId('search-probe')).toHaveTextContent('window=2400000'),
    );
    expect(screen.getByTestId('search-probe')).toHaveTextContent('page=2');
    // The window reaches the tx query from the URL.
    expect(mocks.txQueryArgs[4]).toBe(2_400_000);

    // Pagination must keep the widened window: the page write merges too.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(screen.getByTestId('search-probe')).toHaveTextContent('page=3'),
    );
    expect(screen.getByTestId('search-probe')).toHaveTextContent('window=2400000');
    expect(mocks.txQueryArgs[4]).toBe(2_400_000);
  });

  it('seeds the search window from a shared ?window= deep link', async () => {
    renderPage(`/chain/1/address/${mocks.testAddress}?window=2400000`);

    await screen.findByRole('group', { name: 'Recent activity' });
    // The window arg rides the tx query from the URL alone (absent value
    // would be undefined — the backend default window).
    expect(mocks.txQueryArgs[4]).toBe(2_400_000);
  });

  it('degrades a malformed ?window= deep link to the default window', async () => {
    renderPage(`/chain/1/address/${mocks.testAddress}?window=abc`);

    await screen.findByRole('group', { name: 'Recent activity' });
    expect(mocks.txQueryArgs[4]).toBeUndefined();
  });

  it('renders the discovered total as a floor ("at least N") for partial coverage', async () => {
    // `total` counts heuristic discovery only: without authoritative
    // 'complete' coverage it must never read as an exact count.
    mocks.addressTransactions = {
      transactions: mocks.mockTransactions,
      total: 42,
      coverage: 'partial',
      searchWindowBlocks: 600_000,
    };

    renderPage();

    expect(
      await screen.findByText('Page 1 of 5 • At least 42 transactions discovered'),
    ).toBeInTheDocument();
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

  it('shows the unsupported-chain recovery state with CTAs for an invalid chain', async () => {
    renderPage(`/chain/999/address/${mocks.testAddress}`);

    // Same recovery pattern as Home/Blocks: name the requested id and offer
    // deterministic CTAs instead of a bare dead-end error.
    expect(await screen.findByText(/Chain not supported/)).toBeInTheDocument();
    expect(screen.getByText(/chain ID 999/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Mainnet' })).toHaveAttribute(
      'href',
      '/chain/1',
    );
    // In-card chain list replaces the old '/' bounce CTA.
    expect(screen.getByRole('heading', { name: 'Open a supported chain' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Polygon/ })).toHaveAttribute('href', '/chain/137');
  });

  // Mixed-case disagreement with EIP-55: uppercase one body position the
  // checksummed form holds lowercase (a guaranteed checksum mismatch that
  // stays mixed-case — the tier the page-level card must explain).
  const withBrokenChecksum = (address: string): string => {
    const checksummed = getAddress(address);
    for (let i = 2; i < checksummed.length; i++) {
      if (/[a-f]/.test(checksummed[i])) {
        return address.slice(0, i) + address[i].toUpperCase() + address.slice(i + 1);
      }
    }
    return address;
  };

  it('renders the page-level checksum guidance card for a bad-checksum address, with the lowercase recovery link', async () => {
    // A1: the verdict comes from the address string itself (no query
    // error needed) and replaces the whole data area — ONE verdict on the
    // screen, not the old mix of a normal-looking card, tab guidance and
    // raw 400s.
    renderPage(`/chain/1/address/${withBrokenChecksum(mocks.testAddress)}`);

    expect(await screen.findByText(/This address has an invalid checksum/)).toBeInTheDocument();
    expect(screen.getByText(/Copy the address from a trusted source/)).toBeInTheDocument();
    // Recovery is one click: the all-lowercase form is valid everywhere.
    const link = screen.getByRole('link', { name: /all-lowercase form/i });
    expect(link.getAttribute('href')).toBe(`/chain/1/address/${mocks.testAddress}`);
    // The Overview data card does NOT render for an invalid address.
    expect(screen.queryByText('Overview')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Recent activity' })).not.toBeInTheDocument();
  });

  it('renders the format-tier guidance for a malformed address, never checksum advice', async () => {
    // Shape failure ('0xGG…', 40 chars): the address has no checksum to
    // retry in lowercase, so the checksum tier (and its link) must not
    // render.
    renderPage(`/chain/1/address/0xGG${'11'.repeat(19)}`);

    expect(await screen.findByText(/Not a valid address format/)).toBeInTheDocument();
    expect(screen.queryByText(/invalid checksum/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /all-lowercase form/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Overview')).not.toBeInTheDocument();
  });

  it('passes query errors through verbatim for a valid address — the invalid-address guidance is address-driven, never message-driven', async () => {
    // A valid all-lowercase address whose (mocked) query fails with an
    // 'Invalid address' message: the raw error renders as-is. Sniffing
    // the message for guidance wording produced three conflicting
    // verdicts for one bad address; the address string is the only
    // ground truth now.
    mocks.realTime = {
      data: undefined,
      loading: false,
      fetching: false,
      error: new Error('Invalid address'),
    };

    renderPage();

    expect(await screen.findByText('Error: Invalid address')).toBeInTheDocument();
    expect(screen.queryByText(/This address has an invalid checksum/)).not.toBeInTheDocument();
  });

  it('renders the raw tx error verbatim for a valid address (no message sniffing)', async () => {
    mocks.addressTxError = new Error('Invalid address');

    renderPage();

    expect(await screen.findByText('Invalid address')).toBeInTheDocument();
    expect(screen.queryByText(/This address has an invalid checksum/)).not.toBeInTheDocument();
    expect(screen.queryByText('No transactions found')).not.toBeInTheDocument();
  });

  it('attributes missing indexed fields when the backend is unreachable, and classifies Type from the RPC read', async () => {
    // A3: offline backend + working RPC. The Overview card must say WHY
    // verification/creator rows are absent, and the EOA/contract verdict
    // must come from the RPC code read — an errored persistent channel
    // contributes no type verdict, so 'Unknown' is wrong here.
    mocks.infoError = new ApiError('Backend not connected — indexed data unavailable', 0);
    mocks.contractCode = '0x';

    renderPage();

    expect(await screen.findByText(/Indexed address details are unavailable/)).toBeInTheDocument();
    expect(
      screen.getByText(/still come from the live chain RPC/),
    ).toBeInTheDocument();
    expect(screen.getByText('Externally Owned Account (EOA)')).toBeInTheDocument();
    // The RPC fallback covers the page, so no raw page-level error card.
    expect(screen.queryByText(/Error: Backend not connected/)).not.toBeInTheDocument();
  });

  it('keeps Unknown honest when both channels fail, with the page error card and the offline attribution', async () => {
    // Both the persistent channel and the RPC code read failed: Type is
    // honestly Unknown (no data to classify from) while the page-level
    // error card carries the failure and the attribution explains the
    // missing indexed fields.
    mocks.infoError = new ApiError('Backend not connected — indexed data unavailable', 0);
    mocks.contractCodeError = new Error('RPC read failed');

    renderPage();

    expect(
      await screen.findByText('Error: Backend not connected — indexed data unavailable'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Indexed address details are unavailable/)).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(
      screen.queryByText('Externally Owned Account (EOA)'),
    ).not.toBeInTheDocument();
  });

  it('does not run the tx history scan for a transfers-only deep link', async () => {
    // C2: the expensive heuristic scan belongs to the transactions tab —
    // a transfers deep link gates it off (chainId <= 0 is the services'
    // disabled-key shape: resolves undefined, zero network).
    renderPage(`/chain/1/address/${mocks.testAddress}?tab=transfers`);

    expect(await screen.findByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(mocks.txQueryArgs[0]).toBe(0);
  });

  it('re-enables the tx scan when switching back to the transactions tab', async () => {
    renderPage(`/chain/1/address/${mocks.testAddress}?tab=transfers`);

    await screen.findByRole('columnheader', { name: 'Amount' });
    expect(mocks.txQueryArgs[0]).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }));

    expect(await screen.findByRole('columnheader', { name: 'Value' })).toBeInTheDocument();
    expect(mocks.txQueryArgs[0]).toBe(1);
  });

  it('never converges ?page= while sitting on the transfers tab', async () => {
    // C2: the beyond-data URL convergence rides the tx tab's own fetch —
    // a transfers-tab visit must not silently rewrite ?page= behind a
    // scan it is not running.
    mocks.addressTransactions = {
      transactions: [],
      total: 25,
      coverage: 'complete',
    };

    renderPage(`/chain/1/address/${mocks.testAddress}?tab=transfers&page=5`);

    expect(await screen.findByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.getByTestId('search-probe')).toHaveTextContent('page=5');
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

// The Overview card's "Token Holdings (discovered)" section: aggregates
// the mocked transfers fixture (one ERC-1155 single OUT row → net −3 for
// token id 5). The scan is lazy — the section holds no query until the
// transfers tab is visited (or the Scan button pressed), so the default
// render shows the honest not-scanned hint instead of an empty list.
describe('Token Holdings (discovered) overview section', () => {
  beforeEach(() => {
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
  });

  it('shows the not-scanned hint with a scan CTA and no holding rows by default', async () => {
    renderPage();

    expect(await screen.findByText('Token Holdings (discovered)')).toBeInTheDocument();
    expect(
      screen.getByText('Token transfers have not been scanned for this address.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Scan Token Transfers' }),
    ).toBeInTheDocument();
    // The lazy section renders no aggregate rows before the first scan.
    expect(screen.queryByText('ID 5 × -3')).not.toBeInTheDocument();
    expect(screen.queryByText(/Based on discovered transfers/)).not.toBeInTheDocument();
  });

  it('aggregates the scanned fixture into a holding row linking to the contract view, with the completeness caveat', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Scan Token Transfers' }));

    // One OUT of amount 3 → net −3 for id 5 (thousands formatting leaves
    // the small magnitude unchanged; the minus sign is shown honestly).
    const row = await screen.findByText('ID 5 × -3');
    expect(row.closest('a')?.getAttribute('href')).toBe(
      '/chain/1/contract/0x9999999999999999999999999999999999999999',
    );
    // The honesty caveat must render with the list — discovered transfers
    // are a partial scan, never a claim of full holdings.
    expect(
      screen.getByText('Based on discovered transfers — may be incomplete'),
    ).toBeInTheDocument();
  });

  // --- USD estimate (browser-side DefiLlama price layer) ---
  it('renders no USD estimate when no holdings row is priceable — the price layer is never even consulted', async () => {
    resetPricesForTests();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    try {
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: 'Scan Token Transfers' }));

      await screen.findByText('ID 5 × -3');
      expect(
        screen.getByText('Based on discovered transfers — may be incomplete'),
      ).toBeInTheDocument();

      // ERC-1155-only holdings carry no priceable ERC-20 rows: zero
      // DefiLlama requests (the spy still sees the page's own backend
      // API calls), no estimate line, no USD anywhere — clean absence.
      const llamaCalls = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('coins.llama.fi'),
      );
      expect(llamaCalls).toHaveLength(0);
      expect(screen.queryByText('Estimated value')).not.toBeInTheDocument();
      expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
      resetPricesForTests();
    }
  });
});

// The Overview card's summary stats strip over the tx tab's discovered
// rows: renders only when that set is non-empty, with the one-line
// discovered-window caveat; an empty set → clean absence (never
// zeros-as-facts). The fixture rows carry timestamps, so this pins the
// strip's plumbing through the page (the lazy block-lookup fallback has
// its own focused file: addressSummaryStatsRow.test.tsx).
describe('Overview summary stats row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addressTransactions = {
      transactions: mocks.mockTransactions,
      total: mocks.mockTransactions.length,
    };
    // The strip's data source is the balance-history page (widest cached
    // slice of the discovered set — the same response the chart card
    // renders in production).
    mocks.balanceHistoryPage = {
      chainId: 1,
      address: mocks.testAddress,
      transactions: mocks.mockTransactions,
      total: mocks.mockTransactions.length,
    };
  });

  it('renders FIRST/LAST SEEN and TOTAL IN/OUT over the discovered fixture, with the window caveat', async () => {
    renderPage();
    // The route component resolves async — wait for the strip's labels.
    await screen.findByText('First Seen');
    // Fixture: 1 ETH out at block 18,000,001 + 0.5 ETH in at 18,000,000,
    // both rows timestamped (dates render — year presence keeps the
    // assertion locale-agnostic).
    expect(screen.getByText('First Seen').nextElementSibling).toHaveTextContent('2024');
    expect(screen.getByText('Last Seen').nextElementSibling).toHaveTextContent('2024');
    expect(screen.getByText('Total In').nextElementSibling).toHaveTextContent('0.5000 ETH');
    expect(screen.getByText('Total Out').nextElementSibling).toHaveTextContent('1.0000 ETH');
    // The discovered semantics ride with the strip — never lifetime
    // totals; the fixture page carries the full set (2 of 2).
    expect(screen.getByTestId('summary-stats-row')).toHaveTextContent(
      /the 2 discovered transactions of the selected window/,
    );
  });

  it('renders nothing when the discovered set is empty', async () => {
    mocks.addressTransactions = { transactions: [], total: 0 };
    mocks.balanceHistoryPage = {
      chainId: 1,
      address: mocks.testAddress,
      transactions: [],
      total: 0,
    };
    renderPage();
    // Wait for the page itself (the Overview card) before pinning the
    // strip's absence — an unmounted page proves nothing.
    await screen.findByRole('heading', { name: 'Overview' });
    expect(screen.queryByTestId('summary-stats-row')).not.toBeInTheDocument();
    expect(screen.queryByText('Total In')).not.toBeInTheDocument();
    expect(screen.queryByText('First Seen')).not.toBeInTheDocument();
  });

  it('lifts the coverage badge line when the payload carries a completed genesis deep scan', async () => {
    // The heuristic channel alone stays partial; the additive deepScan
    // job (complete + genesis-anchored) is the only sanctioned lift.
    mocks.addressTransactions = {
      transactions: mocks.mockTransactions,
      total: mocks.mockTransactions.length,
      coverage: 'partial',
      deepScan: {
        status: 'complete',
        fromBlock: 0,
        toBlock: 18_000_000,
        cursorBlock: 18_000_000,
        blocksWalked: 18_000_001,
        blocksTotal: 18_000_001,
        txsFound: 2,
        errorMessage: null,
        coverage: 'complete',
        updatedAt: '2026-09-24T00:00:00.000Z',
      },
    };
    renderPage();
    await screen.findByRole('heading', { name: 'Overview' });
    fireEvent.click(screen.getByTestId('coverage-badge-toggle'));
    expect(screen.getByTestId('coverage-badge-detail')).toHaveTextContent(
      'complete (deep scan)',
    );
  });
});
