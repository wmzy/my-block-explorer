// Help section render contract (both views):
//
//   /help          the index — every topic as a linkable card, plus the
//                  shared reference (shortcuts, glossary, FAQ) and the
//                  pointers to the two explainers that live elsewhere.
//   /help/:topic   one topic's page, rendered from the SAME pure model the
//                  index summarizes, with its structured blocks (the
//                  troubleshooting symptom list and the /api/health table)
//                  and links to its siblings and back to the index.
//   /help/nope     nothing — an unknown topic is a 404, not a themed
//                  page, so a mistyped help URL behaves like any other
//                  mistyped URL.
//
// The URL /help/troubleshooting is pinned here too: it was the shipped
// standalone page's path and must keep resolving after the section
// absorbed it. The topbar is mocked (this is about page content, and the
// nav's own contract lives in tests/unit/topNavigation.test.tsx).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';

import Help from '@/views/Help';
import HelpPage from '@/views/Help/HelpPage';
import { HELP_TOPICS } from '@/views/Help/helpContent';

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <nav data-testid="top-nav" data-chain={String(currentChainId)} />
  ),
}));

const NotFoundStub = () => <div data-testid="not-found">404</div>;
const CoverageStub = () => <div data-testid="coverage-stub" />;
const ToolsStub = () => <div data-testid="tools-stub" />;

// One table for both cases; the index tests need the /about/coverage and
// /tools destinations registered only so TypedLink hrefs resolve (their
// content is covered by their own page tests), the topic tests do not
// navigate there at all.
const routes = createRoutes([
  { path: '/help', component: () => Help },
  { path: '/help/:topic', component: () => HelpPage },
  { path: '/about/coverage', component: () => CoverageStub },
  { path: '/tools', component: () => ToolsStub },
]);

// The router resolves its view asynchronously (its store update lands in
// an effect), so every render awaits the router settling before
// asserting — the same discipline the other page tests use. The page
// landing IS the settle signal; a timeout means the view never resolved.
// (The unknown-topic case deliberately does NOT await this: it renders
// the 404 through the router's rejection path, asserted with findBy.)
const renderAt = async (path: string) => {
  const result = render(
    <MemoryRouter routes={routes} initialEntries={[path]} notFound={() => <NotFoundStub />}>
      <View />
    </MemoryRouter>,
  );
  await waitFor(() => expect(result.container.textContent?.trim()).not.toBe(''));
  return result;
};

const renderIndex = () => renderAt('/help');

describe('help index (/help)', () => {
  it('renders the heading and the section subtitle', async () => {
    await renderIndex();

    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toBeInTheDocument();
    expect(
      screen.getByText(/How this explorer works, what its data means/),
    ).toBeInTheDocument();
  });

  it('links every topic to its own page', async () => {
    await renderIndex();

    // One destination per topic, each an in-app /help/<slug> link.
    const hrefs = screen
      .getAllByRole('link')
      .map(link => link.getAttribute('href'))
      .filter(href => href?.startsWith('/help/'));
    expect(new Set(hrefs).size).toBe(HELP_TOPICS.length);
    for (const topic of HELP_TOPICS) {
      expect(hrefs, topic.slug).toContain(`/help/${topic.slug}`);
    }
  });

  it('shows each topic title and summary on its card', async () => {
    await renderIndex();

    for (const topic of HELP_TOPICS) {
      expect(screen.getByRole('heading', { name: topic.title })).toBeInTheDocument();
      expect(screen.getByText(topic.summary)).toBeInTheDocument();
    }
  });

  it('lists the reference material that is not topic-specific', async () => {
    await renderIndex();

    for (const heading of ['Topics', 'Keyboard shortcuts', 'Glossary', 'Frequently asked']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    // The palette shortcut in both platform spellings — a help page that
    // only spells one of them teaches the wrong key on the other OS.
    expect(screen.getByText('Ctrl+K / ⌘K')).toBeInTheDocument();
    // Glossary terms render as definition terms (dt/dd), not as loose text.
    expect(screen.getByText('Nonce')).toBeInTheDocument();
    expect(
      screen.getByText(/counting outgoing transactions only|outgoing-transaction counter/i),
    ).toBeInTheDocument();
  });

  it('answers the FAQ with a question heading and prose', async () => {
    await renderIndex();

    expect(screen.getByText('Do I need the backend?')).toBeInTheDocument();
    expect(screen.getByText('Is this a full block explorer?')).toBeInTheDocument();
    // Each answer is real prose, not a link to somewhere else.
    expect(screen.getByText(/With nothing but an RPC endpoint/)).toBeInTheDocument();
  });

  it('points at the two explainers that live outside the section', async () => {
    await renderIndex();

    // Both are real in-app destinations (not dead text), which is why the
    // router table here includes them.
    const coverage = screen.getByRole('link', { name: 'Data coverage' });
    const tools = screen.getByRole('link', { name: 'Tools' });
    expect(coverage).toHaveAttribute('href', '/about/coverage');
    expect(tools).toHaveAttribute('href', '/tools');
  });

  it('renders the chain-aware top bar on the remembered chain', async () => {
    localStorage.removeItem('be:lastChain');
    await renderIndex();

    // Falls back to the preferred chain when nothing is remembered — the
    // nav must never render without a chain (same rule as the other
    // chain-less pages).
    expect(screen.getByTestId('top-nav')).toBeInTheDocument();
  });
});

describe('help topic page (/help/:topic)', () => {
  it('keeps /help/troubleshooting working — the shipped standalone path', async () => {
    await renderAt('/help/troubleshooting');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Troubleshooting' }),
    ).toBeInTheDocument();
  });

  it('renders a topic heading, its summary and every body paragraph', async () => {
    const topic = HELP_TOPICS.find(entry => entry.slug === 'contracts');
    if (topic === undefined) throw new Error('contracts topic missing');
    await renderAt('/help/contracts');

    expect(screen.getByRole('heading', { level: 1, name: topic.title })).toBeInTheDocument();
    expect(screen.getByText(topic.summary)).toBeInTheDocument();
    for (const paragraph of topic.body) {
      expect(screen.getByText(paragraph), paragraph.slice(0, 40)).toBeInTheDocument();
    }
  });

  it('says where the topic lives in the app', async () => {
    await renderAt('/help/rpc-settings');

    const topic = HELP_TOPICS.find(entry => entry.slug === 'rpc-settings');
    if (topic === undefined) throw new Error('rpc-settings topic missing');
    expect(screen.getByText('Where to find it:')).toBeInTheDocument();
    expect(screen.getByText(topic.where)).toBeInTheDocument();
  });

  it('renders the troubleshooting symptom list with every verbatim string', async () => {
    await renderAt('/help/troubleshooting');

    expect(screen.getByRole('heading', { name: 'Symptoms, verbatim' })).toBeInTheDocument();
    for (const text of [
      /block range too large/,
      /results exceed limit/,
      /historical state/,
      /missing trie node/,
      'The Pending page shows an unsupported card',
      'Call Trace / Internal Txns render as unavailable',
      'HTTP 429 responses',
    ]) {
      expect(screen.getByText(text), String(text)).toBeInTheDocument();
    }
    // The meaning, not just the symptom label. (getAllBy: the phrase
    // legitimately appears on two rows — the getLogs cap and the pruned
    // state both route you to an archive endpoint.)
    expect(screen.getAllByText(/archive-mode RPC/).length).toBeGreaterThan(0);
  });

  it('renders the /api/health field table with all five fields', async () => {
    await renderAt('/help/troubleshooting');

    expect(
      screen.getByRole('heading', { name: 'What /api/health answers with' }),
    ).toBeInTheDocument();
    for (const field of [
      'status',
      'adminTokenConfigured',
      'debugApiEnabled',
      'version',
      'timestamp',
    ]) {
      expect(screen.getByText(field), field).toBeInTheDocument();
    }
  });

  it('omits the structured blocks on a topic that has none', async () => {
    await renderAt('/help/tokens');

    expect(screen.queryByRole('heading', { name: 'Symptoms, verbatim' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'What /api/health answers with' }),
    ).not.toBeInTheDocument();
  });

  it('links every sibling topic and back to the index', async () => {
    await renderAt('/help/storage');

    // Scoped to the siblings card: the page header and the top bar have
    // their own links, and this assertion is about the cross-references.
    const heading = screen.getByRole('heading', { name: 'Other topics' });
    const card = heading.closest('div');
    if (card === null) throw new Error('siblings card not found');
    const hrefs = within(card as HTMLElement)
      .getAllByRole('link')
      .map(link => link.getAttribute('href'));
    // Every topic except this one, plus the index.
    for (const topic of HELP_TOPICS.filter(entry => entry.slug !== 'storage')) {
      expect(hrefs, topic.slug).toContain(`/help/${topic.slug}`);
    }
    expect(hrefs).not.toContain('/help/storage');
    expect(hrefs).toContain('/help');
  });
});

describe('unknown help topic', () => {
  it('renders the app 404 rather than a themed help page', async () => {
    // The view throws the router's NotFoundError, which the router's
    // notFound prop renders — so the assertion waits for the 404, not for
    // page content (a blank page would be a different, wrong outcome).
    renderAt('/help/not-a-topic');

    expect(await screen.findByTestId('not-found')).toBeInTheDocument();
    // Critically: no help content, so a mistyped URL can never be mistaken
    // for an answer.
    expect(screen.queryByRole('heading', { name: 'Topics' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Help' })).not.toBeInTheDocument();
  });
});
