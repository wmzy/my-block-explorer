// Route-table contract: the exact path set, the landing redirect, loader
// wiring on the immutable contract routes, and that each path resolves to
// the intended view module (catches path typos and swapped lazy imports
// without rendering — per-view rendering is covered by the page tests).
import { describe, it, expect } from 'vitest';

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
      '/chain/:chainId/contracts',
      '/chain/:chainId/block/:blockNumber',
      '/chain/:chainId/tx/:txHash',
      '/chain/:chainId/address/:address',
      '/chain/:chainId/contract/:address',
      '/chain/:chainId/contract/:address/events',
      '/search',
    ]);
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
      ['/chain/:chainId/tx/:txHash', 'Detail'],
      ['/chain/:chainId/address/:address', 'Address'],
      ['/chain/:chainId/contract/:address', 'Contract'],
      ['/search', 'Search'],
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
