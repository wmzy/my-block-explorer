// The two one-shot bootstrap latches — the user's RPC configs
// (utils/realTimeData) and the custom-chain registry (services/customChains)
// — used to mark themselves LOADED inside their own catch, so a single
// failed request pinned the failure for the whole session. The app makes a
// pre-connect call the DEFAULT path (DiscoveryGate renders children in
// degraded mode while the backend is still down), so that was the normal
// case, not an edge case: the browser then used viem's public default RPCs
// for the rest of the session — the rate-limited endpoints the user
// configured around — and viem's anvil placeholder for their dev chain.
//
// Rejections that are NOT "the backend is unreachable" (util/http's status
// 0, raised while apiBase === '') stay latched: that is the zero-backend
// mode, and retrying from every page would be a request storm. A real
// backend answer (even a 403) is re-armed.
//
// Both bootstraps are driven through the SAME util/http `get`, so the mock
// routes by URL and the assertions count per endpoint.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { http as viemHttp } from 'viem';

import { ApiError } from '@/util/apiError';
import { getCustomChain, resetCustomChainsForTests } from '@/config/customChains';
import { invalidateRpcClients } from '@/utils/realTimeData';
import { resetCustomChainsServiceForTests } from '@/services/customChains';

const { getMock, rpcConfigsOutcome, chainsOutcome } = vi.hoisted(() => ({
  getMock: vi.fn(),
  rpcConfigsOutcome: { impl: (): Promise<unknown> => Promise.resolve({ configs: [] }) },
  chainsOutcome: { impl: (): Promise<unknown> => Promise.resolve({ chains: [] }) },
}));

vi.mock('@/util/http', () => ({
  get: getMock,
  api: {},
  post: vi.fn(),
  del: vi.fn(),
  withSignal: (_api: unknown, signal?: AbortSignal) => ({ signal }),
}));

// The registry latch has one consumer inside the custom-ABI panel, which
// the exercises below never render; stub the module so importing the
// service does not drag the discovery gate in.
vi.mock('@/components/ServiceSetup/RecoveryGate', () => ({
  useServiceDiscovery: () => ({ reconnect: vi.fn() }),
}));

// Chain 31337 is a real viem dev-chain placeholder (loopback 8545), so the
// assertions compare the browser's wiring against viem's own default for it
// — exactly what a registered custom chain overrides.
vi.mock('viem', async importOriginal => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ id: 'client' })),
    http: vi.fn(() => ({ id: 'transport' })),
  };
});

const RPC_CONFIGS = '/api/rpc-configs';
const CUSTOM_CHAINS = '/api/chains/custom';
const ANVIL = 31337;
const REGISTERED_URL = 'http://127.0.0.1:9545';

// A registered custom chain as GET /api/chains/custom serves it.
const registeredChain = {
  chainId: ANVIL,
  name: 'Local',
  symbol: 'ETH',
  decimals: 18,
  rpcUrl: REGISTERED_URL,
  urlRedacted: false,
};

// The same chain as GET /api/rpc-configs serves it (note: `url`, not
// `rpcUrl` — that is the endpoint's own field).
const registeredRpcConfig = {
  chainId: ANVIL,
  url: REGISTERED_URL,
  urlRedacted: false,
};

// A real backend answered and the fetch failed (403, 5xx, network).
const serverFailure = () => new ApiError('upstream unavailable', 503);
// Exactly what util/http rejects with while apiBase === ''.
const backendOffline = () => new ApiError('Backend not connected', 0);

const callsTo = (url: string): number => getMock.mock.calls.filter(call => call[0] === url).length;

describe('a failed bootstrap must not be latched as loaded for the session', () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockImplementation((url: string) =>
      url === RPC_CONFIGS ? rpcConfigsOutcome.impl() : chainsOutcome.impl(),
    );
    rpcConfigsOutcome.impl = () => Promise.resolve({ configs: [] });
    chainsOutcome.impl = () => Promise.resolve({ chains: [] });
    resetCustomChainsForTests();
    resetCustomChainsServiceForTests();
    invalidateRpcClients();
  });

  afterAll(() => {
    invalidateRpcClients();
  });

  it('realTimeData: a failed RPC-config fetch is re-armed on the next client request', async () => {
    const { createRpcClient } = await import('@/utils/realTimeData');
    rpcConfigsOutcome.impl = () =>
      Promise.reject(new ApiError('unavailable', 503))
        .then(undefined, () => ({ configs: [] }));

    await createRpcClient(1);
    expect(callsTo(RPC_CONFIGS)).toBe(1);

    // Drop the built client (what addCustomChain / the RPC modal do): the
    // latch must still be open, so the next request re-asks.
    invalidateRpcClients();
    await createRpcClient(1);

    expect(callsTo(RPC_CONFIGS)).toBe(2);
  });

  it('realTimeData: the user-configured RPC wins over the viem default once the fetch recovers', async () => {
    const { createRpcClient } = await import('@/utils/realTimeData');
    // While the RPC-config fetch is down, no custom URL is known, so the
    // client falls back to the chain's own default (viem's anvil 8545).
    rpcConfigsOutcome.impl = () => Promise.reject(serverFailure());
    await createRpcClient(ANVIL);
    expect(viemHttp).toHaveBeenLastCalledWith(undefined);

    // The config endpoint recovers; the next client must pick it up.
    rpcConfigsOutcome.impl = () => Promise.resolve({ configs: [registeredRpcConfig] });
    invalidateRpcClients();
    await createRpcClient(ANVIL);

    expect(callsTo(RPC_CONFIGS)).toBe(2);
    expect(viemHttp).toHaveBeenLastCalledWith(REGISTERED_URL);
  });

  it('realTimeData: the zero-backend mode stays latched (no per-page request storm)', async () => {
    const { createRpcClient } = await import('@/utils/realTimeData');
    rpcConfigsOutcome.impl = () => Promise.reject(backendOffline());

    await createRpcClient(1);
    await createRpcClient(1);
    await createRpcClient(1);

    // One shot, not three: the degraded mode is a stable state and the
    // discovery reconnect is the re-probe path.
    expect(callsTo(RPC_CONFIGS)).toBe(1);
  });

  it('customChains: a failed registry fetch is re-armed for the next ensure', async () => {
    const { ensureCustomChainsLoaded } = await import('@/services/customChains');
    chainsOutcome.impl = () => Promise.reject(serverFailure());

    await ensureCustomChainsLoaded();
    expect(callsTo(CUSTOM_CHAINS)).toBe(1);

    await ensureCustomChainsLoaded();

    expect(callsTo(CUSTOM_CHAINS)).toBe(2);
  });

  it('customChains: a recovered registry registers the chain and its RPC url', async () => {
    const { ensureCustomChainsLoaded } = await import('@/services/customChains');
    chainsOutcome.impl = () => Promise.reject(serverFailure());
    await ensureCustomChainsLoaded();
    // The gate's honest fallback: the chain is unknown.
    expect(getCustomChain(ANVIL)).toBeUndefined();

    chainsOutcome.impl = () => Promise.resolve({ chains: [registeredChain] });
    await ensureCustomChainsLoaded();

    // The re-armed fetch registered the chain AND absorbed its RPC URL.
    expect(getCustomChain(ANVIL)?.name).toBe('Local');

    // The absorbed URL is the one the browser's client cache now serves:
    // viem's anvil placeholder (8545) is shadowed by the registered 9545.
    const { createRpcClient } = await import('@/utils/realTimeData');
    await createRpcClient(ANVIL);
    expect(viemHttp).toHaveBeenLastCalledWith(REGISTERED_URL);
  });

  it('customChains: the zero-backend mode stays latched', async () => {
    const { ensureCustomChainsLoaded } = await import('@/services/customChains');
    chainsOutcome.impl = () => Promise.reject(backendOffline());

    await ensureCustomChainsLoaded();
    await ensureCustomChainsLoaded();

    expect(callsTo(CUSTOM_CHAINS)).toBe(1);
  });
});
