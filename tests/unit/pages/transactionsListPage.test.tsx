import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes, useSearchParams } from '@native-router/react';
import '@testing-library/jest-dom';
import TransactionsList from '@/views/Transactions/List';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">
      chain:
      {currentChainId}
    </div>
  ),
}));

// CopyableHash still takes plain href strings; stubbed here to keep the
// view test isolated from the shared component internals.
vi.mock('@/components/ui/CopyableHash', () => ({
  CopyableHash: ({
    value,
    truncated,
    href,
  }: {
    value: string;
    truncated?: string;
    href?: string;
  }) => (href ? <a href={href}>{truncated ?? value}</a> : <span>{truncated ?? value}</span>),
}));

vi.mock('@/config/chains', () => ({
  getChainInfo: (chainId: number) => {
    if (chainId === 1) return { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } };
    return null;
  },
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Unknown'),
  getChainSymbol: (chainId: number) => (chainId === 1 ? 'ETH' : 'UNKNOWN'),
  // Consumed by the Landing helpers behind UnsupportedChainState.
  isChainSupported: (chainId: number) => chainId === 1,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
}));

// Real formatters are pure functions; keep them (formatEth included) instead
// of a hand-listed factory that silently breaks when the view imports more.
// Only relative time is pinned for determinism.
vi.mock('@/utils/format', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/format')>();
  return { ...actual, formatRelativeTime: () => '5 min ago' };
});

type TransactionsHookResult = {
  data?: {
    transactions?: unknown[];
    latestBlockNumber?: bigint;
    hasMore?: boolean;
    nextCursor?: bigint;
  };
  loading: boolean;
  fetching?: boolean;
  error?: Error;
  refetch?: () => void;
};

const mockUseLatestTransactions = vi.fn<(...args: unknown[]) => TransactionsHookResult>();

vi.mock('@/services/chainRpc', () => ({
  useLatestTransactions: (...args: unknown[]) => mockUseLatestTransactions(...args),
}));

// Live-head feed backing the staleness hint (same polled service as the
// Blocks list and Home views).
type FeedHookResult = { data?: { latestBlockNumber?: bigint }; loading?: boolean };

const mockUseLatestBlocksFeed = vi.fn<(...args: unknown[]) => FeedHookResult>();

vi.mock('@/services/homeFeed', () => ({
  useLatestBlocksFeed: (...args: unknown[]) => mockUseLatestBlocksFeed(...args),
}));

const makeTx = (blockNumber: number, status: number) => ({
  hash: `0xtx${blockNumber}`,
  blockNumber: String(blockNumber),
  fromAddress: '0x1234567890abcdef1234567890abcdef12345678',
  toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  value: '1000000000000000000',
  status,
  timestamp: '2024-01-01T00:00:00Z',
});

// Exposes the current search string so ?page= writes are observable
// (same probe pattern as the contract page tests).
function SearchProbe() {
  const [searchParams] = useSearchParams();
  return <div data-testid="search-probe">{searchParams.toString()}</div>;
}

const renderTransactionsList = (path: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([
        { path: '/chain/:chainId/transactions', component: () => TransactionsList },
      ])}
      initialEntries={[path]}
    >
      <SearchProbe />
      <View />
    </MemoryRouter>,
  );

describe('TransactionsList view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseLatestTransactions.mockReturnValue({
      data: undefined,
      loading: false,
      error: undefined,
    });
    // No live head beyond the page snapshot by default: no staleness hint.
    mockUseLatestBlocksFeed.mockReturnValue({ data: undefined });
  });

  it('renders TopNavigation and page header, querying the head page', async () => {
    renderTransactionsList('/chain/1/transactions');

    expect(await screen.findByTestId('top-navigation')).toBeInTheDocument();
    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(screen.getByText(/Ethereum/)).toBeInTheDocument();
    expect(mockUseLatestTransactions).toHaveBeenCalledWith(1, 20, undefined);
  });

  it('displays loading skeleton while the query is in flight', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: undefined,
      loading: true,
      error: undefined,
    });
    renderTransactionsList('/chain/1/transactions');
    expect((await screen.findAllByTestId('skeleton')).length).toBeGreaterThan(0);
  });

  it('displays transactions with status badges after loading', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: {
        transactions: [makeTx(18000001, 1), makeTx(18000000, 0)],
        latestBlockNumber: 18000001n,
      },
      loading: false,
      error: undefined,
    });
    renderTransactionsList('/chain/1/transactions');

    expect(await screen.findByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getAllByText('5 min ago').length).toBe(2);
    expect(screen.getAllByText('1.0000 ETH').length).toBe(2);
    // Block number and hash links navigate within the app
    expect(screen.getByText('18,000,001').closest('a')?.getAttribute('href')).toBe(
      '/chain/1/block/18000001',
    );
    expect(screen.getByText('0xtx18000001').closest('a')?.getAttribute('href')).toBe(
      '/chain/1/tx/0xtx18000001',
    );
  });

  it('displays error state when the query fails', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: undefined,
      loading: false,
      error: new Error('Failed to get transactions'),
      refetch: vi.fn(),
    });
    renderTransactionsList('/chain/1/transactions');

    expect(await screen.findByText(/Failed to get transactions/)).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('shows empty state when the head page is empty', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: { transactions: [], latestBlockNumber: 18000001n },
      loading: false,
      error: undefined,
    });
    renderTransactionsList('/chain/1/transactions');

    expect(await screen.findByText('No transactions found')).toBeInTheDocument();
  });

  it('shows the unsupported-chain recovery state with CTAs for an invalid chain', async () => {
    renderTransactionsList('/chain/999/transactions');

    // Same recovery pattern as Home/Blocks: name the requested id and offer
    // deterministic CTAs instead of a bare dead-end error.
    expect(await screen.findByText(/Chain not supported/)).toBeInTheDocument();
    expect(screen.getByText(/chain ID 999/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Mainnet' })).toHaveAttribute('href', '/chain/1');
    expect(screen.getByRole('link', { name: 'Open chain list' })).toHaveAttribute('href', '/');
  });

  it('renders Pending for transactions without a receipt (status -1)', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: {
        transactions: [makeTx(18000001, -1), makeTx(18000000, 1)],
        latestBlockNumber: 18000001n,
        hasMore: false,
      },
      loading: false,
      error: undefined,
    });
    renderTransactionsList('/chain/1/transactions');

    expect(await screen.findByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
    // A pending tx must never be labeled Failed
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
  });

  it('paginates via the continuation cursor the service returned', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => makeTx(18000001 - i, 1));
    const nextCursor = 17_999_982_000_005n; // (block 17999982, index 5)
    mockUseLatestTransactions.mockReturnValue({
      data: { transactions: twenty, latestBlockNumber: 18000001n, hasMore: true, nextCursor },
      loading: false,
      error: undefined,
    });
    renderTransactionsList('/chain/1/transactions');

    expect(await screen.findByText(/Page 1/)).toBeInTheDocument();
    expect(screen.getByText('Newer')).toBeDisabled();
    expect(screen.getByText('Older')).not.toBeDisabled();

    fireEvent.click(screen.getByText('Older'));
    // The page index now round-trips through the URL, so the page-2 render
    // lands asynchronously; once it does, page 2 resumes exactly at the
    // cursor page 1 returned — no fixed stride.
    expect(await screen.findByText(/Page 2/)).toBeInTheDocument();
    expect(mockUseLatestTransactions).toHaveBeenLastCalledWith(1, 20, nextCursor);
  });

  it('disables Older when the service reports no older transactions', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: {
        transactions: [makeTx(18000001, 1)],
        latestBlockNumber: 18000001n,
        hasMore: false,
        nextCursor: undefined,
      },
      loading: false,
      error: undefined,
    });
    renderTransactionsList('/chain/1/transactions');

    expect(await screen.findByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Older')).toBeDisabled();
  });

  it('seeds the first page from the ?block= deep link', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: undefined,
      loading: false,
      error: undefined,
    });
    renderTransactionsList('/chain/1/transactions?block=18000000');

    // wait for the lazy view to resolve and mount
    expect(await screen.findByText('No transactions found')).toBeInTheDocument();
    // cursor = (18000000 + 1) * 1_000_000: start AT block 18000000, walk down
    expect(mockUseLatestTransactions).toHaveBeenCalledWith(1, 20, 18_000_001_000_000n);
  });

  it('Refresh re-anchors at the live head: back to page 1, head refetched, cursors reset', async () => {
    const refetch = vi.fn();
    const nextCursor = 17_999_980_000_000n;
    mockUseLatestTransactions.mockReturnValue({
      data: {
        transactions: [makeTx(18000001, 1)],
        latestBlockNumber: 18000001n,
        hasMore: true,
        nextCursor,
      },
      loading: false,
      fetching: false,
      error: undefined,
      refetch,
    });
    renderTransactionsList('/chain/1/transactions');

    expect(await screen.findByText(/Page 1/)).toBeInTheDocument();

    // Walk one page older (the ?page=2 URL write settles asynchronously),
    // then come back to the live head via Refresh.
    fireEvent.click(screen.getByText('Older'));
    expect(await screen.findByText(/Page 2/)).toBeInTheDocument();
    expect(mockUseLatestTransactions).toHaveBeenLastCalledWith(1, 20, nextCursor);

    fireEvent.click(screen.getByRole('button', { name: '↻ Refresh' }));
    // Page 1 is the head again (no cursor) and the head entry was refetched
    // through the cache-bypassing path instead of riding its cached answer.
    await waitFor(() =>
      expect(mockUseLatestTransactions).toHaveBeenLastCalledWith(1, 20, undefined),
    );
    expect(refetch).toHaveBeenCalled();
    expect(await screen.findByText(/Page 1/)).toBeInTheDocument();
  });

  it('Refresh keeps the ?block= anchor and re-pulls the seeded page; Show latest clears it', async () => {
    const refetch = vi.fn();
    mockUseLatestTransactions.mockReturnValue({
      data: {
        transactions: [makeTx(18000000, 1)],
        latestBlockNumber: 18000001n,
        hasMore: false,
      },
      loading: false,
      fetching: false,
      error: undefined,
      refetch,
    });
    renderTransactionsList('/chain/1/transactions?block=18000000');

    expect(await screen.findByText('Success')).toBeInTheDocument();
    // The anchored view says so in the title instead of looking like the
    // live head page.
    expect(screen.getByText('Transactions · anchored at Block #18,000,000')).toBeInTheDocument();
    // Seeded page 1 carries the deep-link cursor.
    expect(mockUseLatestTransactions).toHaveBeenCalledWith(1, 20, 18_000_001_000_000n);

    // Refresh re-pulls page 1 OF THE ANCHOR: the seed cursor stays (the
    // deep link is the point of the page) and the URL keeps the param —
    // the rendered page never switches to the live-head cursor.
    fireEvent.click(screen.getByRole('button', { name: '↻ Refresh' }));
    expect(refetch).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('search-probe').textContent).toBe('block=18000000&page=1'),
    );
    expect(mockUseLatestTransactions).toHaveBeenLastCalledWith(1, 20, 18_000_001_000_000n);

    // "Show latest" is the explicit way out: it drops the anchor, the walk
    // re-seeds at the live head and the URL loses the param.
    fireEvent.click(screen.getByRole('button', { name: 'Show latest' }));
    await waitFor(() =>
      expect(mockUseLatestTransactions).toHaveBeenLastCalledWith(1, 20, undefined),
    );
    await waitFor(() => expect(screen.getByTestId('search-probe').textContent).toBe('page=1'));
    expect(
      screen.queryByText('Transactions · anchored at Block #18,000,000'),
    ).not.toBeInTheDocument();
  });

  it('walks a ?page=2 deep link: page 1 chains its cursor into the page-2 query', async () => {
    const pageOneCursor = 17_999_980_000_000n;
    // Page 1 (no cursor) reports the continuation; page 2 (any cursor) is
    // the end of the chain.
    mockUseLatestTransactions.mockImplementation((_chainId, _limit, cursor) =>
      cursor === undefined
        ? {
            data: {
              transactions: [makeTx(18000001, 1)],
              latestBlockNumber: 18000001n,
              hasMore: true,
              nextCursor: pageOneCursor,
            },
            loading: false,
            error: undefined,
          }
        : {
            data: {
              transactions: [makeTx(17999980, 1)],
              latestBlockNumber: 18000001n,
              hasMore: false,
            },
            loading: false,
            error: undefined,
          },
    );
    renderTransactionsList('/chain/1/transactions?page=2');

    // The walk runs page 1, extends the cursor stack with its nextCursor,
    // then lands on page 2 driven purely by the URL.
    expect(await screen.findByText(/Page 2/)).toBeInTheDocument();
    expect(mockUseLatestTransactions).toHaveBeenLastCalledWith(1, 20, pageOneCursor);
  });

  it('writes ?page= into the URL on Older and Newer clicks', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: {
        transactions: [makeTx(18000001, 1)],
        latestBlockNumber: 18000001n,
        hasMore: true,
        nextCursor: 17_999_980_000_000n,
      },
      loading: false,
      error: undefined,
    });
    renderTransactionsList('/chain/1/transactions');

    expect(await screen.findByText(/Page 1/)).toBeInTheDocument();
    expect(screen.getByTestId('search-probe').textContent).toBe('');

    fireEvent.click(screen.getByText('Older'));
    expect(await screen.findByText(/Page 2/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('search-probe').textContent).toBe('page=2'));

    fireEvent.click(screen.getByText('Newer'));
    expect(await screen.findByText(/Page 1/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('search-probe').textContent).toBe('page=1'));
  });

  it('keeps the ?block= anchor when paging writes ?page=', async () => {
    const nextCursor = 17_999_980_000_000n;
    mockUseLatestTransactions.mockReturnValue({
      data: {
        transactions: [makeTx(18000000, 1)],
        latestBlockNumber: 18000001n,
        hasMore: true,
        nextCursor,
      },
      loading: false,
      error: undefined,
    });
    renderTransactionsList('/chain/1/transactions?block=18000000');

    expect(await screen.findByText(/Page 1/)).toBeInTheDocument();
    // Seeded page 1 carries the deep-link cursor.
    expect(mockUseLatestTransactions).toHaveBeenCalledWith(1, 20, 18_000_001_000_000n);

    fireEvent.click(screen.getByText('Older'));
    expect(await screen.findByText(/Page 2/)).toBeInTheDocument();
    // The page write merges into the search: the anchor param survives.
    await waitFor(() =>
      expect(screen.getByTestId('search-probe').textContent).toBe('block=18000000&page=2'),
    );
    // Page 2 resumes from page 1's cursor, still anchored at the seed block.
    expect(mockUseLatestTransactions).toHaveBeenLastCalledWith(1, 20, nextCursor);
  });

  it('pins the URL to the deepest reachable page when a deep link overshoots', async () => {
    const pageOneCursor = 17_999_980_000_000n;
    mockUseLatestTransactions.mockImplementation((_chainId, _limit, cursor) =>
      cursor === undefined
        ? {
            data: {
              transactions: [makeTx(18000001, 1)],
              latestBlockNumber: 18000001n,
              hasMore: true,
              nextCursor: pageOneCursor,
            },
            loading: false,
            error: undefined,
          }
        : {
            data: {
              transactions: [makeTx(17999980, 1)],
              latestBlockNumber: 18000001n,
              hasMore: false,
            },
            loading: false,
            error: undefined,
          },
    );
    renderTransactionsList('/chain/1/transactions?page=5');

    // The walk stops where the chain does (page 2); the URL is replaced to
    // report the page actually shown instead of the unreachable page 5.
    expect(await screen.findByText(/Page 2/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('search-probe').textContent).toBe('page=2'));
  });

  it('falls back to page 1 when ?page= is garbage', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: {
        transactions: [makeTx(18000001, 1)],
        latestBlockNumber: 18000001n,
        hasMore: true,
        nextCursor: 17_999_980_000_000n,
      },
      loading: false,
      error: undefined,
    });
    renderTransactionsList('/chain/1/transactions?page=abc');

    // zod's .catch(1) degrades ?page=abc: the head page renders, no walk.
    expect(await screen.findByText(/Page 1/)).toBeInTheDocument();
    expect(mockUseLatestTransactions).toHaveBeenCalledWith(1, 20, undefined);
  });

  it('renders a pending row with Pending text and no block link', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: {
        transactions: [{ ...makeTx(18000001, -1), blockNumber: null }],
        latestBlockNumber: 18000001n,
        hasMore: false,
      },
      loading: false,
      error: undefined,
    });
    renderTransactionsList('/chain/1/transactions');

    // The Block cell degrades to honest Pending text: no "0" number, and
    // neither Pending occurrence (status badge, block cell) is a link —
    // a transaction with no block position never points at /block/0.
    const pendings = await screen.findAllByText('Pending');
    expect(pendings.length).toBe(2);
    for (const el of pendings) {
      expect(el.closest('a')).toBeNull();
    }
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '0' })).not.toBeInTheDocument();
  });

  it('flags stale data when the polled live head passes the page snapshot', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: {
        transactions: [makeTx(18000001, 1)],
        latestBlockNumber: 18000001n,
        hasMore: false,
      },
      loading: false,
      fetching: false,
      error: undefined,
      refetch: vi.fn(),
    });
    // The polled feed reports a head 10 blocks beyond the page snapshot.
    mockUseLatestBlocksFeed.mockReturnValue({ data: { latestBlockNumber: 18000011n } });
    renderTransactionsList('/chain/1/transactions');

    // The hint names the drift (Blocks/List pattern) and offers the same
    // refresh control the toolbar carries.
    expect(await screen.findByText(/10 new blocks/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('renders no staleness hint while the live head matches the page snapshot', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: {
        transactions: [makeTx(18000001, 1)],
        latestBlockNumber: 18000001n,
        hasMore: false,
      },
      loading: false,
      error: undefined,
    });
    mockUseLatestBlocksFeed.mockReturnValue({ data: { latestBlockNumber: 18000001n } });
    renderTransactionsList('/chain/1/transactions');

    expect(await screen.findByText('Success')).toBeInTheDocument();
    expect(screen.queryByText(/new blocks/)).not.toBeInTheDocument();
  });

  it('displays dust values with the shared <0.0001 floor', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: {
        transactions: [
          { ...makeTx(18000001, 1), value: '1' }, // 1 wei — far below 0.0001
          { ...makeTx(18000000, 1), value: '0' },
        ],
        latestBlockNumber: 18000001n,
        hasMore: false,
      },
      loading: false,
      error: undefined,
    });
    renderTransactionsList('/chain/1/transactions');

    // Shared formatValue contract: dust floors at <0.0001 instead of a
    // misleading 0.0000; zero renders exactly.
    expect(await screen.findByText('<0.0001 ETH')).toBeInTheDocument();
    expect(screen.getByText('0 ETH')).toBeInTheDocument();
    expect(screen.queryByText('0.0000 ETH')).not.toBeInTheDocument();
  });
});
