// Forward ENS resolution (name → address) for search surfaces. ENS records
// only exist on Ethereum mainnet, so resolution is pinned to chain 1 no
// matter which chain the user is browsing; the returned outcome keeps the
// honesty distinctions the UI depends on — 'not-found' is a definitive
// answer (the name is not registered), 'failed' means the Ethereum RPC
// never answered and must be presented as retryable, never as "no such
// name", and 'no-rpc' means the client itself could not be constructed
// (this explorer has no usable Ethereum RPC endpoint), which no retry can
// fix and must be presented as missing configuration instead.
import { createRpcClient } from '@/utils/realTimeData';

/** ENS registry/resolvers live on Ethereum mainnet only. */
export const ENS_RESOLUTION_CHAIN_ID = 1;

export type EnsAddressResolution =
  | { status: 'resolved'; address: `0x${string}` }
  | { status: 'not-found' }
  | { status: 'failed' }
  | { status: 'no-rpc' };

export async function resolveEnsAddress(name: string): Promise<EnsAddressResolution> {
  // Client construction and the lookup itself fail for different reasons:
  // the former is a missing-configuration dead end, the latter a transient
  // outage. Collapsing them would put a Retry button on a failure no
  // retry can cure, so they are caught separately.
  let client: Awaited<ReturnType<typeof createRpcClient>>;
  try {
    client = await createRpcClient(ENS_RESOLUTION_CHAIN_ID);
  }
  catch {
    return { status: 'no-rpc' };
  }

  try {
    const address = await client.getEnsAddress({ name: name.toLowerCase() });
    return address ? { status: 'resolved', address } : { status: 'not-found' };
  }
  catch {
    return { status: 'failed' };
  }
}

/**
 * Destination chains a resolved ENS name can be viewed on. The primary is
 * always the chain the name resolved on (Ethereum mainnet — the registry
 * only lives there, so that is where the address is a known fact); the
 * alternate is the chain the user was browsing when they searched, offered
 * as a secondary action only when it differs (browsing mainnet itself
 * leaves nothing to choose between). History records whichever destination
 * the user actually opens — never the viewing chain by default.
 */
export type EnsDestinations = {
  primaryChainId: number;
  alternateChainId: number | null;
};

export function ensDestinations(viewingChainId: number | undefined): EnsDestinations {
  return {
    primaryChainId: ENS_RESOLUTION_CHAIN_ID,
    alternateChainId:
      viewingChainId !== undefined && viewingChainId !== ENS_RESOLUTION_CHAIN_ID
        ? viewingChainId
        : null,
  };
}
