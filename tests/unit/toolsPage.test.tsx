// Tools hub (/tools) view contract: one card per tool (chain pages,
// global tools, admin-marked SQL/Ops, coverage legend, the informational
// Backup & restore card), chain-scoped cards link through the remembered
// chain with an honest "(remembered chain)" sub-label naming the chain,
// and when nothing valid is remembered those cards keep their titles but
// render a "no chain remembered" note instead of a link (never a dead or
// guessed destination). The pure card model is covered directly; the view
// renders under a real MemoryRouter so TypedLink hrefs are observable.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';
import ToolsPage, { buildToolCards, NO_CHAIN_REMEMBERED_NOTE } from '@/views/Tools';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">TopNav chain={currentChainId}</div>
  ),
}));

// Pin the remembered-chain input: the fallback and its honest degraded
// state are the contract under test, not the localStorage reader.
const { mockReadRememberedChainId } = vi.hoisted(() => ({
  mockReadRememberedChainId: vi.fn<() => number | undefined>(),
}));
vi.mock('@/views/Home/Landing', () => ({
  readRememberedChainId: () => mockReadRememberedChainId(),
}));

vi.mock('@/config/chains', () => ({
  getChainName: (chainId: number) => {
    if (chainId === 1) return 'Ethereum';
    if (chainId === 137) return 'Polygon';
    return `Chain ${chainId}`;
  },
}));

const renderTools = () =>
  render(
    <MemoryRouter
      routes={createRoutes([{ path: '/tools', component: () => ToolsPage }])}
      initialEntries={['/tools']}
    >
      <View />
    </MemoryRouter>,
  );

// Every tool the hub promises, in card order.
const EXPECTED_TOOL_TITLES = [
  'Blocks',
  'Transactions',
  'Pending',
  'Broadcast',
  'Contracts',
  'Tokens',
  'Charts',
  'Watchlist',
  'Search',
  'Signatures',
  'Coverage legend',
  'Troubleshooting',
  'SQL console',
  'Ops',
  'Backup & restore',
] as const;

// Chain-scoped cards + their remembered-chain destinations.
const CHAIN_TOOL_PATHS: Array<[title: string, suffix: string]> = [
  ['Blocks', '/blocks'],
  ['Transactions', '/transactions'],
  ['Pending', '/pending'],
  ['Broadcast', '/broadcast'],
  ['Contracts', '/contracts'],
  ['Tokens', '/tokens'],
  ['Charts', '/charts'],
  // The watchlist is a Home-page section: the card points at the chain
  // home itself.
  ['Watchlist', ''],
];

beforeEach(() => {
  vi.clearAllMocks();
  mockReadRememberedChainId.mockReturnValue(137);
});

// --- Pure card model ---

describe('buildToolCards', () => {
  it('builds exactly one card per expected tool', () => {
    expect(buildToolCards(137, 'Polygon').map(card => card.title)).toEqual([
      ...EXPECTED_TOOL_TITLES,
    ]);
  });

  it('scopes chain cards to the remembered chain and marks only SQL/Ops admin', () => {
    const cards = buildToolCards(137, 'Polygon');
    const byId = new Map(cards.map(card => [card.id, card]));

    expect(byId.get('blocks')?.href).toBe('/chain/137/blocks');
    expect(byId.get('watchlist')?.href).toBe('/chain/137');
    expect(byId.get('search')?.href).toBe('/search');
    expect(byId.get('signatures')?.href).toBe('/signatures');
    expect(byId.get('coverage')?.href).toBe('/about/coverage');
    expect(byId.get('sql')?.href).toBe('/sql');
    expect(byId.get('ops')?.href).toBe('/ops');

    expect(cards.filter(card => card.admin).map(card => card.id)).toEqual(['sql', 'ops']);
  });

  it('labels chain cards with the remembered-chain scope note', () => {
    const cards = buildToolCards(137, 'Polygon');
    for (const card of cards) {
      if (card.href?.startsWith('/chain/')) {
        expect(card.scopeNote).toBe('Polygon · remembered chain');
      } else {
        expect(card.scopeNote).toBeUndefined();
      }
    }
  });

  it('degrades chain cards honestly when nothing is remembered', () => {
    const cards = buildToolCards(undefined, undefined);
    for (const [title] of CHAIN_TOOL_PATHS) {
      const card = cards.find(candidate => candidate.title === title);
      expect(card, `chain card ${title}`).toBeDefined();
      expect(card?.href).toBeNull();
      expect(card?.unavailableNote).toBe(NO_CHAIN_REMEMBERED_NOTE);
    }
    // Global tools keep their links regardless of remembered state.
    const byId = new Map(cards.map(card => [card.id, card.href]));
    expect(byId.get('search')).toBe('/search');
    expect(byId.get('sql')).toBe('/sql');
  });

  it('keeps Backup & restore informational by design (no link, no degraded note)', () => {
    const remembered = buildToolCards(137, 'Polygon').find(card => card.id === 'backup');
    expect(remembered?.href).toBeNull();
    expect(remembered?.unavailableNote).toBeUndefined();
    expect(remembered?.description).toContain('settings modal');

    const bare = buildToolCards(undefined, undefined).find(card => card.id === 'backup');
    expect(bare?.href).toBeNull();
    expect(bare?.unavailableNote).toBeUndefined();
  });
});

// --- View ---

describe('Tools page', () => {
  it('renders one card per expected tool with the palette hint', async () => {
    renderTools();

    // Route resolution is async: await the first paint before sync queries.
    expect(await screen.findByRole('heading', { name: 'Tools' })).toBeInTheDocument();
    for (const title of EXPECTED_TOOL_TITLES) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    // The header ties the page to the palette (and names the touch story).
    expect(screen.getByText(/Ctrl\/Cmd\+K/)).toBeInTheDocument();
  });

  it('links chain tools through the remembered chain with an honest scope label', async () => {
    renderTools();

    await screen.findByRole('link', { name: 'Open Blocks' });
    for (const [title, suffix] of CHAIN_TOOL_PATHS) {
      const link = screen.getByRole('link', { name: `Open ${title}` });
      expect(link).toHaveAttribute('href', `/chain/137${suffix}`);
    }
    // Global destinations are never chain-prefixed.
    const globalLinks: Array<[title: string, href: string]> = [
      ['Search', '/search'],
      ['Signatures', '/signatures'],
      ['Coverage legend', '/about/coverage'],
      ['Troubleshooting', '/help/troubleshooting'],
      ['SQL console', '/sql'],
      ['Ops', '/ops'],
    ];
    for (const [title, href] of globalLinks) {
      expect(screen.getByRole('link', { name: `Open ${title}` })).toHaveAttribute('href', href);
    }

    // Every chain card carries the remembered-chain note naming the chain;
    // global cards never do.
    const scopeNotes = screen.getAllByText('Polygon · remembered chain');
    expect(scopeNotes).toHaveLength(CHAIN_TOOL_PATHS.length);
  });

  it('marks exactly the SQL console and Ops cards with an admin chip', async () => {
    renderTools();

    await screen.findByRole('heading', { name: 'SQL console' });
    const chips = screen.getAllByText('admin', { exact: true });
    expect(chips).toHaveLength(2);
  });

  it('renders the Backup & restore card as an honest pointer, not a link', async () => {
    renderTools();

    expect(
      await screen.findByRole('heading', { name: 'Backup & restore' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Backup & restore' })).not.toBeInTheDocument();
    // It says where the feature actually lives.
    expect(screen.getByText(/settings modal/)).toBeInTheDocument();
    expect(screen.getByText(/⚙️ RPC/)).toBeInTheDocument();
  });

  it('degrades chain cards honestly when no chain is remembered', async () => {
    mockReadRememberedChainId.mockReturnValue(undefined);
    renderTools();

    // All cards keep their titles — the hub stays complete. (The note
    // repeats per chain card, so findAll also serves as the await point
    // for the async route resolution.)
    const notes = await screen.findAllByText(NO_CHAIN_REMEMBERED_NOTE);
    expect(notes).toHaveLength(CHAIN_TOOL_PATHS.length);
    for (const title of EXPECTED_TOOL_TITLES) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }

    // Chain tools: honest notes instead of links.
    for (const [title] of CHAIN_TOOL_PATHS) {
      expect(screen.queryByRole('link', { name: `Open ${title}` })).not.toBeInTheDocument();
    }

    // Global tools are unaffected: exactly their five links remain.
    const hrefs = screen
      .getAllByRole('link')
      .map(link => link.getAttribute('href'))
      .sort();
    expect(hrefs).toEqual([
      '/about/coverage',
      '/help/troubleshooting',
      '/ops',
      '/search',
      '/signatures',
      '/sql',
    ]);
    // No remembered-chain label may render without a chain behind it.
    expect(screen.queryByText('Polygon · remembered chain')).not.toBeInTheDocument();
  });
});
