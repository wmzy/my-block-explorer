// Directory page (/chain/:chainId/contracts) behavioral contract, driven
// through a mocked useContractDirectory hook: rows render with their
// contract-page links, verification badges and cached dates; the empty
// state explains what the cache is and how to grow it; fetch failures
// render the retryable error state, never an empty list; ?offset=
// pagination rides the URL and re-keys the hook; the filter box debounces
// into ?q= (resetting the offset); and the hook's payload echo guards the
// view against a settle that raced an argument switch.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes, useSearchParams } from '@native-router/react';
import '@testing-library/jest-dom';
import ContractsList from '@/views/Contracts/List';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">
      chain:
      {currentChainId}
    </div>
  ),
}));

// CopyableHash renders plain anchors here, keeping the href contract
// (contract page, chain-scoped) observable without the clipboard plumbing.
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
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Unknown'),
  getChainSymbol: () => 'ETH',
  isChainSupported: (chainId: number) => chainId === 1,
  POPULAR_CHAINS: [{ id: 1, name: 'Ethereum' }],
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
}));

vi.mock('@/utils/format', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/format')>();
  return { ...actual, formatRelativeTime: () => '5 min ago' };
});

type DirectoryHookResult = {
  data?: {
    chainId: number;
    chainName: string;
    contracts: Array<{
      chainId: number;
      address: string;
      name: string | null;
      isVerified: boolean;
      verificationSource: string | null;
      updatedAt: string | null;
    }>;
    total: number;
    q: string | null;
    offset: number;
  };
  loading: boolean;
  fetching?: boolean;
  error?: Error;
  refetch?: () => void;
};

const mockUseContractDirectory = vi.fn<(...args: unknown[]) => DirectoryHookResult>();

vi.mock('@/services/contractDirectory', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/contractDirectory')>();
  return { ...actual, useContractDirectory: (...args: unknown[]) => mockUseContractDirectory(...args) };
});

const ADDR_A = '0xabc0000000000000000000000000000000000001';
const ADDR_B = '0xdef0000000000000000000000000000000000002';

const row = (overrides: Partial<DirectoryHookResult['data']> = {}) =>
  ({
    chainId: 1,
    chainName: 'Ethereum',
    contracts: [
      {
        chainId: 1,
        address: ADDR_A,
        name: 'Uniswap V2',
        isVerified: true,
        verificationSource: 'sourcify',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
      {
        chainId: 1,
        address: ADDR_B,
        name: null,
        isVerified: false,
        verificationSource: null,
        updatedAt: null,
      },
    ],
    total: 2,
    q: null,
    offset: 0,
    ...overrides,
  });

// Settles whatever args the view asks for: the payload echoes the request
// (chainId/q/offset), so the view's settle guard passes for the rendered
// page — the shape the real hook produces once its fetch resolves.
const mockEchoSettle = (overrides: Partial<DirectoryHookResult['data']> = {}) => {
  mockUseContractDirectory.mockImplementation(
    (chainId: unknown, q: unknown, offset: unknown) => ({
      data: row({
        chainId: chainId as number,
        q: (q as string | undefined) ?? null,
        offset: offset as number,
        ...overrides,
      }),
      loading: false,
    }),
  );
};

// Exposes the current search string so ?q=/?offset= writes are observable
// (transactionsListPage probe pattern).
function SearchProbe() {
  const [searchParams] = useSearchParams();
  return <div data-testid="search-probe">{searchParams.toString()}</div>;
}

const renderContractsList = (path: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([{ path: '/chain/:chainId/contracts', component: () => ContractsList }])}
      initialEntries={[path]}
    >
      <View />
      <SearchProbe />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockUseContractDirectory.mockReturnValue({ data: undefined, loading: true });
});

describe('Contracts directory page', () => {
  it('renders rows with contract links, badges and cached dates', async () => {
    mockUseContractDirectory.mockReturnValue({ data: row(), loading: false });

    renderContractsList('/chain/1/contracts');

    // Named row links by name; unnamed rows keep an em-dash, both
    // addresses link to the chain's contract page (the name link and the
    // address link both target ADDR_A's contract page).
    expect(await screen.findByText('Uniswap V2')).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.map(l => l.getAttribute('href'))).toEqual([
      `/chain/1/contract/${ADDR_A}`,
      `/chain/1/contract/${ADDR_A}`,
      `/chain/1/contract/${ADDR_B}`,
    ]);
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('sourcify')).toBeInTheDocument();
    expect(screen.getByText('Unverified')).toBeInTheDocument();
    expect(screen.getByTitle('2026-09-01T00:00:00.000Z')).toHaveTextContent('5 min ago');
    // Null names and null cache dates render em-dashes, never fabricated
    // values (one per unnamed cell in the second row).
    expect(screen.getAllByText('—')).toHaveLength(2);
    // The honesty note names the data source.
    expect(screen.getByText(/Cached contract sources on this explorer/)).toBeInTheDocument();
    expect(screen.getByText(/Page 1 • 2 cached contracts/)).toBeInTheDocument();
  });

  it('renders the explained empty state for a cold cache', async () => {
    mockUseContractDirectory.mockReturnValue({
      data: row({ contracts: [], total: 0 }),
      loading: false,
    });

    renderContractsList('/chain/1/contracts');

    expect(
      await screen.findByText('No cached contracts yet — open a contract page to cache its source'),
    ).toBeInTheDocument();
    // No pagination for an empty single page.
    expect(screen.queryByText(/Page 1/)).not.toBeInTheDocument();
  });

  it('renders the filtered empty state when ?q= matches nothing', async () => {
    mockUseContractDirectory.mockReturnValue({
      data: row({ contracts: [], total: 0, q: 'zzz' }),
      loading: false,
    });

    renderContractsList('/chain/1/contracts?q=zzz');

    expect(await screen.findByText('No cached contracts match "zzz"')).toBeInTheDocument();
  });

  it('renders the retryable error state on fetch failure, not an empty list', async () => {
    mockUseContractDirectory.mockReturnValue({
      data: undefined,
      loading: false,
      error: new Error('backend exploded'),
      refetch: () => undefined,
    });

    renderContractsList('/chain/1/contracts');

    expect(await screen.findByText('backend exploded')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.queryByText(/No cached contracts/)).not.toBeInTheDocument();
  });

  it('pages through ?offset= and re-keys the hook', async () => {
    mockEchoSettle({ total: 120 });

    renderContractsList('/chain/1/contracts');

    // The route component mounts asynchronously — wait for the page
    // before pinning the hook's args.
    await screen.findByText(/Page 1/);
    expect(mockUseContractDirectory).toHaveBeenLastCalledWith(1, undefined, 0);

    fireEvent.click(screen.getByText('Next'));
    await waitFor(() =>
      expect(screen.getByTestId('search-probe').textContent).toBe('offset=50'),
    );
    expect(mockUseContractDirectory).toHaveBeenLastCalledWith(1, undefined, 50);
    expect(screen.getByText(/Page 2/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Prev'));
    await waitFor(() =>
      expect(screen.getByTestId('search-probe').textContent).toBe('offset=0'),
    );
    expect(mockUseContractDirectory).toHaveBeenLastCalledWith(1, undefined, 0);
  });

  it('debounces the filter box into ?q= and resets the offset', async () => {
    mockEchoSettle({ total: 120 });

    renderContractsList('/chain/1/contracts?q=old&offset=50');

    // Deep link: input prefilled, hook keyed to the URL state.
    const input = await screen.findByPlaceholderText('Filter by name or address prefix...');
    expect(input).toHaveValue('old');
    expect(mockUseContractDirectory).toHaveBeenLastCalledWith(1, 'old', 50);

    fireEvent.change(input, { target: { value: 'uni' } });
    await waitFor(
      // Dropping the offset key still materializes offset=0 (the schema
      // default serializes back — same materialization as ?page=1 on the
      // transactions list); the point under test is the RESET from 50.
      () => expect(screen.getByTestId('search-probe').textContent).toBe('q=uni&offset=0'),
      { timeout: 2000 },
    );
    // A new filter restarts at page 1 (offset dropped, not written as 0).
    expect(mockUseContractDirectory).toHaveBeenLastCalledWith(1, 'uni', 0);
    expect(screen.getByText(/Page 1/)).toBeInTheDocument();
  });

  it('refuses a settle whose echo does not match the rendered args', async () => {
    // The query store can hand back the PREVIOUS args' settle after a
    // switch: here offset moved to 50 but the store still holds the page-1
    // payload (echo offset 0). The view must render pending, never
    // someone else's page or the empty state.
    mockUseContractDirectory.mockReturnValue({
      data: row({ total: 2 }),
      loading: false,
    });

    renderContractsList('/chain/1/contracts?offset=50');

    // Wait for the mount (the note renders once the view is up), then
    // pin the refusal: rows exist in the payload, but the echo (offset 0)
    // does not match the rendered offset 50 — no rows, no empty state,
    // still pending.
    await screen.findByText(/Cached contract sources on this explorer/);
    expect(screen.queryByText('Uniswap V2')).not.toBeInTheDocument();
    expect(screen.queryByText(/No cached contracts/)).not.toBeInTheDocument();
  });
});
