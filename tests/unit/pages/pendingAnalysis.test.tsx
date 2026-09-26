// Pending-page conflict-analysis tests: the analysis strip (summary line
// + the mandatory single-node derivation caveat), the per-row Replaceable
// badge (title = conflict size + current likely winner), the ?group=
// schema contract (absent / explicit '1' / invalid values degrade to
// flat), the grouped rendering (group header with from + nonce + size,
// winner first, solos flat), and the honest empty/truncated summaries.
// The txpool feed is mocked with settled outcomes; the analyzer itself
// runs real (pure) — the same split the page uses.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, View, createRoutes, useSearchParams } from '@native-router/react';
import '@testing-library/jest-dom/vitest';
import PendingPage, {
  analysisSummaryText,
  conflictBadgeTitle,
  pendingSearchSchema,
} from '@/views/Transactions/Pending';
import { analyzeMempool } from '@/utils/mempoolAnalysis';
import type { PoolEntry, TxPoolResult } from '@/services/txpool';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">TopNav chain={currentChainId}</div>
  ),
}));

// CopyableHash stubbed to keep the view test isolated from the shared
// component internals (blocks-list pattern) while keeping the href
// contract observable.
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
    chainId === 1
      ? { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH', decimals: 18 } }
      : null,
  getChainName: () => 'Ethereum',
}));

vi.mock('@/views/Home/UnsupportedChainState', () => ({
  UnsupportedChainState: ({ chainId }: { chainId: number }) => (
    <div data-testid="unsupported-chain">unsupported {chainId}</div>
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

const GWEI = 1_000_000_000n;

// The conflict fixture: one slot held by a 1559 entry (fee cap 30 gwei,
// tip 2) and a legacy replacement (gasPrice 10 gwei) — the 1559 cap wins.
// A third unopposed legacy entry (5 gwei) pads the statistics.
const CONFLICT_LOWER = '0xabc1111111111111111111111111111111111111';
const CONFLICT_UPPER = '0xABC1111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const HASH_WIN = `0x${'aa'.repeat(32)}`;
const HASH_LOSE = `0x${'bb'.repeat(32)}`;
const HASH_SOLO = `0x${'cc'.repeat(32)}`;

const shortHash = (hash: string): string => `${hash.slice(0, 10)}...${hash.slice(-8)}`;

const entry = (overrides: Partial<PoolEntry> & { hash: string }): PoolEntry => ({
  from: CONFLICT_LOWER,
  to: OTHER,
  value: 0n,
  nonce: 5,
  account: CONFLICT_LOWER,
  accountNonce: 5,
  ...overrides,
});

const conflictPool = (): PoolEntry[] => [
  entry({
    hash: HASH_WIN,
    maxFeePerGas: 30n * GWEI,
    maxPriorityFeePerGas: 2n * GWEI,
  }),
  entry({ hash: HASH_LOSE, from: CONFLICT_UPPER, gasPrice: 10n * GWEI }),
  entry({ hash: HASH_SOLO, from: OTHER, account: OTHER, nonce: 9, gasPrice: 5n * GWEI }),
];

const okResult = (pending: PoolEntry[], pendingCount = pending.length): TxPoolResult => ({
  status: 'ok',
  chainId: 1,
  pending,
  pendingCount,
  queuedCount: 0,
  truncated: pendingCount > pending.length,
});

// Exposes the current search string so ?group= writes are observable
// (blocks-list probe pattern).
function SearchProbe() {
  const [searchParams] = useSearchParams();
  return <div data-testid="search-probe">{searchParams.toString()}</div>;
}

const renderPending = (path: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([{ path: '/chain/:chainId/pending', component: () => PendingPage }])}
      initialEntries={[path]}
    >
      <SearchProbe />
      <View />
    </MemoryRouter>,
  );

describe('pendingSearchSchema (?group=)', () => {
  it('keeps an explicit ?group=1 distinguishable from absence', () => {
    expect(pendingSearchSchema.parse({})).toEqual({});
    expect(pendingSearchSchema.parse({ group: '1' })).toEqual({ group: '1' });
  });

  it('degrades every other value to the flat default instead of throwing', () => {
    for (const invalid of ['0', '2', 'true', 'yes', '']) {
      expect(pendingSearchSchema.parse({ group: invalid })).toEqual({});
    }
  });
});

describe('Pending page — analysis strip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePendingTransactions.mockReturnValue({ data: undefined, loading: false });
  });

  it('summarizes counts, conflict groups, cap quartiles and 1559-only tips', async () => {
    mockUsePendingTransactions.mockReturnValue({
      data: okResult(conflictPool()),
      loading: false,
    });

    renderPending('/chain/1/pending');

    // Caps over [5, 10, 30] gwei: min 5, p25 5 (lower-index pick),
    // median 10, max 30. Tips over the single 1559 entry: 2 gwei.
    expect(await screen.findByTestId('pending-analysis')).toHaveTextContent(
      '3 pending · 2 accounts · 1 replaceable conflict · fee caps min 5 · p25 5 · median 10 · max 30 gwei · tips (1559 only) p25 2 · median 2 gwei',
    );
    // The mandatory derivation caveat rides the strip.
    expect(screen.getByTestId('pending-analysis-derivation')).toHaveTextContent(
      'Derived from this node’s current pool snapshot — other nodes may hold a different view.',
    );
  });

  it('says the pool snapshot is empty instead of rendering zero statistics', async () => {
    mockUsePendingTransactions.mockReturnValue({
      data: okResult([]),
      loading: false,
    });

    renderPending('/chain/1/pending');

    expect(await screen.findByTestId('pending-analysis')).toHaveTextContent('Pool snapshot empty');
    expect(screen.getByTestId('pending-analysis-derivation')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // Nothing to group: the toggle disables rather than promising a view.
    expect(screen.getByRole('button', { name: 'Group conflicts' })).toBeDisabled();
  });

  it('discloses in the derivation note when the display cap trimmed the statistics', async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      entry({
        hash: `0x${String(i).padStart(4, '0')}${'ab'.repeat(30)}`,
        nonce: i,
        accountNonce: i,
      }),
    );
    mockUsePendingTransactions.mockReturnValue({
      data: okResult(many.slice(0, 200), 250),
      loading: false,
    });

    renderPending('/chain/1/pending');

    expect(await screen.findByTestId('pending-analysis-derivation')).toHaveTextContent(
      'Derived from this node’s current pool snapshot (first 200 of 250 entries shown) — other nodes may hold a different view.',
    );
  });

  it('renders no analysis strip for the unsupported state (states stay unmasked)', async () => {
    mockUsePendingTransactions.mockReturnValue({
      data: {
        status: 'unsupported',
        chainId: 1,
        message: 'This RPC does not expose the transaction pool (txpool_* is not supported)',
      },
      loading: false,
    });

    renderPending('/chain/1/pending');

    expect(await screen.findByTestId('pending-unsupported')).toBeInTheDocument();
    expect(screen.queryByTestId('pending-analysis')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-analysis-derivation')).not.toBeInTheDocument();
  });
});

describe('Pending page — Replaceable badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('badges every conflict member with the size and the current likely winner', async () => {
    mockUsePendingTransactions.mockReturnValue({
      data: okResult(conflictPool()),
      loading: false,
    });

    renderPending('/chain/1/pending');

    await screen.findByTestId('pending-analysis');

    // Both members of the (from, nonce) collision carry the badge —
    // including the current winner (it is replaceable too).
    const badges = screen.getAllByTestId('pending-replaceable');
    expect(badges).toHaveLength(2);
    const expectedTitle = `2 transactions compete for this sender and nonce — ${shortHash(HASH_WIN)} currently the likely winner`;
    for (const badge of badges) {
      expect(badge).toHaveAttribute('title', expectedTitle);
      expect(within(badge).getByText('Replaceable')).toBeInTheDocument();
    }

    // The unopposed entry carries none.
    const soloRow = screen.getByRole('link', { name: shortHash(HASH_SOLO) }).closest('tr');
    expect(soloRow).not.toBeNull();
    expect(
      within(soloRow as HTMLElement).queryByTestId('pending-replaceable'),
    ).not.toBeInTheDocument();
  });
});

describe('Pending page — grouped view (?group=)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePendingTransactions.mockReturnValue({
      data: okResult(conflictPool()),
      loading: false,
    });
  });

  it('deep link ?group=1 collapses the conflict under a header, winner first', async () => {
    renderPending('/chain/1/pending?group=1');

    await screen.findByTestId('pending-analysis');

    const table = screen.getByRole('table');
    const groupHeaders = within(table).getAllByTestId('pending-conflict-group');
    expect(groupHeaders).toHaveLength(1);
    expect(groupHeaders[0]).toHaveTextContent(/nonce 5/);
    expect(groupHeaders[0]).toHaveTextContent(/2 competing transactions — likely winner first/);
    expect(groupHeaders[0]).toHaveTextContent(
      `${CONFLICT_LOWER.slice(0, 8)}...${CONFLICT_LOWER.slice(-6)}`,
    );

    // Member rows sit under the header, the likely winner (HASH_WIN, the
    // 30-gwei 1559 cap) before the 10-gwei legacy replacement; the solo
    // entry renders flat after the group.
    const rows = within(table).getAllByRole('row');
    const rowIndexOf = (hash: string): number =>
      rows.findIndex(row => within(row).queryByRole('link', { name: shortHash(hash) }));
    const headerIndex = rows.indexOf(groupHeaders[0].closest('tr') as HTMLElement);
    const winIndex = rowIndexOf(HASH_WIN);
    const loseIndex = rowIndexOf(HASH_LOSE);
    const soloIndex = rowIndexOf(HASH_SOLO);
    expect(headerIndex).toBeLessThan(winIndex);
    expect(winIndex).toBeLessThan(loseIndex);
    expect(loseIndex).toBeLessThan(soloIndex);
    // The conflict members are still badged inside the group.
    expect(within(table).getAllByTestId('pending-replaceable')).toHaveLength(2);
  });

  it('renders flat (no group headers) without the param and for invalid values', async () => {
    const { unmount } = renderPending('/chain/1/pending');
    await screen.findByTestId('pending-analysis');
    expect(screen.queryByTestId('pending-conflict-group')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Group conflicts' })).toBeInTheDocument();
    unmount();

    // ?group=0 is not a valid grouped value: the schema's catch degrades
    // it to the flat default instead of throwing during render.
    renderPending('/chain/1/pending?group=0');
    await screen.findByTestId('pending-analysis');
    expect(screen.queryByTestId('pending-conflict-group')).not.toBeInTheDocument();
  });

  it('toggles the param on and off through the URL (shareable, reversible)', async () => {
    renderPending('/chain/1/pending');

    await screen.findByTestId('pending-analysis');
    expect(screen.getByTestId('search-probe')).toHaveTextContent('');

    fireEvent.click(screen.getByRole('button', { name: 'Group conflicts' }));

    expect(await screen.findByTestId('pending-conflict-group')).toBeInTheDocument();
    expect(screen.getByTestId('search-probe')).toHaveTextContent('group=1');
    expect(screen.getByRole('button', { name: 'Flat list' })).toBeInTheDocument();

    // Switching OFF removes the key (an explicit-off must not linger as
    // ?group=0 — the absence-vs-explicit contract). The URL write settles
    // asynchronously (router subscription), so await the un-grouping.
    fireEvent.click(screen.getByRole('button', { name: 'Flat list' }));

    await waitFor(() =>
      expect(screen.queryByTestId('pending-conflict-group')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('search-probe')).toHaveTextContent('');
    expect(screen.getByRole('button', { name: 'Group conflicts' })).toBeInTheDocument();
  });
});

// --- pure display helpers (wording contracts) ---

describe('analysisSummaryText / conflictBadgeTitle (pure)', () => {
  it('pluralizes honestly and names the 1559-only tip scope', () => {
    expect(analysisSummaryText(analyzeMempool(conflictPool()))).toBe(
      '3 pending · 2 accounts · 1 replaceable conflict · fee caps min 5 · p25 5 · median 10 · max 30 gwei · tips (1559 only) p25 2 · median 2 gwei',
    );
  });

  it('returns an empty badge title for unopposed entries', () => {
    const [solo] = analyzeMempool([entry({ hash: HASH_SOLO, nonce: 9 })]).entries;
    expect(conflictBadgeTitle(solo)).toBe('');
  });
});
