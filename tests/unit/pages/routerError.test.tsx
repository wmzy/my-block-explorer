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
import { ApiError } from '@/util/apiError';

// The global setup's haze-ui mock has no Title/Alert/Button; provide the
// members the error view (and its offline state) renders.
vi.mock('haze-ui', async () => {
  const React = await import('react');
  return {
    Title: (props: { level?: number; children?: React.ReactNode }) =>
      React.createElement(`h${props.level ?? 3}`, {}, props.children),
    Alert: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { role: 'alert' }, children),
    Button: ({
      children,
      onClick,
      disabled,
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => React.createElement('button', { onClick, disabled }, children),
  };
});

// The offline branch reaches for the discovery layer's reconnect; the
// harness has no provider, so the context hook is mocked at module level.
const mockReconnect = vi.fn(async (): Promise<{ url: string } | null> => null);
vi.mock('@/hooks/ServiceDiscoveryContext', () => ({
  useServiceDiscovery: () => ({ reconnect: mockReconnect }),
}));

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

  it('attributes not-a-contract 404s to the address, with the address page as the way out', () => {
    // A contract-source deep link on an EOA rejects in the loader with
    // ApiError 404 + code 'not_a_contract'; the error slot is where the
    // user lands (the crashed view's own not-a-contract state never runs).
    window.history.pushState(
      {},
      '',
      '/chain/137/contract/0x4bcc950dba937772a68cdbe7847c0de5c2fdeec5',
    );
    render(
      <MemoryRouter
        routes={createRoutes([{ path: '/', component: () => NullView }])}
        initialEntries={['/']}
      >
        <RouterError
          error={new ApiError(
            'Address 0x4bcc… is not a contract on chain 137',
            404,
            'not_a_contract',
          )}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /This address is not a contract/i }));
    expect(
      screen.getByRole('link', { name: /View as address/i }),
    ).toHaveAttribute(
      'href',
      '/chain/137/address/0x4bcc950dba937772a68cdbe7847c0de5c2fdeec5',
    );
    // Not the generic card, not the unverified-contract journey.
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
    expect(screen.queryByText(/unverified/i)).not.toBeInTheDocument();
  });

  it('renders the not-a-contract card without a view-as-address link when the crashed path carries no address', () => {
    window.history.pushState({}, '', '/chain/137/blocks');
    render(
      <MemoryRouter
        routes={createRoutes([{ path: '/', component: () => NullView }])}
        initialEntries={['/']}
      >
        <RouterError
          error={new ApiError('Address is not a contract', 404, 'not_a_contract')}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /This address is not a contract/i }));
    expect(screen.queryByRole('link', { name: /View as address/i })).not.toBeInTheDocument();
  });

  it('attributes backend-unreachable loader failures to the missing backend', () => {
    // A contract-source loader rejects with ApiError status 0 when the
    // indexed backend is down; the error slot is where the user actually
    // lands (the crashed view never renders its own error state).
    render(
      <MemoryRouter
        routes={createRoutes([{ path: '/', component: () => NullView }])}
        initialEntries={['/']}
      >
        <RouterError
          error={new ApiError('Backend not connected — indexed data unavailable', 0)}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Backend offline/i)).toBeInTheDocument();
    expect(screen.getByText(/npx my-block-explorer/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry connection/i })).toBeInTheDocument();
    // Not the generic card, not the raw message.
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Backend not connected/)).not.toBeInTheDocument();
  });

  it('keeps ordinary loader failures on the generic card', () => {
    renderError();

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('resolver exploded')).toBeInTheDocument();
    expect(screen.queryByText(/Backend offline/i)).not.toBeInTheDocument();
  });
});
