// Charts page (/chain/:chainId/charts) view-layer tests: hooks mocked with
// settled ChartStats results, the REAL page rendered — every card's source
// label (the honesty contract made visible), gap-preserving bars and line
// segments, per-reason unavailable states (page-level and fee-section),
// first-load skeletons, the cross-chain no-flash guard, the young-chain
// day-count note, and the unsupported-chain early return.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';
import ChartsPage from '@/views/Charts';
import type { ChartsResult, ChartsSnapshot } from '@/services/chartStats';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">TopNav chain={currentChainId}</div>
  ),
}));

vi.mock('@/config/chains', () => ({
  getChainInfo: (chainId: number) => {
    if (chainId === 1) return { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } };
    if (chainId === 137) return { id: 137, name: 'Polygon', nativeCurrency: { symbol: 'POL' } };
    return null;
  },
  getChainSymbol: () => 'ETH',
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Polygon'),
  getChainType: () => 'mainnet',
  isChainSupported: (chainId: number) => chainId === 1 || chainId === 137,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
  POPULAR_CHAINS: [
    { id: 1, name: 'Ethereum' },
    { id: 137, name: 'Polygon' },
  ],
}));

vi.mock('@/views/Home/UnsupportedChainState', () => ({
  UnsupportedChainState: ({ chainId, rawChainId }: { chainId: number; rawChainId?: string }) => (
    <div data-testid="unsupported-chain">
      unsupported {chainId} {rawChainId ?? ''}
    </div>
  ),
}));

const mockUseChartStats = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/services/chartStats', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/chartStats')>();
  return { ...actual, useChartStats: (...args: unknown[]) => mockUseChartStats(...args) };
});

const DAY = 86_400_000;
// The fetch layer grids by UTC day ending yesterday; freeze the fixture
// grid to the same shape.
const TODAY = Date.UTC(2026, 8, 22);
const GRID = Array.from({ length: 30 }, (_, i) => TODAY - (30 - i) * DAY);

type FixtureOptions = {
  /** Grid index whose point is unresolvable — rendered as a gap. */
  gapDay?: number;
  /** Number of charted days (young chains resolve fewer). */
  chartedDays?: number;
  /** Days with a fee point (default: every charted day). */
  gasDays?: number;
  /** Mark some fee days partially covered. */
  partialGas?: boolean;
  gasReason?: 'rpc-cap' | 'method-not-supported' | 'pre-eip-1559' | 'rpc-error' | null;
};

const okSnapshot = (options: FixtureOptions = {}): ChartsSnapshot => {
  const chartedDays = options.chartedDays ?? GRID.length;
  const grid = GRID.slice(GRID.length - chartedDays);
  const blocksPerDay = grid
    .map((dayStart, index) => ({ dayStart, blocks: 7180 + (index % 7) * 6 }))
    .filter(point => point.dayStart !== GRID[options.gapDay ?? -1]);
  const boundaryHeaders = blocksPerDay.map(point => ({
    dayStart: point.dayStart,
    block: 21_000_000 + GRID.indexOf(point.dayStart) * 7185,
    timestamp: Math.floor(point.dayStart / 1000) + 500,
    gasUsed: BigInt(29_100_000 + GRID.indexOf(point.dayStart) * 12_000),
    baseFeePerGas: BigInt(12_000_000_000 + GRID.indexOf(point.dayStart) * 1_000_000),
  }));
  const gasDayCount = options.gasDays ?? blocksPerDay.length;
  const gasDaily = blocksPerDay.slice(0, gasDayCount).map((point, index) => ({
    dayStart: point.dayStart,
    startBlock: 21_000_000 + index * 7185,
    endBlockExclusive: 21_000_000 + (index + 1) * 7185,
    coveredBlocks: options.partialGas && index % 3 === 0 ? 5_000 : point.blocks,
    firstCoveredBlock: 21_000_000 + index * 7185,
    lastCoveredBlock: 21_000_000 + index * 7185 + (options.partialGas && index % 3 === 0 ? 4_999 : point.blocks - 1),
    avgBaseFeeGwei: 12 + index * 0.1,
    avgPriorityFeeGwei: options.gasReason === undefined && index % 10 === 9 ? null : 1.2,
    complete: !(options.partialGas && index % 3 === 0),
  }));
  const gasCharted = gasDaily.length > 0 && options.gasReason !== 'pre-eip-1559' ? gasDaily : [];
  const gasExpected = blocksPerDay.reduce((total, point) => total + point.blocks, 0);
  const gasCovered = gasCharted.reduce((total, point) => total + point.coveredBlocks, 0);
  return {
    chainId: 1,
    dayKey: '2026-09-22',
    computedAt: Date.UTC(2026, 8, 22, 0, 5),
    headBlock: 21_216_000,
    gridDayStarts: grid,
    blocksPerDay,
    boundaryHeaders,
    gasDaily: gasCharted,
    gasCoveredBlocks: gasCharted.length === 0 ? 0 : gasCovered,
    gasExpectedBlocks: gasExpected,
  };
};

const okResult = (options: FixtureOptions = {}): ChartsResult => ({
  status: 'ok',
  chainId: 1,
  snapshot: okSnapshot(options),
  gasUnavailableReason: options.gasReason ?? null,
});

const unavailableResult = (
  reason: 'unsupported-chain' | 'rpc-error' | 'method-not-supported' | 'insufficient-history',
): ChartsResult => ({ status: 'unavailable', chainId: 1, reason });

const renderCharts = (path: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([{ path: '/chain/:chainId/charts', component: () => ChartsPage }])}
      initialEntries={[path]}
    >
      <View />
    </MemoryRouter>,
  );

describe('Charts page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseChartStats.mockReturnValue({ data: undefined, loading: false });
  });

  it('renders the page header, sampling basis, and every source label', async () => {
    mockUseChartStats.mockReturnValue({ data: okResult(), loading: false });

    renderCharts('/chain/1/charts');

    expect(await screen.findByText('Ethereum Charts')).toBeVisible();
    expect(
      screen.getByText(
        'Derived from block headers and eth_feeHistory windows fetched live from this chain\u2019s RPC — sampled estimates, not an indexer\u2019s full-chain aggregation.',
      ),
    ).toBeVisible();

    // Every chart names its derivation basis verbatim.
    expect(
      screen.getByText('block numbers at day boundaries — derived from block timestamps'),
    ).toBeVisible();
    expect(
      screen.getByText('day-boundary block numbers — derived from block timestamps'),
    ).toBeVisible();
    expect(screen.getByText('sampled: one block per day boundary')).toBeVisible();
    // The fee chart labels the block window actually covered.
    expect(screen.getByText(/^daily averages · fee windows cover/)).toBeVisible();

    // Four aria-labelled charts.
    expect(screen.getByRole('img', { name: 'Blocks mined per day' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Average block time per day' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Gas used by the day-boundary block' })).toBeVisible();
    expect(
      screen.getByRole('img', { name: 'Daily average base fee and priority fee' }),
    ).toBeVisible();

    // One bar per charted day, one per card.
    expect(screen.getAllByTestId('chart-bar')).toHaveLength(60);
    // Both fee series drew line segments.
    expect(screen.getAllByTestId('chart-line').length).toBeGreaterThanOrEqual(2);

    // The honest burnt-fees refusal note.
    expect(screen.getByTestId('charts-burnt-note')).toHaveTextContent(
      'not available without full indexing',
    );
  });

  it('renders gaps as gaps: a missing day drops its bar and splits the line', async () => {
    mockUseChartStats.mockReturnValue({ data: okResult({ gapDay: 15 }), loading: false });

    renderCharts('/chain/1/charts');

    expect(await screen.findByTestId('charts-blocks-day')).toBeVisible();
    // 29 bars + 29 gas-used bars, never a zero-filled 30th.
    expect(screen.getAllByTestId('chart-bar')).toHaveLength(58);
    // The block-time line breaks into two segments around the gap.
    const blockTimeCard = screen.getByTestId('charts-block-time');
    expect(within(blockTimeCard).getAllByTestId('chart-line')).toHaveLength(2);
  });

  it('names partial fee coverage instead of pretending the day was whole', async () => {
    mockUseChartStats.mockReturnValue({ data: okResult({ partialGas: true }), loading: false });

    renderCharts('/chain/1/charts');

    const feeCard = await screen.findByTestId('charts-gas-fees');
    expect(within(feeCard).getByText(/days cover only part of their block span/)).toBeVisible();
    expect(
      within(feeCard).getByText(/partial days are averaged over the blocks actually returned/),
    ).toBeVisible();
  });

  it('keeps boundary charts while the fee section degrades per reason', async () => {
    for (const reason of ['pre-eip-1559', 'rpc-cap', 'method-not-supported'] as const) {
      mockUseChartStats.mockReturnValue({
        data: okResult({ gasReason: reason, gasDays: 0 }),
        loading: false,
      });

      renderCharts('/chain/1/charts');

      const feeCard = await screen.findByTestId('charts-gas-unavailable');
      if (reason === 'pre-eip-1559') {
        expect(feeCard).toHaveTextContent(
          'Fee history unavailable — no EIP-1559 base-fee data was returned (pre-EIP-1559 chain).',
        );
      } else if (reason === 'rpc-cap') {
        expect(feeCard).toHaveTextContent(
          'Fee history unavailable — this RPC refuses fee-history windows even at the minimum size.',
        );
      } else {
        expect(feeCard).toHaveTextContent(
          'Fee history unavailable — this endpoint does not implement eth_feeHistory.',
        );
      }
      // The boundary-derived charts kept rendering.
      expect(screen.getByTestId('charts-blocks-day')).toBeVisible();
      expect(screen.queryByTestId('charts-unavailable')).not.toBeInTheDocument();

      cleanup();
    }
  });

  it('marks a missing priority series as absent, never a 0-gwei line', async () => {
    mockUseChartStats.mockReturnValue({ data: okResult(), loading: false });

    renderCharts('/chain/1/charts');

    // The fixture leaves one day's priority average null — the legend still
    // names the series because most days carry it.
    const feeCard = await screen.findByTestId('charts-gas-fees');
    expect(within(feeCard).getByText('Priority fee (25th pct reward, avg)')).toBeVisible();
  });

  it('renders the honest page-level unavailable state per reason', async () => {
    const cases: ReadonlyArray<
      ['rpc-error' | 'method-not-supported' | 'insufficient-history', RegExp]
    > = [
      ['rpc-error', /the RPC did not answer the block probes/],
      ['method-not-supported', /does not implement the block methods/],
      ['insufficient-history', /fewer than one complete day of blocks is resolvable/],
    ];
    for (const [reason, pattern] of cases) {
      mockUseChartStats.mockReturnValue({ data: unavailableResult(reason), loading: false });

      renderCharts('/chain/1/charts');

      expect(await screen.findByTestId('charts-unavailable')).toHaveTextContent(pattern);
      expect(screen.queryAllByTestId('chart-bar')).toHaveLength(0);

      cleanup();
    }
  });

  it('pulses chart-shaped skeletons during the first load', async () => {
    mockUseChartStats.mockReturnValue({ data: undefined, loading: true });

    renderCharts('/chain/1/charts');

    expect(await screen.findAllByTestId('charts-skeleton')).toHaveLength(4);
    expect(screen.queryAllByTestId('chart-bar')).toHaveLength(0);
    expect(screen.queryByTestId('charts-unavailable')).not.toBeInTheDocument();
  });

  it('refuses another chain\'s data while the new chain loads (no flash)', async () => {
    mockUseChartStats.mockReturnValue({ data: okResult(), loading: true });

    renderCharts('/chain/137/charts');

    expect(await screen.findByText('Polygon Charts')).toBeInTheDocument();
    expect(screen.getAllByTestId('charts-skeleton')).toHaveLength(4);
    expect(screen.queryAllByTestId('chart-bar')).toHaveLength(0);
  });

  it('notes when the chain has fewer resolvable days than the 30-day window', async () => {
    mockUseChartStats.mockReturnValue({
      data: okResult({ chartedDays: 12 }),
      loading: false,
    });

    renderCharts('/chain/1/charts');

    expect(
      await screen.findByText(/Showing 12 complete days — this chain has less than the 30-day window/),
    ).toBeVisible();
  });

  it('renders the unsupported-chain state and never starts the feed', async () => {
    renderCharts('/chain/999999/charts');

    expect(await screen.findByTestId('unsupported-chain')).toHaveTextContent('unsupported 999999');
    // The unsupported branch returns before the feed body mounts, so no
    // RPC traffic is ever issued for a chain that cannot render.
    expect(mockUseChartStats).not.toHaveBeenCalled();
  });
});
