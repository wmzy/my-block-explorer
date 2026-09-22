// Home × liveChain integration: the Latest Blocks column reflects the
// live mode — merged pushed blocks at the list head plus the Live/Polling
// indicator with its explanatory title — and the Watchlist panel mounts
// under the stats area. useLiveBlocks is the only mocked piece (merge +
// block-event subscription run real; apiBase/EventSource gating keeps
// them inert under jsdom).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';
import Home from '@/views/Home';
import type { LiveBlockPayload } from '@/services/liveChain';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">chain:{currentChainId}</div>
  ),
}));

vi.mock('@/config/chains', () => ({
  getChainInfo: (chainId: number) =>
    chainId === 1 ? { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } } : null,
  getChainSymbol: () => 'ETH',
  getChainName: () => 'Ethereum',
  getChainType: () => 'mainnet',
  isChainSupported: (chainId: number) => chainId === 1,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
  POPULAR_CHAINS: [{ id: 1, name: 'Ethereum' }],
}));

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
const mockUseGasHistory = vi.fn<(...args: unknown[]) => FeedResult>();

vi.mock('@/services/homeFeed', () => ({
  HOME_FEED_ITEMS: 10,
  useLatestBlocksFeed: (...args: unknown[]) => mockUseLatestBlocksFeed(...args),
  useLatestTransactionsFeed: (...args: unknown[]) => mockUseLatestTransactionsFeed(...args),
}));

vi.mock('@/services/gasHistory', () => ({
  useGasHistory: (...args: unknown[]) => mockUseGasHistory(...args),
}));

const mockUseLiveBlocks = vi.fn<
  (...args: unknown[]) => { mode: 'polling' | 'live'; blocks: LiveBlockPayload[] }
>();

vi.mock('@/services/liveChain', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/liveChain')>();
  return {
    ...actual,
    useLiveBlocks: (...args: unknown[]) => mockUseLiveBlocks(...args),
  };
});

const feedBlock = (number: number) => ({
  number: String(number),
  hash: `0xfeed${number}`,
  parentHash: `0xfeed${number - 1}`,
  timestamp: '1690000000000',
  miner: '0x0000000000000000000000000000000000000000',
  gasUsed: '1000000',
  gasLimit: '30000000',
  transactionCount: 2,
});

const liveBlock = (number: number): LiveBlockPayload => ({
  number: String(number),
  hash: `0xlive${number}`,
  parentHash: `0xlive${number - 1}`,
  timestamp: '1690000060000',
  miner: '0x0000000000000000000000000000000000000000',
  transactionCount: 7,
  gasUsed: '2000000',
  gasLimit: '30000000',
});

const renderHome = () =>
  render(
    <MemoryRouter
      routes={createRoutes([{ path: '/chain/:chainId', component: () => Home }])}
      initialEntries={['/chain/1']}
    >
      <View />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockUseLatestBlocksFeed.mockReturnValue({
    data: {
      blocks: [feedBlock(100), feedBlock(99)],
      latestBlockNumber: 100n,
      gasPrice: 1_500_000_000n,
    },
    loading: false,
  });
  mockUseLatestTransactionsFeed.mockReturnValue({ data: [], loading: false });
  mockUseGasHistory.mockReturnValue({ data: undefined, loading: false });
  mockUseLiveBlocks.mockReturnValue({ mode: 'polling', blocks: [] });
});

describe('Home live-mode integration', () => {
  it('renders the Polling indicator (with its explanation) and the polled list in polling mode', async () => {
    renderHome();

    expect(await screen.findByText('Ethereum Explorer')).toBeInTheDocument();

    const indicator = screen.getByTestId('live-mode-indicator');
    expect(indicator).toHaveTextContent('Polling');
    expect(indicator).toHaveAttribute(
      'title',
      expect.stringContaining('Updating by polling every 12s'),
    );

    // The polled feed is the rendered source of truth.
    expect(screen.getByRole('link', { name: '100' })).toHaveAttribute(
      'href',
      '/chain/1/block/100',
    );
    expect(screen.queryByRole('link', { name: '200' })).not.toBeInTheDocument();
  });

  it('merges pushed blocks at the list head and flips the badge in live mode', async () => {
    mockUseLiveBlocks.mockReturnValue({ mode: 'live', blocks: [liveBlock(200), liveBlock(199)] });
    renderHome();

    expect(await screen.findByTestId('live-mode-indicator')).toHaveTextContent('Live');

    // Pushed blocks lead the list, polled history follows.
    expect(screen.getByRole('link', { name: '200' })).toHaveAttribute(
      'href',
      '/chain/1/block/200',
    );
    expect(screen.getByRole('link', { name: '199' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '100' })).toBeInTheDocument();

    // The live head also wins the "Latest Block" stat (the stat card whose
    // label says so).
    const latestBlockStat = screen.getByText('Latest Block').parentElement;
    expect(latestBlockStat).toHaveTextContent('200');
  });

  it('mounts the Watchlist panel under the stats area', async () => {
    renderHome();

    expect(await screen.findByTestId('watchlist')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('0x… address to watch')).toBeInTheDocument();
    expect(screen.getByText(/not a background service/)).toBeInTheDocument();
  });
});
