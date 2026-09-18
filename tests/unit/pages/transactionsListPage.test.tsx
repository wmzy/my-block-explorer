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

  it('shows unsupported chain error for invalid chain', async () => {
    renderTransactionsList('/chain/999/transactions');
    expect(await screen.findByText(/Unsupported chain ID/)).toBeInTheDocument();
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

  it('Refresh drops the ?block= deep-link seed and returns to the live head', async () => {
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
    renderTransactionsList('/chain/1/transactions?block=18000000');

    expect(await screen.findByText('Success')).toBeInTheDocument();
    // Seeded page 1 carries the deep-link cursor.
    expect(mockUseLatestTransactions).toHaveBeenCalledWith(1, 20, 18_000_001_000_000n);

    fireEvent.click(screen.getByRole('button', { name: '↻ Refresh' }));
    // The seed is dropped: page 1 queries the live head (no cursor).
    expect(mockUseLatestTransactions).toHaveBeenLastCalledWith(1, 20, undefined);
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
    await waitFor(() =>
      expect(screen.getByTestId('search-probe').textContent).toBe('page=2'),
    );

    fireEvent.click(screen.getByText('Newer'));
    expect(await screen.findByText(/Page 1/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('search-probe').textContent).toBe('page=1'),
    );
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
    await waitFor(() =>
      expect(screen.getByTestId('search-probe').textContent).toBe('page=2'),
    );
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
});
