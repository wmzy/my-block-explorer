// Header prev/next navigation wiring for the block detail view: which
// control is a link vs a disabled boundary, and what each names. The
// service hook and the RPC client factory are mocked, so the cases pin the
// view's data flow — the head comes ONLY from the error-path probe the view
// already runs (happy path: no head call, next stays a link labeled
// honestly as unknown), genesis disables prev, and a known head at or below
// the viewed number disables next.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';
import BlockDetail from '@/views/Blocks/Detail';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">chain:{currentChainId}</div>
  ),
}));

vi.mock('@/components/ui/CopyableHash', () => ({
  CopyableHash: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock('@/config/chains', () => ({
  getChainInfo: (chainId: number) =>
    chainId === 1 ? { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } } : null,
  getChainName: () => 'Ethereum',
  getChainType: () => 'mainnet',
  getChainSymbol: () => 'ETH',
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
    transactionCount: number;
  };
  loading: boolean;
  error?: Error;
  refetch?: () => void | Promise<unknown>;
};

const { mockUseBlockByNumber, mockGetBlockNumber } = vi.hoisted(() => ({
  mockUseBlockByNumber: vi.fn<(...args: unknown[]) => BlockHookResult>(),
  mockGetBlockNumber: vi.fn<() => Promise<bigint>>(),
}));

vi.mock('@/services/chainRpc', () => ({
  useBlockByNumber: (...args: unknown[]) => mockUseBlockByNumber(...args),
}));

vi.mock('@/services/blocks', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/blocks')>();
  return {
    ...actual,
    useFinalityHeads: () => ({ data: undefined }),
  };
});

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
});

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

describe('BlockDetail header prev/next navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBlockByNumber.mockReturnValue({
      data: undefined,
      loading: false,
      error: undefined,
    });
  });

  it('links both neighbors without probing the head on the happy path', async () => {
    mockUseBlockByNumber.mockReturnValue({
      data: makeBlock(100),
      loading: false,
      error: undefined,
    });
    renderBlockDetail('/chain/1/block/100');

    expect(await screen.findByText('Block Details')).toBeInTheDocument();
    // Both steps are links to the neighboring numbers.
    expect(screen.getByRole('link', { name: 'Prev' })).toHaveAttribute(
      'href',
      '/chain/1/block/99',
    );
    // No head was observed (the probe only runs on the error path), so the
    // next link stays clickable but its label names the uncertainty.
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/chain/1/block/101',
    );
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'title',
      'Chain head unknown — the next block may not exist yet',
    );
    // The nav adds no head probe of its own.
    expect(mockGetBlockNumber).not.toHaveBeenCalled();
  });

  it('shows the nav from the URL number while the block is still loading', async () => {
    mockUseBlockByNumber.mockReturnValue({ data: undefined, loading: true, error: undefined });
    renderBlockDetail('/chain/1/block/100');

    expect(await screen.findByRole('link', { name: 'Prev' })).toHaveAttribute(
      'href',
      '/chain/1/block/99',
    );
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/chain/1/block/101',
    );
  });

  it('disables prev at genesis with an explanatory title', async () => {
    mockUseBlockByNumber.mockReturnValue({
      data: makeBlock(0),
      loading: false,
      error: undefined,
    });
    renderBlockDetail('/chain/1/block/0');

    expect(await screen.findByText('Block Details')).toBeInTheDocument();
    const prev = screen.getByRole('button', { name: 'Prev' });
    expect(prev).toBeDisabled();
    expect(prev).toHaveAttribute('title', 'Genesis block');
    // Next from genesis is still a candidate link (head unobserved).
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/chain/1/block/1');
  });

  it('disables next once the observed head rules it out', async () => {
    mockUseBlockByNumber.mockReturnValue({
      data: undefined,
      loading: false,
      error: new Error('Header not found'),
    });
    mockGetBlockNumber.mockResolvedValue(123n);
    renderBlockDetail('/chain/1/block/999999999');
    // Settle the error-path head probe.
    await act(async () => {});

    expect(await screen.findByText(/does not exist yet/)).toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next).toBeDisabled();
    expect(next).toHaveAttribute('title', 'Chain head');
    // Prev keeps pointing one number down.
    expect(screen.getByRole('link', { name: 'Prev' })).toHaveAttribute(
      'href',
      '/chain/1/block/999999998',
    );
  });

  it('renders no nav controls for an invalid block param', async () => {
    renderBlockDetail('/chain/1/block/0x1A');

    expect(await screen.findByText(/Invalid block number/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Prev' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Prev' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Next' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });
});
