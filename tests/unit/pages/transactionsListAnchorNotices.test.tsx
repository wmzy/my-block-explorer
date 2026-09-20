// Wiring tests for the transactions list's anchor notices: the malformed
// ?block= deep link renders a one-time notice AND strips the param from
// the URL (a refresh cannot re-trigger it), a future anchor (beyond the
// polled live head) explains the clamped view without touching the URL,
// and the empty scan window renders the info-toned EmptyState instead of
// the red ErrorState. Mock preamble mirrors transactionsListPage.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes, useSearchParams } from '@native-router/react';
import '@testing-library/jest-dom';
import TransactionsList from '@/views/Transactions/List';

vi.mock('@/components/TopNavigation', () => ({
  default: () => <div data-testid="top-navigation" />,
}));

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
  getChainInfo: (chainId: number) =>
    chainId === 1 ? { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } } : null,
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Unknown'),
  getChainSymbol: (chainId: number) => (chainId === 1 ? 'ETH' : 'UNKNOWN'),
  isChainSupported: (chainId: number) => chainId === 1,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
}));

// Real formatters kept (formatNumber renders the anchor number in the
// notice); only relative time is pinned for determinism.
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
  error?: Error;
  refetch?: () => void;
};

const mockUseLatestTransactions = vi.fn<(...args: unknown[]) => TransactionsHookResult>();

vi.mock('@/services/chainRpc', () => ({
  useLatestTransactions: (...args: unknown[]) => mockUseLatestTransactions(...args),
}));

type FeedHookResult = { data?: { latestBlockNumber?: bigint } };

const mockUseLatestBlocksFeed = vi.fn<(...args: unknown[]) => FeedHookResult>();

vi.mock('@/services/homeFeed', () => ({
  useLatestBlocksFeed: (...args: unknown[]) => mockUseLatestBlocksFeed(...args),
}));

const makeTx = (blockNumber: number) => ({
  hash: `0xtx${blockNumber}`,
  blockNumber: String(blockNumber),
  fromAddress: '0x1234567890abcdef1234567890abcdef12345678',
  toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  value: '1000000000000000000',
  status: 1,
  timestamp: '2024-01-01T00:00:00Z',
});

// Exposes the current search string so the URL strip is observable.
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

describe('TransactionsList anchor notices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseLatestTransactions.mockReturnValue({
      data: undefined,
      loading: false,
      error: undefined,
    });
    // Live head unknown by default: no future-anchor verdict without it.
    mockUseLatestBlocksFeed.mockReturnValue({ data: undefined });
  });

  it('notifies once about a malformed ?block=, strips it from the URL, and walks the head', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: { transactions: [], latestBlockNumber: 18000001n },
      loading: false,
      error: undefined,
    });
    renderTransactionsList('/chain/1/transactions?block=abc');

    // The one-time notice: the param was ignored, latest transactions shown.
    expect(
      await screen.findByText('Invalid block parameter ignored — showing latest transactions'),
    ).toBeInTheDocument();
    // "Showing latest" is honest: the walk queried the live head, not a
    // garbage cursor.
    expect(mockUseLatestTransactions).toHaveBeenCalledWith(1, 20, undefined);

    // The block key is replaced out of the URL (the setter normalizes the
    // remaining search through the schema, so an explicit page=1 may
    // appear), so a refresh cannot re-show the notice — while the notice
    // itself survives the strip in-session.
    await waitFor(() =>
      expect(screen.getByTestId('search-probe').textContent).not.toContain('block'),
    );
    expect(screen.getByTestId('search-probe').textContent).toBe('page=1');
    expect(
      screen.getByText('Invalid block parameter ignored — showing latest transactions'),
    ).toBeInTheDocument();
  });

  it('keeps a valid ?block= in the URL and flags an anchor beyond the live head', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: { transactions: [makeTx(18000001)], latestBlockNumber: 18000001n },
      loading: false,
      error: undefined,
    });
    mockUseLatestBlocksFeed.mockReturnValue({ data: { latestBlockNumber: 18000001n } });
    renderTransactionsList('/chain/1/transactions?block=18000005');

    expect(
      await screen.findByText(
        'Anchor block 18,000,005 has not been produced yet — showing nearest earlier transactions',
      ),
    ).toBeInTheDocument();
    // A valid anchor is never stripped: the deep link stays shareable.
    expect(screen.getByTestId('search-probe').textContent).toBe('block=18000005');
    // Exactly one notice bar (no malformed notice stacked under it).
    expect(screen.queryByText(/Invalid block parameter/)).not.toBeInTheDocument();
  });

  it('renders no future-anchor notice while the live head is unknown', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: { transactions: [makeTx(18000001)], latestBlockNumber: 18000001n },
      loading: false,
      error: undefined,
    });
    renderTransactionsList('/chain/1/transactions?block=18000005');

    expect(await screen.findByText('Success')).toBeInTheDocument();
    expect(screen.queryByText(/has not been produced yet/)).not.toBeInTheDocument();
  });

  it('renders the empty scan window as an info EmptyState, not an error', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: { transactions: [], latestBlockNumber: 18000001n, hasMore: true },
      loading: false,
      error: undefined,
    });
    renderTransactionsList('/chain/1/transactions');

    // Normal business outcome: the scanned range holds no transactions and
    // the page says so without the red error palette (the global haze-ui
    // test mock forwards the Alert variant as an attribute).
    const empty = await screen.findByText(
      'No transactions in the scanned range — go older to continue',
    );
    expect(empty.closest('[data-testid="alert"]')?.getAttribute('variant')).toBe('info');
    expect(
      screen.queryByText('No transactions in the scanned range — go older to continue')?.closest(
        '[variant="danger"]',
      ),
    ).toBeNull();
  });
});
