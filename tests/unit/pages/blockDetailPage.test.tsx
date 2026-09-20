// Block detail view tests: the error-path fork added for future block
// numbers, plus the header finality badge. The service hook and the RPC
// client factory are mocked, so the error cases pin which presentation the
// view picks when the block fetch fails: "does not exist yet" guidance
// (with escape links) only when the requested number is beyond the chain
// head, the genuine error UI otherwise, and no extra RPC call on the happy
// path. The finality cases pin that the badge compares the viewed number
// against the polled heads and renders nothing while those are unknown.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';
import BlockDetail from '@/views/Blocks/Detail';

vi.mock('@/components/TopNavigation', () => ({
  // Clicking the nav invokes onChainChange — the vehicle for the
  // chain-switch test (Sepolia is the configured second chain).
  default: ({
    currentChainId,
    onChainChange,
  }: {
    currentChainId: number;
    onChainChange?: (chainId: number) => void;
  }) => (
    <div
      data-testid="top-navigation"
      data-chain-id={currentChainId}
      onClick={() => onChainChange?.(11155111)}
    >
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
    chainId === 1 ? 'Ethereum' : chainId === 11155111 ? 'Sepolia' : chainId === 137 ? 'Polygon' : 'Unknown',
  // Only Sepolia is a testnet in this fixture.
  getChainType: (chainId: number) => (chainId === 11155111 ? 'testnet' : 'mainnet'),
  // Consumed by the Burnt Fees / withdrawals rows.
  getChainSymbol: () => 'ETH',
  // Consumed by the Landing helpers behind UnsupportedChainState.
  isChainSupported: (chainId: number) => chainId === 1 || chainId === 11155111,
  // In-card recovery links rendered by UnsupportedChainState.
  POPULAR_CHAINS: [
    { id: 1, name: 'Ethereum' },
    { id: 137, name: 'Polygon' },
  ],
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
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
    blobGasUsed?: string;
    excessBlobGas?: string;
    withdrawals?: {
      index: string;
      validatorIndex: string;
      address: string;
      amount: string;
    }[];
  };
  loading: boolean;
  error?: Error;
  refetch?: () => void | Promise<unknown>;
};

const { mockUseBlockByNumber, mockGetBlockNumber, mockRefetchBlock } = vi.hoisted(() => ({
  mockUseBlockByNumber: vi.fn<(...args: unknown[]) => BlockHookResult>(),
  mockGetBlockNumber: vi.fn<() => Promise<bigint>>(),
  mockRefetchBlock: vi.fn<() => void | Promise<unknown>>(),
}));

vi.mock('@/services/chainRpc', () => ({
  useBlockByNumber: (...args: unknown[]) => mockUseBlockByNumber(...args),
}));

// The header Safe/Finalized badge's heads come from the finality service's
// polled hook, stubbed here (its RPC tag lookups would otherwise go through
// the mocked createRpcClient). The pure finalityLabelFor stays real so the
// cases pin the genuine boundary semantics.
type FinalityHookResult = { data?: { safe?: number; finalized?: number } };

const { mockUseFinalityHeads } = vi.hoisted(() => ({
  mockUseFinalityHeads: vi.fn<(...args: unknown[]) => FinalityHookResult>(),
}));

vi.mock('@/services/blocks', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/blocks')>();
  return {
    ...actual,
    useFinalityHeads: (...args: unknown[]) => mockUseFinalityHeads(...args),
  };
});

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

// Landing markers for the navigation tests: the new chain's home route and
// the blocks list route (the back button's fallback).
const ChainHomeStub = () => <div data-testid="chain-home" />;
const BlocksListStub = () => <div data-testid="blocks-list" />;

const renderBlockDetail = (path: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([
        { path: '/chain/:chainId/block/:blockNumber', component: () => BlockDetail },
        { path: '/chain/:chainId', component: () => ChainHomeStub },
        { path: '/chain/:chainId/blocks', component: () => BlocksListStub },
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
      refetch: mockRefetchBlock,
    });
    // Heads unknown by default: no finality badge unless a case sets heads.
    mockUseFinalityHeads.mockReturnValue({ data: undefined });
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
      refetch: mockRefetchBlock,
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
      refetch: mockRefetchBlock,
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
      refetch: mockRefetchBlock,
    });
    mockGetBlockNumber.mockRejectedValue(new Error('rpc down'));
    renderBlockDetail('/chain/1/block/999999999');

    expect(await screen.findByText(/Header not found/)).toBeInTheDocument();
    expect(screen.queryByText(/does not exist yet/)).not.toBeInTheDocument();
  });

  it('renders Burnt Fees as baseFeePerGas × gasUsed in native units', async () => {
    mockUseBlockByNumber.mockReturnValue({
      // 20 gwei × 15,000,000 gas = 0.3 ETH.
      data: { ...makeBlock(19_500_002), baseFeePerGas: '20000000000' },
      loading: false,
      error: undefined,
    });
    renderBlockDetail('/chain/1/block/19500002');

    expect(await screen.findByText('Block Details')).toBeInTheDocument();
    expect(screen.getByText('Burnt Fees')).toBeInTheDocument();
    expect(screen.getByText('0.3 ETH')).toBeInTheDocument();
    // No blob gas on the RPC payload: neither blob row renders.
    expect(screen.queryByText('Blob Gas Used')).not.toBeInTheDocument();
    expect(screen.queryByText('Excess Blob Gas')).not.toBeInTheDocument();
  });

  it('renders blob gas rows with the blob count when present', async () => {
    mockUseBlockByNumber.mockReturnValue({
      data: {
        ...makeBlock(19_500_002),
        blobGasUsed: '393216', // exactly 3 blobs (131,072 gas each)
        excessBlobGas: '720896',
      },
      loading: false,
      error: undefined,
    });
    renderBlockDetail('/chain/1/block/19500002');

    expect(await screen.findByText('Block Details')).toBeInTheDocument();
    expect(screen.getByText('393,216 (3 blobs)')).toBeInTheDocument();
    expect(screen.getByText('Excess Blob Gas')).toBeInTheDocument();
    expect(screen.getByText('720,896')).toBeInTheDocument();
    // No baseFeePerGas: the burnt-fees row stays out entirely.
    expect(screen.queryByText('Burnt Fees')).not.toBeInTheDocument();
  });

  it('renders no fee/blob/withdrawal rows for a block without those fields', async () => {
    mockUseBlockByNumber.mockReturnValue({
      data: makeBlock(19_500_002),
      loading: false,
      error: undefined,
    });
    renderBlockDetail('/chain/1/block/19500002');

    expect(await screen.findByText('Block Details')).toBeInTheDocument();
    expect(screen.queryByText('Burnt Fees')).not.toBeInTheDocument();
    expect(screen.queryByText('Blob Gas Used')).not.toBeInTheDocument();
    expect(screen.queryByText('Excess Blob Gas')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Withdrawals \(/)).not.toBeInTheDocument();
  });

  it('shows withdrawals collapsed by default and expands to navigable rows', async () => {
    mockUseBlockByNumber.mockReturnValue({
      data: {
        ...makeBlock(19_500_002),
        withdrawals: [
          {
            index: '0',
            validatorIndex: '1234567',
            address: '0x1111111111111111111111111111111111111111',
            amount: '1159655', // gwei → 0.001159655 ETH
          },
          {
            index: '1',
            validatorIndex: '7654321',
            address: '0x2222222222222222222222222222222222222222',
            amount: '1000000000', // exactly 1 ETH
          },
        ],
      },
      loading: false,
      error: undefined,
    });
    renderBlockDetail('/chain/1/block/19500002');

    expect(await screen.findByText('Withdrawals (2)')).toBeInTheDocument();

    // Collapsed by default: rows exist but stay hidden from assistive tech.
    const firstRow = screen.getByText('0x1111111111111111111111111111111111111111');
    expect(firstRow.closest('[aria-hidden="true"]')).not.toBeNull();

    // Expand via the header toggle.
    fireEvent.click(screen.getByRole('button', { name: /Withdrawals \(2\)/ }));
    expect(firstRow.closest('[aria-hidden="false"]')).not.toBeNull();

    // Each row: grouped validator index, linked address, exact ETH amount.
    expect(screen.getByText('1,234,567')).toBeInTheDocument();
    expect(screen.getByText('7,654,321')).toBeInTheDocument();
    expect(
      screen
        .getByText('0x1111111111111111111111111111111111111111')
        .closest('a')
        ?.getAttribute('href'),
    ).toBe('/chain/1/address/0x1111111111111111111111111111111111111111');
    expect(screen.getByText('0.001159655 ETH')).toBeInTheDocument();
    expect(screen.getByText('1 ETH')).toBeInTheDocument();
  });

  it('refreshes the future-block hint from the 4 s head poll without refetching', async () => {
    vi.useFakeTimers();
    try {
      mockUseBlockByNumber.mockReturnValue({
        data: undefined,
        loading: false,
        error: new Error('Header not found'),
        refetch: mockRefetchBlock,
      });
      mockGetBlockNumber.mockResolvedValue(123n);
      renderBlockDetail('/chain/1/block/999999999');
      // Settle the one-shot head probe's promise chain (fake timers do not
      // flush bare microtasks on their own).
      await act(async () => {});

      expect(screen.getByText(/does not exist yet/)).toBeInTheDocument();
      expect(screen.getByText(/currently at block 123\./)).toBeInTheDocument();

      // The head advances but stays below the request: the hint updates
      // and the block fetch is NOT retried (it cannot exist yet).
      mockGetBlockNumber.mockResolvedValue(456n);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      expect(screen.getByText(/currently at block 456\./)).toBeInTheDocument();
      expect(mockRefetchBlock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refetches the block once the polled head reaches it, then stops polling', async () => {
    vi.useFakeTimers();
    try {
      mockUseBlockByNumber.mockReturnValue({
        data: undefined,
        loading: false,
        error: new Error('Header not found'),
        refetch: mockRefetchBlock,
      });
      mockGetBlockNumber.mockResolvedValue(123n);
      renderBlockDetail('/chain/1/block/999999999');
      await act(async () => {});
      expect(screen.getByText(/does not exist yet/)).toBeInTheDocument();

      // The chain mines up to the requested number: the tick refetches the
      // block detail (the mocked hook keeps erroring, so the view then
      // honestly falls back to the RPC error — the data flow is what is
      // pinned here).
      mockGetBlockNumber.mockResolvedValue(999_999_999n);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      expect(mockRefetchBlock).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Header not found/)).toBeInTheDocument();

      // Polling ended with the future state: further ticks must not fire.
      const callsAfterCatchUp = mockGetBlockNumber.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(12_000);
      });
      expect(mockGetBlockNumber.mock.calls.length).toBe(callsAfterCatchUp);
      expect(mockRefetchBlock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the automatic head polling after the ~5 minute budget', async () => {
    vi.useFakeTimers();
    try {
      mockUseBlockByNumber.mockReturnValue({
        data: undefined,
        loading: false,
        error: new Error('Header not found'),
        refetch: mockRefetchBlock,
      });
      mockGetBlockNumber.mockResolvedValue(123n);
      renderBlockDetail('/chain/1/block/999999999');
      await act(async () => {});
      expect(screen.getByText(/does not exist yet/)).toBeInTheDocument();

      // ~5 minutes of 4 s ticks: the budget latch flips and the interval
      // is torn down.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60_000);
      });
      expect(screen.getByText(/Automatic checking stopped/)).toBeInTheDocument();

      const callsAfterBudget = mockGetBlockNumber.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(12_000);
      });
      expect(mockGetBlockNumber.mock.calls.length).toBe(callsAfterBudget);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-probes the head and retries the block fetch on Check again', async () => {
    vi.useFakeTimers();
    try {
      mockUseBlockByNumber.mockReturnValue({
        data: undefined,
        loading: false,
        error: new Error('Header not found'),
        refetch: mockRefetchBlock,
      });
      mockGetBlockNumber.mockResolvedValue(123n);
      renderBlockDetail('/chain/1/block/999999999');
      await act(async () => {});
      expect(screen.getByText(/does not exist yet/)).toBeInTheDocument();

      const headCallsBefore = mockGetBlockNumber.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
      // The click itself retries the block fetch…
      expect(mockRefetchBlock).toHaveBeenCalledTimes(1);
      // …and arms exactly one fresh head probe (the nonce effect).
      await act(async () => {});
      expect(mockGetBlockNumber.mock.calls.length).toBe(headCallsBefore + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tears the head polling interval down on unmount', async () => {
    vi.useFakeTimers();
    try {
      mockUseBlockByNumber.mockReturnValue({
        data: undefined,
        loading: false,
        error: new Error('Header not found'),
        refetch: mockRefetchBlock,
      });
      mockGetBlockNumber.mockResolvedValue(123n);
      const view = renderBlockDetail('/chain/1/block/999999999');
      await act(async () => {});
      expect(screen.getByText(/does not exist yet/)).toBeInTheDocument();

      view.unmount();
      const callsAtUnmount = mockGetBlockNumber.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16_000);
      });
      expect(mockGetBlockNumber.mock.calls.length).toBe(callsAtUnmount);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a Finalized badge in the header for a block at or past the finalized head', async () => {
    // Block == finalized (boundary): 'Finalized' wins over 'Safe' even
    // though the safe head covers it too.
    mockUseBlockByNumber.mockReturnValue({
      data: makeBlock(17_999_998),
      loading: false,
      error: undefined,
    });
    mockUseFinalityHeads.mockReturnValue({
      data: { safe: 17_999_999, finalized: 17_999_998 },
    });
    renderBlockDetail('/chain/1/block/17999998');

    expect(await screen.findByText('Finalized')).toBeInTheDocument();
    expect(screen.queryByText('Safe')).not.toBeInTheDocument();
  });

  it('shows a Safe badge in the header for a block past finalized but within safe', async () => {
    // finalized < block <= safe (block == safe here, the boundary): 'Safe'
    // only — it is beyond the finalized head.
    mockUseBlockByNumber.mockReturnValue({
      data: makeBlock(17_999_999),
      loading: false,
      error: undefined,
    });
    mockUseFinalityHeads.mockReturnValue({
      data: { safe: 17_999_999, finalized: 17_999_998 },
    });
    renderBlockDetail('/chain/1/block/17999999');

    expect(await screen.findByText('Safe')).toBeInTheDocument();
    expect(screen.queryByText('Finalized')).not.toBeInTheDocument();
  });

  it('renders no finality badge while the heads are unknown or beyond safe', async () => {
    const beyondSafe = {
      data: makeBlock(18_000_000),
      loading: false,
      error: undefined,
    };

    // Hook still loading: no badge — absence of head data is not "pending".
    mockUseBlockByNumber.mockReturnValue(beyondSafe);
    mockUseFinalityHeads.mockReturnValue({ data: undefined });
    const stillLoading = renderBlockDetail('/chain/1/block/18000000');
    expect(await stillLoading.findByText('Block Details')).toBeInTheDocument();
    expect(stillLoading.queryByText('Safe')).not.toBeInTheDocument();
    expect(stillLoading.queryByText('Finalized')).not.toBeInTheDocument();
    stillLoading.unmount();

    // Fetch answered but neither tag supported: heads = {} still earns
    // nothing.
    mockUseFinalityHeads.mockReturnValue({ data: {} });
    const noTags = renderBlockDetail('/chain/1/block/18000000');
    expect(await noTags.findByText('Block Details')).toBeInTheDocument();
    expect(noTags.queryByText('Safe')).not.toBeInTheDocument();
    expect(noTags.queryByText('Finalized')).not.toBeInTheDocument();
    noTags.unmount();

    // Heads known but the block is beyond safe: known-unknown — the block
    // is genuinely not safe yet, so no badge rather than a misleading one.
    mockUseFinalityHeads.mockReturnValue({
      data: { safe: 17_999_999, finalized: 17_999_998 },
    });
    const recent = renderBlockDetail('/chain/1/block/18000000');
    expect(await recent.findByText('Block Details')).toBeInTheDocument();
    expect(recent.queryByText('Safe')).not.toBeInTheDocument();
    expect(recent.queryByText('Finalized')).not.toBeInTheDocument();
  });

  it('shows a Testnet badge in the header for a testnet chain', async () => {
    mockUseBlockByNumber.mockReturnValue({
      data: makeBlock(18000001),
      loading: false,
      error: undefined,
    });
    renderBlockDetail('/chain/11155111/block/18000001');

    expect(await screen.findByText('Testnet')).toBeInTheDocument();
    expect(screen.getByText(/Sepolia/)).toBeInTheDocument();
  });

  it('renders the unsupported-chain state with recovery CTAs for an invalid chain', async () => {
    renderBlockDetail('/chain/999/block/123');

    expect(await screen.findByText(/Chain not supported/)).toBeInTheDocument();
    expect(screen.getByText(/chain ID 999/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Mainnet' })).toHaveAttribute('href', '/chain/1');
    // In-card chain list replaces the old '/' bounce CTA.
    expect(screen.getByRole('heading', { name: 'Open a supported chain' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Polygon/ })).toHaveAttribute('href', '/chain/137');
  });

  it('redirects to the new chain home when switching chains while viewing a block', async () => {
    mockUseBlockByNumber.mockReturnValue({
      data: makeBlock(18000001),
      loading: false,
      error: undefined,
    });
    renderBlockDetail('/chain/1/block/18000001');

    expect(await screen.findByText('Block Details')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('top-navigation'));

    // Different chain = different block data: the switch must never show
    // the new chain's same-numbered block as if it were the one being
    // read — it lands on the new chain's home instead.
    expect(await screen.findByTestId('chain-home')).toBeInTheDocument();
    expect(screen.queryByText('Block Details')).not.toBeInTheDocument();
  });

  it('rejects a non-decimal block param with an explicit invalid state, not block 26 or NaN', async () => {
    // Number("0x1A") === 26: the hex-looking param used to silently load
    // block 26 (and worse shapes rendered NaN). The view now names the
    // invalid param and pays for no lookups.
    mockUseBlockByNumber.mockReturnValue({
      data: undefined,
      loading: false,
      error: undefined,
    });
    renderBlockDetail('/chain/1/block/0x1A');

    expect(await screen.findByText(/Invalid block number/)).toBeInTheDocument();
    expect(screen.getByText(/"0x1A" is not a decimal block number/)).toBeInTheDocument();
    // No error was raised by the fetch (it guarded the param itself), so
    // neither the future-block head check nor any block data renders.
    expect(mockGetBlockNumber).not.toHaveBeenCalled();
    expect(screen.queryByText(/does not exist yet/)).not.toBeInTheDocument();
    expect(screen.queryByText('Block Details')).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('falls back to the blocks list when the back button has no history to step into', async () => {
    mockUseBlockByNumber.mockReturnValue({
      data: makeBlock(18000001),
      loading: false,
      error: undefined,
    });
    renderBlockDetail('/chain/1/block/18000001');

    expect(await screen.findByText('Block Details')).toBeInTheDocument();

    // Fresh deep link (jsdom: no referrer, history.length === 1): the back
    // control lands on the chain's blocks list — the page the detail was
    // reached from in normal flows — instead of the old hard-coded home.
    fireEvent.click(screen.getByRole('button', { name: /Back to Explorer/ }));
    expect(await screen.findByTestId('blocks-list')).toBeInTheDocument();
    expect(screen.queryByText('Block Details')).not.toBeInTheDocument();
  });
});
