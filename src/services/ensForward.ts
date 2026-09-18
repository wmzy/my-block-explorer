// Forward ENS resolution (name → address) for search surfaces. ENS records
// only exist on Ethereum mainnet, so resolution is pinned to chain 1 no
// matter which chain the user is browsing; the returned outcome keeps the
// honesty distinction the UI depends on — 'not-found' is a definitive
// answer (the name is not registered), 'failed' means the Ethereum RPC
// never answered and must be presented as retryable, never as "no such
// name".
import { createRpcClient } from '@/utils/realTimeData';

/** ENS registry/resolvers live on Ethereum mainnet only. */
export const ENS_RESOLUTION_CHAIN_ID = 1;

export type EnsAddressResolution =
  | { status: 'resolved'; address: `0x${string}` }
  | { status: 'not-found' }
  | { status: 'failed' };

export async function resolveEnsAddress(name: string): Promise<EnsAddressResolution> {
  try {
    const client = await createRpcClient(ENS_RESOLUTION_CHAIN_ID);
    const address = await client.getEnsAddress({ name: name.toLowerCase() });
    return address ? { status: 'resolved', address } : { status: 'not-found' };
  }
  catch {
    return { status: 'failed' };
  }
}
