// First-run onboarding contract (GettingStarted + Landing mount):
//
//  - visibility matrix: the card shows ONLY when discovery has settled
//    with no backend and the persistent dismissal flag is unset — a null
//    (still discovering) or true (connected) hides it so it never flashes
//    or lingers next to a working backend;
//  - dismissal is one mechanism: "Don't show again" and the × close both
//    persist the localStorage flag and release the landing redirect;
//  - the card presents all three run-mode names (copy must not drift
//    from docs/INSTALLATION.md), the npx command with a working Copy
//    button, and a plain docs link;
//  - Landing holds the '/' redirect while the guide is visible and
//    releases it otherwise (backend found or flag preset → straight to
//    the chain page, no behavior change for non-first runs).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import Landing from '@/views/Home/Landing';
import {
  GettingStarted,
  GETTING_STARTED_COMMAND,
  ONBOARDING_DISMISSED_KEY,
  backendConnectedFromStatus,
  readOnboardingDismissed,
  shouldShowGettingStarted,
  writeOnboardingDismissed,
} from '@/views/Home/GettingStarted';

// Discovery state is module-mutable so each case can pin the status the
// Landing view observes without remounting the context provider.
const discovery = vi.hoisted(() => ({ status: 'not-found' }));

vi.mock('@/hooks/ServiceDiscoveryContext', () => ({
  useServiceDiscovery: () => ({ status: discovery.status }),
}));

// Same chain-config fixture shape as homePage.test.tsx: mainnet only.
vi.mock('@/config/chains', () => ({
  isChainSupported: (chainId: number) => chainId === 1,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
}));

// jsdom ships no navigator.clipboard; copy tests stub the async API
// directly (rawJson.test.tsx pattern).
const stubClipboard = (writeText?: (text: string) => Promise<void>) => {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
};

const ChainPage = () => <div data-testid="chain-page" />;

const renderLanding = () =>
  render(
    <MemoryRouter
      routes={createRoutes([
        { path: '/', component: () => Landing },
        { path: '/chain/:chainId', component: () => ChainPage },
      ])}
      initialEntries={['/']}
    >
      <View />
    </MemoryRouter>,
  );

beforeEach(() => {
  localStorage.clear();
  discovery.status = 'not-found';
  stubClipboard();
});

describe('shouldShowGettingStarted visibility matrix', () => {
  it('hides the card while discovery is still running (null)', () => {
    expect(
      shouldShowGettingStarted({ backendConnected: null, dismissed: false }),
    ).toBe(false);
  });

  it('hides the card once a backend is connected', () => {
    expect(
      shouldShowGettingStarted({ backendConnected: true, dismissed: false }),
    ).toBe(false);
  });

  it('shows the card when discovery settled with no backend and it was not dismissed', () => {
    expect(
      shouldShowGettingStarted({ backendConnected: false, dismissed: false }),
    ).toBe(true);
  });

  it('hides the card when it was dismissed, even backend-less', () => {
    expect(
      shouldShowGettingStarted({ backendConnected: false, dismissed: true }),
    ).toBe(false);
  });
});

describe('backendConnectedFromStatus', () => {
  it('maps the discovery lifecycle onto the tri-state', () => {
    expect(backendConnectedFromStatus('found')).toBe(true);
    expect(backendConnectedFromStatus('idle')).toBeNull();
    expect(backendConnectedFromStatus('discovering')).toBeNull();
    expect(backendConnectedFromStatus('not-found')).toBe(false);
    expect(backendConnectedFromStatus('error')).toBe(false);
  });
});

describe('onboarding dismissal storage helpers', () => {
  it('round-trips the flag through jsdom localStorage under the documented key', () => {
    expect(readOnboardingDismissed()).toBe(false);

    writeOnboardingDismissed();

    expect(localStorage.getItem(ONBOARDING_DISMISSED_KEY)).toBe('1');
    expect(readOnboardingDismissed()).toBe(true);
  });

  it('reads and writes through an injected storage (isolated from the real one)', () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => void backing.set(key, value),
    };

    expect(readOnboardingDismissed(storage)).toBe(false);
    writeOnboardingDismissed(storage);

    expect(readOnboardingDismissed(storage)).toBe(true);
    // The real localStorage stayed untouched by the injected calls.
    expect(localStorage.getItem(ONBOARDING_DISMISSED_KEY)).toBeNull();
  });

  it('treats a malformed stored value as not dismissed', () => {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, 'yes');

    expect(readOnboardingDismissed()).toBe(false);
  });
});

describe('GettingStarted card', () => {
  const renderCard = (onDismiss = vi.fn()) =>
    render(<GettingStarted onDismiss={onDismiss} />);

  it('names all three run modes', () => {
    renderCard();

    expect(screen.getByText('RPC-only (no backend)')).toBeInTheDocument();
    expect(screen.getByText('Local backend')).toBeInTheDocument();
    expect(screen.getByText('Shared deployment')).toBeInTheDocument();
  });

  it('shows the npx command and a plain docs link', () => {
    renderCard();

    expect(screen.getByText(GETTING_STARTED_COMMAND)).toBeInTheDocument();
    const docs = screen.getByRole('link', { name: /INSTALLATION/ });
    expect(docs).toHaveAttribute(
      'href',
      'https://github.com/wmzy/my-block-explorer/blob/main/docs/INSTALLATION.md',
    );
  });

  it('copies the command through the async clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await screen.findByRole('button', { name: 'Copied!' });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(GETTING_STARTED_COMMAND);
  });

  it('routes both close controls through the single dismiss mechanism', () => {
    const onDismiss = vi.fn();
    renderCard(onDismiss);

    fireEvent.click(screen.getByRole('button', { name: /Don't show again/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close getting started' }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});

describe('Landing first-run mount', () => {
  it('holds the redirect on the guide when no backend was found on first run', async () => {
    renderLanding();

    expect(
      await screen.findByRole('heading', { name: 'Three ways to run this explorer' }),
    ).toBeInTheDocument();
    // The chain page has NOT taken over while the guide is readable.
    expect(screen.queryByTestId('chain-page')).not.toBeInTheDocument();
  });

  it('persisting the dismissal releases the redirect to the chain page', async () => {
    renderLanding();

    fireEvent.click(
      await screen.findByRole('button', { name: /Don't show again/i }),
    );

    // The flag survived the dismissal (persistent, not session-scoped)…
    expect(localStorage.getItem(ONBOARDING_DISMISSED_KEY)).toBe('1');
    // …and the entry redirect proceeded to the resolved chain.
    expect(await screen.findByTestId('chain-page')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Three ways to run this explorer' })).not.toBeInTheDocument();
  });

  it('goes straight to the chain page when a backend is connected', async () => {
    discovery.status = 'found';
    renderLanding();

    expect(await screen.findByTestId('chain-page')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Three ways to run this explorer' }),
    ).not.toBeInTheDocument();
  });

  it('goes straight to the chain page when the guide was dismissed earlier', async () => {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
    renderLanding();

    expect(await screen.findByTestId('chain-page')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Three ways to run this explorer' }),
    ).not.toBeInTheDocument();
  });

  it('renders nothing while discovery has not settled (no flash)', () => {
    discovery.status = 'discovering';
    const { container } = renderLanding();

    expect(container.innerHTML).toBe('');
    expect(screen.queryByTestId('chain-page')).not.toBeInTheDocument();
  });
});
