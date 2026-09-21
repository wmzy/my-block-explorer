// Search view's Local contracts section: free-text responses carrying
// localContracts render the section ABOVE the remote/degraded result
// cards, each hit linking to its own chain's contract page, with the
// honest "locally cached sources" note; responses without hits (or
// without the field — every non-free-text shape) render no section at
// all. Harness mirrors searchPage.test.tsx (mocked services, stubbed
// header), so no network and no db are involved.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';
import Search from '@/views/Search';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">chain:{currentChainId}</div>
  ),
}));

const { mockFetchSearch, mockRecordHistory, mockReadRememberedChainId } = vi.hoisted(() => ({
  mockFetchSearch: vi.fn(),
  mockRecordHistory: vi.fn(),
  mockReadRememberedChainId: vi.fn(),
}));

vi.mock('@/services/search', () => ({
  fetchSearch: mockFetchSearch,
  fetchChainSearch: vi.fn(),
}));
vi.mock('@/services/searchHistory', () => ({
  recordSearchHistoryEntry: mockRecordHistory,
}));
vi.mock('@/views/Home/Landing', () => ({
  readRememberedChainId: mockReadRememberedChainId,
}));

const ADDR_A = '0xabc0000000000000000000000000000000000001';
const ADDR_B = '0xdef0000000000000000000000000000000000002';

// A free-text miss that also hit the local cache (the endpoint's additive
// shape for searchType 'unknown'); query is echoed by the response, so
// the fixture takes it as a parameter.
const freeTextMissWithHits = (q: string, localContracts: unknown[]) => ({
  found: false,
  type: 'unknown',
  query: q,
  searchedChainId: 1,
  suggestions: ['Enter a valid block number, transaction hash, or address'],
  localContracts,
});

const HITS = [
  { chainId: 1, address: ADDR_A, name: 'Uniswap V2', isVerified: true },
  { chainId: 137, address: ADDR_B, name: null, isVerified: false },
];

const renderSearch = (initial: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([
        { path: '/search', component: () => Search },
        { path: '/chain/:chainId/contract/:address', component: () => () => <div>contract-page</div> },
      ])}
      initialEntries={[initial]}
    >
      <View />
    </MemoryRouter>,
  );

describe('Search view local contracts section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadRememberedChainId.mockReturnValue(undefined);
  });

  it('renders cached hits above the not-found card, each linking to its chain', async () => {
    mockFetchSearch.mockResolvedValue(freeTextMissWithHits('uni', HITS));

    const { container } = renderSearch('/search?q=uni&chain=1');

    await screen.findByText('Local contracts');

    // Honest note: the section says exactly where the matches come from.
    expect(screen.getByText(/Matching your locally cached sources/)).toBeInTheDocument();

    // One row-link per hit, onto the hit's OWN chain page; a null name
    // renders "Unnamed contract", never a fabricated label.
    const links = screen.getAllByRole('link');
    expect(links.map(l => l.getAttribute('href'))).toEqual([
      `/chain/1/contract/${ADDR_A}`,
      `/chain/137/contract/${ADDR_B}`,
    ]);
    expect(screen.getByText('Uniswap V2')).toBeInTheDocument();
    expect(screen.getByText('Unnamed contract')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('Unverified')).toBeInTheDocument();
    // Real chain names from the config registry (137 = Polygon).
    expect(screen.getByText('Ethereum')).toBeInTheDocument();
    expect(screen.getByText('Polygon')).toBeInTheDocument();

    // The remote miss card renders too, BELOW the local section.
    expect(screen.getByText(/No results found for "uni"/)).toBeInTheDocument();
    expect(
      container.innerHTML.indexOf('Local contracts')
      < container.innerHTML.indexOf('No results found'),
    ).toBe(true);
  });

  it('renders no section when the read succeeded with zero hits (empty array)', async () => {
    mockFetchSearch.mockResolvedValue(freeTextMissWithHits('zzz', []));

    renderSearch('/search?q=zzz&chain=1');

    expect(await screen.findByText(/No results found for "zzz"/)).toBeInTheDocument();
    expect(screen.queryByText('Local contracts')).not.toBeInTheDocument();
  });

  it('renders no section when the field is absent (failed cache read)', async () => {
    const { localContracts: _dropped, ...withoutField } = freeTextMissWithHits('uni', HITS);
    mockFetchSearch.mockResolvedValue(withoutField);

    renderSearch('/search?q=uni&chain=1');

    expect(await screen.findByText(/No results found for "uni"/)).toBeInTheDocument();
    expect(screen.queryByText('Local contracts')).not.toBeInTheDocument();
  });
});
