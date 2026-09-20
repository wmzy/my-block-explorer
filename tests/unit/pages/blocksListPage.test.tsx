import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, View, createRoutes, useSearchParams } from '@native-router/react';
import '@testing-library/jest-dom';
import BlocksList from '@/views/Blocks/List';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">
      chain:
      {currentChainId}
    </div>
  ),
}));

// CopyableHash still takes plain href strings; stubbed here to keep the
// view test isolated from the shared component internals.
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
    if (chainId === 1) return { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } };
    if (chainId === 11155111)
      return { id: 11155111, name: 'Sepolia', nativeCurrency: { symbol: 'ETH' } };
    return null;
  },
  getChainName: (chainId: number) =>
    chainId === 1 ? 'Ethereum' : chainId === 11155111 ? 'Sepolia' : 'Unknown',
  // Only Sepolia is a testnet in this fixture: the badge case has a
  // mainnet/testnet pair to distinguish.
  getChainType: (chainId: number) => (chainId === 11155111 ? 'testnet' : 'mainnet'),
  // Consumed by the Landing helpers behind UnsupportedChainState.
  isChainSupported: (chainId: number) => chainId === 1 || chainId === 11155111,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
}));

vi.mock('@/utils/format', () => ({
  formatNumber: (n: number) => n.toLocaleString(),
  formatRelativeTime: () => '2 min ago',
}));

type BlocksHookResult = {
  data?: { blocks?: unknown[]; latestBlockNumber?: bigint };
  loading: boolean;
  fetching?: boolean;
  error?: Error;
  refetch?: () => void;
  dataUpdatedAt?: number;
};

const mockUseLatestBlocks = vi.fn<(...args: unknown[]) => BlocksHookResult>();

vi.mock('@/services/chainRpc', () => ({
  useLatestBlocks: (...args: unknown[]) => mockUseLatestBlocks(...args),
}));

// The live-head feed backing the staleness hint (polled service reused
// from the Home view).
type FeedHookResult = { data?: { latestBlockNumber?: bigint }; loading?: boolean };

const mockUseLatestBlocksFeed = vi.fn<(...args: unknown[]) => FeedHookResult>();

vi.mock('@/services/homeFeed', () => ({
  useLatestBlocksFeed: (...args: unknown[]) => mockUseLatestBlocksFeed(...args),
}));

// Finality heads behind the per-row Safe/Finalized badges. Only the polled
// hook is stubbed; the real finalityLabelFor stays in play so the view
// tests pin the genuine boundary semantics, not a mock copy.
type FinalityHookResult = { data?: { safe?: number; finalized?: number } };

const mockUseFinalityHeads = vi.fn<(...args: unknown[]) => FinalityHookResult>();

vi.mock('@/services/blocks', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/blocks')>();
  return {
    ...actual,
    useFinalityHeads: (...args: unknown[]) => mockUseFinalityHeads(...args),
  };
});

const makeBlock = (number: number) => ({
  number: String(number),
  hash: `0xhash${number}`,
  timestamp: '2024-01-01T00:00:00Z',
  miner: '0x1234567890abcdef1234567890abcdef12345678',
  gasUsed: '15000000',
  gasLimit: '30000000',
  transactionCount: 150,
});

// Exposes the current search string so ?page= writes are observable (same
// probe pattern as the transactions list tests).
function SearchProbe() {
  const [searchParams] = useSearchParams();
  return <div data-testid="search-probe">{searchParams.toString()}</div>;
}

const renderBlocksList = (path: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([{ path: '/chain/:chainId/blocks', component: () => BlocksList }])}
      initialEntries={[path]}
    >
      <SearchProbe />
      <View />
    </MemoryRouter>,
  );

describe('BlocksList view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseLatestBlocks.mockReturnValue({ data: undefined, loading: false, error: undefined });
    // No live head beyond the anchor by default: no staleness hint.
    mockUseLatestBlocksFeed.mockReturnValue({ data: undefined });
    // Heads unknown by default: no finality badges unless a case sets them.
    mockUseFinalityHeads.mockReturnValue({ data: undefined });
  });

  it('renders TopNavigation and page header, querying the head page', async () => {
    renderBlocksList('/chain/1/blocks');

    expect(await screen.findByTestId('top-navigation')).toBeInTheDocument();
    expect(screen.getByText('Blocks')).toBeInTheDocument();
    expect(screen.getByText(/Ethereum/)).toBeInTheDocument();
    // Mainnet header carries no testnet badge.
    expect(screen.queryByText('Testnet')).not.toBeInTheDocument();
    // head query (no cursor) — called once per render for page 1
    expect(mockUseLatestBlocks).toHaveBeenCalledWith(1, 20, undefined);
  });

  it('displays loading skeleton while the query is in flight', async () => {
    mockUseLatestBlocks.mockReturnValue({ data: undefined, loading: true, error: undefined });
    renderBlocksList('/chain/1/blocks');
    expect((await screen.findAllByTestId('skeleton')).length).toBeGreaterThan(0);
  });

  it('displays blocks after loading', async () => {
    mockUseLatestBlocks.mockReturnValue({
      data: { blocks: [makeBlock(18000001), makeBlock(18000000)], latestBlockNumber: 18000001n },
      loading: false,
      fetching: false,
      error: undefined,
      dataUpdatedAt: 1,
    });
    renderBlocksList('/chain/1/blocks');

    expect(await screen.findByText('18,000,001')).toBeInTheDocument();
    expect(screen.getByText('18,000,000')).toBeInTheDocument();
    expect(screen.getAllByText('150').length).toBe(2);
    expect(screen.getAllByText(/50.0%/).length).toBe(2);
    expect(screen.getAllByText('2 min ago').length).toBe(2);
    // Links navigate within the app via TypedLink with plain to strings
    expect(screen.getByText('18,000,001').closest('a')?.getAttribute('href')).toBe(
      '/chain/1/block/18000001',
    );
    expect(screen.getAllByText('0x123456...345678').length).toBe(2);
  });

  it('displays error state when the query fails', async () => {
    mockUseLatestBlocks.mockReturnValue({
      data: undefined,
      loading: false,
      error: new Error('Failed to get blocks'),
      refetch: vi.fn(),
    });
    renderBlocksList('/chain/1/blocks');

    expect(await screen.findByText(/Failed to get blocks/)).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('shows empty state when the head page is empty', async () => {
    mockUseLatestBlocks.mockReturnValue({
      data: { blocks: [], latestBlockNumber: 18000001n },
      loading: false,
      fetching: false,
      error: undefined,
      dataUpdatedAt: 1,
    });
    renderBlocksList('/chain/1/blocks');

    // Proper empty state (info alert), not a loading placeholder.
    expect(await screen.findByText('No blocks found')).toBeInTheDocument();
  });

  it('renders the unsupported-chain state with recovery CTAs for an invalid chain', async () => {
    renderBlocksList('/chain/999/blocks');

    // Explicit state naming the requested id — not a silent redirect to
    // some other chain.
    expect(await screen.findByText(/Chain not supported/)).toBeInTheDocument();
    expect(screen.getByText(/chain ID 999/)).toBeInTheDocument();
    expect(screen.queryByText(/Unsupported chain ID/)).not.toBeInTheDocument();
    // Recovery: a deterministic preferred-chain destination plus the
    // landing route (chain list entry).
    expect(screen.getByRole('link', { name: 'Go to Mainnet' })).toHaveAttribute('href', '/chain/1');
    expect(screen.getByRole('link', { name: 'Open chain list' })).toHaveAttribute('href', '/');
  });

  it('paginates via the beforeBlock cursor computed from the head page, with ?page= in the URL', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => makeBlock(18000001 - i));
    mockUseLatestBlocks.mockReturnValue({
      data: { blocks: twenty, latestBlockNumber: 18000001n },
      loading: false,
      fetching: false,
      error: undefined,
      dataUpdatedAt: 1,
    });
    renderBlocksList('/chain/1/blocks');

    expect(await screen.findByText(/Page 1/)).toBeInTheDocument();
    expect(screen.getByText('Newer')).toBeDisabled();
    expect(screen.getByText('Older')).not.toBeDisabled();
    expect(screen.getByTestId('search-probe').textContent).toBe('');

    fireEvent.click(screen.getByText('Older'));
    // page 2 cursor: 18000001 - 20 + 1 — and the page index now round-trips
    // through the URL, so the page-2 render lands asynchronously.
    await waitFor(() => expect(mockUseLatestBlocks).toHaveBeenLastCalledWith(1, 20, 17999982n));
    await waitFor(() => expect(screen.getByTestId('search-probe').textContent).toBe('page=2'));
    expect(await screen.findByText(/Page 2/)).toBeInTheDocument();

    // Back navigation mirrors forward: the URL steps back to page 1.
    fireEvent.click(screen.getByText('Newer'));
    await waitFor(() => expect(screen.getByTestId('search-probe').textContent).toBe('page=1'));
  });

  it('renders a ?page=2 deep link at page 2 without walking there first', async () => {
    mockUseLatestBlocks.mockReturnValue({
      data: {
        blocks: Array.from({ length: 20 }, (_, i) => makeBlock(17999981 - i)),
        latestBlockNumber: 18000001n,
      },
      loading: false,
      fetching: false,
      error: undefined,
      dataUpdatedAt: 1,
    });
    renderBlocksList('/chain/1/blocks?page=2');

    // The URL page governs from the first paint (shareable/refreshable):
    // the anchor adopts from the head answer and page 2's cursor is
    // derived directly from it.
    expect(await screen.findByText(/Page 2/)).toBeInTheDocument();
    await waitFor(() => expect(mockUseLatestBlocks).toHaveBeenLastCalledWith(1, 20, 17999982n));
    expect(screen.getByTestId('search-probe').textContent).toBe('page=2');
  });

  it('freezes the pagination anchor while the head advances; Refresh re-anchors', async () => {
    // The head answer moves between renders: the walk must keep paging from
    // the head frozen at first load until the Refresh control re-anchors.
    let head = 18000001n;
    let tick = 1;
    const refetch = vi.fn();
    mockUseLatestBlocks.mockImplementation(() => ({
      data: {
        blocks: Array.from({ length: 20 }, (_, i) => makeBlock(Number(head) - i)),
        latestBlockNumber: head,
      },
      loading: false,
      fetching: false,
      error: undefined,
      refetch,
      dataUpdatedAt: tick,
    }));
    renderBlocksList('/chain/1/blocks');

    expect(await screen.findByText(/Page 1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '↻ Refresh' })).toBeInTheDocument();

    // Chain advanced by 10 blocks; paging to 2 must still use the frozen
    // anchor (18000001), not the live head (18000011).
    head = 18000011n;
    tick = 2;
    fireEvent.click(screen.getByText('Older'));
    await waitFor(() => expect(mockUseLatestBlocks).toHaveBeenLastCalledWith(1, 20, 17999982n));

    // Refresh re-anchors at the live head: page 1 cursor becomes
    // 18000011 + 1.
    tick = 3;
    fireEvent.click(screen.getByRole('button', { name: '↻ Refresh' }));
    await waitFor(() => expect(mockUseLatestBlocks).toHaveBeenLastCalledWith(1, 20, 18000012n));
    expect(refetch).toHaveBeenCalled();
    expect(await screen.findByText(/Page 1/)).toBeInTheDocument();
  });

  it('shows a Testnet badge in the header for a testnet chain', async () => {
    mockUseLatestBlocks.mockReturnValue({
      data: { blocks: [makeBlock(1)], latestBlockNumber: 1n },
      loading: false,
      fetching: false,
      error: undefined,
      dataUpdatedAt: 1,
    });
    renderBlocksList('/chain/11155111/blocks');

    expect(await screen.findByText('Testnet')).toBeInTheDocument();
    expect(screen.getByText(/Sepolia/)).toBeInTheDocument();
  });

  it('flags stale data when the polled live head passes the frozen anchor', async () => {
    let head = 18000001n;
    let tick = 1;
    const refetch = vi.fn();
    mockUseLatestBlocks.mockImplementation(() => ({
      data: {
        blocks: Array.from({ length: 20 }, (_, i) => makeBlock(Number(head) - i)),
        latestBlockNumber: head,
      },
      loading: false,
      fetching: false,
      error: undefined,
      refetch,
      dataUpdatedAt: tick,
    }));
    // The polled feed reports a head 10 blocks beyond the frozen anchor.
    mockUseLatestBlocksFeed.mockReturnValue({ data: { latestBlockNumber: 18000011n } });
    renderBlocksList('/chain/1/blocks');

    // The hint names the drift; the footer keeps reporting the anchor, so
    // together they no longer claim the frozen head is "latest" silently.
    expect(await screen.findByText(/10 new blocks/)).toBeInTheDocument();
    expect(screen.getByText(/Latest block: 18,000,001/)).toBeInTheDocument();

    // The hint's Refresh is the same re-anchor control: the head entry
    // refetches, the newer answer is adopted and the hint clears.
    head = 18000011n;
    tick = 2;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/Latest block: 18,000,011/)).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText(/new blocks/)).not.toBeInTheDocument());
  });

  it('renders no staleness hint while the live head matches the anchor', async () => {
    mockUseLatestBlocks.mockReturnValue({
      data: { blocks: [makeBlock(100)], latestBlockNumber: 100n },
      loading: false,
      fetching: false,
      error: undefined,
      dataUpdatedAt: 1,
    });
    mockUseLatestBlocksFeed.mockReturnValue({ data: { latestBlockNumber: 100n } });
    renderBlocksList('/chain/1/blocks');

    expect(await screen.findByText('100')).toBeInTheDocument();
    expect(screen.queryByText(/new blocks/)).not.toBeInTheDocument();
  });

  it('disables Older with a Reached genesis note when the page ends at block 0', async () => {
    // A full LIMIT-row page whose oldest row IS genesis: the old
    // length-only hasNext would offer a next page that can only be empty.
    mockUseLatestBlocks.mockReturnValue({
      data: {
        blocks: Array.from({ length: 20 }, (_, i) => makeBlock(19 - i)),
        latestBlockNumber: 19n,
      },
      loading: false,
      fetching: false,
      error: undefined,
      dataUpdatedAt: 1,
    });
    renderBlocksList('/chain/1/blocks');

    expect(await screen.findByText(/Reached genesis/)).toBeInTheDocument();
    expect(screen.getByText('Older')).toBeDisabled();
    // Page 1: Newer is disabled as always.
    expect(screen.getByText('Newer')).toBeDisabled();
  });

  it('keeps Older enabled just above genesis and walks onto the genesis row page', async () => {
    // Blocks 25..6 fill page 1 (oldest is 6 > 0): Older stays enabled and
    // page 2's cursor is the oldest fetched block (6).
    mockUseLatestBlocks.mockImplementation((...args: unknown[]) => {
      const beforeBlock = args[2] as bigint | undefined;
      const top = beforeBlock === undefined ? 25n : beforeBlock - 1n;
      const numbers = Array.from({ length: 20 }, (_, i) => Number(top) - i).filter(n => n >= 0);
      return {
        data: { blocks: numbers.map(makeBlock), latestBlockNumber: 25n },
        loading: false,
        fetching: false,
        error: undefined,
        dataUpdatedAt: 1,
      };
    });
    renderBlocksList('/chain/1/blocks');

    expect(await screen.findByText(/Page 1/)).toBeInTheDocument();
    expect(screen.getByText('Older')).not.toBeDisabled();
    fireEvent.click(screen.getByText('Older'));

    // Page 2 covers blocks 5..0 and stops at genesis: no further page.
    await waitFor(() => expect(screen.getByText(/Reached genesis/)).toBeInTheDocument());
    expect(screen.getByText('Older')).toBeDisabled();
    expect(mockUseLatestBlocks).toHaveBeenLastCalledWith(1, 20, 6n);
  });

  // Finality badges: each row compares its block number against the polled
  // safe/finalized heads. The pinned contract: unknown heads (hook still
  // loading, fetch failed, or neither tag supported) render NO badge —
  // absence of data is never presented as "pending" — and once heads are
  // known, Finalized (block <= finalized) wins over Safe (block <= safe).
  it('renders no finality badges while the heads are unknown', async () => {
    const blocksData = {
      data: {
        blocks: [makeBlock(18000001), makeBlock(18000000)],
        latestBlockNumber: 18000001n,
      },
      loading: false,
      fetching: false,
      error: undefined,
      dataUpdatedAt: 1,
    };

    // Hook still loading: data undefined.
    mockUseLatestBlocks.mockReturnValue(blocksData);
    mockUseFinalityHeads.mockReturnValue({ data: undefined });
    const stillLoading = renderBlocksList('/chain/1/blocks');
    expect(await stillLoading.findByText('18,000,001')).toBeInTheDocument();
    expect(stillLoading.queryByText('Safe')).not.toBeInTheDocument();
    expect(stillLoading.queryByText('Finalized')).not.toBeInTheDocument();
    stillLoading.unmount();

    // Fetch answered but the node supports neither tag: heads = {}.
    mockUseFinalityHeads.mockReturnValue({ data: {} });
    const noTags = renderBlocksList('/chain/1/blocks');
    expect(await noTags.findByText('18,000,001')).toBeInTheDocument();
    expect(noTags.queryByText('Safe')).not.toBeInTheDocument();
    expect(noTags.queryByText('Finalized')).not.toBeInTheDocument();
  });

  it('labels rows Finalized/Safe from the known heads with both boundaries pinned', async () => {
    // finalized = M = 17,999,998 and safe = N = 17,999,999:
    // blocks <= M are 'Finalized', blocks in (M, N] are 'Safe', blocks > N
    // show neither. The row set pins every boundary: == M is 'Finalized'
    // (not 'Safe'), == N is 'Safe', and > N gets no badge.
    mockUseFinalityHeads.mockReturnValue({ data: { safe: 17_999_999, finalized: 17_999_998 } });
    mockUseLatestBlocks.mockReturnValue({
      data: {
        blocks: [
          makeBlock(18_000_000), // > N
          makeBlock(17_999_999), // == N
          makeBlock(17_999_998), // == M
          makeBlock(17_999_997), // < M
        ],
        latestBlockNumber: 18_000_000n,
      },
      loading: false,
      fetching: false,
      error: undefined,
      dataUpdatedAt: 1,
    });
    renderBlocksList('/chain/1/blocks');

    expect(await screen.findByText('17,999,997')).toBeInTheDocument();
    // The badge rides the block-number cell, so scoping to the row pins
    // which number earned which label.
    const rowOf = (label: string) => screen.getByText(label).closest('tr');
    expect(within(rowOf('18,000,000') as HTMLElement).queryByText('Safe')).not.toBeInTheDocument();
    expect(
      within(rowOf('18,000,000') as HTMLElement).queryByText('Finalized'),
    ).not.toBeInTheDocument();
    expect(within(rowOf('17,999,999') as HTMLElement).getByText('Safe')).toBeInTheDocument();
    expect(
      within(rowOf('17,999,999') as HTMLElement).queryByText('Finalized'),
    ).not.toBeInTheDocument();
    expect(within(rowOf('17,999,998') as HTMLElement).getByText('Finalized')).toBeInTheDocument();
    expect(within(rowOf('17,999,997') as HTMLElement).getByText('Finalized')).toBeInTheDocument();
  });
});
