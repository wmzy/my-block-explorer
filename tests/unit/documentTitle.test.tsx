// Per-route document.title (G2): every tab used to read the static
// index.html title. deriveDocumentTitle pins the derivation for every route
// shape (pure function, no harness); the DocumentTitle component test pins
// the wiring — mounted at the same Router-children position as in App, it
// must set the title for the initial location and follow in-app
// navigations (the router's history listener, not a remount).
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes, useRouter } from '@native-router/react';
import { navigate } from '@native-router/core';
import '@testing-library/jest-dom';

import { deriveDocumentTitle, deriveMetaDescription, DocumentTitle } from '@/views';

const TX_HASH = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd';
const ADDRESS = '0x9876543210abcdef9876543210abcdef9876543210';

// The generic blurb unknown shapes fall back to (mirrors the static
// index.html description family).
const FALLBACK_BLURB =
  'A modern blockchain explorer for Ethereum and compatible networks — blocks, transactions, addresses and contracts.';

describe('deriveDocumentTitle', () => {
  it('titles detail routes with the entity and the chain', () => {
    expect(deriveDocumentTitle(`/chain/1/block/18000001`, '')).toBe('Block #18000001 · Ethereum');
    expect(deriveDocumentTitle(`/chain/1/tx/${TX_HASH}`, '')).toBe(
      `Tx ${TX_HASH.slice(0, 10)}… · Ethereum`,
    );
    expect(deriveDocumentTitle(`/chain/137/address/${ADDRESS}`, '')).toBe(
      `Address ${ADDRESS.slice(0, 10)}… · Polygon`,
    );
    expect(deriveDocumentTitle(`/chain/8453/contract/${ADDRESS}`, '')).toBe(
      `Contract ${ADDRESS.slice(0, 10)}… · Base`,
    );
    // The /events subpath is the same contract page.
    expect(deriveDocumentTitle(`/chain/8453/contract/${ADDRESS}/events`, '')).toBe(
      `Contract ${ADDRESS.slice(0, 10)}… · Base`,
    );
  });

  it('titles list and home routes with the chain', () => {
    expect(deriveDocumentTitle('/chain/1', '')).toBe('Ethereum Explorer');
    expect(deriveDocumentTitle('/chain/137/blocks', '')).toBe('Polygon Blocks');
    expect(deriveDocumentTitle('/chain/8453/transactions', '')).toBe('Base Transactions');
    // The pending-pool page is entity-first ("Pending Transactions · …"),
    // not the list-page "{chain} Transactions" shape.
    expect(deriveDocumentTitle('/chain/1/pending', '')).toBe('Pending Transactions · Ethereum');
  });

  it('titles search with its chain context when ?chain= rides the URL', () => {
    expect(deriveDocumentTitle('/search', '?chain=1')).toBe('Search · Ethereum');
    expect(deriveDocumentTitle('/search', '?q=vitalik&chain=137')).toBe('Search · Polygon');
    // No chain context: the generic suffix.
    expect(deriveDocumentTitle('/search', '')).toBe('Search · Explorer');
    expect(deriveDocumentTitle('/search', '?q=0xdead')).toBe('Search · Explorer');
  });

  it('falls back to the app title for unchanined, unknown, or malformed routes', () => {
    expect(deriveDocumentTitle('/', '')).toBe('My Block Explorer');
    expect(deriveDocumentTitle('/chain/1/unknown-section', '')).toBe('My Block Explorer');
    expect(deriveDocumentTitle('/chain/abc', '')).toBe('My Block Explorer');
    // Detail routes without their param keep the fallback too.
    expect(deriveDocumentTitle('/chain/1/tx', '')).toBe('My Block Explorer');
  });

  it('ignores trailing slashes when matching', () => {
    expect(deriveDocumentTitle('/chain/1/blocks/', '')).toBe('Ethereum Blocks');
  });
});

describe('deriveMetaDescription', () => {
  it('describes detail routes with the entity and the chain', () => {
    expect(deriveMetaDescription(`/chain/1/tx/${TX_HASH}`, '')).toBe(
      `View transaction ${TX_HASH.slice(0, 10)}… on Ethereum — block, gas, status and decoded calls.`,
    );
    expect(deriveMetaDescription(`/chain/137/address/${ADDRESS}`, '')).toBe(
      `View address ${ADDRESS.slice(0, 10)}… on Polygon — balance, nonce, transactions and token holdings.`,
    );
    expect(deriveMetaDescription('/chain/8453/block/18000001', '')).toBe(
      'View block #18000001 on Base — transactions, gas used and more.',
    );
    expect(deriveMetaDescription(`/chain/1/contract/${ADDRESS}`, '')).toBe(
      `View contract ${ADDRESS.slice(0, 10)}… on Ethereum — source, ABI, events and interaction.`,
    );
    // The /events subpath shares the plain contract blurb.
    expect(deriveMetaDescription(`/chain/1/contract/${ADDRESS}/events`, '')).toBe(
      `View contract ${ADDRESS.slice(0, 10)}… on Ethereum — source, ABI, events and interaction.`,
    );
  });

  it('describes home and list routes', () => {
    expect(deriveMetaDescription('/chain/137', '')).toBe(
      'Explore Polygon: latest blocks, transactions, gas and chain stats.',
    );
    expect(deriveMetaDescription('/chain/1/blocks', '')).toBe(
      'Browse the latest blocks on Ethereum.',
    );
    expect(deriveMetaDescription('/chain/1/transactions', '')).toBe(
      'Browse the latest transactions on Ethereum.',
    );
    expect(deriveMetaDescription('/chain/1/contracts', '')).toBe(
      `Browse the explorer's cached contracts on Ethereum.`,
    );
    expect(deriveMetaDescription('/chain/137/pending', '')).toBe(
      `Pending (unconfirmed) transactions in this node's transaction pool on Polygon.`,
    );
  });

  it('describes search with and without its chain context', () => {
    expect(deriveMetaDescription('/search', '?chain=137')).toBe(
      'Search blocks, transactions, addresses and contracts on Polygon.',
    );
    expect(deriveMetaDescription('/search', '')).toBe(
      'Search blocks, transactions, addresses and contracts across chains.',
    );
  });

  it('keeps the route family blurb with "the chain" when chainId is malformed', () => {
    // The family is recognizable from the path alone; only the noun slot
    // degrades (never the whole blurb) for an unparseable chainId.
    expect(deriveMetaDescription(`/chain/abc/tx/${TX_HASH}`, '')).toBe(
      `View transaction ${TX_HASH.slice(0, 10)}… on the chain — block, gas, status and decoded calls.`,
    );
  });

  it('falls back to the generic explorer blurb for unknown or paramless shapes', () => {
    expect(deriveMetaDescription('/', '')).toBe(FALLBACK_BLURB);
    expect(deriveMetaDescription('/chain/1/unknown-section', '')).toBe(FALLBACK_BLURB);
    expect(deriveMetaDescription('/chain/1/tx', '')).toBe(FALLBACK_BLURB);
    // A recognizable family without its param keeps the fallback too.
    expect(deriveMetaDescription('/chain/1/address', '')).toBe(FALLBACK_BLURB);
  });
});

// A view stub that can navigate the harness router on demand: the click
// exercises the history-listener path (title follows an in-app navigation
// without any remount of DocumentTitle). Routes need a component TYPE, so
// the factory closes over the target.
const makeNavigateStub = (to: string) =>
  function NavigateStub() {
    const router = useRouter();
    return (
      <button type="button" onClick={() => void navigate(router, to).catch(() => undefined)}>
        go
      </button>
    );
  };

// Captures the harness router so a test can navigate after the subject
// unmounted (late-listener proof).
function RouterCapture({ onRouter }: { onRouter: (router: ReturnType<typeof useRouter>) => void }) {
  onRouter(useRouter());
  return null;
}

function renderTitleHarness(initial: string, navTarget?: string) {
  const stub = makeNavigateStub(navTarget ?? '/chain/1');
  const routes = createRoutes([
    { path: '/chain/:chainId', component: () => stub },
    { path: '/chain/:chainId/tx/:txHash', component: () => stub },
  ]);
  return render(
    <MemoryRouter routes={routes} initialEntries={[initial]}>
      <DocumentTitle />
      <View />
    </MemoryRouter>,
  );
}

// Share-card tags the component maintains (jsdom reads .content off the
// living document.head).
const shareTags = () => ({
  ogTitle: document.head.querySelector<HTMLMetaElement>('meta[property="og:title"]'),
  ogDescription: document.head.querySelector<HTMLMetaElement>(
    'meta[property="og:description"]',
  ),
  ogType: document.head.querySelector<HTMLMetaElement>('meta[property="og:type"]'),
  twitterCard: document.head.querySelector<HTMLMetaElement>('meta[name="twitter:card"]'),
});

describe('DocumentTitle component', () => {
  beforeEach(() => {
    document.title = '';
    // The maintained tags live in the shared jsdom head; strip them so
    // each case observes its own lifecycle from a clean slate.
    document.head
      .querySelectorAll('meta[property^="og:"], meta[name="twitter:card"]')
      .forEach(tag => tag.remove());
  });

  it('sets document.title for the initial location', () => {
    renderTitleHarness(`/chain/1/tx/${TX_HASH}`);
    expect(document.title).toBe(`Tx ${TX_HASH.slice(0, 10)}… · Ethereum`);
  });

  it('sets the share-card meta tags for the initial location', () => {
    renderTitleHarness(`/chain/1/tx/${TX_HASH}`);
    const tags = shareTags();
    expect(tags.ogTitle?.content).toBe(`Tx ${TX_HASH.slice(0, 10)}… · Ethereum`);
    expect(tags.ogDescription?.content).toBe(
      `View transaction ${TX_HASH.slice(0, 10)}… on Ethereum — block, gas, status and decoded calls.`,
    );
    expect(tags.ogType?.content).toBe('website');
    expect(tags.twitterCard?.content).toBe('summary');
  });

  it('follows in-app navigation via the router history listener', async () => {
    renderTitleHarness(`/chain/1/tx/${TX_HASH}`, '/chain/137');

    expect(document.title).toBe(`Tx ${TX_HASH.slice(0, 10)}… · Ethereum`);
    // The view (and its button) resolve asynchronously.
    fireEvent.click(await screen.findByRole('button', { name: 'go' }));

    await waitFor(() => expect(document.title).toBe('Polygon Explorer'));
  });

  it('updates og:title and og:description on in-app navigation', async () => {
    renderTitleHarness(`/chain/1/tx/${TX_HASH}`, '/chain/137');

    fireEvent.click(await screen.findByRole('button', { name: 'go' }));

    await waitFor(() => {
      expect(shareTags().ogTitle?.content).toBe('Polygon Explorer');
      expect(shareTags().ogDescription?.content).toBe(
        'Explore Polygon: latest blocks, transactions, gas and chain stats.',
      );
    });
  });

  it('is idempotent: updates tags in place instead of duplicating them across renders and navigations', async () => {
    // Seed a stale og:title (e.g. left in the head before the app booted):
    // the sync must rewrite it, never append a sibling.
    const stale = document.createElement('meta');
    stale.setAttribute('property', 'og:title');
    stale.setAttribute('content', 'stale');
    document.head.appendChild(stale);

    renderTitleHarness(`/chain/1/tx/${TX_HASH}`, '/chain/137');

    expect(document.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
    expect(shareTags().ogTitle?.content).toBe(`Tx ${TX_HASH.slice(0, 10)}… · Ethereum`);

    fireEvent.click(await screen.findByRole('button', { name: 'go' }));
    await waitFor(() => expect(shareTags().ogTitle?.content).toBe('Polygon Explorer'));

    // The navigation re-synced every tag in place: still exactly one per key.
    expect(document.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[property="og:description"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[property="og:type"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[name="twitter:card"]')).toHaveLength(1);
  });

  it('stops listening on unmount (late navigations do not touch the title)', async () => {
    let harnessRouter: ReturnType<typeof useRouter> | undefined;
    const stub = makeNavigateStub('/chain/137');
    const { unmount } = render(
      <MemoryRouter
        routes={createRoutes([{ path: '/chain/:chainId', component: () => stub }])}
        initialEntries={['/chain/1']}
      >
        <DocumentTitle />
        <RouterCapture onRouter={r => (harnessRouter = r)} />
        <View />
      </MemoryRouter>,
    );
    expect(document.title).toBe('Ethereum Explorer');

    unmount();
    const router = harnessRouter;
    expect(router).toBeDefined();
    if (router) {
      await navigate(router, '/chain/8453').catch(() => undefined);
    }

    // The listener is gone: the stale title survives the late navigation.
    expect(document.title).toBe('Ethereum Explorer');
  });
});
