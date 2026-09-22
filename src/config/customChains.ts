// Runtime registry for user-registered EVM chains that viem's static
// registry does not ship (anvil 31337, hardhat forks, private geth, new
// L2s). Dependency-free on purpose: this module sits in BOTH the backend
// and frontend import graphs — src/config/chains.ts folds it in as a
// fallback layer over the viem index, the API routes and the backend's
// RpcManager write to it, and the frontend service registers fetched rows
// into it — so like its sibling chains.ts it may import nothing but types.
//
// The registry is process-local state. The backend loads it from the
// custom_chains table at startup (RpcManager.loadUserConfigs) and keeps it
// mirrored across writes; the frontend loads it from GET /api/chains/custom.
// Both ends therefore resolve a registered id through the same
// getChainInfo fallback without the viem index ever being rebuilt.
import type { Chain } from 'viem';

/** One user-registered chain exactly as the registry stores it. */
export type CustomChain = {
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  rpcUrl: string;
};

const registry = new Map<number, CustomChain>();

/** Register (or replace) one custom chain. */
export function registerCustomChain(chain: CustomChain): void {
  registry.set(chain.chainId, { ...chain });
}

/** Remove one custom chain; true when a registration existed. */
export function removeCustomChain(chainId: number): boolean {
  return registry.delete(chainId);
}

/** Look up one custom chain. */
export function getCustomChain(chainId: number): CustomChain | undefined {
  return registry.get(chainId);
}

/** All registered custom chains, sorted by id for stable output. */
export function listCustomChains(): CustomChain[] {
  return [...registry.values()].sort((a, b) => a.chainId - b.chainId);
}

/** All registered custom chain ids, sorted. */
export function listCustomChainIds(): number[] {
  return [...registry.keys()].sort((a, b) => a - b);
}

/**
 * Minimal viem-compatible Chain for a custom registration. Only the
 * fields every consumer actually reads are filled (id, name,
 * nativeCurrency, rpcUrls); viem treats block explorers, testnet flags
 * and the rest as optional, so existing consumers keep working unchanged.
 */
export function toViemChain(custom: CustomChain): Chain {
  return {
    id: custom.chainId,
    name: custom.name,
    nativeCurrency: {
      name: custom.name,
      symbol: custom.symbol,
      decimals: custom.decimals,
    },
    rpcUrls: {
      default: { http: [custom.rpcUrl] },
    },
  };
}

/** Test-only hook: wipe the registry between cases. */
export function resetCustomChainsForTests(): void {
  registry.clear();
}
