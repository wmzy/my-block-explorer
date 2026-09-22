// jsdom tests for the Balance-over-time (discovered) card: settled-data
// rendering (points, tooltips, mandatory caveats), the honest degradation
// states (unanchored without a live balance, query error), and the
// collapsible interaction. The HTTP layer is mocked — these pin VIEW
// behavior, not the endpoint (covered in addressesRouteBalanceHistory).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ApiError } from '@/util/apiError';
import {
  BalanceHistory,
  type BalanceHistoryPage,
} from '@/views/Address/BalanceHistory';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('@/util/http', () => ({
  get: (...args: unknown[]) => mocks.get(...args),
  longRunningApi: {},
  withSignal: (o: unknown) => o,
  isBackendUnreachable: () => false,
}));

const WEI = 1_000_000_000_000_000_000n;
const OTHER = '0x9999999999999999999999999999999999999999';

// The viewed address is the tx participant (per-test addresses also prove
// the component scopes its own cache key); fixtures are built around it.
const settledPage = (address: string): BalanceHistoryPage => ({
  chainId: 1,
  address,
  // Newest first on the wire: incoming 3 ETH at block 200, outgoing
  // 1 ETH at block 100 — deltas sum to +2 ETH.
  transactions: [
    {
      hash: '0xtx200',
      blockNumber: '200',
      fromAddress: OTHER,
      toAddress: address,
      value: (3n * WEI).toString(),
    },
    {
      hash: '0xtx100',
      blockNumber: '100',
      fromAddress: address,
      toAddress: OTHER,
      value: WEI.toString(),
    },
  ],
  total: 2,
  coverage: 'partial',
  searchWindowBlocks: 2_500_000,
  // Backend points (oldest first) carry the block times the tx rows
  // themselves lack on the wire.
  balancePoints: [
    { blockNumber: '100', timestamp: '2026-01-01T00:00:00Z', cumulativeValue: '0' },
    { blockNumber: '100', timestamp: '2026-01-01T00:00:00Z', cumulativeValue: (-WEI).toString() },
    { blockNumber: '200', timestamp: '2026-01-02T00:00:00Z', cumulativeValue: (2n * WEI).toString() },
  ],
  balancePointsCount: 3,
});

const emptyPage = (address: string): BalanceHistoryPage => ({
  chainId: 1,
  address,
  transactions: [],
  total: 0,
  coverage: 'none',
  reason: 'zero-balance',
  balancePoints: [],
  balancePointsCount: 0,
});

const renderCard = (address: string, currentBalance: bigint | null) =>
  render(
    <BalanceHistory
      chainId={1}
      address={address}
      currentBalance={currentBalance}
      defaultExpanded
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BalanceHistory card — settled data', () => {
  it('renders the chart points and the mandatory incompleteness caveat', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    mocks.get.mockResolvedValue(settledPage(address));

    renderCard(address, 2n * WEI); // deltas reconcile: −1 + 3 = +2

    const chart = await screen.findByTestId('balance-chart');
    expect(chart).toBeInTheDocument();
    // Anchor + two tx points.
    const ticks = chart.querySelectorAll('[data-testid="balance-point"]');
    expect(ticks).toHaveLength(3);
    // Mandatory honesty caveat, always present with data.
    expect(screen.getByTestId('balance-history-caveats').textContent).toContain(
      'Computed from discovered transactions — may be incomplete',
    );
    // Reconciled: no unknown-history caveat.
    expect(screen.getByTestId('balance-history-caveats').textContent).not.toContain(
      'balance before the oldest discovered transaction is unknown',
    );
    // Window label echoes the searched window.
    expect(screen.getByText(/Searched the most recent 2,500,000 blocks/)).toBeInTheDocument();
  });

  it('tooltips carry block number and the formatted balance', async () => {
    const address = '0x1111111111111111111111111111111111111122';
    mocks.get.mockResolvedValue(settledPage(address));

    renderCard(address, 2n * WEI);

    await screen.findByTestId('balance-chart');
    const titles = Array.from(
      screen
        .getAllByTestId('balance-point')
        .map(tick => tick.querySelector('title')?.textContent ?? ''),
    );
    expect(titles).toContain('Block #100 — -1 ETH');
    expect(titles).toContain('Block #200 — 2 ETH');
    // The anchor explains itself instead of posing as a mined balance.
    expect(titles.some(t => t.includes('before the oldest discovered transaction'))).toBe(true);
  });

  it('surfaces the reconciliation gap honestly when deltas miss the live balance', async () => {
    const address = '0x1111111111111111111111111111111111111133';
    mocks.get.mockResolvedValue(settledPage(address));

    // Deltas sum to +2 but the live balance is 5 → residual 3.
    renderCard(address, 5n * WEI);

    await screen.findByTestId('balance-chart');
    // gap-origin + pre-history + two tx points.
    expect(screen.getAllByTestId('balance-point')).toHaveLength(4);
    expect(screen.getByTestId('balance-history-caveats').textContent).toContain(
      'balance before the oldest discovered transaction is unknown',
    );
    // The newest point still equals the on-screen live balance (it also
    // happens to be the window high — both facts render 5 ETH).
    expect(screen.getAllByText('5 ETH').length).toBeGreaterThanOrEqual(1);
  });

  it('labels a missing live balance as discovered-change-only', async () => {
    const address = '0x1111111111111111111111111111111111111144';
    mocks.get.mockResolvedValue(settledPage(address));

    renderCard(address, null);

    await screen.findByTestId('balance-chart');
    expect(screen.getByTestId('balance-history-caveats').textContent).toContain(
      'showing discovered change only',
    );
    // "Now" is honestly absent, not zero.
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('says when only the newest slice of a larger discovery fits the chart', async () => {
    const address = '0x1111111111111111111111111111111111111155';
    const page = settledPage(address);
    mocks.get.mockResolvedValue({ ...page, total: 137 });

    renderCard(address, 2n * WEI);

    await screen.findByTestId('balance-chart');
    expect(screen.getByTestId('balance-history-caveats').textContent).toContain(
      'newest 2 of 137 discovered transactions',
    );
  });

  it('charts the single live anchor when nothing was discovered but the balance is known', async () => {
    const address = '0x1111111111111111111111111111111111111166';
    mocks.get.mockResolvedValue(emptyPage(address));

    renderCard(address, 0n);

    const chart = await screen.findByTestId('balance-chart');
    // One point: the current balance, labeled as such — never a fake series.
    const ticks = chart.querySelectorAll('[data-testid="balance-point"]');
    expect(ticks).toHaveLength(1);
    expect(ticks[0].querySelector('title')?.textContent).toBe('Current balance — 0 ETH');
  });

  it('explains an empty discovery through the endpoint coverage semantics', async () => {
    const address = '0x1111111111111111111111111111111111111177';
    mocks.get.mockResolvedValue(emptyPage(address));

    // No live balance either → nothing to chart, and the card says why.
    renderCard(address, null);

    expect(await screen.findByTestId('balance-history-empty')).toHaveTextContent(
      'Balance is zero — nothing to chart.',
    );
  });
});

describe('BalanceHistory card — honest failure states', () => {
  it('renders an explicit unavailable state on query error (no chart)', async () => {
    const address = '0x1111111111111111111111111111111111111188';
    mocks.get.mockRejectedValue(new ApiError('Failed to get address transactions', 500));

    renderCard(address, WEI);

    expect(await screen.findByTestId('balance-history-error')).toHaveTextContent(
      'Balance history unavailable — Failed to get address transactions.',
    );
    expect(screen.queryByTestId('balance-chart')).not.toBeInTheDocument();
  });
});

describe('BalanceHistory card — collapsible', () => {
  it('mounts collapsed (content aria-hidden) and expands on header click', async () => {
    const address = '0x1111111111111111111111111111111111111199';
    mocks.get.mockResolvedValue(settledPage(address));

    render(<BalanceHistory chainId={1} address={address} currentBalance={2n * WEI} />);

    const header = screen.getByRole('button', { name: /Balance over time \(discovered\)/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    // Content stays mounted (the fetch runs even collapsed) but hidden.
    await waitFor(() => expect(screen.getByTestId('balance-chart')).toBeInTheDocument());
    expect(
      screen.getByTestId('balance-chart').closest('[aria-hidden="true"]'),
    ).not.toBeNull();

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('balance-chart').closest('[aria-hidden="true"]')).toBeNull();
  });
});

describe('BalanceHistory — request shape', () => {
  it('fetches its own page with the balanceHistory opt-in', async () => {
    const address = '0x11111111111111111111111111111111111111aa';
    mocks.get.mockResolvedValue(settledPage(address));

    renderCard(address, WEI);
    await screen.findByTestId('balance-chart');

    expect(mocks.get).toHaveBeenCalledWith(
      `/api/chains/1/addresses/${address}/transactions`,
      { limit: 50, page: 1, balanceHistory: 1, window: undefined },
      expect.anything(),
    );
  });
});
