// Gas panel on the Home view: the EIP-1559 sparkline + tier card's tri-state
// behavior end-to-end at the view layer. Feeds and the chain config are
// mocked (the same harness as the other Home tests); the gas hook is fed
// hand-built GasHistoryResult objects so every panel state — ok with/without
// rewards, first load, unavailable, hidden on unknown chains — is pinned
// without any RPC.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';
import Home from '@/views/Home';
import { resetPricesForTests } from '@/services/prices';
import type {
  GasHistoryResult,
  GasTierInclusionEstimates,
  GasTiers,
} from '@/services/gasHistory';

vi.mock('@/components/TopNavigation', () => ({
  default: () => <div data-testid="top-navigation" />,
}));

vi.mock('@/config/chains', () => ({
  getChainInfo: (chainId: number) => {
    if (chainId === 1) return { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } };
    if (chainId === 137) return { id: 137, name: 'Polygon', nativeCurrency: { symbol: 'POL' } };
    return null;
  },
  getChainSymbol: () => 'ETH',
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Unknown'),
  getChainType: () => 'mainnet',
  isChainSupported: (chainId: number) => chainId === 1 || chainId === 137,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
  // Rendered by the unsupported-chain recovery grid.
  POPULAR_CHAINS: [
    { id: 1, name: 'Ethereum' },
    { id: 137, name: 'Polygon' },
  ],
}));

vi.mock('@/utils/format', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/format')>();
  return { ...actual, formatRelativeTime: () => '2 min ago' };
});

const mockUseLatestBlocksFeed = vi.fn<(...args: unknown[]) => unknown>();
const mockUseLatestTransactionsFeed = vi.fn<(...args: unknown[]) => unknown>();
const mockUseGasHistory = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/services/homeFeed', () => ({
  useLatestBlocksFeed: (...args: unknown[]) => mockUseLatestBlocksFeed(...args),
  useLatestTransactionsFeed: (...args: unknown[]) => mockUseLatestTransactionsFeed(...args),
}));

vi.mock('@/services/gasHistory', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/gasHistory')>();
  return { ...actual, useGasHistory: (...args: unknown[]) => mockUseGasHistory(...args) };
});

// A settled ok window: 120 blocks from #21,236,800 with a 10→12.5 gwei ramp.
const okSnapshot = (overrides: {
  tiers?: GasTiers | null;
  inclusion?: GasTierInclusionEstimates | null;
  oldestBlock?: number;
  chainId?: number;
}): GasHistoryResult => ({
  status: 'ok',
  chainId: overrides.chainId ?? 1,
  snapshot: {
    chainId: overrides.chainId ?? 1,
    baseFeeGwei: Array.from({ length: 120 }, (_, i) => 10 + (i / 119) * 2.5),
    oldestBlock: overrides.oldestBlock ?? 21_236_800,
    newestBlock: (overrides.oldestBlock ?? 21_236_800) + 119,
    currentBaseFeeGwei: 12.5,
    averageBaseFeeGwei: 11.25,
    tiers:
      overrides.tiers === undefined
        ? { slow: 0.8, standard: 1.5, fast: 3.2 }
        : overrides.tiers,
    tierInclusionBlocks:
      overrides.inclusion !== undefined
        ? overrides.inclusion
        : overrides.tiers === null
          ? null
          : { sampleBlocks: 10, slow: 5, standard: 2, fast: 1 },
  },
});

const renderHome = (path: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([{ path: '/chain/:chainId', component: () => Home }])}
      initialEntries={[path]}
    >
      <View />
    </MemoryRouter>,
  );

describe('Home gas panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUseLatestBlocksFeed.mockReturnValue({ data: undefined, loading: false });
    mockUseLatestTransactionsFeed.mockReturnValue({ data: undefined, loading: false });
  });

  it('renders sparkline, tiers, and the actual block window label', async () => {
    mockUseGasHistory.mockReturnValue({ data: okSnapshot({}), loading: false });

    renderHome('/chain/1');

    // Window label derives from the response's block numbers, never a
    // wall-clock "24h" guess.
    expect(await screen.findByText('last 120 blocks · #21,236,800–#21,236,919')).toBeVisible();

    // Sparkline: an accessible chart whose line path spans the viewBox.
    const chart = screen.getByRole('img', { name: /Base fee per gas/ });
    expect(chart.querySelector('path')).toHaveAttribute('d', expect.stringMatching(/^M0\.00,/));

    // Base fee facts: exact newest-block value plus the window mean.
    expect(screen.getByText('12.5 gwei')).toBeVisible();
    expect(screen.getByText('11.25 gwei')).toBeVisible();

    // Tier rows labeled Slow/Standard/Fast with the percentile rewards.
    expect(screen.getByText('Slow')).toBeVisible();
    expect(screen.getByText('0.8 gwei')).toBeVisible();
    expect(screen.getByText('Standard')).toBeVisible();
    expect(screen.getByText('1.5 gwei')).toBeVisible();
    expect(screen.getByText('Fast')).toBeVisible();
    expect(screen.getByText('3.2 gwei')).toBeVisible();

    expect(screen.queryByTestId('gas-unavailable')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gas-skeleton')).not.toBeInTheDocument();
  });

  it('keeps the sparkline but marks tiers explicitly absent when rewards are missing', async () => {
    mockUseGasHistory.mockReturnValue({
      data: okSnapshot({ tiers: null, oldestBlock: 100 }),
      loading: false,
    });

    renderHome('/chain/1');

    expect(
      await screen.findByText('last 120 blocks · #100–#219'),
    ).toBeVisible();
    expect(screen.getByRole('img', { name: /Base fee per gas/ })).toBeVisible();
    // Honest absence: dashes on exactly the three tier rows (scoped — the
    // parked stat cards also dash), never a fabricated 0 gwei tier.
    const panel = screen.getByTestId('gas-panel');
    expect(within(panel).getAllByText('—')).toHaveLength(3);
    expect(screen.getByText('Priority fees not returned by this RPC')).toBeVisible();
    expect(screen.queryByText('0 gwei')).not.toBeInTheDocument();
  });

  it('renders the honest unavailable state for an unsupported method', async () => {
    mockUseGasHistory.mockReturnValue({
      data: { status: 'unavailable', chainId: 1, reason: 'method-not-supported' },
      loading: false,
    });

    renderHome('/chain/1');

    expect(await screen.findByTestId('gas-unavailable')).toHaveTextContent(
      'Gas history unavailable from this RPC — this endpoint does not implement eth_feeHistory.',
    );
    // No chart, no fabricated values.
    expect(screen.queryByRole('img', { name: /Base fee per gas/ })).not.toBeInTheDocument();
  });

  it('names a dead RPC differently from an unsupported method', async () => {
    mockUseGasHistory.mockReturnValue({
      data: { status: 'unavailable', chainId: 1, reason: 'fetch-failed' },
      loading: false,
    });

    renderHome('/chain/1');

    expect(await screen.findByTestId('gas-unavailable')).toHaveTextContent(
      'Gas history unavailable from this RPC — the fee-history request failed.',
    );
  });

  it('pulses a sparkline-shaped skeleton during the first load', async () => {
    mockUseGasHistory.mockReturnValue({ data: undefined, loading: true });

    renderHome('/chain/1');

    expect(await screen.findByText('Ethereum Explorer')).toBeInTheDocument();
    expect(screen.getByTestId('gas-skeleton')).toBeVisible();
    expect(screen.queryByTestId('gas-unavailable')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Base fee per gas/ })).not.toBeInTheDocument();
  });

  it('refuses another chain\'s data while the new chain loads (no flash)', async () => {
    // The query layer keeps the last settle across a chain switch; the
    // panel must pulse instead of showing chain 1\'s fees under chain 137.
    mockUseGasHistory.mockReturnValue({
      data: okSnapshot({ chainId: 1 }),
      loading: true,
    });

    renderHome('/chain/137');

    expect(await screen.findByText('Polygon Explorer')).toBeInTheDocument();
    expect(screen.getByTestId('gas-skeleton')).toBeVisible();
    expect(screen.queryByText('12.5 gwei')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Base fee per gas/ })).not.toBeInTheDocument();
  });

  it('renders nothing gas-related on an unsupported chain', async () => {
    renderHome('/chain/999999');

    expect(await screen.findByText(/Chain not supported/)).toBeInTheDocument();
    expect(screen.queryByTestId('gas-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gas-unavailable')).not.toBeInTheDocument();
    // The parked id means no RPC traffic at all.
    expect(mockUseGasHistory).toHaveBeenCalledWith(0);
  });

  // --- per-tier USD (browser-side DefiLlama price layer) ---

  it('appends per-tier USD for a plain 21,000-gas transfer when the native coin is priced', async () => {
    // Earlier tests in this file already settled (and TTL-cached) the
    // chain-1 native price as unavailable — clear the module cache so
    // this test's stubbed fetch is actually consulted.
    resetPricesForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ coins: { 'coingecko:ethereum': { price: 2000 } } }),
      })),
    );
    mockUseGasHistory.mockReturnValue({ data: okSnapshot({}), loading: false });

    try {
      renderHome('/chain/1');

      await screen.findByText('last 120 blocks · #21,236,800–#21,236,919');
      // 21000 × (12.5 base + tip) gwei at $2000/ETH:
      // slow 13.3 → $0.56 · standard 14 → $0.59 · fast 15.7 → $0.66.
      // The gwei figures stay exact-matchable siblings; the USD nodes
      // appear once the price settles.
      expect(await screen.findByText('$0.56')).toBeInTheDocument();
      expect(screen.getByText('0.8 gwei')).toBeInTheDocument();
      expect(screen.getByText('$0.59')).toBeInTheDocument();
      expect(screen.getByText('1.5 gwei')).toBeInTheDocument();
      expect(screen.getByText('$0.66')).toBeInTheDocument();
      expect(screen.getByText('3.2 gwei')).toBeInTheDocument();
      expect(screen.getAllByTitle(/cost of a plain 21,000-gas transfer/)).toHaveLength(3);
    } finally {
      vi.unstubAllGlobals();
      resetPricesForTests();
    }
  });

  it('renders zero USD nodes when the price fetch fails', async () => {
    resetPricesForTests();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    mockUseGasHistory.mockReturnValue({ data: okSnapshot({}), loading: false });

    try {
      renderHome('/chain/1');

      const panel = await screen.findByTestId('gas-panel');
      await waitFor(() => {
        // Settled-unavailable: the panel is complete without any USD.
        expect(within(panel).queryByText(/\$/)).not.toBeInTheDocument();
      });
      expect(within(panel).getByText('0.8 gwei')).toBeInTheDocument();
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
      resetPricesForTests();
    }
  });
});
