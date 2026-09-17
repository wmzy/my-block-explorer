// Block detail view tests: the error-path fork added for future block
// numbers. The service hook and the RPC client factory are mocked, so the
// cases pin which presentation the view picks when the block fetch fails:
// "does not exist yet" guidance (with escape links) only when the requested
// number is beyond the chain head, the genuine error UI otherwise, and no
// extra RPC call on the happy path.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';
import BlockDetail from '@/views/Blocks/Detail';

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
  formatRelativeTime: () => '2 min ago',
}));

type BlockHookResult = {
  data?: {
    number: string;
    hash: string;
    parentHash: string;
    timestamp: string;
    miner: string;
    gasUsed: string;
    gasLimit: string;
    baseFeePerGas?: string;
    transactionCount: number;
    sizeBytes?: number;
  };
  loading: boolean;
  error?: Error;
};

const { mockUseBlockByNumber, mockGetBlockNumber } = vi.hoisted(() => ({
  mockUseBlockByNumber: vi.fn<(...args: unknown[]) => BlockHookResult>(),
  mockGetBlockNumber: vi.fn<() => Promise<bigint>>(),
}));

vi.mock('@/services/chainRpc', () => ({
  useBlockByNumber: (...args: unknown[]) => mockUseBlockByNumber(...args),
}));

// The view's head lookup goes through the shared RPC client factory; the
// mock keeps the one eth_blockNumber call observable without a network.
vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: async () => ({ getBlockNumber: mockGetBlockNumber }),
}));

const makeBlock = (number: number) => ({
  number: String(number),
  hash: `0xhash${number}`,
  parentHash: `0xparent${number}`,
  timestamp: '2024-01-01T00:00:00Z',
  miner: '0x1234567890abcdef1234567890abcdef12345678',
  gasUsed: '15000000',
  gasLimit: '30000000',
  transactionCount: 150,
  sizeBytes: 45_678,
});

const ZERO_PARENT_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

const renderBlockDetail = (path: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([
        { path: '/chain/:chainId/block/:blockNumber', component: () => BlockDetail },
      ])}
      initialEntries={[path]}
    >
      <View />
    </MemoryRouter>,
  );

describe('BlockDetail view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBlockByNumber.mockReturnValue({
      data: undefined,
      loading: false,
      error: undefined,
    });
  });

  it('renders block details and pays nothing for the head lookup', async () => {
    mockUseBlockByNumber.mockReturnValue({
      data: makeBlock(18000001),
      loading: false,
      error: undefined,
    });
    renderBlockDetail('/chain/1/block/18000001');

    expect(await screen.findByText('Block Details')).toBeInTheDocument();
    expect(screen.getByText('18,000,001')).toBeInTheDocument();
    expect(screen.getByText(/View 150 Transactions/)).toBeInTheDocument();
    // Hash rows are copyable/navigable instead of plain text: the block
    // hash is copy-only (the route is by number), the parent hash links to
    // block N-1, and the miner links to its address page.
    expect(screen.getByText('0xhash18000001').closest('a')).toBeNull();
    expect(screen.getByText('0xparent18000001').closest('a')?.getAttribute('href')).toBe(
      '/chain/1/block/18000000',
    );
    expect(
      screen
        .getByText('0x1234567890abcdef1234567890abcdef12345678')
        .closest('a')
        ?.getAttribute('href'),
    ).toBe('/chain/1/address/0x1234567890abcdef1234567890abcdef12345678');
    // Happy path: the error-only head lookup never fires.
    expect(mockGetBlockNumber).not.toHaveBeenCalled();
  });

  it('renders the genesis parent hash copy-only with no parent link', async () => {
    mockUseBlockByNumber.mockReturnValue({
      data: { ...makeBlock(0), parentHash: ZERO_PARENT_HASH },
      loading: false,
      error: undefined,
    });
    renderBlockDetail('/chain/1/block/0');

    expect(await screen.findByText('Block Details')).toBeInTheDocument();
    // Genesis has no parent block to visit: the zero parent hash stays
    // copyable-only while the miner keeps its address link.
    expect(screen.getByText(ZERO_PARENT_HASH).closest('a')).toBeNull();
    expect(
      screen
        .getByText('0x1234567890abcdef1234567890abcdef12345678')
        .closest('a')
        ?.getAttribute('href'),
    ).toBe('/chain/1/address/0x1234567890abcdef1234567890abcdef12345678');
    expect(mockGetBlockNumber).not.toHaveBeenCalled();
  });

  it('shows the not-yet state with escape links for a block beyond the head', async () => {
    mockUseBlockByNumber.mockReturnValue({
      data: undefined,
      loading: false,
      error: new Error('Header not found'),
    });
    mockGetBlockNumber.mockResolvedValue(123n);
    renderBlockDetail('/chain/1/block/999999999');

    expect(await screen.findByText(/does not exist yet/)).toBeInTheDocument();
    expect(screen.getByText(/The chain is currently at block 123\./)).toBeInTheDocument();
    expect(screen.getByText('View latest block').closest('a')?.getAttribute('href')).toBe(
      '/chain/1/block/123',
    );
    expect(screen.getByText('View blocks list').closest('a')?.getAttribute('href')).toBe(
      '/chain/1/blocks',
    );
    // The raw RPC error is replaced by the guidance, not shown beside it.
    expect(screen.queryByText(/Header not found/)).not.toBeInTheDocument();
  });

  it('keeps the genuine error UI when the requested block is within the chain', async () => {
    mockUseBlockByNumber.mockReturnValue({
      data: undefined,
      loading: false,
      error: new Error('Header not found'),
    });
    // Head far above the requested number: a missing block, not a future
    // one — the raw error stays.
    mockGetBlockNumber.mockResolvedValue(1_000_000_000_000n);
    renderBlockDetail('/chain/1/block/999999999');

    expect(await screen.findByText(/Header not found/)).toBeInTheDocument();
    expect(screen.queryByText(/does not exist yet/)).not.toBeInTheDocument();
  });

  it('keeps the genuine error UI when the head lookup itself fails', async () => {
    mockUseBlockByNumber.mockReturnValue({
      data: undefined,
      loading: false,
      error: new Error('Header not found'),
    });
    mockGetBlockNumber.mockRejectedValue(new Error('rpc down'));
    renderBlockDetail('/chain/1/block/999999999');

    expect(await screen.findByText(/Header not found/)).toBeInTheDocument();
    expect(screen.queryByText(/does not exist yet/)).not.toBeInTheDocument();
  });
});
