// Confirmations/finality row on the transaction detail page: the count is
// the polled head minus the tx block (never a fabricated 0 while the head
// is unknown, never a negative count after a reorg), the Safe/Finalized
// badge reuses the real finalityLabelFor boundaries, a chain without tag
// support degrades to the bare count, and a pending tx renders no row at
// all. Also pins the revert card's persistent end-of-block-state caveat.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import type { Hex } from 'viem';
import '@testing-library/jest-dom';

import TransactionDetail from '@/views/Transactions/Detail';
import { useContractSource } from '@/services/contracts';
import { useTransactionByHash } from '@/services/chainRpc';
import { useFinalityHeads } from '@/services/blocks';
import { useLatestBlocksFeed } from '@/services/homeFeed';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/services/contracts', () => ({
  useContractSource: vi.fn(),
}));

vi.mock('@/services/chainRpc', () => ({
  useTransactionByHash: vi.fn(),
}));

// Finality heads stubbed at the polled hook; the real finalityLabelFor
// stays in play so the tests pin the genuine boundary semantics.
vi.mock('@/services/blocks', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/blocks')>();
  return {
    ...actual,
    useFinalityHeads: vi.fn(),
  };
});

vi.mock('@/services/homeFeed', () => ({
  useLatestBlocksFeed: vi.fn(),
}));

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(),
}));

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">chain: {currentChainId}</div>
  ),
}));

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
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : `Chain ${chainId}`),
  getChainSymbol: () => 'ETH',
  isChainSupported: (chainId: number) => chainId === 1,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
  POPULAR_CHAINS: [
    { id: 1, name: 'Ethereum' },
    { id: 137, name: 'Polygon' },
  ],
}));

const SENDER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const TOKEN = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const TX_HASH = '0xtxhash0000000000000000000000000000000000000000000000000000000000';

// Hand-rolled ABI encoding of Error(string) — what `revert("…")` emits.
const errorStringPayload = (reason: string): string => {
  const body = Array.from(new TextEncoder().encode(reason), b =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const word = (n: number) => n.toString(16).padStart(64, '0');
  return `0x08c379a0${word(32)}${word(reason.length)}${body.padEnd(64, '0')}`;
};

// Plain mined transfer: no input data, so the function-call and revert
// cards stay out of the way unless a test overrides status/inputData.
const makeTx = (overrides: Record<string, unknown> = {}) =>
  ({
    hash: TX_HASH,
    blockNumber: '1000000',
    transactionIndex: 3,
    fromAddress: SENDER,
    toAddress: RECIPIENT,
    value: '0',
    gasLimit: '21000',
    gasUsed: '21000',
    gasPrice: '20000000000',
    nonce: 7,
    type: 2,
    status: 1,
    inputData: '0x',
    logs: [],
    ...overrides,
  }) as never;

const hookResult = (data: unknown, error?: unknown) =>
  ({ data, loading: false, error, refetch: vi.fn() }) as unknown as never;

const mockHeads = (heads: Record<string, number> | undefined) => {
  vi.mocked(useFinalityHeads).mockReturnValue({ data: heads } as never);
};

const mockHead = (latestBlockNumber: bigint | undefined) => {
  vi.mocked(useLatestBlocksFeed).mockReturnValue({
    data: latestBlockNumber === undefined ? undefined : { latestBlockNumber },
  } as never);
};

// The back button's fallback destination (also the second route's target).
const TxListStub = () => <div data-testid="tx-list" />;

const renderDetail = () => {
  const routes = createRoutes([
    { path: '/chain/:chainId/tx/:txHash', component: () => TransactionDetail },
    { path: '/chain/:chainId/transactions', component: () => TxListStub },
  ]);
  return render(
    <MemoryRouter routes={routes} initialEntries={[`/chain/1/tx/${TX_HASH}`]}>
      <View />
    </MemoryRouter>,
  );
};

// The InfoItem row container of a grid label. Async like every first
// query in this suite: @native-router resolves the route asynchronously,
// so sync reads race the first paint.
const rowOf = async (label: string): Promise<HTMLElement> => {
  const labelEl = await screen.findByText(label);
  const row = labelEl.closest('div');
  expect(row).not.toBeNull();
  return row as HTMLElement;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useTransactionByHash).mockReturnValue(hookResult(makeTx()));
  vi.mocked(useContractSource).mockReturnValue(hookResult(undefined));
  mockHeads(undefined);
  mockHead(undefined);
});

describe('TransactionDetail confirmations row', () => {
  it('shows the head-minus-block count with locale formatting and no badge on a tag-less chain', async () => {
    // Node answered but supports neither tag: heads = {} — count only.
    mockHeads({});
    mockHead(2000001n);

    renderDetail();

    const row = await rowOf('Confirmations');
    expect(within(row).getByText('1,000,001')).toBeInTheDocument();
    expect(within(row).queryByText('Safe')).not.toBeInTheDocument();
    expect(within(row).queryByText('Finalized')).not.toBeInTheDocument();
  });

  it('labels the row Finalized when the tx block is at or below the finalized head', async () => {
    // Boundary pin: block == finalized is Finalized, not Safe.
    mockHeads({ safe: 1000005, finalized: 1000000 });
    mockHead(1000010n);

    renderDetail();

    const row = await rowOf('Confirmations');
    expect(within(row).getByText('10')).toBeInTheDocument();
    expect(within(row).getByText('Finalized')).toBeInTheDocument();
    expect(within(row).queryByText('Safe')).not.toBeInTheDocument();
  });

  it('labels the row Safe strictly between the finalized and safe heads', async () => {
    // Boundary pin: block == safe (and > finalized) is Safe.
    mockHeads({ safe: 1000000, finalized: 999999 });
    mockHead(1000003n);

    renderDetail();

    const row = await rowOf('Confirmations');
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByText('Safe')).toBeInTheDocument();
    expect(within(row).queryByText('Finalized')).not.toBeInTheDocument();
  });

  it('keeps an honest placeholder while the head is unknown — never a fabricated 0', async () => {
    renderDetail();

    const row = await rowOf('Confirmations');
    expect(within(row).getByText('…')).toBeInTheDocument();
    expect(within(row).queryByText('0')).not.toBeInTheDocument();
  });

  it('reports Unknown instead of a negative count when the block sits above the head', async () => {
    // Cached tx outliving a reorg: head below the tx's block number.
    mockHead(999999n);

    renderDetail();

    const row = await rowOf('Confirmations');
    expect(within(row).getByText('Unknown')).toBeInTheDocument();
    const unknown = within(row).getByText('Unknown');
    expect(unknown).toHaveAttribute(
      'title',
      'Transaction block is above the current chain head (likely reorged out)',
    );
  });

  it('renders no confirmations row for a pending transaction', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(
        makeTx({ blockNumber: null, transactionIndex: null, status: -1, gasUsed: undefined }),
      ),
    );

    renderDetail();

    expect((await screen.findAllByRole('heading', { name: 'Transaction Details' })).length).toBe(2);
    expect(screen.queryByText('Confirmations')).not.toBeInTheDocument();
  });

  it('shows the confirmations row for failed transactions too, beside the revert card caveat', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(
        makeTx({
          status: 0,
          toAddress: TOKEN,
          inputData: '0xa9059cbb000000000000000000000000222222222222222222222222222222222222222200000000000000000000000000000000000000000000000000000000000f4240',
        }),
      ),
    );
    mockHeads({});
    mockHead(1000004n);
    // Replay answers with a revert carrying Error(string).
    const inner = Object.assign(new Error('RPC error'), {
      data: errorStringPayload('Insufficient balance') as Hex,
    });
    vi.mocked(createRpcClient).mockResolvedValue({
      call: vi.fn().mockRejectedValue(new Error('execution reverted', { cause: inner })),
    } as never);

    renderDetail();

    // Failed tx keeps the confirmations row (count only, tag-less chain).
    const row = await rowOf('Confirmations');
    expect(within(row).getByText('4')).toBeInTheDocument();
    // Decoded revert reason plus the persistent semantic caveat.
    expect(await screen.findByText('Insufficient balance')).toBeInTheDocument();
    expect(screen.getByText(/Replayed against end-of-block state/)).toBeInTheDocument();
    expect(
      screen.getByText(/transactions earlier in the same block may alter the result/),
    ).toBeInTheDocument();
  });

  it('keeps the end-of-block caveat on the unavailable revert state as well', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(
        makeTx({
          status: 0,
          toAddress: TOKEN,
          inputData: '0xa9059cbb000000000000000000000000222222222222222222222222222222222222222200000000000000000000000000000000000000000000000000000000000f4240',
        }),
      ),
    );
    mockHeads({});
    mockHead(1000002n);
    vi.mocked(createRpcClient).mockResolvedValue({
      call: vi.fn().mockResolvedValue('0x'),
    } as never);

    renderDetail();

    expect(await screen.findByText(/Reason unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Replayed against end-of-block state/)).toBeInTheDocument();
  });
});
