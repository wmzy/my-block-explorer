// Transactions list ENS wiring: From/To cells upgrade to verified ENS
// names in place while their link targets stay the address routes, rows
// past the per-page ENS bound render unenriched (no resolution attempt),
// and contract-creation rows (empty recipient) keep today's plain
// rendering. Resolution is stubbed here — the hook's own contract (null
// for loading/failure/unverified) lives in the EnsInline component tests.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';

import TransactionsList from '@/views/Transactions/List';
import { shortAddress } from '@/components/ui/EnsInline';

vi.mock('@/components/TopNavigation', () => ({
  default: () => <div data-testid="top-navigation" />,
}));

// Same stub as the other list tests: plain anchors, truncated text.
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
    chainId === 1 ? { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } } : null,
  getChainName: () => 'Ethereum',
  getChainSymbol: () => 'ETH',
  isChainSupported: (chainId: number) => chainId === 1,
  POPULAR_CHAINS: [
    { id: 1, name: 'Ethereum' },
    { id: 137, name: 'Polygon' },
  ],
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
}));

vi.mock('@/utils/format', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/format')>();
  return { ...actual, formatRelativeTime: () => '5 min ago' };
});

const mockUseLatestTransactions = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/services/chainRpc', () => ({
  useLatestTransactions: (...args: unknown[]) => mockUseLatestTransactions(...args),
}));

vi.mock('@/services/homeFeed', () => ({
  useLatestBlocksFeed: () => ({ data: undefined }),
}));

// One fixture address resolves; every other address settles unresolved —
// the list must show the name and the plain short form side by side.
const NAMED = '0x1111111111111111111111111111111111111111';
const PLAIN = '0x2222222222222222222222222222222222222222';

const mockUseEnsName = vi.fn((address: string | undefined, _chainId?: number) =>
  address === NAMED ? { data: 'vitalik.eth', loading: false } : { data: null, loading: false },
);

vi.mock('@/services/ens', () => ({
  useEnsName: (...args: unknown[]) =>
    mockUseEnsName(...(args as [string | undefined, number | undefined])),
}));

type TxStub = {
  hash: string;
  blockNumber: string;
  fromAddress: string;
  toAddress: string;
  value: string;
  status: number;
  timestamp?: string;
};

const makeTx = (overrides: Partial<TxStub> = {}): TxStub => ({
  hash: `0xtx${Math.random().toString(16).slice(2).padEnd(10, '0')}`,
  blockNumber: '18000001',
  fromAddress: PLAIN,
  toAddress: PLAIN,
  value: '1000000000000000000',
  status: 1,
  timestamp: '2024-01-01T00:00:00Z',
  ...overrides,
});

// Distinct lowercase addresses per index (0x..0001, 0x..0002, ...) so the
// per-address set of resolution requests is exactly observable.
const rowAddress = (i: number) => `0x${(i + 1).toString(16).padStart(40, '0')}`;

const renderTransactionsList = () =>
  render(
    <MemoryRouter
      routes={createRoutes([
        { path: '/chain/:chainId/transactions', component: () => TransactionsList },
      ])}
      initialEntries={['/chain/1/transactions']}
    >
      <View />
    </MemoryRouter>,
  );

describe('TransactionsList ENS cells', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseLatestTransactions.mockReturnValue({
      data: undefined,
      loading: false,
      error: undefined,
    });
  });

  it('shows a resolved name in place of the address while both link targets stay the address route', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: {
        transactions: [
          makeTx({ fromAddress: NAMED, toAddress: PLAIN }),
          makeTx({ fromAddress: PLAIN, toAddress: NAMED }),
        ],
        latestBlockNumber: 18000001n,
      },
      loading: false,
      error: undefined,
    });
    renderTransactionsList();

    // Name text in both From and To positions, each still linking at its
    // own address route — the upgrade never retargets the link.
    const namedLinks = await screen.findAllByRole('link', { name: 'vitalik.eth' });
    expect(namedLinks).toHaveLength(2);
    for (const link of namedLinks) {
      expect(link).toHaveAttribute('href', `/chain/1/address/${NAMED}`);
      expect(link).toHaveAttribute('title', NAMED);
    }

    // Unresolved neighbor keeps the short address form and its route.
    const plainLinks = screen.getAllByRole('link', { name: shortAddress(PLAIN) });
    expect(plainLinks).toHaveLength(2);
    for (const link of plainLinks) {
      expect(link).toHaveAttribute('href', `/chain/1/address/${PLAIN}`);
    }
  });

  it('bounds resolution to the first 25 rows of the page', async () => {
    // 30 rows with pairwise-distinct addresses: rows 25+ must never be
    // requested, and the set (not the render count) is the observable.
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeTx({ fromAddress: rowAddress(i * 2), toAddress: rowAddress(i * 2 + 1) }),
    );
    mockUseLatestTransactions.mockReturnValue({
      data: { transactions: rows, latestBlockNumber: 18000001n },
      loading: false,
      error: undefined,
    });
    renderTransactionsList();

    expect((await screen.findAllByText('Success')).length).toBe(30);
    const requested = new Set(mockUseEnsName.mock.calls.map(([address]) => address));
    // 25 enabled rows × 2 address cells, all distinct.
    expect(requested.size).toBe(50);
    // The boundary: the last enabled row's cells are in, the next row's out.
    expect(requested.has(rowAddress(24 * 2))).toBe(true);
    expect(requested.has(rowAddress(24 * 2 + 1))).toBe(true);
    expect(requested.has(rowAddress(25 * 2))).toBe(false);
    expect(requested.has(rowAddress(25 * 2 + 1))).toBe(false);
    // Bounded rows still render as links to their address routes.
    const boundedFrom = screen.getAllByRole('link', { name: shortAddress(rowAddress(25 * 2)) });
    expect(boundedFrom).toHaveLength(1);
    expect(boundedFrom[0]).toHaveAttribute('href', `/chain/1/address/${rowAddress(25 * 2)}`);
  });

  it('keeps the plain rendering for contract-creation rows and never resolves an empty recipient', async () => {
    mockUseLatestTransactions.mockReturnValue({
      data: {
        transactions: [makeTx({ fromAddress: PLAIN, toAddress: '' })],
        latestBlockNumber: 18000001n,
      },
      loading: false,
      error: undefined,
    });
    renderTransactionsList();

    expect(await screen.findByText('N/A')).toBeInTheDocument();
    // Today's rendering kept verbatim: the N/A cell still renders through
    // the CopyableHash branch with its (address-less) href.
    expect(screen.getByText('N/A').closest('a')?.getAttribute('href')).toBe(
      '/chain/1/address/',
    );
    // Only the From cell resolved; the empty To never reached the hook.
    expect(mockUseEnsName.mock.calls.some(([address]) => !address)).toBe(false);
    expect(mockUseEnsName).toHaveBeenCalledWith(PLAIN, 1);
  });
});
