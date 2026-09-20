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

import { deriveDocumentTitle, DocumentTitle } from '@/views';

const TX_HASH = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd';
const ADDRESS = '0x9876543210abcdef9876543210abcdef9876543210';

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

describe('DocumentTitle component', () => {
  beforeEach(() => {
    document.title = '';
  });

  it('sets document.title for the initial location', () => {
    renderTitleHarness(`/chain/1/tx/${TX_HASH}`);
    expect(document.title).toBe(`Tx ${TX_HASH.slice(0, 10)}… · Ethereum`);
  });

  it('follows in-app navigation via the router history listener', async () => {
    renderTitleHarness(`/chain/1/tx/${TX_HASH}`, '/chain/137');

    expect(document.title).toBe(`Tx ${TX_HASH.slice(0, 10)}… · Ethereum`);
    // The view (and its button) resolve asynchronously.
    fireEvent.click(await screen.findByRole('button', { name: 'go' }));

    await waitFor(() => expect(document.title).toBe('Polygon Explorer'));
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
