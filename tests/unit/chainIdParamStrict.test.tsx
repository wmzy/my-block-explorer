// The frontend sibling of the server-side junk-param class.
//
// The repo already ships the strict parser (`parseChainIdParam`, which
// accepts plain decimal digits only) and Home/Charts/Pending/Broadcast use
// it. Eight chain-scoped views instead read the :chainId route param with
// `Number.parseInt(params.chainId ?? '1', 10)`, which accepts a valid
// PREFIX and ignores the rest:
//
//   /chain/1abc/blocks  -> chain 1    /chain/0x89/blocks -> chain 137
//   /chain/1e3/blocks   -> chain 1    /chain/+7/blocks   -> chain 7
//
// Each view guards with `getChainInfo(currentChainId)` and renders
// UnsupportedChainState when it is null, so a junk param that HAPPENS to
// parse into a real chain id renders a fully live, wrong-chain explorer
// page instead of the honest "this link is broken" state — the header,
// every RPC call and every link are for a chain the URL never named.
//
// utils/metaDescribe.ts has the same parse for the document title and the
// og/twitter description, so a junk link also gets a confidently wrong
// share blurb naming that chain.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';
import BlocksList from '@/views/Blocks/List';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">chain:{currentChainId}</div>
  ),
}));

vi.mock('@/components/ui/CopyableHash', () => ({
  CopyableHash: ({ value, truncated, href }: { value: string; truncated?: string; href?: string }) =>
    href ? <a href={href}>{truncated ?? value}</a> : <span>{truncated ?? value}</span>,
}));

// Chain 137 is a real, supported chain in this fixture, so the defect is
// observable: junk that parses into 137 must NOT render a live Polygon
// page.
vi.mock('@/config/chains', () => ({
  getChainInfo: (chainId: number) => {
    if (chainId === 1) return { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } };
    if (chainId === 137) return { id: 137, name: 'Polygon', nativeCurrency: { symbol: 'POL' } };
    if (chainId === 11155111)
      return { id: 11155111, name: 'Sepolia', nativeCurrency: { symbol: 'ETH' } };
    return null;
  },
  getChainName: (chainId: number) =>
    chainId === 1 ? 'Ethereum' : chainId === 137 ? 'Polygon' : chainId === 11155111 ? 'Sepolia' : 'Unknown',
  getChainSymbol: (chainId: number) => (chainId === 137 ? 'POL' : 'ETH'),
  getChainType: () => 'mainnet',
  isChainSupported: (chainId: number) => chainId === 1 || chainId === 137 || chainId === 11155111,
  getSupportedChainIds: () => [1, 137, 11155111],
  POPULAR_CHAINS: [
    { id: 1, name: 'Ethereum' },
    { id: 137, name: 'Polygon' },
  ],
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
}));

vi.mock('@/utils/format', () => ({
  formatNumber: (n: number) => n.toLocaleString(),
  formatRelativeTime: () => '2 min ago',
}));

const mockUseLatestBlocks = vi.fn<(...args: unknown[]) => Record<string, unknown>>();
vi.mock('@/services/chainRpc', () => ({
  useLatestBlocks: (...args: unknown[]) => mockUseLatestBlocks(...args),
}));
const mockUseLatestBlocksFeed = vi.fn<(...args: unknown[]) => Record<string, unknown>>();
vi.mock('@/services/homeFeed', () => ({
  useLatestBlocksFeed: (...args: unknown[]) => mockUseLatestBlocksFeed(...args),
}));
const mockUseFinalityHeads = vi.fn<(...args: unknown[]) => Record<string, unknown>>();
vi.mock('@/services/blocks', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/blocks')>();
  return { ...actual, useFinalityHeads: (...args: unknown[]) => mockUseFinalityHeads(...args) };
});

const { deriveDocumentTitle, deriveMetaDescription } = await import('@/utils/metaDescribe');

const renderAt = (path: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([{ path: '/chain/:chainId/blocks', component: () => BlocksList }])}
      initialEntries={[path]}
    >
      <View />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockUseLatestBlocks.mockReturnValue({ data: { blocks: [], latestBlockNumber: 100n }, loading: false });
  mockUseLatestBlocksFeed.mockReturnValue({ data: { latestBlockNumber: 100n } });
  mockUseFinalityHeads.mockReturnValue({ data: { safe: 90, finalized: 80 } });
});

// Junk segments that parseInt happily turns into a real, supported chain.
const JUNK_TO_CHAIN = [
  { raw: '1abc', parsed: 1 },
  { raw: '0x89', parsed: 137 },
  { raw: '137xyz', parsed: 137 },
  { raw: '1e3', parsed: 1 },
  { raw: '+7', parsed: 7 },
];

describe('chain-scoped views reject a junk :chainId instead of loading the prefix-parsed chain', () => {
  for (const { raw, parsed } of JUNK_TO_CHAIN) {
    it(`/chain/${raw}/blocks parks on the unsupported state, not chain ${parsed}`, async () => {
      renderAt(`/chain/${raw}/blocks`);

      // The honest state: no live chain page for a chain the URL never named.
      // (The view is lazy, so the nav appears asynchronously.)
      expect(await screen.findByTestId('top-navigation')).toHaveTextContent('chain:0');
      // And no RPC traffic was issued against the parsed chain.
      for (const call of [...mockUseLatestBlocks.mock.calls, ...mockUseLatestBlocksFeed.mock.calls]) {
        expect(call[0]).not.toBe(parsed);
      }
    });
  }

  it('still renders a live page for a valid chain id', async () => {
    renderAt('/chain/137/blocks');

    expect(await screen.findByTestId('top-navigation')).toHaveTextContent('chain:137');
    expect(mockUseLatestBlocks).toHaveBeenCalledWith(137, expect.anything());
  });
});

describe('title and share blurb reject a junk chain instead of naming the parsed chain', () => {
  it('falls back to the generic title for a junk /chain/ segment', () => {
    // "Ethereum Blocks" is what a junk link used to claim.
    expect(deriveDocumentTitle('/chain/0x89/blocks', '')).not.toContain('Polygon');
    expect(deriveDocumentTitle('/chain/1abc/blocks', '')).not.toContain('Ethereum');
  });

  it('falls back to the generic blurb for a junk /chain/ segment', () => {
    expect(deriveMetaDescription('/chain/0x89/blocks', '')).not.toContain('Polygon');
    expect(deriveMetaDescription('/chain/1abc/blocks', '')).not.toContain('Ethereum');
  });

  it('falls back for a junk ?chain= on /search', () => {
    expect(deriveDocumentTitle('/search', '?chain=0x89')).not.toContain('Polygon');
    expect(deriveMetaDescription('/search', '?chain=1abc')).not.toContain('Ethereum');
  });

  it('still names a valid chain', () => {
    expect(deriveDocumentTitle('/chain/137/blocks', '')).toContain('Polygon');
    expect(deriveDocumentTitle('/search', '?chain=137')).toContain('Polygon');
  });
});
