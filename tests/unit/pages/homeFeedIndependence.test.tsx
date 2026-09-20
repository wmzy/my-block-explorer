// Home view progressive-reveal tests: the two feed columns and the four
// stats cards each render behind their own feed state instead of the old
// page-wide all-or-nothing gate. deriveStatPresentation is covered pure;
// the component cases pin cross-feed independence (blocks ready while
// transactions still load), the stat skeleton pulse, the error dash +
// tooltip, and that the stale-banner / fatal-error semantics are unchanged.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';
import Home, { deriveStatPresentation } from '@/views/Home';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">
      chain:
      {currentChainId}
    </div>
  ),
}));

vi.mock('@/config/chains', () => ({
  getChainInfo: (chainId: number) => {
    if (chainId === 1) return { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } };
    return null;
  },
  getChainSymbol: () => 'ETH',
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Unknown'),
  getChainType: () => 'mainnet',
  isChainSupported: (chainId: number) => chainId === 1,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
}));

// Real formatters are pure; keep them. Only relative time is pinned for
// determinism (the stale banner embeds it).
vi.mock('@/utils/format', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/format')>();
  return { ...actual, formatRelativeTime: () => '2 min ago' };
});

type FeedResult = {
  data?: unknown;
  loading: boolean;
  error?: Error;
  refetch?: () => void;
  dataUpdatedAt?: number;
};

const mockUseLatestBlocksFeed = vi.fn<(...args: unknown[]) => FeedResult>();
const mockUseLatestTransactionsFeed = vi.fn<(...args: unknown[]) => FeedResult>();

vi.mock('@/services/homeFeed', () => ({
  useLatestBlocksFeed: (...args: unknown[]) => mockUseLatestBlocksFeed(...args),
  useLatestTransactionsFeed: (...args: unknown[]) => mockUseLatestTransactionsFeed(...args),
}));

const renderHome = () =>
  render(
    <MemoryRouter
      routes={createRoutes([{ path: '/chain/:chainId', component: () => Home }])}
      initialEntries={['/chain/1']}
    >
      <View />
    </MemoryRouter>,
  );

// One honest block: zero-address miner (producer not exposed), gas usage
// at exactly 50%, 20 gwei gas price.
const BLOCK = {
  number: '21236964',
  hash: '0xblockhash00000000000000000000000000000000000000000000000000',
  parentHash: '0xparent0000000000000000000000000000000000000000000000000',
  timestamp: '2026-09-20T00:00:00.000Z',
  miner: '0x0000000000000000000000000000000000000000',
  gasUsed: '15000000',
  gasLimit: '30000000',
  baseFeePerGas: '20000000000',
  transactionCount: 42,
  sizeBytes: 12345,
};

const blocksFeedData = {
  blocks: [BLOCK],
  latestBlockNumber: 21236964n,
  gasPrice: 20000000000n,
};

describe('deriveStatPresentation', () => {
  it('pulses while the first fetch runs and nothing is on screen', () => {
    expect(deriveStatPresentation({ value: null, loading: true, error: false })).toEqual({
      kind: 'skeleton',
    });
  });

  it('shows a present value even mid-flight or under error (stale data stays)', () => {
    expect(
      deriveStatPresentation({ value: '21,236,964', loading: true, error: true }),
    ).toEqual({ kind: 'value', text: '21,236,964' });
  });

  it('marks a missing value under a failing feed as Unavailable', () => {
    expect(deriveStatPresentation({ value: null, loading: false, error: true })).toEqual({
      kind: 'unavailable',
      title: 'Unavailable',
    });
  });

  it('keeps the plain dash for a successful fetch without the figure', () => {
    expect(deriveStatPresentation({ value: null, loading: false, error: false })).toEqual({
      kind: 'empty',
    });
  });
});

describe('Home view feed independence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUseLatestBlocksFeed.mockReturnValue({ data: undefined, loading: false });
    mockUseLatestTransactionsFeed.mockReturnValue({ data: undefined, loading: false });
  });

  it('renders the blocks column while the transactions feed is still loading', async () => {
    mockUseLatestBlocksFeed.mockReturnValue({
      data: blocksFeedData,
      loading: false,
      dataUpdatedAt: Date.now(),
    });
    mockUseLatestTransactionsFeed.mockReturnValue({ data: undefined, loading: true });

    renderHome();

    // The blocks rows are on screen: the block-number link in the rows
    // column, even though the sibling feed has not settled yet.
    expect(await screen.findByRole('link', { name: '21,236,964' })).toBeInTheDocument();
    // The transactions column shows its own first-load skeleton instead of
    // the misleading empty message.
    expect(screen.getByTestId('feed-skeleton')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByText('No transactions in recent blocks')).not.toBeInTheDocument();
    // The old page-wide loading banner is gone.
    expect(screen.queryByText('Loading blockchain data...')).not.toBeInTheDocument();
    // Both columns keep their stable navigation chrome.
    expect(screen.getByRole('link', { name: 'View all blocks →' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all transactions →' })).toBeInTheDocument();
    // Stats traveled with the blocks feed: values, no skeletons.
    expect(screen.getByText('20.00 Gwei')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('50.0%')).toBeInTheDocument();
    expect(screen.queryByTestId('stat-skeleton')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Unavailable')).not.toBeInTheDocument();
  });

  it('pulses all four stat cards and both columns during the first load', async () => {
    mockUseLatestBlocksFeed.mockReturnValue({ data: undefined, loading: true });
    mockUseLatestTransactionsFeed.mockReturnValue({ data: undefined, loading: true });

    renderHome();

    // The router resolves the route component async; await the mount.
    expect(await screen.findByText('Ethereum Explorer')).toBeInTheDocument();

    expect(screen.getAllByTestId('stat-skeleton')).toHaveLength(4);
    expect(screen.getAllByTestId('feed-skeleton')).toHaveLength(2);
    expect(screen.queryByText('21,236,964')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Unavailable')).not.toBeInTheDocument();
  });

  it('shows the Unavailable dash with a tooltip when the blocks feed fails with no data', async () => {
    const refetchBlocks = vi.fn();
    const refetchTransactions = vi.fn();
    mockUseLatestBlocksFeed.mockReturnValue({
      data: undefined,
      loading: false,
      error: new Error('rpc down'),
      refetch: refetchBlocks,
    });
    // Sibling still healthy with data: the failure is stale, not fatal.
    mockUseLatestTransactionsFeed.mockReturnValue({
      data: [],
      loading: false,
      refetch: refetchTransactions,
      dataUpdatedAt: Date.now(),
    });

    renderHome();

    const unavailable = await screen.findAllByTitle('Unavailable');
    expect(unavailable).toHaveLength(4);
    for (const cell of unavailable) {
      expect(cell).toHaveTextContent('—');
    }
    // Stale semantics unchanged: warning banner over still-shown data, and
    // Retry still fans out to both feeds.
    expect(screen.getByText(/Live data unavailable — showing data from/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetchBlocks).toHaveBeenCalled();
    expect(refetchTransactions).toHaveBeenCalled();
    // Settled feeds: no skeletons anywhere.
    expect(screen.queryByTestId('stat-skeleton')).not.toBeInTheDocument();
    expect(screen.queryByTestId('feed-skeleton')).not.toBeInTheDocument();
  });

  it('keeps the plain dash, without the error tooltip, for a clean fetch that omits a figure', async () => {
    mockUseLatestBlocksFeed.mockReturnValue({
      data: { ...blocksFeedData, gasPrice: null },
      loading: false,
      dataUpdatedAt: Date.now(),
    });
    mockUseLatestTransactionsFeed.mockReturnValue({
      data: [],
      loading: false,
      dataUpdatedAt: Date.now(),
    });

    renderHome();

    // Await the async route mount before the synchronous assertions.
    expect(await screen.findByText('Ethereum Explorer')).toBeInTheDocument();

    // Three cards carry values (block number appears as stat + row link);
    // the gas-price card keeps its long-standing dash — distinguishable
    // from the error dash only by the missing tooltip.
    expect(screen.getAllByText('21,236,964')).toHaveLength(2);
    expect(screen.queryByText('20.00 Gwei')).not.toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(1);
    expect(screen.queryByTitle('Unavailable')).not.toBeInTheDocument();
  });

  it('waits for both feeds before showing the fatal error (mixed transient)', async () => {
    // Blocks already dead, transactions still on its first fetch: the
    // fatal card must not fire early and bury the live column.
    mockUseLatestBlocksFeed.mockReturnValue({
      data: undefined,
      loading: false,
      error: new Error('blocks rpc dead'),
    });
    mockUseLatestTransactionsFeed.mockReturnValue({ data: undefined, loading: true });

    renderHome();

    // Await the async route mount before the synchronous assertions.
    expect(await screen.findByText('Ethereum Explorer')).toBeInTheDocument();

    expect(
      screen.queryByText('Live data is unavailable and no previous data to show.'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all blocks →' })).toBeInTheDocument();
    expect(screen.getByTestId('feed-skeleton')).toBeInTheDocument();
    // Stats honestly say Unavailable for the dead feed.
    expect(screen.getAllByTitle('Unavailable')).toHaveLength(4);
  });

  it('replaces the columns with the fatal error once both feeds settle dead', async () => {
    mockUseLatestBlocksFeed.mockReturnValue({
      data: undefined,
      loading: false,
      error: new Error('blocks rpc dead'),
    });
    mockUseLatestTransactionsFeed.mockReturnValue({
      data: undefined,
      loading: false,
      error: new Error('transactions rpc dead'),
    });

    renderHome();

    expect(
      await screen.findByText('Live data is unavailable and no previous data to show.'),
    ).toBeInTheDocument();
    // Columns are gone (no chrome, no skeletons); the stats bar stays and
    // keeps its honest Unavailable presentation.
    expect(screen.queryByRole('link', { name: 'View all blocks →' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('feed-skeleton')).not.toBeInTheDocument();
    expect(screen.getAllByTitle('Unavailable')).toHaveLength(4);
  });
});
