// Route-table contract: the exact path set, the landing redirect, loader
// wiring on the immutable contract routes, and that each path resolves to
// the intended view module (catches path typos and swapped lazy imports
// without rendering — per-view rendering is covered by the page tests;
// the sole render case is the static /about/coverage deep link, which has
// no page test of its own).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View } from '@native-router/react';
import '@testing-library/jest-dom/vitest';

import { routes } from '@/views';
import { contractSourceLoader } from '@/services/dataloaders';

type LazyView = () => Promise<{ default: unknown }>;

const children = (routes.children ?? []) as Array<{
  path?: string;
  redirect?: unknown;
  data?: unknown;
  component?: LazyView;
}>;

const byPath = (path: string) => {
  const route = children.find((r) => r.path === path);
  if (!route) throw new Error(`route not found: ${path}`);
  return route;
};

describe('route table', () => {
  it('declares exactly the known flat path set', () => {
    expect(children.map((r) => r.path)).toEqual([
      '/',
      '/chain/:chainId',
      '/chain/:chainId/blocks',
      '/chain/:chainId/transactions',
      '/chain/:chainId/pending',
      '/chain/:chainId/contracts',
      '/chain/:chainId/token/:address',
      '/chain/:chainId/charts',
      '/chain/:chainId/block/:blockNumber',
      '/chain/:chainId/tx/:txHash',
      '/chain/:chainId/address/:address',
      '/chain/:chainId/contract/:address',
      '/chain/:chainId/contract/:address/events',
      '/search',
      '/sql',
      '/about/coverage',
    ]);
  });

  it('keeps the static about route loader-free (pure copy page)', () => {
    expect(byPath('/about/coverage').data).toBeUndefined();
  });

  it('renders the dynamic landing component on \'/\' (remembered-chain redirect)', async () => {
    // Landing replaces the old static `redirect: {path: '/chain/1'}`: the
    // target is resolved at runtime (remembered chain → preferred chain),
    // so the route table must no longer hardcode any chain target.
    expect(children.every(r => r.redirect === undefined)).toBe(true);
    const load = byPath('/').component as LazyView;
    const mod = await load();
    expect(typeof mod.default).toBe('function');
  });

  it('wires the immutable contract-source loader on both contract routes', () => {
    expect(byPath('/chain/:chainId/contract/:address').data).toBe(contractSourceLoader);
    expect(byPath('/chain/:chainId/contract/:address/events').data).toBe(contractSourceLoader);
  });

  it('resolves each path to its intended view module', async () => {
    const expectations: Array<[string, string]> = [
      ['/chain/:chainId', 'Home'],
      ['/chain/:chainId/blocks', 'List'],
      ['/chain/:chainId/block/:blockNumber', 'Detail'],
      ['/chain/:chainId/transactions', 'List'],
      ['/chain/:chainId/pending', 'Pending'],
      ['/chain/:chainId/tx/:txHash', 'Detail'],
      ['/chain/:chainId/address/:address', 'Address'],
      ['/chain/:chainId/contract/:address', 'Contract'],
      ['/search', 'Search'],
      ['/about/coverage', 'Coverage/Legend'],
    ];

    for (const [path] of expectations) {
      const load = byPath(path).component as LazyView;
      const mod = await load();
      expect(typeof mod.default, `view for ${path} must default-export a component`).toBe(
        'function',
      );
    }
  });
});

describe('/about/coverage deep link', () => {
  it('renders the legend with all six levels and the indexer-comparison section', async () => {
    render(
      <MemoryRouter routes={routes} initialEntries={['/about/coverage']}>
        <View />
      </MemoryRouter>,
    );

    // The lazy view chunk resolves async; every level renders as a term
    // (glyph + chip word) with its definition and example below it.
    const terms = ['Live', 'Cached', 'Discovered', 'Sampled', 'Partial', 'Unavailable'];
    for (const term of terms) {
      expect(await screen.findByText(term)).toBeInTheDocument();
    }
    expect(
      screen.getByText('Why numbers may differ from Etherscan/Blockscout'),
    ).toBeInTheDocument();
  });
});
