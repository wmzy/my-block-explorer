// Focused TokenTransfers tab tests: the service hook is mocked with a
// settled page and the RPC client factory is mocked so token enrichment
// resolves/rejects per fixture token. Pins the column contract, direction
// badge variants driven by the backend field, per-standard amount
// rendering (ERC-20 formatted, ERC-721 Token ID, ERC-1155 id/amounts,
// raw fallback), the coverage-honesty banners, and nextCursor-driven
// pagination.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState, type ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes, useMatched, useSearchParams } from '@native-router/react';
import { navigate } from '@native-router/core';
import { getAddress } from 'viem';
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
  // "Search deeper" fixture: served when the hook is called with the
  // widened window so the banner-update behavior is observable.
  const deepWindow = 200_000;
  const deepPage: TokenTransferPage = {
    transfers,
    nextCursor: String(transfers.length),
    coverage: 'partial',
    windowBlocks: deepWindow,
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
    deepWindow,
    deepPage,
    // Mock switch for the first-load case (data: undefined) without
    // re-assigning the typed page fixture.
    emptyData: false,
    loading: false,
    error: undefined as Error | undefined,
    refetch: () => undefined,
    // Cache-bypass latch stand-in: the view must call this before every
    // explicit Retry/Refresh-triggered refetch.
    requestRefresh: () => undefined,
    // Contract classification prop for the events-indexing CTA.
    isContract: false,
    queryArgs: [] as unknown[],
  };
});

vi.mock('@/services/tokenTransfers', () => ({
  // Args captured so pagination cases can assert the cursor (index 2) and
  // the widened window (index 4); the page fixture is selected by the
  // requested window so "Search deeper" can pin the banner update.
  useTokenTransfers: (...args: unknown[]) => {
    mocks.queryArgs = args;
    const page = args[4] === mocks.deepWindow ? mocks.deepPage : mocks.page;
    return {
      data: mocks.emptyData ? undefined : page,
      loading: mocks.loading,
      fetching: false,
      error: mocks.error,
      refetch: mocks.refetch,
    };
  },
  // Wrapper (not the bare reference) so vi.spyOn(mocks, 'requestRefresh')
  // is honored: the factory runs once at import time, before any spy.
  requestTokenTransfersRefresh: () => mocks.requestRefresh(),
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
  return (
    <TokenTransfers
      chainId={mocks.chainId}
      address={mocks.holder}
      isContract={mocks.isContract}
    />
  );
}

// Parent-refresh wiring: a button bumps the refreshSignal prop exactly the
// way the address page's Refresh button does on the transfers tab.
function RefreshSignalHost() {
  const [signal, setSignal] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setSignal(s => s + 1)}>
        bump refresh signal
      </button>
      <TokenTransfers
        chainId={mocks.chainId}
        address={mocks.holder}
        isContract={mocks.isContract}
        refreshSignal={signal}
      />
    </>
  );
}

const routes = createRoutes([
  { path: '/', component: () => Promise.resolve(TokenTransfersHost) },
]);

const signalRoutes = createRoutes([
  { path: '/', component: () => Promise.resolve(RefreshSignalHost) },
]);

// Param-driven host: navigating between addresses changes params WITHOUT
// remounting the component — the same-route scenario the address page
// actually runs (TypedLink to another address re-uses this route).
const NEXT_ADDRESS = '0xdef8888888888888888888888888888888888888';
function AddressParamHost() {
  const { params, router } = useMatched();
  return (
    <>
      <TokenTransfers chainId={mocks.chainId} address={params.address ?? ''} />
      <button
        type="button"
        onClick={() => {
          void navigate(router, `/${NEXT_ADDRESS}`).catch(() => undefined);
        }}
      >
        go next address
      </button>
    </>
  );
}

const addressRoutes = createRoutes([
  { path: '/:address', component: () => Promise.resolve(AddressParamHost) },
]);

// Exposes the live search string so cases can pin ?ttPage= round-trips
// through the URL (memory history is not window.location).
function SearchProbe() {
  const [params] = useSearchParams();
  return <div data-testid="search-probe">{params.toString()}</div>;
}

// Legacy pre-coverage cached payload: the runtime can serve entries whose
// coverage/windowBlocks tags never existed (the service type models only
// the fresh shape) — this helper models the missing tags honestly so the
// view's unknown-coverage branch is testable.
type LegacyPageInput = Omit<TokenTransferPage, 'coverage' | 'windowBlocks'>;
const legacyPage = (page: LegacyPageInput): TokenTransferPage =>
  page as TokenTransferPage;

const renderTab = (path = '/') =>
  render(
    <MemoryRouter routes={routes} initialEntries={[path]}>
      <SearchProbe />
      <View />
    </MemoryRouter>,
  );

const renderSignalHost = () =>
  render(
    <MemoryRouter routes={signalRoutes} initialEntries={['/']}>
      <View />
    </MemoryRouter>,
  );

const renderAddressRoute = (path: string) =>
  render(
    <MemoryRouter routes={addressRoutes} initialEntries={[path]}>
      <SearchProbe />
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
    mocks.deepWindow = 200_000;
    mocks.deepPage = {
      transfers: mocks.transfers,
      nextCursor: String(mocks.transfers.length),
      coverage: 'partial',
      windowBlocks: mocks.deepWindow,
    };
    mocks.loading = false;
    mocks.emptyData = false;
    mocks.error = undefined;
    mocks.isContract = false;
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
    // Symbol-known token column shows the symbol instead of the address;
    // the link routes to the token's contract page, not the address page.
    expect(screen.getByText('TKN').closest('a')?.getAttribute('href')).toBe(
      `/chain/1/contract/${mocks.tokenErc20}`,
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
    const refreshSpy = vi.spyOn(mocks, 'requestRefresh');
    renderTab();

    expect(await screen.findByText(/Partial coverage/)).toBeInTheDocument();
    expect(screen.getByText(/after the last 50,000 blocks/)).toBeInTheDocument();

    // Retry is a cache-bypassing refresh: the latch arms BEFORE the
    // refetch re-issues the request (backend then re-scans instead of
    // re-serving its 60s 'partial' cache entry).
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it('arms the cache bypass when the parent refresh signal bumps', async () => {
    const refetchSpy = vi.spyOn(mocks, 'refetch');
    const refreshSpy = vi.spyOn(mocks, 'requestRefresh');
    renderSignalHost();

    expect(await screen.findByText(/Partial coverage/)).toBeInTheDocument();
    expect(refetchSpy).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'bump refresh signal' }));
    await waitFor(() => expect(refetchSpy).toHaveBeenCalledTimes(1));
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('widens the scan window via Search deeper into ?ttWindow= and reflects it in the banner', async () => {
    const refreshSpy = vi.spyOn(mocks, 'requestRefresh');
    renderTab();

    expect(await screen.findByText(/after the last 50,000 blocks/)).toBeInTheDocument();
    const deepen = screen.getByRole('button', { name: 'Search deeper' });
    expect(deepen).toBeEnabled();
    // Default request uses the backend's default window (undefined arg).
    expect(mocks.queryArgs[4]).toBeUndefined();

    fireEvent.click(deepen);
    // 50,000 x 4; the widened request bypasses the shallower cache.
    await waitFor(() => expect(mocks.queryArgs[4]).toBe(200_000));
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    // The window rides the URL (shareable, refresh-stable, back/forward).
    expect(screen.getByTestId('search-probe')).toHaveTextContent('ttWindow=200000');
    // The widened response drives the coverage banner numbers.
    expect(await screen.findByText(/after the last 200,000 blocks/)).toBeInTheDocument();
  });

  it('seeds the scan window from a shared ?ttWindow= deep link', async () => {
    renderTab('/?ttWindow=200000');

    // The deep link alone drives the request: the widened window is read
    // from the URL, not rebuilt from local state.
    expect(await screen.findByText(/after the last 200,000 blocks/)).toBeInTheDocument();
    expect(mocks.queryArgs[4]).toBe(200_000);
    expect(mocks.queryArgs[1]).toBe(mocks.holder);
  });

  it('degrades a malformed or out-of-range ?ttWindow= to the default window', async () => {
    renderTab('/?ttWindow=50000001');

    expect(await screen.findByText('Page 1')).toBeInTheDocument();
    expect(mocks.queryArgs[4]).toBeUndefined();
  });

  it('never scans the next address with the previous address\'s window', async () => {
    // Window deep link on address A, then an in-app hop to address B on
    // the SAME route (param change, no remount): B's URL carries no
    // ?ttWindow, so B's very first request already uses the default
    // window — the old reset-in-effect lagged one frame.
    renderAddressRoute(`/${mocks.holder}?ttWindow=200000`);

    expect(await screen.findByText(/after the last 200,000 blocks/)).toBeInTheDocument();
    expect(mocks.queryArgs[4]).toBe(200_000);

    fireEvent.click(screen.getByRole('button', { name: 'go next address' }));
    await waitFor(() => expect(mocks.queryArgs[1]).toBe(NEXT_ADDRESS));
    expect(mocks.queryArgs[4]).toBeUndefined();
  });

  it('disables Search deeper at the RPC budget cap', async () => {
    mocks.page = {
      transfers: mocks.transfers,
      nextCursor: null,
      coverage: 'partial',
      windowBlocks: 50_000_000,
    };

    renderTab();

    const deepen = await screen.findByRole('button', { name: 'Search deeper' });
    expect(deepen).toBeDisabled();
    expect(deepen).toHaveAttribute('title', 'maximum RPC budget reached');
  });

  it('links an empty contract scan to the events-indexing channel', async () => {
    mocks.isContract = true;
    mocks.page = { transfers: [], nextCursor: null, coverage: 'complete', windowBlocks: 10_000 };

    renderTab();

    const cta = await screen.findByText('Index this contract\'s events for full history →');
    expect(cta.closest('a')?.getAttribute('href')).toBe(
      `/chain/1/contract/${mocks.holder}/events`,
    );
  });

  it('offers the events-indexing CTA on a budget-limited empty scan too', async () => {
    mocks.isContract = true;
    mocks.page = { transfers: [], nextCursor: null, coverage: 'partial', windowBlocks: 10_000 };

    renderTab();

    expect(await screen.findByText(/Scan budget exhausted/)).toBeInTheDocument();
    expect(
      screen.getByText('Index this contract\'s events for full history →'),
    ).toBeInTheDocument();
  });

  it('shows no events-indexing CTA for non-contract addresses', async () => {
    mocks.isContract = false;
    mocks.page = { transfers: [], nextCursor: null, coverage: 'complete', windowBlocks: 10_000 };

    renderTab();

    expect(await screen.findByText('No token transfers found')).toBeInTheDocument();
    expect(
      screen.queryByText('Index this contract\'s events for full history →'),
    ).not.toBeInTheDocument();
  });

  it('hides the events-indexing CTA while transfers are present', async () => {
    mocks.isContract = true;

    renderTab();

    expect(await screen.findByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(
      screen.queryByText('Index this contract\'s events for full history →'),
    ).not.toBeInTheDocument();
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

  it('seeds the page from a shared ?ttPage= deep link', async () => {
    renderTab('/?ttPage=2');

    // The deep link is the pagination state: page 2's cursor rides the
    // query from the URL alone (shareable, refresh-stable).
    expect(await screen.findByText('Page 2')).toBeInTheDocument();
    expect(mocks.queryArgs[2]).toBe('25');
    expect(screen.getByRole('button', { name: 'Prev' })).toBeEnabled();
  });

  it('writes pagination into ?ttPage= so deep pages are shareable', async () => {
    renderTab();

    expect(await screen.findByText('Page 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Page 2')).toBeInTheDocument();
    expect(screen.getByTestId('search-probe')).toHaveTextContent('ttPage=2');
    expect(mocks.queryArgs[2]).toBe('25');

    fireEvent.click(screen.getByRole('button', { name: 'Prev' }));
    expect(await screen.findByText('Page 1')).toBeInTheDocument();
    expect(screen.getByTestId('search-probe')).toHaveTextContent('ttPage=1');
  });

  it('degrades a malformed ?ttPage= deep link to page 1', async () => {
    renderTab('/?ttPage=abc');

    expect(await screen.findByText('Page 1')).toBeInTheDocument();
    expect(mocks.queryArgs[2]).toBe('0');
  });

  it('converges an out-of-range ?ttPage= deep link back to page 1 via replace', async () => {
    // Settled payload with no rows past the list end: an empty page 3 is
    // not a shareable state — the URL pins (replaces) to page 1.
    mocks.page = { transfers: [], nextCursor: null, coverage: 'complete', windowBlocks: 10_000 };

    renderTab('/?ttPage=3');

    await waitFor(() =>
      expect(screen.getByTestId('search-probe')).toHaveTextContent('ttPage=1'));
    // Page 1 with no rows renders the trusted empty state — never the
    // beyond-data row a shareable empty page would show.
    expect(mocks.queryArgs[2]).toBe('0');
    expect(await screen.findByText('No token transfers found')).toBeInTheDocument();
    expect(screen.queryByText('No transfers on this page')).not.toBeInTheDocument();
  });

  it('keeps a mid-flight empty page instead of converging', async () => {
    // First-load in flight (no settled data): nothing converges yet —
    // the race guard must not replace-pin while the fetch is pending.
    mocks.page = { transfers: [], nextCursor: null, coverage: 'complete', windowBlocks: 10_000 };
    mocks.loading = true;
    mocks.emptyData = true;

    renderTab('/?ttPage=5');

    expect(await screen.findByText('Scanning token transfers...')).toBeInTheDocument();
    expect(screen.getByTestId('search-probe')).toHaveTextContent('ttPage=5');
  });

  it('shows the first-scan freshness the payload reports', async () => {
    // 2 minutes before "now": the real formatRelativeTime renders
    // '2 min ago'. The line is the tab's data-freshness disclosure.
    mocks.page = {
      transfers: mocks.transfers,
      nextCursor: String(mocks.transfers.length),
      coverage: 'partial',
      windowBlocks: 50_000,
      scannedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    };

    renderTab();

    expect(await screen.findByText('Scanned 2 min ago')).toBeInTheDocument();
  });

  it('claims no freshness when the payload carries no scannedAt', async () => {
    renderTab();

    expect(await screen.findByText(/Partial coverage/)).toBeInTheDocument();
    expect(screen.queryByText(/^Scanned /)).not.toBeInTheDocument();
  });

  it('explains the empty Age column via tooltips and a table legend', async () => {
    renderTab();

    expect(await screen.findByRole('columnheader', { name: 'Age' })).toHaveAttribute(
      'title',
      'Timestamps are not available for scan results',
    );
    // Every row's Age placeholder carries the same explanation.
    const titled = screen.getAllByTitle('Timestamps are not available for scan results');
    expect(titled.length).toBe(mocks.transfers.length + 1); // header + rows
    // Stated once in full under the table.
    expect(screen.getByText('Timestamps are not available for scan results.')).toBeInTheDocument();
  });

  it('warns about unknown coverage on an empty pre-coverage payload instead of a trusted empty', async () => {
    // Legacy cached payload without coverage/windowBlocks tags: coverage
    // UNKNOWN must read differently from a complete scan that found
    // nothing (and from a budget-capped partial scan).
    mocks.page = legacyPage({ transfers: [], nextCursor: null });

    renderTab();

    expect(
      await screen.findByText(/Token transfer data source unknown/),
    ).toBeInTheDocument();
    expect(screen.getByText(/not proof that none exist/)).toBeInTheDocument();
    expect(screen.queryByText('No token transfers found')).not.toBeInTheDocument();
    expect(screen.queryByText(/Partial coverage/)).not.toBeInTheDocument();
    // External escape hatch, same semantics as the tx tab's banner.
    expect(screen.getByText('Routescan')).toBeInTheDocument();
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

  it('shows a neutral note instead of the raw 400 when the address itself is invalid', async () => {
    // A1: a bad-checksum address makes the scan 400, but the page-level
    // guidance card already carries that verdict (same pure check, same
    // address) — the tab must not repeat the guidance or surface the
    // server message as if it were a scan/data problem.
    mocks.error = new Error('Invalid address checksum');
    // Uppercase one body position the checksummed form holds lowercase:
    // mixed case, guaranteed EIP-55 mismatch.
    const checksummed = getAddress(mocks.holder);
    let bad = checksummed;
    for (let i = 2; i < checksummed.length; i++) {
      if (/[a-f]/.test(checksummed[i])) {
        bad = mocks.holder.slice(0, i) + mocks.holder[i].toUpperCase() + mocks.holder.slice(i + 1);
        break;
      }
    }
    expect(bad).not.toBe(checksummed);

    renderAddressRoute(`/${bad}`);

    expect(
      await screen.findByText(/Token transfers cannot be scanned for this address/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Invalid address checksum')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});
