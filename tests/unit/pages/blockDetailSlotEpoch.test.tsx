// Block detail slot/epoch row (Blockscout parity): the InfoGrid renders
// 'Slot / Epoch' only when the chain's consensus schedule is known
// (mainnet) and the block timestamp parses — the row's value carries the
// honest "derived from the block timestamp" caveat. Unmapped-but-
// supported chains and pre-genesis timestamps render no row at all, never
// a misleading blank or a guessed slot. Harness mirrors
// blockDetailPage.test.tsx (minimal native-router setup, service hooks
// and network-adjacent children mocked) so these tests pin only the
// slot/epoch row's render contract.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';
import BlockDetail from '@/views/Blocks/Detail';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">chain: {currentChainId}</div>
  ),
}));

// CopyableHash takes plain href strings; stubbed to keep the view test
// isolated from the shared component internals.
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
  // Chain 1 (mapped schedule) and 137 (supported explorer chain, NO
  // schedule in the slot/epoch map) — the pair pins that "supported by
  // the app" and "has a known consensus schedule" are different gates.
  getChainInfo: (chainId: number) => {
    if (chainId === 1) return { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } };
    if (chainId === 137) return { id: 137, name: 'Polygon', nativeCurrency: { symbol: 'POL' } };
    return null;
  },
  getChainName: (chainId: number) =>
    chainId === 1 ? 'Ethereum' : chainId === 137 ? 'Polygon' : 'Unknown',
  getChainType: () => 'mainnet',
  getChainSymbol: (chainId: number) => (chainId === 137 ? 'POL' : 'ETH'),
  isChainSupported: (chainId: number) => chainId === 1 || chainId === 137,
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
    transactionCount: number;
    sizeBytes?: number;
  };
  loading: boolean;
  error?: Error;
  refetch?: () => void | Promise<unknown>;
};

const { mockUseBlockByNumber, mockUseFinalityHeads } = vi.hoisted(() => ({
  mockUseBlockByNumber: vi.fn<(...args: unknown[]) => BlockHookResult>(),
  mockUseFinalityHeads: vi.fn<(...args: unknown[]) => { data?: unknown }>(),
}));

vi.mock('@/services/chainRpc', () => ({
  useBlockByNumber: (...args: unknown[]) => mockUseBlockByNumber(...args),
}));

// The finality badge's heads hook is stubbed (unknown heads → no badge);
// the pure finalityLabelFor stays real.
vi.mock('@/services/blocks', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/blocks')>();
  return {
    ...actual,
    useFinalityHeads: (...args: unknown[]) => mockUseFinalityHeads(...args),
  };
});

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(),
}));

// The first post-Merge mainnet block (Etherscan 15537394): its timestamp
// sits exactly on slot 4,700,013's start boundary — the canonical
// known-answer fixture for the derivation.
const makeBlock = (timestamp: string) => ({
  number: '15537394',
  hash: '0xhash15537394',
  parentHash: '0xparent15537394',
  timestamp,
  miner: '0x1234567890abcdef1234567890abcdef12345678',
  gasUsed: '29983006',
  gasLimit: '30000000',
  transactionCount: 0,
  sizeBytes: 45_678,
});

const BlocksListStub = () => <div data-testid="blocks-list" />;

const renderBlockDetail = (path: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([
        { path: '/chain/:chainId/block/:blockNumber', component: () => BlockDetail },
        { path: '/chain/:chainId/blocks', component: () => BlocksListStub },
      ])}
      initialEntries={[path]}
    >
      <View />
    </MemoryRouter>,
  );

describe('BlockDetail Slot / Epoch row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBlockByNumber.mockReturnValue({
      data: undefined,
      loading: false,
      error: undefined,
    });
    mockUseFinalityHeads.mockReturnValue({ data: undefined });
  });

  it('renders the derived slot/epoch with the timestamp caveat for a mapped chain', async () => {
    mockUseBlockByNumber.mockReturnValue({
      data: makeBlock('2022-09-15T06:42:59.000Z'),
      loading: false,
      error: undefined,
    });
    renderBlockDetail('/chain/1/block/15537394');

    expect(await screen.findByText('Block Details')).toBeInTheDocument();
    expect(screen.getByText('Slot / Epoch')).toBeInTheDocument();
    expect(screen.getByText('4,700,013 · epoch 146,875')).toBeInTheDocument();
    // The hover hint carries the honest derivation caveat.
    expect(
      screen.getByTitle('Derived from the block timestamp — may be off by one slot'),
    ).toBeInTheDocument();
  });

  it('omits the row entirely for a supported chain without a known schedule', async () => {
    mockUseBlockByNumber.mockReturnValue({
      data: makeBlock('2022-09-15T06:42:59.000Z'),
      loading: false,
      error: undefined,
    });
    renderBlockDetail('/chain/137/block/15537394');

    // The block itself renders (chain 137 is a supported explorer chain);
    // only the schedule-dependent row is absent — no guessed slot, no
    // misleading blank.
    expect(await screen.findByText('Block Details')).toBeInTheDocument();
    expect(screen.getByText('15,537,394')).toBeInTheDocument();
    expect(screen.queryByText('Slot / Epoch')).not.toBeInTheDocument();
  });

  it('omits the row for a mainnet block whose timestamp predates genesis', async () => {
    mockUseBlockByNumber.mockReturnValue({
      // One second before beacon genesis: no slot window contains it.
      data: makeBlock('2020-12-01T12:00:22.000Z'),
      loading: false,
      error: undefined,
    });
    renderBlockDetail('/chain/1/block/1');

    expect(await screen.findByText('Block Details')).toBeInTheDocument();
    expect(screen.queryByText('Slot / Epoch')).not.toBeInTheDocument();
  });
});
