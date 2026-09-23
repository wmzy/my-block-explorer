// Token lens page tests: hooks mocked with settled results (code read,
// token probes, token-mode scan), the REAL TokenTransfers component
// rendered inside the page (the scan is reused, never forked — pinned by
// asserting the mode=token call shape on the shared service hook). Covers
// the header + overview grid + discovered caveats, the holders ranking
// with share percentages, mint/burn aggregates, every not-a-token guard
// (EOA, delegated EOA, settled-no-probes, transport failure, two-tier
// invalid address), and the wave-1 mobile stacking convention.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import { getAddress } from 'viem';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import TokenPage from '@/views/Token';
import { resetPricesForTests } from '@/services/prices';
// Type-only import: erased at runtime, so the vi.mock below is unaffected.
import type { TokenTransfer, TokenTransferPage } from '@/services/tokenTransfers';

// Explicit knob types for the hoisted mock store: without them, const
// initializer narrowing infers e.g. detection: 'token' (not the union) and
// per-case reassignments of undefined/narrower shapes stop typechecking.
type ProbeReads = {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: bigint | null;
};

type TokenPageMocks = {
  testAddress: string;
  alice: string;
  bob: string;
  carol: string;
  zero: string;
  transfers: TokenTransfer[];
  scanPage: TokenTransferPage;
  contractCode: string | undefined;
  contractCodeLoading: boolean;
  contractCodeError: Error | undefined;
  reads: ProbeReads | undefined;
  settled: boolean;
  detection: 'token' | 'plain-contract' | 'none';
  transfersData: TokenTransferPage | undefined;
  transfersLoading: boolean;
  transfersError: Error | undefined;
  calls: unknown[][];
};

const mocks = vi.hoisted<TokenPageMocks>(() => {
  const testAddress = `0x${'a1'.repeat(20)}`;
  const alice = '0x1111111111111111111111111111111111111111';
  const bob = '0x2222222222222222222222222222222222222222';
  const carol = '0x3333333333333333333333333333333333333333';
  const zero = '0x0000000000000000000000000000000000000000';
  // Token-mode scan rows (the viewed contract as log emitter, direction
  // 'none'): mint 1000 to Alice, Alice→Bob 400, Alice→Carol 50, Bob burns
  // 100. Discovered nets: Alice +550, Bob +300, Carol +50 (supply 900).
  const transferRow = (
    fields: Partial<TokenTransfer>,
  ): TokenTransfer => ({
    txHash: `0x${'00'.repeat(32)}`,
    blockNumber: 18_000_000,
    logIndex: 0,
    token: testAddress,
    standard: 'erc20-or-erc721',
    from: alice,
    to: bob,
    value: '1',
    direction: 'none',
    ...fields,
  });
  const transfers: TokenTransfer[] = [
    transferRow({ from: zero, to: alice, value: '1000000000000000000000' }),
    transferRow({ from: alice, to: bob, value: '400000000000000000000' }),
    transferRow({ from: alice, to: carol, value: '50000000000000000000' }),
    transferRow({ from: bob, to: zero, value: '100000000000000000000' }),
  ];
  const scanPage: TokenTransferPage = {
    transfers,
    nextCursor: null,
    coverage: 'complete',
    windowBlocks: 100_000,
    mode: 'token',
  };
  // The literal fields inline cleanly: the explicit TokenPageMocks type
  // contextually widens them (no `as` casts, no narrowing traps).
  return {
    testAddress,
    alice,
    bob,
    carol,
    zero,
    transfers,
    scanPage,
    // eth_getCode result: undefined = not read yet, '0x' = EOA, bytecode =
    // contract, '0xef0100…' = EIP-7702 delegated EOA.
    contractCode: '0x608060405234801561000f57600080fd5b50',
    contractCodeLoading: false,
    contractCodeError: undefined,
    // Settle-aware probe knobs: reads undefined + settled false = reading,
    // all-null + settled = plain contract, undefined + settled = transport
    // failure (never a not-a-token verdict).
    reads: {
      name: 'Mock Token',
      symbol: 'MCK',
      decimals: 18,
      totalSupply: 1_234_500_000_000_000_000_000_000n,
    },
    settled: true,
    // TokenTransfers' internal detection knob ('token' = detected token).
    detection: 'token',
    transfersData: scanPage,
    transfersLoading: false,
    transfersError: undefined,
    // Every useTokenTransfers call's positional args (the page piggyback
    // AND the real TokenTransfers component share the service hook).
    calls: [],
  };
});

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">TopNav chain={currentChainId}</div>
  ),
}));

vi.mock('@/config/chains', () => ({
  getChainInfo: (chainId: number) => {
    if (chainId === 1) {
      return { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } };
    }
    return null;
  },
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Unknown'),
  getChainSymbol: (chainId: number) => (chainId === 1 ? 'ETH' : 'UNKNOWN'),
  isChainSupported: (chainId: number) => chainId === 1,
  getPreferredChainId: () => 1,
  readRememberedChainId: () => 1,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
  POPULAR_CHAINS: [{ id: 1, name: 'Ethereum' }],
}));

vi.mock('@/services/addressRealTime', () => ({
  useContractCode: () => ({
    data: mocks.contractCode,
    loading: mocks.contractCodeLoading,
    fetching: false,
    error: mocks.contractCodeError,
  }),
}));

vi.mock('@/services/tokenMetadata', () => ({
  // The page's settle-aware detection hook. Honors `enabled` exactly like
  // the real hook (disabled → unsettled, zero network) so the guard
  // branches see realistic probe states.
  useTokenOverviewProbe: (
    _chainId: number,
    _token: string,
    enabled: boolean,
  ) =>
    enabled
      ? { reads: mocks.reads, settled: mocks.settled }
      : { reads: undefined, settled: false },
  // The REAL TokenTransfers component rides the same module-cached
  // detection; the knob mirrors the page's so both agree.
  useTokenOverview: (
    _chainId: number,
    _token: string,
    enabled: boolean,
  ) => {
    if (!enabled || mocks.detection === 'none') return undefined;
    if (mocks.detection === 'token') return mocks.reads;
    return { name: null, symbol: null, decimals: null, totalSupply: null };
  },
}));

vi.mock('@/services/tokenTransfers', () => ({
  // Args captured on EVERY call so the tests can pin the token-mode call
  // shape (cursor '0', limit 25, window undefined, mode 'token') shared by
  // the page's holders piggyback and the real transfers component.
  useTokenTransfers: (...args: unknown[]) => {
    mocks.calls.push(args);
    return {
      data: mocks.transfersData,
      loading: mocks.transfersLoading,
      fetching: false,
      error: mocks.transfersError,
      refetch: () => undefined,
    };
  },
  requestTokenTransfersRefresh: () => undefined,
}));

vi.mock('@/utils/realTimeData', () => ({
  // Row-enrichment stand-in: every token resolves symbol + decimals so the
  // shared-signature rows render as ERC-20 amounts.
  createRpcClient: vi.fn(async () => ({
    readContract: async (call: { functionName: string }) => {
      if (call.functionName === 'symbol') return 'MCK';
      return 18;
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

const routes = createRoutes([
  {
    path: '/chain/:chainId/token/:address',
    component: () => Promise.resolve(TokenPage),
  },
]);

const renderPage = (path = `/chain/1/token/${mocks.testAddress}`) =>
  render(
    <MemoryRouter routes={routes} initialEntries={[path]}>
      <View />
    </MemoryRouter>,
  );

const formatAddr = (a: string) => `${a.slice(0, 8)}...${a.slice(-6)}`;

describe('Token page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contractCode = '0x608060405234801561000f57600080fd5b50';
    mocks.contractCodeLoading = false;
    mocks.contractCodeError = undefined;
    mocks.reads = {
      name: 'Mock Token',
      symbol: 'MCK',
      decimals: 18,
      totalSupply: 1_234_500_000_000_000_000_000_000n,
    };
    mocks.settled = true;
    mocks.detection = 'token';
    mocks.transfersData = mocks.scanPage;
    mocks.transfersLoading = false;
    mocks.transfersError = undefined;
    mocks.calls = [];
  });

  it('renders the header with name (symbol), checksummed address and cross-view links', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Mock Token (MCK)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Ethereum • Chain ID: 1')).toBeInTheDocument();

    // Checksummed display address (CopyableHash truncation).
    const display = getAddress(mocks.testAddress);
    expect(screen.getByText(formatAddr(display))).toBeInTheDocument();

    const contractLink = screen.getByText('View contract page →').closest('a');
    expect(contractLink?.getAttribute('href')).toBe(
      `/chain/1/contract/${mocks.testAddress}`,
    );
    const addressLink = screen.getByText('View as address →').closest('a');
    expect(addressLink?.getAttribute('href')).toBe(
      `/chain/1/address/${mocks.testAddress}`,
    );
  });

  it('renders the overview grid with the existing honesty semantics', async () => {
    renderPage();

    expect(await screen.findByText('Token Overview')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Mock Token')).toBeInTheDocument();
    expect(screen.getByText('Decimals')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    // BigInt-exact supply formatted with the TOKEN's decimals.
    expect(screen.getByText('1234500')).toBeInTheDocument();
    // 'ERC-20' is claimed only when decimals AND totalSupply responded —
    // the overview badge is the success-variant one.
    expect(
      screen.getAllByText('ERC-20').some(el => el.dataset.variant === 'success'),
    ).toBe(true);
  });

  it('reuses the token-mode scan: every service call carries mode=token at the page-1 key', async () => {
    renderPage();

    await screen.findByText('Token Transfers');
    // Two consumers share the hook: the page's holders piggyback and the
    // REAL TokenTransfers component — identical args (the shared cache
    // entry), never a forked scan.
    expect(mocks.calls.length).toBeGreaterThanOrEqual(2);
    for (const args of mocks.calls) {
      expect(args[0]).toBe(1);
      expect(args[1]).toBe(mocks.testAddress);
      expect(args[2]).toBe('0');
      expect(args[3]).toBe(25);
      expect(args[4]).toBeUndefined();
      expect(args[5]).toBe('token');
    }
  });

  it('renders the discovered holders ranking with share percentages', async () => {
    renderPage();

    expect(await screen.findByText('Top Holders (discovered)')).toBeInTheDocument();
    // Nets 550/300/50 of discovered supply 900 (ERC-20 rows, 18 decimals).
    // '50 MCK' also appears as a raw transfer row below — the holders
    // card's nets are among the matches.
    expect(screen.getAllByText('550 MCK').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('300 MCK').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('50 MCK').length).toBeGreaterThanOrEqual(1);
    // Truncated basis points rendered as percentages.
    expect(screen.getByText('61.11%')).toBeInTheDocument();
    expect(screen.getByText('33.33%')).toBeInTheDocument();
    expect(screen.getByText('5.55%')).toBeInTheDocument();
    // Holder address links route to the address page (the same truncated
    // text also appears in the transfers table's From/To columns).
    expect(
      screen
        .getAllByText(formatAddr(mocks.alice))
        .some(el => el.closest('a')?.getAttribute('href') === `/chain/1/address/${mocks.alice}`),
    ).toBe(true);
  });

  it('renders the mint/burn aggregates BigInt-exactly', async () => {
    renderPage();

    expect(await screen.findByText('Mint / Burn (discovered)')).toBeInTheDocument();
    expect(screen.getByText('Mint events')).toBeInTheDocument();
    // One mint + one burn among the scanned rows (rank numbers also render
    // '1', so the count is asserted as multiple matches).
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2);
    // '1000 MCK' also appears as the mint row's amount in the transfers
    // table below — the aggregate is among the matches.
    expect(screen.getAllByText('1000 MCK').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('100 MCK').length).toBeGreaterThanOrEqual(1);
  });

  it('carries the discovered caveat under both aggregates and renders token-mode rows', async () => {
    renderPage();

    // The mandatory incompleteness caveat (holders + mint/burn).
    expect(
      (await screen.findAllByText(/discovered from scanned window — may be incomplete/i))
        .length,
    ).toBe(2);

    // The transfers section is the REAL TokenTransfers component: row
    // amounts appear per-event (400 MCK exists only in the table, the
    // holders card shows nets) and 'none'-direction rows render the em
    // dash honestly instead of a guessed IN/OUT.
    expect(await screen.findByText('400 MCK')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders the dedicated not-a-token card for an EOA and parks every scan', async () => {
    mocks.contractCode = '0x';

    renderPage();

    expect(
      await screen.findByText('This address is not a token contract'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/externally owned account|EOA/),
    ).toBeInTheDocument();
    const addressLink = screen.getByText('View as address →').closest('a');
    expect(addressLink?.getAttribute('href')).toBe(
      `/chain/1/address/${mocks.testAddress}`,
    );
    // No contract view exists for an EOA — the link stays absent.
    expect(screen.queryByText('View contract page →')).not.toBeInTheDocument();
    expect(screen.queryByText('Token Overview')).not.toBeInTheDocument();
    // The holders piggyback stays parked on the disabled key (chainId 0):
    // zero network for an address that cannot be a token.
    for (const args of mocks.calls) expect(args[0]).toBe(0);
  });

  it('renders the dedicated card with BOTH links when the probes settled on nothing', async () => {
    mocks.reads = { name: null, symbol: null, decimals: null, totalSupply: null };

    renderPage();

    expect(
      await screen.findByText('This address is not a token contract'),
    ).toBeInTheDocument();
    expect(screen.getByText(/none of the standard token probes/)).toBeInTheDocument();
    expect(screen.getByText('View as address →')).toBeInTheDocument();
    expect(screen.getByText('View contract page →')).toBeInTheDocument();
  });

  it('renders the dedicated card for an EIP-7702 delegated account', async () => {
    mocks.contractCode = `0xef0100${'ab'.repeat(20)}`;

    renderPage();

    expect(
      await screen.findByText('This address is not a token contract'),
    ).toBeInTheDocument();
    expect(screen.getByText(/EIP-7702 delegated account/)).toBeInTheDocument();
    expect(screen.queryByText('View contract page →')).not.toBeInTheDocument();
  });

  it('never mistakes a transport-level probe failure for a not-a-token verdict', async () => {
    mocks.reads = undefined;
    mocks.settled = true;

    renderPage();

    expect(
      await screen.findByText(/Could not read the token interface/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('This address is not a token contract'),
    ).not.toBeInTheDocument();
  });

  it('surfaces the checksum tier for an invalid-checksum address (never a valid page)', async () => {
    // Flip the case of the checksummed form's first body char: guaranteed
    // mixed case + guaranteed checksum mismatch.
    const checksummed = getAddress(mocks.testAddress);
    const first = checksummed.slice(2, 3);
    const flipped = first === first.toUpperCase() ? first.toLowerCase() : first.toUpperCase();
    const corrupted = `0x${flipped}${checksummed.slice(3)}`;

    renderPage(`/chain/1/token/${corrupted}`);

    expect(await screen.findByText(/invalid checksum/i)).toBeInTheDocument();
    expect(screen.getByText('Open the all-lowercase form →')).toBeInTheDocument();
    // An invalid address never renders the token surface.
    expect(screen.queryByText('Token Overview')).not.toBeInTheDocument();
  });

  it('surfaces the format tier for a malformed address', async () => {
    renderPage('/chain/1/token/0x123');

    expect(await screen.findByText(/Not a valid address format/i)).toBeInTheDocument();
  });

  it('shows the checking state while the code read is in flight', async () => {
    mocks.contractCode = undefined;
    mocks.contractCodeLoading = true;

    renderPage();

    expect(await screen.findByText('Checking token contract...')).toBeInTheDocument();
  });

  it('shows the code-read failure instead of a wrong not-a-token verdict', async () => {
    mocks.contractCode = undefined;
    mocks.contractCodeError = new Error('RPC connection refused');

    renderPage();

    expect(await screen.findByText(/Could not read on-chain code/)).toBeInTheDocument();
    expect(
      screen.queryByText('This address is not a token contract'),
    ).not.toBeInTheDocument();
  });

  it('shows the reading state while the token probes are unsettled', async () => {
    mocks.settled = false;

    renderPage();

    expect(await screen.findByText('Reading token interface...')).toBeInTheDocument();
  });

  it('keeps the unknown-standard token honest: warning badge, no holders, amounts not summed', async () => {
    // Name/symbol respond, decimals+totalSupply revert: the classic
    // ERC-721 shape — 'standard unknown', never a guessed 'ERC-20'.
    mocks.reads = { name: 'Punks', symbol: 'PUNK', decimals: null, totalSupply: null };

    renderPage();

    expect(
      await screen.findByText('Token (standard unknown — possibly ERC-721)'),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('Token (standard unknown — possibly ERC-721)').some(
        el => el.dataset.variant === 'warning',
      ),
    ).toBe(true);
    // Holder balances are ERC-20 semantics — no holders card at all.
    expect(screen.queryByText('Top Holders (discovered)')).not.toBeInTheDocument();
    // Mint/burn events still count; amounts stay unsupmed.
    expect(screen.getByText('Mint events')).toBeInTheDocument();
    expect(screen.getByText(/events counted, amounts not summed/)).toBeInTheDocument();
    // Total supply is absent (never fabricated), name still visible.
    expect(screen.queryByText('Total Supply')).not.toBeInTheDocument();
    expect(screen.getByText('Punks')).toBeInTheDocument();
  });

  it('keeps the wave-1 mobile convention: stacking rules at 768px and reused machinery', () => {
    // linaria is zero-runtime, so jsdom never applies the CSS — the pin is
    // that the degradation rules exist in the source at all (the same
    // technique as responsiveLayout.test.tsx).
    const src = readFileSync(resolve(__dirname, '../../..', 'src/views/Token/index.tsx'), 'utf8');
    // headerRow + holderRankRow + nextStepLinks each carry the breakpoint.
    expect(src.match(/@media \(max-width: 768px\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(src).toContain('flex-wrap: wrap');
    // The scan and the holders netting are REUSED, not forked (needles are
    // quote-free to stay inside the single-quote lint rule).
    expect(src).toContain('@/views/Address/TokenTransfers');
    expect(src).toContain('@/views/Address/tokenOverview');
    const math = readFileSync(resolve(__dirname, '../../..', 'src/views/Token/tokenMath.ts'), 'utf8');
    expect(math).toContain('computeDiscoveredHolders');
  });

  // --- USD rows (browser-side DefiLlama price layer) ---

  it('renders Price and Market Cap via DefiLlama when the token is priced', async () => {
    resetPricesForTests();
    const id = `ethereum:${getAddress(mocks.testAddress)}`;
    const now = Math.floor(Date.now() / 1000);
    // Spot and history hit the same host: branch on the path so the
    // Price History card settles ok too (Low $2.00 / High $3.50 /
    // Latest $3.00 — all distinct from the spot $2.50 figures so
    // getByText stays unambiguous).
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/chart/')) {
          return {
            ok: true,
            json: async () => ({
              coins: {
                [id]: {
                  symbol: 'MCK',
                  confidence: 0.9,
                  prices: [
                    { timestamp: now - 5 * 86_400, price: 2 },
                    { timestamp: now - 3 * 86_400, price: 3.5 },
                    { timestamp: now - 1 * 86_400, price: 3 },
                  ],
                },
              },
            }),
          };
        }
        return { ok: true, json: async () => ({ coins: { [id]: { price: 2.5 } } }) };
      }),
    );

    try {
      renderPage();

      // Overview card: Price $2.50 and Market Cap 1,234,500 × $2.5 =
      // $3,086,250 → compact $3.09M, each with the provenance suffix.
      expect(await screen.findAllByText('$2.50')).toHaveLength(2);
      expect(screen.getByText('$3.09M')).toBeInTheDocument();
      // Two provenance rows + the Price History card's source chip.
      expect(screen.getAllByText('via DefiLlama')).toHaveLength(3);
      expect(screen.getAllByTitle(/Price via DefiLlama · updated \d+s ago/)).toHaveLength(2);
      // Price History card (ok): Low/High/Latest facts from the series
      // extent, plus the Live fact mirroring the spot snapshot ($2.50 —
      // the second occurrence counted above).
      expect(screen.getByText('Low')).toBeInTheDocument();
      expect(screen.getByText('$2.00')).toBeInTheDocument();
      expect(screen.getByText('High')).toBeInTheDocument();
      expect(screen.getByText('$3.50')).toBeInTheDocument();
      expect(screen.getByText('Latest')).toBeInTheDocument();
      expect(screen.getByText('$3.00')).toBeInTheDocument();
      expect(screen.getByText('Live')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
      resetPricesForTests();
    }
  });

  it('renders no USD rows and no provenance when the price fetch fails', async () => {
    resetPricesForTests();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    try {
      renderPage();

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Mock Token (MCK)' }),
      ).toBeInTheDocument();
      await waitFor(() => {
        // Settled-unavailable: zero USD figures anywhere on the page.
        expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
      });
      // The OVERVIEW card's provenance rows are gone; the Price History
      // card legitimately keeps its source chip while its own separate
      // lookup settles unavailable with the reason on display.
      expect(screen.queryAllByTitle(/Price via DefiLlama · updated/)).toHaveLength(0);
      expect(screen.queryByText('Price')).not.toBeInTheDocument();
      expect(screen.queryByText('Market Cap')).not.toBeInTheDocument();
      expect(
        await screen.findByText('Price history unavailable — request failed.'),
      ).toBeInTheDocument();
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
      resetPricesForTests();
    }
  });
});
