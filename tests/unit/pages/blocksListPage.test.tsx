import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
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
    return null;
  },
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Unknown'),
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

const makeBlock = (number: number) => ({
  number: String(number),
  hash: `0xhash${number}`,
  timestamp: '2024-01-01T00:00:00Z',
  miner: '0x1234567890abcdef1234567890abcdef12345678',
  gasUsed: '15000000',
  gasLimit: '30000000',
  transactionCount: 150,
});

const renderBlocksList = (path: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([{ path: '/chain/:chainId/blocks', component: () => BlocksList }])}
      initialEntries={[path]}
    >
      <View />
    </MemoryRouter>,
  );

describe('BlocksList view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseLatestBlocks.mockReturnValue({ data: undefined, loading: false, error: undefined });
  });

  it('renders TopNavigation and page header, querying the head page', async () => {
    renderBlocksList('/chain/1/blocks');

    expect(await screen.findByTestId('top-navigation')).toBeInTheDocument();
    expect(screen.getByText('Blocks')).toBeInTheDocument();
    expect(screen.getByText(/Ethereum/)).toBeInTheDocument();
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

  it('shows unsupported chain error for invalid chain', async () => {
    renderBlocksList('/chain/999/blocks');
    expect(await screen.findByText(/Unsupported chain ID/)).toBeInTheDocument();
  });

  it('paginates via the beforeBlock cursor computed from the head page', async () => {
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

    fireEvent.click(screen.getByText('Older'));
    // page 2 cursor: 18000001 - 20 + 1
    expect(mockUseLatestBlocks).toHaveBeenLastCalledWith(1, 20, 17999982n);
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
    await waitFor(() =>
      expect(mockUseLatestBlocks).toHaveBeenLastCalledWith(1, 20, 17999982n),
    );

    // Refresh re-anchors at the live head: page 1 cursor becomes
    // 18000011 + 1.
    tick = 3;
    fireEvent.click(screen.getByRole('button', { name: '↻ Refresh' }));
    await waitFor(() =>
      expect(mockUseLatestBlocks).toHaveBeenLastCalledWith(1, 20, 18000012n),
    );
    expect(refetch).toHaveBeenCalled();
    expect(await screen.findByText(/Page 1/)).toBeInTheDocument();
  });
});
