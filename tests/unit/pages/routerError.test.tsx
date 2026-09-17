// RouterError recovery-link contract: the back link targets the chain the
// user last viewed (the Landing view's remembered-chain key) and names it
// via the chain config; /chain/1 is the fallback only when nothing valid
// is remembered.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';

import RouterError from '@/views/RouterError';
import { LAST_CHAIN_STORAGE_KEY } from '@/views/Home/Landing';

// The global setup's haze-ui mock has no Title; provide the one member the
// error view renders.
vi.mock('haze-ui', async () => {
  const React = await import('react');
  return {
    Title: (props: { level?: number; children?: React.ReactNode }) =>
      React.createElement(`h${props.level ?? 3}`, {}, props.children),
  };
});

const NullView = () => null;

// TypedLink needs the router context; the error view itself is rendered as
// a plain child, not as the routed component.
const renderError = () =>
  render(
    <MemoryRouter
      routes={createRoutes([{ path: '/', component: () => NullView }])}
      initialEntries={['/']}
    >
      <RouterError error={new Error('resolver exploded')} />
    </MemoryRouter>,
  );

describe('RouterError view', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('links back to the remembered chain by name', () => {
    localStorage.setItem(LAST_CHAIN_STORAGE_KEY, '137');
    renderError();

    const link = screen.getByRole('link', { name: 'Back to Polygon' });
    expect(link).toHaveAttribute('href', '/chain/137');
    // The error text still surfaces for diagnostics.
    expect(screen.getByText('resolver exploded')).toBeInTheDocument();
  });

  it('falls back to Ethereum mainnet when nothing valid is remembered', () => {
    renderError();

    expect(screen.getByRole('link', { name: 'Back to Ethereum' })).toHaveAttribute(
      'href',
      '/chain/1',
    );
  });

  it('ignores a remembered value that is not a supported chain', () => {
    localStorage.setItem(LAST_CHAIN_STORAGE_KEY, '999999');
    renderError();

    expect(screen.getByRole('link', { name: 'Back to Ethereum' })).toHaveAttribute(
      'href',
      '/chain/1',
    );
  });
});
