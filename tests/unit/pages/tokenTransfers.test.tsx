// Focused TokenTransfers tab tests: the service hook is mocked with a
// settled page and the RPC client factory is mocked so token enrichment
// resolves/rejects per fixture token. Pins the column contract, direction
// badge variants driven by the backend field, per-standard amount
// rendering (ERC-20 formatted, ERC-721 Token ID, ERC-1155 id/amounts,
// raw fallback), the coverage-honesty banners, and nextCursor-driven
// pagination.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';
import TokenTransfers from '@/views/Address/TokenTransfers';
// Type-only import: erased at runtime, so the vi.mock below is unaffected.
import type { TokenTransfer, TokenTransferPage } from '@/services/tokenTransfers';

const mocks = vi.hoisted(() => {
  const chainId = 1;
  const holder = '0x1234567890abcdef1234567890abcdef12345678';
  const counterparty = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  // Enrichment fixtures: erc20 resolves symbol+decimals; erc721 resolves
  // symbol but reverts decimals; unknown reverts both (raw fallback).
  const tokenErc20 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const tokenErc721 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const tokenUnknown = '0xcccccccccccccccccccccccccccccccccccccccc';
  const transfers: TokenTransfer[] = [
    {
      txHash: `0x${'11'.repeat(32)}`,
      blockNumber: 18_000_004,
      logIndex: 0,
      token: tokenErc20,
      standard: 'erc20-or-erc721',
      from: counterparty,
      to: holder,
      value: '1500000000000000000',
      direction: 'in',
    },
    {
      txHash: `0x${'22'.repeat(32)}`,
      blockNumber: 18_000_003,
      logIndex: 1,
      token: tokenErc721,
      standard: 'erc20-or-erc721',
      from: holder,
      to: counterparty,
      value: '77',
      direction: 'out',
    },
    {
      txHash: `0x${'33'.repeat(32)}`,
      blockNumber: 18_000_002,
      logIndex: 2,
      token: tokenUnknown,
      standard: 'erc20-or-erc721',
      from: counterparty,
      to: holder,
      value: '999',
      direction: 'in',
    },
    {
      txHash: `0x${'44'.repeat(32)}`,
      blockNumber: 18_000_001,
      logIndex: 3,
      token: tokenErc20,
      standard: 'erc1155-single',
      from: holder,
      to: counterparty,
      value: '3',
      tokenIds: ['5'],
      amounts: ['3'],
      direction: 'out',
    },
    {
      txHash: `0x${'55'.repeat(32)}`,
      blockNumber: 18_000_000,
      logIndex: 4,
      token: tokenErc20,
      standard: 'erc1155-batch',
      from: counterparty,
      to: holder,
      value: '3',
      tokenIds: ['1', '2', '9'],
      amounts: ['1', '1', '2'],
      direction: 'in',
    },
  ];
  const page: TokenTransferPage = {
    transfers,
    nextCursor: String(transfers.length),
    coverage: 'partial',
    windowBlocks: 50_000,
  };
  return {
    chainId,
    holder,
    counterparty,
    tokenErc20,
    tokenErc721,
    tokenUnknown,
    transfers,
    page,
    // Mock switch for the first-load case (data: undefined) without
    // re-assigning the typed page fixture.
    emptyData: false,
    loading: false,
    error: undefined as Error | undefined,
    refetch: () => undefined,
    queryArgs: [] as unknown[],
  };
});

vi.mock('@/services/tokenTransfers', () => ({
  // Args captured so pagination cases can assert the cursor (index 2).
  useTokenTransfers: (...args: unknown[]) => {
    mocks.queryArgs = args;
    return {
      data: mocks.emptyData ? undefined : mocks.page,
      loading: mocks.loading,
      fetching: false,
      error: mocks.error,
      refetch: mocks.refetch,
    };
  },
}));

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(async () => ({
    readContract: async (call: { address: string; functionName: string }) => {
      if (call.address === mocks.tokenErc20) {
        if (call.functionName === 'symbol') return 'TKN';
        return 18;
      }
      if (call.address === mocks.tokenErc721) {
        if (call.functionName === 'symbol') return 'PUNK';
        // No decimals() on the contract → the ERC-721 signal.
        throw new Error('execution reverted');
      }
      // Unreadable token: both metadata reads fail → raw fallback.
      throw new Error('execution reverted');
    },
  })),
}));

// The local Badge wrapper is mocked so the variant the view PICKS is
// directly observable (linaria classnames are opaque in tests).
vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ variant = 'default', children }: { variant?: string; children: ReactNode }) => (
    <span data-variant={variant}>{children}</span>
  ),
}));

function TokenTransfersHost() {
  return <TokenTransfers chainId={mocks.chainId} address={mocks.holder} />;
}

const routes = createRoutes([
  { path: '/', component: () => Promise.resolve(TokenTransfersHost) },
]);

const renderTab = () =>
  render(
    <MemoryRouter routes={routes} initialEntries={['/']}>
      <View />
    </MemoryRouter>,
  );

describe('TokenTransfers tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.page = {
      transfers: mocks.transfers,
      nextCursor: String(mocks.transfers.length),
      coverage: 'partial',
      windowBlocks: 50_000,
    };
    mocks.loading = false;
    mocks.emptyData = false;
    mocks.error = undefined;
    mocks.queryArgs = [];
  });

  it('renders the transfer rows with hash and block links', async () => {
    renderTab();

    expect(await screen.findByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    // The scan contract carries no timestamps: the Age column renders a
    // placeholder, never a fabricated time.
    expect(screen.getByRole('columnheader', { name: 'Age' })).toBeInTheDocument();

    const hashLink = screen.getByText('0x11111111...11111111').closest('a');
    expect(hashLink?.getAttribute('href')).toBe(`/chain/1/tx/0x${'11'.repeat(32)}`);

    const blockLink = screen.getByText('18,000,004').closest('a');
    expect(blockLink?.getAttribute('href')).toBe('/chain/1/block/18000004');

    // The counterparty address appears in several link cells across rows
    // (from/to columns); assert the address link exists among them.
    const fromLinks = screen
      .getAllByText('0xeeeeee...eeeeee')
      .map(el => el.closest('a')?.getAttribute('href'));
    expect(fromLinks).toContain(`/chain/1/address/${mocks.counterparty}`);
  });

  it('renders IN/OUT badges from the backend direction field with success/error variants', async () => {
    renderTab();

    await screen.findByRole('columnheader', { name: 'Amount' });
    const ins = await screen.getAllByText('IN');
    const outs = screen.getAllByText('OUT');
    expect(ins.length).toBeGreaterThan(0);
    expect(outs.length).toBeGreaterThan(0);
    for (const badge of ins) expect(badge).toHaveAttribute('data-variant', 'success');
    for (const badge of outs) expect(badge).toHaveAttribute('data-variant', 'error');
  });

  it('shows a formatted amount + symbol for a known ERC-20 token', async () => {
    renderTab();

    expect(await screen.findByText('1.5 TKN')).toBeInTheDocument();
    expect(screen.getByText('ERC-20')).toBeInTheDocument();
    // Symbol-known token column shows the symbol instead of the address.
    expect(screen.getByText('TKN').closest('a')?.getAttribute('href')).toBe(
      `/chain/1/address/${mocks.tokenErc20}`,
    );
  });

  it('shows Token ID for an ERC-721 (decimals reverts, symbol resolves)', async () => {
    renderTab();

    expect(await screen.findByText(/Token ID 77/)).toBeInTheDocument();
    expect(screen.getByText('ERC-721')).toBeInTheDocument();
  });

  it('falls back to the raw value + shortened token address when metadata is unreadable', async () => {
    renderTab();

    // Never a guessed decimals amount: raw value stays raw.
    expect(await screen.findByText('999')).toBeInTheDocument();
    // The shortened token address may render in more than one cell.
    expect(screen.getAllByText('0xcccccc...cccccc').length).toBeGreaterThan(0);
    // The standard stays honestly ambiguous for that row.
    expect(screen.getByText('ERC-20/721')).toBeInTheDocument();
  });

  it('renders ERC-1155 single and batch amounts from the log payload', async () => {
    renderTab();

    expect(await screen.findByText('ID 5 × 3')).toBeInTheDocument();
    expect(screen.getByText('ID 1 +2 more')).toBeInTheDocument();
    expect(screen.getByText('ERC-1155')).toBeInTheDocument();
    expect(screen.getByText('ERC-1155 Batch')).toBeInTheDocument();
  });

  it('warns on partial coverage with the covered window and a Retry affordance', async () => {
    const refetchSpy = vi.spyOn(mocks, 'refetch');
    renderTab();

    expect(await screen.findByText(/Partial coverage/)).toBeInTheDocument();
    expect(screen.getByText(/after the last 50,000 blocks/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it('shows the plain empty state only for complete coverage', async () => {
    mocks.page = { transfers: [], nextCursor: null, coverage: 'complete', windowBlocks: 10_000 };

    renderTab();

    expect(await screen.findByText('No token transfers found')).toBeInTheDocument();
    expect(screen.queryByText(/Partial coverage/)).not.toBeInTheDocument();
    // Window disclosure stays visible on complete coverage.
    expect(screen.getByText(/Scanned within the last 10,000 blocks/)).toBeInTheDocument();
  });

  it('never reads a budget-limited empty scan as proof of absence', async () => {
    mocks.page = { transfers: [], nextCursor: null, coverage: 'partial', windowBlocks: 10_000 };

    renderTab();

    expect(await screen.findByText(/Scan budget exhausted/)).toBeInTheDocument();
    expect(screen.getByText(/not proof that none exist/)).toBeInTheDocument();
    expect(screen.queryByText('No token transfers found')).not.toBeInTheDocument();
  });

  it('drives pagination from nextCursor with the cursor as a decimal offset', async () => {
    renderTab();

    expect(await screen.findByText('Page 1')).toBeInTheDocument();
    const prev = screen.getByRole('button', { name: 'Prev' });
    const next = screen.getByRole('button', { name: 'Next' });
    expect(prev).toBeDisabled();
    // nextCursor non-null → Next stays available.
    expect(next).toBeEnabled();
    expect(mocks.queryArgs[2]).toBe('0');

    fireEvent.click(next);
    // Page 2 → cursor (2-1)*25.
    expect(await screen.findByText('Page 2')).toBeInTheDocument();
    expect(mocks.queryArgs[2]).toBe('25');
    expect(screen.getByRole('button', { name: 'Prev' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Prev' }));
    expect(await screen.findByText('Page 1')).toBeInTheDocument();
    expect(mocks.queryArgs[2]).toBe('0');
  });

  it('disables Next once nextCursor is null', async () => {
    mocks.page = {
      transfers: mocks.transfers,
      nextCursor: null,
      coverage: 'complete',
      windowBlocks: 50_000,
    };

    renderTab();

    expect(await screen.findByText('Page 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('renders the loading state instead of a half-empty table', async () => {
    // First-load loading means NO data yet; with stale data present the
    // component shows the table plus a 'Loading page...' strip instead.
    mocks.loading = true;
    mocks.emptyData = true;

    renderTab();

    expect(await screen.findByText('Scanning token transfers...')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Amount' })).not.toBeInTheDocument();
  });

  it('surfaces scan errors with a retry affordance', async () => {
    mocks.error = new Error('scan failed');
    const refetchSpy = vi.spyOn(mocks, 'refetch');

    renderTab();

    expect(await screen.findByText('scan failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });
});
