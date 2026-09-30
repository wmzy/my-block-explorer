// Rare-chain deep-link recovery in UnsupportedChainState: while the lazy
// viem barrel is still loading the state must not dead-end — it awaits
// the full registry (plus the custom-chain registry) once, re-checks, and
// only then commits the unsupported verdict. A REAL viem chain outside
// the curated startup subset (Zora) resolves post-load and redirects
// into itself instead. Uses the REAL @/config/chains (fresh module graph:
// the barrel is not loaded when the first test renders).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';
import { UnsupportedChainState } from '@/views/Home/UnsupportedChainState';
import { redirectReplace } from '@/views/Home/Landing';
import { ensureCustomChainsLoaded } from '@/services/customChains';

vi.mock('@/views/Home/Landing', () => ({
  getPreferredChainId: () => 1,
  redirectReplace: vi.fn(() => Promise.resolve()),
}));

// The custom-chain fetch is stubbed: these cases pin the viem-barrel
// half of the recovery, not the backend round-trip (customChainsService
// tests own that half).
vi.mock('@/services/customChains', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/customChains')>();
  return { ...actual, ensureCustomChainsLoaded: vi.fn(() => Promise.resolve()) };
});

const ZORA_ID = 7777777; // real viem chain, outside the curated subset

// native-router's route `component` is a resolver returning the component
// (see homePage.test.tsx's `() => Home`); the state takes props, so wrap
// it per case.
const stateView = (chainId: number, rawChainId?: string) =>
  function StateView() {
    return <UnsupportedChainState chainId={chainId} rawChainId={rawChainId} />;
  };

const renderState = (chainId: number, rawChainId?: string) =>
  render(
    <MemoryRouter
      routes={createRoutes([
        { path: '/chain/:chainId', component: () => stateView(chainId, rawChainId) },
      ])}
      initialEntries={['/chain/1']}
    >
      <View />
    </MemoryRouter>,
  );

describe('UnsupportedChainState lazy-registry recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recovers a real viem chain once the lazy registry loads', async () => {
    renderState(ZORA_ID);

    // Interim: no verdict while the barrel resolves (the state mounts
    // once the router resolves the route; the barrel import is still
    // in flight at that point).
    expect(await screen.findByText(`Resolving chain ID ${ZORA_ID}…`)).toBeInTheDocument();
    expect(screen.queryByText(/Chain not supported/)).not.toBeInTheDocument();

    // Post-load: the chain resolves and the state redirects into it —
    // the unsupported verdict never renders for it.
    await vi.waitFor(() => {
      expect(redirectReplace).toHaveBeenCalledWith(expect.anything(), `/chain/${ZORA_ID}`);
    });
    expect(screen.getByText(/Opening chain/)).toBeInTheDocument();
    expect(screen.queryByText(/Chain not supported/)).not.toBeInTheDocument();
  });

  it('keeps the honest unsupported verdict for ids viem does not ship', async () => {
    // 2**40: far outside any real chain id (same convention as
    // rpcConfigRoutes.test.ts's unsupported-id guard).
    renderState(2 ** 40);

    expect(await screen.findByText(/Chain not supported/)).toBeInTheDocument();
    expect(screen.getByText(/chain ID 1099511627776/)).toBeInTheDocument();
    expect(redirectReplace).not.toHaveBeenCalled();
  });

  it('renders the invalid-param verdict without waiting on either registry', async () => {
    renderState(0, 'abc');

    expect(await screen.findByText(/Invalid chain ID/)).toBeInTheDocument();
    expect(screen.getByText(/"abc" is not a valid chain ID/)).toBeInTheDocument();
    expect(ensureCustomChainsLoaded).not.toHaveBeenCalled();
  });
});
