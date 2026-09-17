import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
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

const renderTransactionsList = (path: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([
        { path: '/chain/:chainId/transactions', component: () => TransactionsList },
      ])}
      initialEntries={[path]}
    >
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
    // page 2 resumes exactly at the cursor page 1 returned — no fixed stride
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

    // Walk one page older, then come back to the live head via Refresh.
    fireEvent.click(screen.getByText('Older'));
    expect(mockUseLatestTransactions).toHaveBeenLastCalledWith(1, 20, nextCursor);

    fireEvent.click(screen.getByRole('button', { name: '↻ Refresh' }));
    // Page 1 is the head again (no cursor) and the head entry was refetched
    // through the cache-bypassing path instead of riding its cached answer.
    expect(mockUseLatestTransactions).toHaveBeenLastCalledWith(1, 20, undefined);
    expect(refetch).toHaveBeenCalled();
    expect(screen.getByText(/Page 1/)).toBeInTheDocument();
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
});
