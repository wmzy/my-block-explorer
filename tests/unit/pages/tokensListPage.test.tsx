// Token directory page (/chain/:chainId/tokens) behavioral contract,
// driven through a mocked useTokenDirectoryReads hook and a mocked prices
// batch: curated + viewed rows render with token-page links, the provable
// 'ERC-20' standard (em-dash otherwise), DefiLlama prices and provenance
// chips; the not-a-registry caveat renders in EVERY state (rows, empty,
// error, pending); ?q= deep-links and the debounced filter box ride the
// URL; and the payload-echo settle guard refuses a settle that raced an
// argument switch. The directory rows themselves come from the REAL
// service helpers over the real curated config + seeded localStorage.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes, useSearchParams } from '@native-router/react';
import { getAddress } from 'viem';
import '@testing-library/jest-dom';
import TokensList from '@/views/Tokens/List';
import {
  tokenDirectoryAddressesKey,
  type TokenDirectoryReads,
} from '@/services/tokenDirectory';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">
      chain:
      {currentChainId}
    </div>
  ),
}));

// CopyableHash renders plain anchors here, keeping the href contract
// (token page, chain-scoped) observable without the clipboard plumbing.
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
    if (chainId === 31337) return { id: 31337, name: 'Anvil', nativeCurrency: { symbol: 'ETH' } };
    return null;
  },
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Anvil'),
  getChainSymbol: () => 'ETH',
  isChainSupported: (chainId: number) => chainId === 1 || chainId === 31337,
  POPULAR_CHAINS: [{ id: 1, name: 'Ethereum' }],
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
}));

// Only the enrichment hook is replaced: the real merge/filter/storage
// helpers drive the rows from the real curated config + localStorage.
vi.mock('@/services/tokenDirectory', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/tokenDirectory')>();
  return {
    ...actual,
    useTokenDirectoryReads: (...args: unknown[]) => mockUseTokenDirectoryReads(...args),
  };
});

vi.mock('@/services/prices', () => ({
  useTokenUsdPrices: (...args: unknown[]) => mockUseTokenUsdPrices(...args),
}));

type ReadsHookResult = {
  data?: {
    chainId: number;
    addressesKey: string;
    reads: Map<string, TokenDirectoryReads>;
  };
  loading: boolean;
  fetching?: boolean;
  error?: Error;
  refetch?: () => void;
};

const mockUseTokenDirectoryReads = vi.fn<(...args: unknown[]) => ReadsHookResult>();
const mockUseTokenUsdPrices = vi.fn<(...args: unknown[]) => Map<string, { usd: number; fetchedAt: number }>>();

// Curated mainnet fixtures the assertions rely on (config/knownTokens).
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const WETH_LOWER = WETH.toLowerCase();
// A viewed token NOT in the curated list (seeded into localStorage).
const VIEWED_CHECKSUMMED = getAddress(`0x${'77'.repeat(20)}`);
const VIEWED = VIEWED_CHECKSUMMED.toLowerCase();

const CAVEAT =
  'Known tokens on this chain — a curated list plus tokens opened in this browser. Not a complete registry.';

// Settles whatever args the view asks for: the payload echoes the request
// (chainId + addresses-set digest), so the view's settle guard passes for
// the rendered directory — the shape the real hook produces once its
// multicall resolves.
const echoSettle = (reads: Map<string, TokenDirectoryReads>) => {
  mockUseTokenDirectoryReads.mockImplementation(
    (chainId: unknown, addresses: unknown) => ({
      data: {
        chainId: chainId as number,
        addressesKey: tokenDirectoryAddressesKey(addresses as readonly string[]),
        reads,
      },
      loading: false,
      refetch: () => undefined,
    }),
  );
};

// Exposes the current search string so ?q= writes are observable
// (transactionsListPage probe pattern).
function SearchProbe() {
  const [searchParams] = useSearchParams();
  return <div data-testid="search-probe">{searchParams.toString()}</div>;
}

const renderTokensList = (path: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([{ path: '/chain/:chainId/tokens', component: () => TokensList }])}
      initialEntries={[path]}
    >
      <View />
      <SearchProbe />
    </MemoryRouter>,
  );

const seedViewedToken = () => {
  localStorage.setItem(
    'be:viewedTokens:1',
    JSON.stringify([
      {
        address: VIEWED_CHECKSUMMED,
        symbol: 'MOON',
        name: 'MoonToken',
        firstSeen: '2026-09-24T00:00:00.000Z',
      },
    ]),
  );
};

const baseReads = () => {
  const reads = new Map<string, TokenDirectoryReads>();
  // WETH answers the full ERC-20 surface; the viewed token answers
  // name/symbol but not decimals/totalSupply (an ERC-721 shape).
  reads.set(WETH_LOWER, {
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    totalSupply: 1_000_000n,
  });
  reads.set(VIEWED, {
    name: 'MoonToken',
    symbol: 'MOON',
    decimals: null,
    totalSupply: null,
  });
  return reads;
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  seedViewedToken();
  mockUseTokenDirectoryReads.mockReturnValue({ data: undefined, loading: true });
  mockUseTokenUsdPrices.mockReturnValue(new Map());
});

describe('Tokens directory page', () => {
  it('renders curated and viewed rows with links, standards, prices, chips and the caveat', async () => {
    echoSettle(baseReads());
    const prices = new Map([[WETH_LOWER, { usd: 2740.68, fetchedAt: Date.now() }]]);
    mockUseTokenUsdPrices.mockReturnValue(prices);

    renderTokensList('/chain/1/tokens');

    // 16 curated mainnet rows + the seeded viewed row.
    expect(await screen.findByText('WETH')).toBeInTheDocument();
    expect(screen.getAllByText('Curated')).toHaveLength(16);
    expect(screen.getAllByText('Viewed')).toHaveLength(1);

    // WETH row: token-page link, resolved name, provable standard, price.
    const wethLink = screen.getByRole('link', { name: 'WETH' });
    expect(wethLink.getAttribute('href')).toBe(`/chain/1/token/${WETH}`);
    expect(screen.getByText('Wrapped Ether')).toBeInTheDocument();
    expect(screen.getAllByText('ERC-20')).toHaveLength(1);
    expect(screen.getByText('$2,740.68')).toBeInTheDocument();

    // Viewed row: link from its runtime symbol, unprovable standard.
    const moonLink = screen.getByRole('link', { name: 'MOON' });
    expect(moonLink.getAttribute('href')).toBe(`/chain/1/token/${VIEWED_CHECKSUMMED}`);

    // Rows without an ERC-20-provable answer render an em-dash, never a
    // guessed standard (every remaining row of the 17).
    expect(screen.getAllByText('—')).toHaveLength(16);

    // The honesty note names exactly what the list is.
    expect(screen.getByText(CAVEAT)).toBeInTheDocument();
  });

  it('deep-links ?q= to a filtered shareable view with the count note', async () => {
    echoSettle(baseReads());

    renderTokensList('/chain/1/tokens?q=pepe');

    expect(await screen.findByText('PEPE')).toBeInTheDocument();
    // The filter matched exactly one of the 17 directory rows.
    expect(screen.getByText('1 of 17 tokens match "pepe"')).toBeInTheDocument();
    expect(screen.queryByText('WETH')).not.toBeInTheDocument();
    expect(screen.getByText(CAVEAT)).toBeInTheDocument();
  });

  it('debounces the filter box into ?q=', async () => {
    echoSettle(baseReads());

    renderTokensList('/chain/1/tokens');

    const input = await screen.findByPlaceholderText('Filter by symbol, name or address...');
    fireEvent.change(input, { target: { value: 'link' } });
    await waitFor(
      () => expect(screen.getByTestId('search-probe').textContent).toBe('q=link'),
      { timeout: 2000 },
    );
    // The hook re-keyed through the URL state (the filter is client-side;
    // the enrichment args carry the full directory either way).
    expect(screen.getByText('LINK')).toBeInTheDocument();
  });

  it('renders the explained empty state with the caveat for a chain with no directory', async () => {
    // Anvil: supported by the chain mock, absent from the curated config,
    // and nothing viewed in this browser.
    echoSettle(new Map());

    renderTokensList('/chain/31337/tokens');

    expect(
      await screen.findByText('No known tokens on this chain yet — open a token page to add it here'),
    ).toBeInTheDocument();
    expect(screen.getByText(CAVEAT)).toBeInTheDocument();
  });

  it('renders the filtered empty state when ?q= matches nothing', async () => {
    echoSettle(new Map());

    renderTokensList('/chain/1/tokens?q=zzz');

    expect(await screen.findByText('No tokens match "zzz"')).toBeInTheDocument();
    expect(screen.getByText(CAVEAT)).toBeInTheDocument();
  });

  it('renders the retryable error state on enrichment failure, not an empty list', async () => {
    mockUseTokenDirectoryReads.mockReturnValue({
      data: undefined,
      loading: false,
      error: new Error('Could not read token details from the RPC'),
      refetch: () => undefined,
    });

    renderTokensList('/chain/1/tokens');

    expect(
      await screen.findByText('Could not read token details from the RPC'),
    ).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.queryByText('WETH')).not.toBeInTheDocument();
    expect(screen.queryByText(/No tokens match/)).not.toBeInTheDocument();
    // The caveat stays visible in the error state too.
    expect(screen.getByText(CAVEAT)).toBeInTheDocument();
  });

  it('refuses a settle whose echo does not match the rendered directory', async () => {
    // The store can hand back the PREVIOUS args' settle after a switch:
    // here the payload echoes a different address set than the rendered
    // 17-row directory. The view must render pending, never someone
    // else's enrichment or the empty state.
    mockUseTokenDirectoryReads.mockReturnValue({
      data: {
        chainId: 1,
        addressesKey: tokenDirectoryAddressesKey([`0x${'de'.repeat(20)}`]),
        reads: new Map(),
      },
      loading: false,
    });

    renderTokensList('/chain/1/tokens');

    // Wait for the mount (the caveat renders once the view is up), then
    // pin the refusal: rows exist in storage but the echo mismatch keeps
    // the table hidden — skeleton only, no rows, no empty state.
    await screen.findByText(CAVEAT);
    expect(screen.queryByText('WETH')).not.toBeInTheDocument();
    expect(screen.queryByText(/No known tokens/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No tokens match/)).not.toBeInTheDocument();
  });
});
