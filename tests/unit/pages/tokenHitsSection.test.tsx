// Search view's "Known tokens & labels (curated)" section: free-text
// responses carrying tokenHits render the section with the honesty-scoped
// copy ("not every token on this chain"), known-token rows linking to the
// token page and label rows to the address page — each on the hit's own
// chain; responses without hits (or without the field — failed label
// read / non-free-text shapes) render no section at all. Harness mirrors
// searchLocalContractsSection.test.tsx (mocked services, stubbed header),
// so no network and no db are involved.
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

const ADDR_TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const ADDR_LABEL = '0xabc0000000000000000000000000000000000001';

// A free-text miss that also hit the curated token/label sources (the
// endpoint's additive shape for searchType 'unknown'); the query is
// echoed by the response, so the fixture takes it as a parameter.
const freeTextMissWithHits = (q: string, tokenHits: unknown[]) => ({
  found: false,
  type: 'unknown',
  query: q,
  searchedChainId: 1,
  suggestions: ['Enter a valid block number, transaction hash, or address'],
  tokenHits,
});

const HITS = [
  { chainId: 1, address: ADDR_TOKEN, matchText: 'USDC', source: 'known-token' },
  { chainId: 137, address: ADDR_LABEL, matchText: 'my polygon vault', source: 'label' },
];

const renderSearch = (initial: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([
        { path: '/search', component: () => Search },
        { path: '/chain/:chainId/token/:address', component: () => () => <div>token-page</div> },
        { path: '/chain/:chainId/address/:address', component: () => () => <div>address-page</div> },
      ])}
      initialEntries={[initial]}
    >
      <View />
    </MemoryRouter>,
  );

describe('Search view known tokens & labels section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadRememberedChainId.mockReturnValue(undefined);
  });

  it('renders curated hits with honest copy, token rows to token pages, label rows to address pages', async () => {
    mockFetchSearch.mockResolvedValue(freeTextMissWithHits('usdc', HITS));

    const { container } = renderSearch('/search?q=usdc&chain=1');

    await screen.findByText('Known tokens & labels (curated)');

    // Honesty contract: the section scopes itself — curated sources, not
    // a token index.
    expect(screen.getByText(/Curated known tokens and your labels — not every token on this chain/))
      .toBeInTheDocument();

    // One row-link per hit, onto the hit's OWN chain; source picks the
    // destination (known-token → token page, label → address page).
    const links = screen.getAllByRole('link');
    expect(links.map(l => l.getAttribute('href'))).toEqual([
      `/chain/1/token/${ADDR_TOKEN}`,
      `/chain/137/address/${ADDR_LABEL}`,
    ]);

    // Match text and source badge render per row; real chain names from
    // the config registry (137 = Polygon).
    expect(screen.getByText('USDC')).toBeInTheDocument();
    expect(screen.getByText('my polygon vault')).toBeInTheDocument();
    expect(screen.getByText('Known token')).toBeInTheDocument();
    expect(screen.getByText('Label')).toBeInTheDocument();
    expect(screen.getByText('Ethereum')).toBeInTheDocument();
    expect(screen.getByText('Polygon')).toBeInTheDocument();

    // The remote miss card renders too, BELOW the curated section.
    expect(screen.getByText(/No results found for "usdc"/)).toBeInTheDocument();
    expect(
      container.innerHTML.indexOf('Known tokens & labels (curated)')
      < container.innerHTML.indexOf('No results found'),
    ).toBe(true);
  });

  it('renders no section when the read succeeded with zero hits (empty array)', async () => {
    mockFetchSearch.mockResolvedValue(freeTextMissWithHits('zzz', []));

    renderSearch('/search?q=zzz&chain=1');

    expect(await screen.findByText(/No results found for "zzz"/)).toBeInTheDocument();
    expect(screen.queryByText('Known tokens & labels (curated)')).not.toBeInTheDocument();
  });

  it('renders no section when the field is absent (failed label read)', async () => {
    const { tokenHits: _dropped, ...withoutField } = freeTextMissWithHits('usdc', HITS);
    mockFetchSearch.mockResolvedValue(withoutField);

    renderSearch('/search?q=usdc&chain=1');

    expect(await screen.findByText(/No results found for "usdc"/)).toBeInTheDocument();
    expect(screen.queryByText('Known tokens & labels (curated)')).not.toBeInTheDocument();
  });
});
