// Custom-chain service (frontend): the user-registered EVM chains viem's
// registry does not ship, persisted through the backend (GET open;
// POST/DELETE admin-token gated — the token rides along automatically
// via util/http's based()). Mirrors the labels.ts service shape: one
// query-cache read hook plus write helpers that reject with ApiError.
//
// Registration semantics: every successfully fetched list is ALSO
// registered into the runtime registry (@/config/customChains) so
// getChainInfo-style lookups resolve custom chains on the frontend the
// same way the backend's RpcManager does after startup — /chain/:id
// views, the chain selector and the search layer all work without
// per-view wiring. A redacted rpcUrl (untrusted reader) is registered
// verbatim: name/symbol stay honest, and RPC-dependent surfaces degrade
// to their normal RPC-error states instead of fabricating a URL.
import { api, get, post, withSignal } from '@/util/http';
import { ApiError } from '@/util/apiError';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';
import { registerCustomChain, type CustomChain } from '@/config/customChains';
import { invalidateRpcClients, absorbCustomChainRpcUrls } from '@/utils/realTimeData';

/** One custom chain as the list endpoint serves it (urlRedacted says which form rpcUrl is in). */
export type CustomChainView = {
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  rpcUrl: string;
  urlRedacted: boolean;
};

type CustomChainsResponse = { chains?: unknown };

// Shape guard for one API row: a chain must carry honest types for every
// field; anything else is dropped rather than fabricated into a chain.
const parseCustomChainRow = (row: unknown): CustomChainView | null => {
  if (typeof row !== 'object' || row === null) return null;
  const { chainId, name, symbol, decimals, rpcUrl, urlRedacted } =
    row as Record<string, unknown>;
  if (typeof chainId !== 'number' || !Number.isInteger(chainId) || chainId <= 0) {
    return null;
  }
  if (typeof name !== 'string' || typeof symbol !== 'string' || typeof rpcUrl !== 'string') {
    return null;
  }
  return {
    chainId,
    name,
    symbol,
    decimals: typeof decimals === 'number' && Number.isInteger(decimals) ? decimals : 18,
    rpcUrl,
    urlRedacted: urlRedacted === true,
  };
};

/** Registry entry (config layer) for one served view row. */
const toRegistryEntry = (view: CustomChainView): CustomChain => ({
  chainId: view.chainId,
  name: view.name,
  symbol: view.symbol,
  decimals: view.decimals,
  rpcUrl: view.rpcUrl,
});

/**
 * Fetch the registered custom chains and mirror them into the runtime
 * registry. Rejects with ApiError on transport/HTTP failure (the query
 * layer surfaces those to the hook's error branch); a malformed row is
 * skipped, never fabricated.
 */
export async function fetchCustomChains(signal?: AbortSignal): Promise<CustomChainView[]> {
  const body = await get<CustomChainsResponse>(
    '/api/chains/custom',
    undefined,
    withSignal(api, signal),
  );

  const rows = Array.isArray(body.chains) ? body.chains : [];
  const views = rows
    .map(parseCustomChainRow)
    .filter((view): view is CustomChainView => view !== null);

  for (const view of views) {
    registerCustomChain(toRegistryEntry(view));
  }
  // Wire the RPC layer too: without this the browser's clients for these
  // ids fall back to viem defaults (e.g. anvil's 127.0.0.1:8545) and the
  // registered RPC never serves. Redacted URLs are skipped inside.
  absorbCustomChainRpcUrls(views);
  return views;
}

export const customChainsCache = createQueryCache<CustomChainView[], []>('custom-chains');

const queryCustomChains = bindQueryFn(fetchCustomChains, customChainsCache);

const useCustomChainsQuery = createQueryHook({ queryFn: queryCustomChains });

/** Reactive read of the registered custom chains. */
export function useCustomChains() {
  return useCustomChainsQuery([]);
}

/** Drop cached rows so the next useCustomChains mount refetches. */
export function invalidateCustomChainsCache(): void {
  customChainsCache.clear();
}

// One-shot registry bootstrap for the unsupported-chain gate: before any
// UI declares a chain id unsupported it must have consulted the backend's
// registrations once — a deep link to /chain/31337 with the chain already
// registered (another tab, a previous session) recovers instead of dead
// -ending. Any failure — including no backend at all — settles silently:
// the gate then simply keeps its honest unsupported state.
let registryLoaded: Promise<void> | null = null;

/** Resolve once the backend's custom chains have been fetched (or the fetch failed). */
export function ensureCustomChainsLoaded(): Promise<void> {
  registryLoaded ??= fetchCustomChains()
    .then(() => undefined)
    .catch(() => undefined);
  return registryLoaded;
}

/**
 * Register a custom chain through the backend: POST probes the RPC's
 * eth_chainId, persists the row, and echoes the registered chain — the
 * probe's id wins, because it is the chain the endpoint actually serves.
 * On success the chain is registered locally and the read cache dropped,
 * so getChainInfo and the next useCustomChains mount see it immediately.
 * Rejects with ApiError: 403 = admin token missing/invalid, 409 = the id
 * is already known to viem (message carries existingName + hint), 502 =
 * the probe could not establish a chain id.
 */
export async function addCustomChain(input: {
  rpcUrl: string;
  name?: string;
  symbol?: string;
  decimals?: number;
}): Promise<CustomChain> {
  const created = await post<unknown>('/api/chains/custom', input);

  const view = parseCustomChainRow(created);
  if (!view) {
    throw new ApiError(
      'The backend registered the chain but returned a malformed body.',
      0,
    );
  }

  const entry = toRegistryEntry(view);
  registerCustomChain(entry);
  invalidateCustomChainsCache();
  // Cached per-chain RPC clients were built against the pre-registration
  // chain info (viem defaults for the id); drop them so the next
  // createRpcClient serves the registered URL (RpcConfig modal pattern).
  invalidateRpcClients();
  // invalidateRpcClients also cleared the URL map — re-seed it with the
  // URL the user just submitted (the POST echo may be redacted for
  // untrusted readers; the input never is) so the very next client build
  // already serves it. The full list re-absorb happens on the next fetch.
  absorbCustomChainRpcUrls([{ chainId: view.chainId, rpcUrl: input.rpcUrl }]);
  return entry;
}

/** Test-only hook: forget the one-shot load and drop cached rows. */
export function resetCustomChainsServiceForTests(): void {
  registryLoaded = null;
  customChainsCache.clear();
}
