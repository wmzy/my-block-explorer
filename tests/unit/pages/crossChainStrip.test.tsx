// CrossChainStrip rendering tests: the probe service's network fan-out
// and the DefiLlama spot fetch are mocked (the service layer has its own
// focused file); the pure ordering/selection logic stays REAL through a
// partial mock, and the custom 9-decimals chain is registered into the
// REAL runtime registry so chip formatting exercises genuine per-chain
// metadata. Pinned: the height contract (one quiet line while probing,
// collapsed one-line summary after settling, chips only behind intent),
// chip link hrefs, per-chain decimals/symbol, visible failure chips with
// the reason, USD only where a price resolved, and the absence of any
// fabricated cross-chain total.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';

import { getChainSymbol } from '@/config/chains';
import { registerCustomChain, resetCustomChainsForTests } from '@/config/customChains';
import { nativePriceId } from '@/services/prices';
import { PROBE_POPULAR_CHAIN_COUNT } from '@/services/crossChainProbe';
import { CrossChainStrip } from '@/views/Address/CrossChainStrip';

const mocks = vi.hoisted(() => ({
  probeAddressAcrossChains: vi.fn(),
  fetchUsdPrices: vi.fn(),
}));

// Partial mocks: only the network edges are replaced; the pure helpers
// (orderProbeResults, selectProbeChains, nativePriceId,
// tokenAmountToUsd) run for real.
vi.mock('@/services/crossChainProbe', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/crossChainProbe')>();
  return { ...actual, probeAddressAcrossChains: mocks.probeAddressAcrossChains };
});

vi.mock('@/services/prices', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/prices')>();
  return { ...actual, fetchUsdPrices: mocks.fetchUsdPrices };
});

const ADDRESS = '0xAbCdEf0123456789012345678901234567890123';
const CUSTOM_CHAIN_ID = 31337;

const Blank = () => null;
const routes = createRoutes([
  { path: '/chain/:chainId/address/:address', component: () => Promise.resolve(Blank) },
]);

// Stable router wrapper so rerenders reconcile instead of remounting
// (the skeleton test re-probes by switching the chainId PROP).
const Harness = ({ chainId }: { chainId: number }) => (
  <MemoryRouter routes={routes} initialEntries={[`/chain/1/address/${ADDRESS}`]}>
    <CrossChainStrip chainId={chainId} address={ADDRESS} />
  </MemoryRouter>
);

const ok = (chainId: number, balance: bigint, isContract = false) => ({
  status: 'ok' as const,
  chainId,
  balance,
  isContract,
});

const failed = (chainId: number, reason: string) => ({
  status: 'failed' as const,
  chainId,
  reason,
});

describe('CrossChainStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCustomChainsForTests();
    registerCustomChain({
      chainId: CUSTOM_CHAIN_ID,
      name: 'Anvil Local',
      symbol: 'TEST',
      decimals: 9,
      rpcUrl: 'http://127.0.0.1:8545',
    });
    // Default: no spot price resolves anywhere.
    mocks.fetchUsdPrices.mockResolvedValue(new Map());
  });

  it('renders a single quiet line while probing — no chips, no counts', async () => {
    mocks.probeAddressAcrossChains.mockReturnValue(new Promise(() => undefined));

    render(<Harness chainId={1} />);

    const line = await screen.findByTestId('cross-chain-loading');
    expect(line).toHaveTextContent('Probing other networks');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/unavailable/)).not.toBeInTheDocument();
  });

  it('settles into the collapsed one-line summary; chips appear only on intent', async () => {
    mocks.probeAddressAcrossChains.mockResolvedValue([
      ok(137, 1_500_000_000_000_000_000n),
      ok(56, 3_200_000_000_000_000_000n, true),
      ok(CUSTOM_CHAIN_ID, 1_500_000_000n),
      failed(42161, 'timed out after 4s'),
    ]);

    render(<Harness chainId={1} />);

    const summary = await screen.findByTestId('cross-chain-summary');
    expect(summary).toHaveTextContent('On 3 other networks · probing failed on 1');
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();

    fireEvent.click(summary);

    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText(
        'Detected presence on other networks (bounded probe — not a complete cross-chain history)',
      ),
    ).toBeInTheDocument();
  });

  it('renders chips as links into each probed chain’s own address page', async () => {
    mocks.probeAddressAcrossChains.mockResolvedValue([
      ok(137, 1_500_000_000_000_000_000n),
      ok(CUSTOM_CHAIN_ID, 1_500_000_000n),
    ]);

    render(<Harness chainId={1} />);
    fireEvent.click(await screen.findByTestId('cross-chain-summary'));

    const links = screen.getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      `/chain/137/address/${ADDRESS}`,
      `/chain/${CUSTOM_CHAIN_ID}/address/${ADDRESS}`,
    ]);
  });

  it('formats balances with each chain’s own decimals and symbol', async () => {
    mocks.probeAddressAcrossChains.mockResolvedValue([
      ok(137, 1_500_000_000_000_000_000n),
      ok(CUSTOM_CHAIN_ID, 1_500_000_000n),
    ]);

    render(<Harness chainId={1} />);
    fireEvent.click(await screen.findByTestId('cross-chain-summary'));

    const links = screen.getAllByRole('link');
    // 18-decimal popular chain...
    expect(links[0]).toHaveTextContent(`1.5000 ${getChainSymbol(137)}`);
    // ...and the 9-decimal custom chain: same human amount, different units.
    expect(links[1]).toHaveTextContent('1.5000 TEST');
  });

  it('shows a USD estimate only where a spot price resolved — never a cross-chain total', async () => {
    const polygonId = nativePriceId(137);
    expect(polygonId).not.toBeNull();
    mocks.fetchUsdPrices.mockImplementation(async (ids: readonly string[]) =>
      new Map(ids.filter(id => id === polygonId).map(id => [id, { usd: 0.42, fetchedAt: Date.now() }])),
    );
    mocks.probeAddressAcrossChains.mockResolvedValue([
      ok(137, 1_500_000_000_000_000_000n),
      ok(56, 3_200_000_000_000_000_000n, true),
      ok(CUSTOM_CHAIN_ID, 1_500_000_000n),
    ]);

    render(<Harness chainId={1} />);
    fireEvent.click(await screen.findByTestId('cross-chain-summary'));

    // Priced chain: 1.5 × $0.42 = $0.63 beside the native figure.
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveTextContent('$0.63');
    // Unpriced chains (mapped-but-unanswered AND unmapped): no figure.
    expect(links[1]).not.toHaveTextContent(/\$/);
    expect(links[2]).not.toHaveTextContent(/\$/);
    // Exactly one USD figure in the whole strip — no summed total.
    expect(screen.getAllByText(/\$\d/)).toHaveLength(1);
    expect(screen.queryByText(/total/i)).not.toBeInTheDocument();
  });

  it('renders failed probes as muted unavailable chips carrying the reason', async () => {
    mocks.probeAddressAcrossChains.mockResolvedValue([
      ok(137, 1n),
      failed(42161, 'timed out after 4s'),
    ]);

    render(<Harness chainId={1} />);
    fireEvent.click(await screen.findByTestId('cross-chain-summary'));

    const failedChip = screen.getByTitle('timed out after 4s');
    expect(failedChip).toHaveTextContent('unavailable');
    // A failure is not a link: there is nothing on that chain to navigate
    // to from this probe.
    expect(failedChip.closest('a')).toBeNull();
    // And never a zero balance for the failed chain.
    expect(failedChip).not.toHaveTextContent(/0\.0000/);
  });

  it('orders chips by USD value desc, unknowns after, chainId tiebreak', async () => {
    const polygonId = nativePriceId(137);
    const bscId = nativePriceId(56);
    const usdById = new Map<string, number>([
      [polygonId as string, 0.42],
      [bscId as string, 600],
    ]);
    mocks.fetchUsdPrices.mockImplementation(async (ids: readonly string[]) =>
      new Map(
        ids
          .filter(id => usdById.has(id))
          .map(id => [id, { usd: usdById.get(id) as number, fetchedAt: Date.now() }]),
      ),
    );
    mocks.probeAddressAcrossChains.mockResolvedValue([
      ok(CUSTOM_CHAIN_ID, 1_500_000_000n),
      ok(137, 1_500_000_000_000_000_000n),
      ok(56, 3_200_000_000_000_000_000n, true),
      failed(42161, 'request failed'),
    ]);

    render(<Harness chainId={1} />);
    fireEvent.click(await screen.findByTestId('cross-chain-summary'));

    // BNB ($1,920) > Polygon ($0.63); then unpriced custom chain and the
    // failed probe by chainId (31337 < 42161).
    const chips = screen.getAllByRole('listitem');
    expect(chips.map(chip => chip.textContent)).toEqual([
      expect.stringContaining('BNB'),
      expect.stringContaining('Polygon'),
      expect.stringContaining('Anvil Local'),
      expect.stringContaining('Arbitrum'),
    ]);
  });

  it('summarizes zero presence without failures honestly', async () => {
    mocks.probeAddressAcrossChains.mockResolvedValue([
      ok(137, 0n),
      ok(56, 0n),
    ]);

    render(<Harness chainId={1} />);

    expect(await screen.findByTestId('cross-chain-summary')).toHaveTextContent(
      'No presence detected on 2 other networks',
    );
  });

  it('singularizes the summary for one detected network', async () => {
    mocks.probeAddressAcrossChains.mockResolvedValue([
      ok(137, 0n),
      ok(56, 1n),
    ]);

    render(<Harness chainId={1} />);

    expect(await screen.findByTestId('cross-chain-summary')).toHaveTextContent(
      'On 1 other network',
    );
  });

  it('renders nothing at all when there are no candidate chains', async () => {
    mocks.probeAddressAcrossChains.mockResolvedValue([]);

    const { container } = render(<Harness chainId={1} />);

    await screen.findByTestId('cross-chain-loading');
    // Settling on zero candidates is a clean absence.
    await waitForAbsence();
    expect(container).toBeEmptyDOMElement();
  });

  it('re-probes on chain switch and shows staggered skeletons behind given intent', async () => {
    mocks.probeAddressAcrossChains.mockResolvedValueOnce([ok(137, 1n)]);

    const view = render(<Harness chainId={1} />);
    fireEvent.click(await screen.findByTestId('cross-chain-summary'));

    // Switching the viewed chain re-probes; the expanded state persists,
    // so the loading state renders skeleton chips — one per popular
    // slot, staggered — instead of collapsing away.
    mocks.probeAddressAcrossChains.mockReturnValue(new Promise(() => undefined));
    view.rerender(<Harness chainId={137} />);

    const skeletons = await screen.findAllByTestId('cross-chain-skeleton');
    expect(skeletons).toHaveLength(PROBE_POPULAR_CHAIN_COUNT);
    const delays = new Set(skeletons.map(chip => chip.style.animationDelay));
    expect(delays.size).toBe(PROBE_POPULAR_CHAIN_COUNT);
    expect(mocks.probeAddressAcrossChains).toHaveBeenLastCalledWith(137, ADDRESS);
  });
});

// The empty-candidates case settles asynchronously (a microtask between
// the loading line and the clean absence) — one rAF-ish drain.
function waitForAbsence(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}
