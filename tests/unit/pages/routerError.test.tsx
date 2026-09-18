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
    // Reset the browser URL between cases: the view derives the crashed
    // route's chain from it when no matched context exists.
    window.history.pushState({}, '', '/');
  });

  it('links back to the remembered chain by name', () => {
    localStorage.setItem(LAST_CHAIN_STORAGE_KEY, '137');
    renderError();

    const link = screen.getByRole('link', { name: 'Back to Polygon' });
    expect(link).toHaveAttribute('href', '/chain/137');
    // The error text still surfaces for diagnostics.
    expect(screen.getByText('resolver exploded')).toBeInTheDocument();
  });

  it('derives the crashed route chain from the failed deep link over memory', () => {
    // Nothing remembered at all: the failed location (the browser URL of a
    // crashed deep link) is the only chain source — the old behavior landed
    // on an unrelated default instead.
    window.history.pushState({}, '', '/chain/137/blocks');
    renderError();

    expect(screen.getByRole('link', { name: 'Back to Polygon' })).toHaveAttribute(
      'href',
      '/chain/137',
    );
  });

  it('prefers the crashed route chain even when another chain is remembered', () => {
    localStorage.setItem(LAST_CHAIN_STORAGE_KEY, '1');
    window.history.pushState({}, '', '/chain/137/block/5');
    renderError();

    expect(screen.getByRole('link', { name: 'Back to Polygon' })).toHaveAttribute(
      'href',
      '/chain/137',
    );
  });

  it('falls back to the remembered chain when the crashed route chain is unsupported', () => {
    // A chain the config cannot resolve cannot be a recovery destination
    // (it would just fail again), so the remembered chain wins. Note 999
    // is a real supported chain in viem (HyperEVM) — use a truly unknown id.
    localStorage.setItem(LAST_CHAIN_STORAGE_KEY, '137');
    window.history.pushState({}, '', '/chain/999999/blocks');
    renderError();

    expect(screen.getByRole('link', { name: 'Back to Polygon' })).toHaveAttribute(
      'href',
      '/chain/137',
    );
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

  it('ignores a non-numeric chain segment in the crashed path', () => {
    window.history.pushState({}, '', '/chain/not-a-number/blocks');
    renderError();

    expect(screen.getByRole('link', { name: 'Back to Ethereum' })).toHaveAttribute(
      'href',
      '/chain/1',
    );
  });
});
