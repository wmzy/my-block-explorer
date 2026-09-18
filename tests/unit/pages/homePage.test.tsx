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
    chainId === 1 ? 'Ethereum' : chainId === 11155111 ? 'Sepolia' : 'Unknown',
  // Only Sepolia is a testnet in this fixture.
  getChainType: (chainId: number) => (chainId === 11155111 ? 'testnet' : 'mainnet'),
  // Consumed by the Landing helpers behind the recovery CTAs.
  isChainSupported: (chainId: number) => chainId === 1 || chainId === 11155111,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
}));

vi.mock('@/utils/format', () => ({
  formatNumber: (n: number) => n.toLocaleString(),
  formatAddress: (a: string) => a,
  formatHash: (h: string) => h,
  formatRelativeTime: () => '2 min ago',
  formatEth: (v: bigint) => v.toString(),
}));

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

    // Recovery CTAs: the deterministic preferred chain (mainnet) and the
    // landing route that leads to the chain list entry.
    expect(screen.getByRole('link', { name: 'Go to Mainnet' })).toHaveAttribute(
      'href',
      '/chain/1',
    );
    expect(screen.getByRole('link', { name: 'Open chain list' })).toHaveAttribute('href', '/');

    // The unsupported state stays put: no hero of another chain ever
    // replaces it.
    expect(screen.queryByText(/Explorer/)).not.toBeInTheDocument();

    // Feeds are parked on the guarded id 0 (no RPC traffic for a chain
    // that cannot render).
    expect(mockUseLatestBlocksFeed).toHaveBeenCalledWith(0);
    expect(mockUseLatestTransactionsFeed).toHaveBeenCalledWith(0);
  });
});
