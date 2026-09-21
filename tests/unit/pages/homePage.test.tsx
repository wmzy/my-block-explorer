// Home view tests for the unsupported-chain deep link and the testnet
// badge. Feeds and the chain config are mocked, so the cases pin which
// presentation the view picks per chain: explicit recovery state (never a
// silent redirect to some other chain) plus the hero badge on testnets.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';
import Home from '@/views/Home';

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
    if (chainId === 11155111)
      return { id: 11155111, name: 'Sepolia', nativeCurrency: { symbol: 'ETH' } };
    return null;
  },
  getChainSymbol: (chainId: number) => (chainId === 11155111 ? 'ETH' : 'ETH'),
  getChainName: (chainId: number) =>
    chainId === 1
      ? 'Ethereum'
      : chainId === 11155111
        ? 'Sepolia'
        : chainId === 137
          ? 'Polygon'
          : chainId === 8453
            ? 'Base'
            : 'Unknown',
  // Only Sepolia is a testnet in this fixture.
  getChainType: (chainId: number) => (chainId === 11155111 ? 'testnet' : 'mainnet'),
  // Consumed by the Landing helpers behind the recovery CTAs.
  isChainSupported: (chainId: number) => chainId === 1 || chainId === 11155111,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
  // Rendered by the in-card popular-chain grid of the recovery state.
  POPULAR_CHAINS: [
    { id: 1, name: 'Ethereum' },
    { id: 137, name: 'Polygon' },
    { id: 8453, name: 'Base' },
  ],
}));

// Real formatters are pure functions; keep them (spread the actual module
// instead of a hand-listed factory that silently breaks when the view
// imports more). Only relative time is pinned for determinism.
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
  useLatestBlocksFeed: (...args: unknown[]) => mockUseLatestBlocksFeed(...args),
  useLatestTransactionsFeed: (...args: unknown[]) => mockUseLatestTransactionsFeed(...args),
}));

// The gas panel's own feed is mocked for the same reason as the feeds
// above: these cases pin view routing, not RPC behavior (gasHistory.test
// and homeGasPanel.test.tsx own the panel's states).
vi.mock('@/services/gasHistory', () => ({
  useGasHistory: (...args: unknown[]) => mockUseGasHistory(...args),
}));

const renderHome = (path: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([{ path: '/chain/:chainId', component: () => Home }])}
      initialEntries={[path]}
    >
      <View />
    </MemoryRouter>,
  );

describe('Home view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUseLatestBlocksFeed.mockReturnValue({ data: undefined, loading: false });
    mockUseLatestTransactionsFeed.mockReturnValue({ data: undefined, loading: false });
    mockUseGasHistory.mockReturnValue({ data: undefined, loading: false });
  });

  it('renders the hero for a supported mainnet without a testnet badge', async () => {
    renderHome('/chain/1');

    expect(await screen.findByText('Ethereum Explorer')).toBeInTheDocument();
    expect(screen.getByText(/Chain ID: 1 · ETH/)).toBeInTheDocument();
    expect(screen.queryByText('Testnet')).not.toBeInTheDocument();
  });

  it('shows a Testnet badge in the hero for a testnet chain', async () => {
    renderHome('/chain/11155111');

    expect(await screen.findByText('Sepolia Explorer')).toBeInTheDocument();
    expect(screen.getByText('Testnet')).toBeInTheDocument();
  });

  it('renders an explicit unsupported state with recovery CTAs, not a silent redirect', async () => {
    renderHome('/chain/999999');

    // The state names the requested id instead of quietly reopening the
    // viewer's remembered chain.
    expect(await screen.findByText(/Chain not supported/)).toBeInTheDocument();
    expect(screen.getByText(/chain ID 999999/)).toBeInTheDocument();
    expect(screen.getByTestId('top-navigation')).toBeInTheDocument();

    // Recovery CTAs: the deterministic preferred chain (mainnet) plus the
    // in-card popular-chain grid that links concrete chains directly.
    expect(screen.getByRole('link', { name: 'Go to Mainnet' })).toHaveAttribute('href', '/chain/1');
    expect(screen.getByRole('heading', { name: 'Open a supported chain' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Polygon/ })).toHaveAttribute('href', '/chain/137');
    expect(screen.getByRole('link', { name: /Base/ })).toHaveAttribute('href', '/chain/8453');
    // The old "Open chain list" CTA bounced through '/' into the viewer's
    // remembered chain — no recovery link may target '/' anymore.
    expect(screen.getAllByRole('link').filter(l => l.getAttribute('href') === '/')).toHaveLength(0);

    // The unsupported state stays put: no hero of another chain ever
    // replaces it.
    expect(screen.queryByText(/Explorer/)).not.toBeInTheDocument();

    // Feeds are parked on the guarded id 0 (no RPC traffic for a chain
    // that cannot render).
    expect(mockUseLatestBlocksFeed).toHaveBeenCalledWith(0);
    expect(mockUseLatestTransactionsFeed).toHaveBeenCalledWith(0);
    expect(mockUseGasHistory).toHaveBeenCalledWith(0);
  });

  it('distinguishes an unparseable chain param from an unsupported chain id', async () => {
    renderHome('/chain/abc');

    // "abc" is a broken link, not an unknown chain: the message names the
    // raw param and never renders a bare NaN.
    expect(await screen.findByText(/Invalid chain ID/)).toBeInTheDocument();
    expect(screen.getByText(/"abc" is not a valid chain ID/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    // The same recovery CTAs apply.
    expect(screen.getByRole('link', { name: 'Go to Mainnet' })).toHaveAttribute('href', '/chain/1');
    // Feeds stay parked on the guarded id 0.
    expect(mockUseLatestBlocksFeed).toHaveBeenCalledWith(0);
  });

  it('labels a pending feed transaction Pending and floors dust values at <0.0001', async () => {
    mockUseLatestTransactionsFeed.mockReturnValue({
      data: [
        // Pending: no block position, no timestamp — the meta line must
        // not render "Block 0" (the old null-unaware fallback).
        {
          hash: '0xpending00000000000000000000000000000000000000000000000000000',
          blockNumber: null,
          transactionIndex: null,
          fromAddress: '0x1111111111111111111111111111111111111111',
          toAddress: '0x2222222222222222222222222222222222222222',
          value: '1',
          timestamp: undefined,
        },
      ],
      loading: false,
    });
    renderHome('/chain/1');

    expect(await screen.findByText('Pending')).toBeInTheDocument();
    expect(screen.queryByText(/Block 0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Block NaN/)).not.toBeInTheDocument();
    // 1 wei uses the shared dust floor, not a misleading 0.0000.
    expect(screen.getByText('<0.0001 ETH')).toBeInTheDocument();
    expect(screen.queryByText('0.0000 ETH')).not.toBeInTheDocument();
  });
});
