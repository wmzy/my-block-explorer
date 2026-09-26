// Per-tier inclusion estimates ("~N blocks (est.)") on the Home gas panel:
// the strictly-additive presentation layer over the wei-exact estimator
// (gasInclusionEstimate.test.ts owns the math). Same harness as the other
// Home tests — feeds, chain config and the native price layer mocked, the
// gas hook fed hand-built snapshots, no RPC anywhere.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';
import Home from '@/views/Home';
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
    return null;
  },
  getChainSymbol: () => 'ETH',
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Unknown'),
  getChainType: () => 'mainnet',
  isChainSupported: (chainId: number) => chainId === 1,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
  POPULAR_CHAINS: [{ id: 1, name: 'Ethereum' }],
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

// USD figures are orthogonal to the estimates; keep the price layer settled
// offline so only the estimate chips vary between cases.
vi.mock('@/services/prices', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/prices')>();
  return { ...actual, useNativeUsdPrice: () => null };
});

const okResult = (
  overrides: { tiers?: GasTiers | null; inclusion?: GasTierInclusionEstimates | null } = {},
): GasHistoryResult => ({
  status: 'ok',
  chainId: 1,
  snapshot: {
    chainId: 1,
    baseFeeGwei: Array.from({ length: 120 }, (_, i) => 10 + (i / 119) * 2.5),
    oldestBlock: 21_236_800,
    newestBlock: 21_236_919,
    currentBaseFeeGwei: 12.5,
    averageBaseFeeGwei: 11.25,
    tiers: overrides.tiers === undefined ? { slow: 0.8, standard: 1.5, fast: 3.2 } : overrides.tiers,
    tierInclusionBlocks:
      overrides.inclusion === undefined
        ? { sampleBlocks: 10, slow: 5, standard: 2, fast: 1 }
        : overrides.inclusion,
  },
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

describe('Home gas panel inclusion estimates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUseLatestBlocksFeed.mockReturnValue({ data: undefined, loading: false });
    mockUseLatestTransactionsFeed.mockReturnValue({ data: undefined, loading: false });
  });

  it('appends a per-tier "~N blocks (est.)" chip and one caveat line to a healthy feed', async () => {
    mockUseGasHistory.mockReturnValue({ data: okResult(), loading: false });

    renderHome();

    const panel = await screen.findByTestId('gas-panel');
    // The estimates are additive: the tier gwei figures stay as they were.
    expect(within(panel).getByText('0.8 gwei')).toBeVisible();
    expect(within(panel).getByText('1.5 gwei')).toBeVisible();
    expect(within(panel).getByText('3.2 gwei')).toBeVisible();

    // One chip per tier, pluralized ("~1 block", "~5 blocks").
    expect(within(panel).getByText('~5 blocks (est.)')).toBeVisible();
    expect(within(panel).getByText('~2 blocks (est.)')).toBeVisible();
    expect(within(panel).getByText('~1 block (est.)')).toBeVisible();

    // A single caveat under the tiers disclosing the sample basis, in the
    // window label's disclose-what-was-sampled style.
    expect(within(panel).getByTestId('gas-inclusion-note')).toHaveTextContent(
      'Inclusion estimates from the paid tips of the last 10 sampled blocks — never a promise',
    );
  });

  it('renders no chip for a tier whose sample gives no basis, and reports the usable count', async () => {
    mockUseGasHistory.mockReturnValue({
      data: okResult({
        inclusion: { sampleBlocks: 7, slow: undefined, standard: 2, fast: 1 },
      }),
      loading: false,
    });

    renderHome();

    const panel = await screen.findByTestId('gas-panel');
    expect(within(panel).queryByTestId('gas-inclusion-slow')).not.toBeInTheDocument();
    expect(within(panel).getByText('~2 blocks (est.)')).toBeVisible();
    expect(within(panel).getByText('~1 block (est.)')).toBeVisible();
    // The caveat still discloses the actual usable sample (7 blocks, not
    // the 10 requested).
    expect(within(panel).getByTestId('gas-inclusion-note')).toHaveTextContent(
      'Inclusion estimates from the paid tips of the last 7 sampled blocks — never a promise',
    );
  });

  it('renders no estimates and no caveat when the RPC returned no rewards', async () => {
    mockUseGasHistory.mockReturnValue({
      data: okResult({ tiers: null, inclusion: null }),
      loading: false,
    });

    renderHome();

    const panel = await screen.findByTestId('gas-panel');
    expect(within(panel).queryByText(/blocks \(est\.\)/)).not.toBeInTheDocument();
    expect(within(panel).queryByTestId('gas-inclusion-note')).not.toBeInTheDocument();
    // The existing honest-absence copy is untouched.
    expect(within(panel).getByText('Priority fees not returned by this RPC')).toBeVisible();
  });

  it('keeps the unavailable states estimate-free with their existing copy', async () => {
    mockUseGasHistory.mockReturnValue({
      data: { status: 'unavailable', chainId: 1, reason: 'method-not-supported' },
      loading: false,
    });

    renderHome();

    expect(await screen.findByTestId('gas-unavailable')).toHaveTextContent(
      'Gas history unavailable from this RPC — this endpoint does not implement eth_feeHistory.',
    );
    expect(screen.queryByText(/blocks \(est\.\)/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('gas-inclusion-note')).not.toBeInTheDocument();
  });
});
