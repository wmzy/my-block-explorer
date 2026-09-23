// Pending-transactions page (/chain/:chainId/pending) view-layer tests:
// the txpool feed mocked with settled TxPoolResult outcomes, the REAL page
// rendered — all four body states (loading skeleton, ok table, unsupported
// card, failed + Retry), the honesty contract (no age column, mempool
// caveat note, visible truncation with full counts, contract-creation
// cells), the cross-chain no-flash guard, and the unsupported-chain early
// return.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';
import PendingPage from '@/views/Transactions/Pending';
import { formatPoolValue, gasPriceCellLabel } from '@/views/Transactions/Pending';
import type { PoolEntry, TxPoolResult } from '@/services/txpool';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">TopNav chain={currentChainId}</div>
  ),
}));

// CopyableHash still takes plain href strings; stubbed here to keep the
// view test isolated from the shared component internals (blocks-list
// pattern) while keeping the href contract observable.
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
    if (chainId === 1) {
      return { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH', decimals: 18 } };
    }
    if (chainId === 137) {
      return { id: 137, name: 'Polygon', nativeCurrency: { symbol: 'POL', decimals: 18 } };
    }
    return null;
  },
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Polygon'),
}));

vi.mock('@/views/Home/UnsupportedChainState', () => ({
  UnsupportedChainState: ({ chainId, rawChainId }: { chainId: number; rawChainId?: string }) => (
    <div data-testid="unsupported-chain">
      unsupported {chainId} {rawChainId ?? ''}
    </div>
  ),
}));

type FeedHookResult = {
  data?: TxPoolResult;
  loading: boolean;
  fetching?: boolean;
  error?: Error;
  refetch?: () => void;
};

const mockUsePendingTransactions = vi.fn<(...args: unknown[]) => FeedHookResult>();

vi.mock('@/services/txpool', () => ({
  usePendingTransactions: (...args: unknown[]) => mockUsePendingTransactions(...args),
}));

const HASH_A =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';
const HASH_B =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2';
const HASH_C =
  '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc3';
const ADDR_1 = '0x1111111111111111111111111111111111111111';
const ADDR_2 = '0x2222222222222222222222222222222222222222';

const GWEI = 1_000_000_000n;

const entry = (overrides: Partial<PoolEntry> & { hash: string }): PoolEntry => ({
  from: ADDR_1,
  to: ADDR_2,
  value: 0n,
  nonce: 0,
  account: ADDR_1,
  accountNonce: 0,
  ...overrides,
});

const okResult = (pending: PoolEntry[], queuedCount: number): TxPoolResult => ({
  status: 'ok',
  chainId: 1,
  pending,
  pendingCount: pending.length,
  queuedCount,
  truncated: false,
});

const renderPending = (path: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([{ path: '/chain/:chainId/pending', component: () => PendingPage }])}
      initialEntries={[path]}
    >
      <View />
    </MemoryRouter>,
  );

describe('Pending transactions page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePendingTransactions.mockReturnValue({ data: undefined, loading: false });
  });

  it('renders the first-load skeleton and nothing else while the pool fetch runs', async () => {
    mockUsePendingTransactions.mockReturnValue({ data: undefined, loading: true });

    renderPending('/chain/1/pending');

    expect((await screen.findAllByTestId('skeleton')).length).toBeGreaterThan(0);
    // No table, no counts, no error states while loading.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-counts')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-unsupported')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-failed')).not.toBeInTheDocument();
  });

  it('renders the pool table: links, values, gas prices, nonces — and no age column', async () => {
    mockUsePendingTransactions.mockReturnValue({
      data: okResult(
        [
          // Legacy entry: flat gasPrice, plain value.
          entry({
            hash: HASH_A,
            value: 500_000_000_000_000_000n,
            gasPrice: 2n * GWEI,
            nonce: 7,
            accountNonce: 7,
          }),
          // EIP-1559 entry: fee cap shown as ≤.
          entry({
            hash: HASH_B,
            from: ADDR_2,
            value: 10n ** 13n, // below the 0.0001 display floor
            maxFeePerGas: 25n * GWEI,
            nonce: 42,
            account: ADDR_2,
            accountNonce: 42,
          }),
          // Contract creation in flight: to === null.
          entry({ hash: HASH_C, to: null, gasPrice: 1n * GWEI, nonce: 3, accountNonce: 3 }),
        ],
        2,
      ),
      loading: false,
      fetching: false,
    });

    renderPending('/chain/1/pending');

    expect(await screen.findByTestId('pending-counts')).toHaveTextContent('3 pending · 2 queued');

    const table = screen.getByRole('table');
    // Honesty contract: pool entries carry no timestamps — the mined-tx
    // lists' Age column must not appear here.
    expect(within(table).queryByText('Age')).not.toBeInTheDocument();

    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4); // header + 3 entries

    // Tx hash cells link into the tx detail route.
    expect(
      within(table).getByRole('link', { name: `${HASH_A.slice(0, 10)}...${HASH_A.slice(-8)}` }),
    ).toHaveAttribute('href', `/chain/1/tx/${HASH_A}`);

    // From/to cells link into address pages (ADDR_2 appears as from AND as
    // to — assert on hrefs, not a single match).
    expect(
      within(table).getAllByRole('link', { name: `${ADDR_1.slice(0, 8)}...${ADDR_1.slice(-6)}` })
        .length,
    ).toBeGreaterThan(0);
    const addrTwoLinks = within(table).getAllByRole('link', {
      name: `${ADDR_2.slice(0, 8)}...${ADDR_2.slice(-6)}`,
    });
    expect(addrTwoLinks.length).toBe(3);
    for (const link of addrTwoLinks) {
      expect(link).toHaveAttribute('href', `/chain/1/address/${ADDR_2}`);
    }

    // Values: exact formatUnits output, dust floored honestly.
    expect(within(table).getByText('0.5 ETH')).toBeInTheDocument();
    expect(within(table).getByText('<0.0001 ETH')).toBeInTheDocument();
    expect(within(table).getByText('0 ETH')).toBeInTheDocument();

    // Gas prices: legacy flat, 1559 fee cap with ≤.
    expect(within(table).getByText('2 gwei')).toBeInTheDocument();
    expect(within(table).getByText('≤ 25 gwei')).toBeInTheDocument();

    // Nonce column carries the tx's own declared nonce.
    expect(within(table).getByText('42')).toBeInTheDocument();

    // Contract creation renders as a stated absence, never a zero-address
    // link.
    expect(within(table).getByText('Contract creation')).toBeInTheDocument();

    // Standing mempool caveat stays visible in the ok state.
    expect(screen.getByText(/no age column is shown/i)).toBeInTheDocument();
    expect(screen.getByText(/other nodes may hold different entries/i)).toBeInTheDocument();
  });

  it('shows the truncation note with full counts when the cap bit', async () => {
    // 250 entries in the pool, only the first 200 served.
    const many = Array.from({ length: 250 }, (_, i) =>
      entry({ hash: `0x${String(i).padStart(4, '0')}${'ab'.repeat(30)}`, nonce: i, accountNonce: i }),
    );
    mockUsePendingTransactions.mockReturnValue({
      data: {
        status: 'ok',
        chainId: 1,
        pending: many.slice(0, 200),
        pendingCount: 250,
        queuedCount: 1,
        truncated: true,
      },
      loading: false,
    });

    renderPending('/chain/1/pending');

    expect(await screen.findByTestId('pending-truncated')).toHaveTextContent(
      'Showing first 200 of 250 pending transactions',
    );
    expect(screen.getByTestId('pending-counts')).toHaveTextContent('250 pending · 1 queued');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(201);
  });

  it('renders an explicit empty state for a drained pool, not a table or an error', async () => {
    mockUsePendingTransactions.mockReturnValue({
      data: okResult([], 0),
      loading: false,
    });

    renderPending('/chain/1/pending');

    expect(
      await screen.findByText(/No pending transactions — this node’s pool is empty right now/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('pending-counts')).toHaveTextContent('0 pending · 0 queued');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-failed')).not.toBeInTheDocument();
  });

  it('renders the explicit unsupported card when the RPC hides its txpool', async () => {
    mockUsePendingTransactions.mockReturnValue({
      data: {
        status: 'unsupported',
        chainId: 1,
        message: 'This RPC does not expose the transaction pool (txpool_* is not supported)',
      },
      loading: false,
    });

    renderPending('/chain/1/pending');

    const card = await screen.findByTestId('pending-unsupported');
    expect(card).toHaveTextContent('Transaction pool unavailable');
    // The provider-unsupported fact, verbatim — never an empty pool claim.
    expect(card).toHaveTextContent('This RPC does not expose the transaction pool');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-failed')).not.toBeInTheDocument();
  });

  it('renders the failure state with its reason and a working Retry', async () => {
    const refetch = vi.fn();
    mockUsePendingTransactions.mockReturnValue({
      data: { status: 'failed', chainId: 1, message: 'Failed to fetch the transaction pool' },
      loading: false,
      refetch,
    });

    renderPending('/chain/1/pending');

    const failed = await screen.findByTestId('pending-failed');
    expect(failed).toHaveTextContent('Failed to fetch the transaction pool');
    expect(screen.queryByTestId('pending-unsupported')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('treats another chain’s settled result as absent (cross-chain guard)', async () => {
    mockUsePendingTransactions.mockReturnValue({
      // Settled for Polygon while the page shows Ethereum: must not flash
      // POL rows under the Ethereum header.
      data: {
        status: 'ok',
        chainId: 137,
        pending: [entry({ hash: HASH_A })],
        pendingCount: 1,
        queuedCount: 0,
        truncated: false,
      },
      loading: false,
    });

    renderPending('/chain/1/pending');

    // Absent result + not loading → the defensive failure branch (never a
    // table, never an unsupported claim).
    expect(await screen.findByTestId('pending-failed')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('early-returns the unsupported-chain state without mounting the pool feed', async () => {
    renderPending('/chain/999/pending');

    expect(await screen.findByTestId('unsupported-chain')).toHaveTextContent('unsupported 999');
    expect(mockUsePendingTransactions).not.toHaveBeenCalled();
  });

  it('renders the page header with the chain context', async () => {
    mockUsePendingTransactions.mockReturnValue({ data: okResult([], 0), loading: false });

    renderPending('/chain/1/pending');

    expect(await screen.findByText('Pending Transactions')).toBeInTheDocument();
    expect(screen.getByText(/Ethereum • Chain ID: 1/)).toBeInTheDocument();
  });
});

// --- pure display helpers (honest formatting contracts) ---

describe('formatPoolValue', () => {
  it('formats exact formatUnits output with trailing zeros cut', () => {
    expect(formatPoolValue(500_000_000_000_000_000n, 18, 'ETH')).toBe('0.5 ETH');
    expect(formatPoolValue(1_230_000_000_000_000_000n, 18, 'ETH')).toBe('1.23 ETH');
    expect(formatPoolValue(0n, 18, 'ETH')).toBe('0 ETH');
  });

  it('floors dust below the display cutoff instead of printing a zero', () => {
    // 0.0001 ETH floor = 10^14 wei; anything strictly below is dust.
    expect(formatPoolValue(10n ** 14n, 18, 'ETH')).toBe('0.0001 ETH');
    expect(formatPoolValue(10n ** 13n, 18, 'ETH')).toBe('<0.0001 ETH');
    expect(formatPoolValue(1n, 18, 'ETH')).toBe('<0.0001 ETH');
  });

  it('honors non-18 native decimals', () => {
    // 6-decimal stablecoin-style currency: 5 units.
    expect(formatPoolValue(5_000_000n, 6, 'XTC')).toBe('5 XTC');
    expect(formatPoolValue(1n, 6, 'XTC')).toBe('<0.0001 XTC');
  });
});

describe('gasPriceCellLabel', () => {
  it('shows the 1559 fee cap with ≤, the legacy gas price flat, absence as em dash', () => {
    expect(gasPriceCellLabel(entry({ hash: HASH_A, maxFeePerGas: 25n * GWEI }))).toBe(
      '≤ 25 gwei',
    );
    expect(gasPriceCellLabel(entry({ hash: HASH_B, gasPrice: 2n * GWEI }))).toBe('2 gwei');
    expect(gasPriceCellLabel(entry({ hash: HASH_C }))).toBe('—');
  });

  it('prefers the fee cap when both fields are present', () => {
    expect(
      gasPriceCellLabel(entry({ hash: HASH_A, gasPrice: 2n * GWEI, maxFeePerGas: 30n * GWEI })),
    ).toBe('≤ 30 gwei');
  });
});
