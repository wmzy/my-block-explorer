// ENS reverse-resolution service: address → ENS name, resolved in the
// browser against a mainnet client (where the ENS registry lives) — the
// same pinning the search bar's forward resolution uses; the chain the
// address is viewed on never changes the lookup target. Unregistered
// reverse records and any RPC failure settle as data null — the hook never
// throws and never invents a name.
import { createRpcClient } from '@/utils/realTimeData';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';

// ENS records only exist on mainnet; both forward and reverse resolution
// always target chain 1.
const ENS_CHAIN_ID = 1;

// Gated like the other services: a missing/blank address is a disabled
// query (undefined, no RPC), distinct from an answered "no name" (null).
// The chainId key member only separates cache entries per viewing chain;
// the lookup itself is mainnet-pinned regardless.
export async function fetchEnsName(
  address: string | undefined,
  _chainId?: number,
): Promise<string | null | undefined> {
  if (!address) return undefined;
  try {
    const client = await createRpcClient(ENS_CHAIN_ID);
    const name = await client.getEnsName({ address: address as `0x${string}` });
    return name ?? null;
  } catch {
    return null;
  }
}

export const ensNameCache = createQueryCache<string | null | undefined, [
  string | undefined,
  number | undefined,
]>('ens-name');

const queryEnsName = bindQueryFn(fetchEnsName, ensNameCache);

const useEnsNameQuery = createQueryHook({ queryFn: queryEnsName });

// Consumers see only the two honest states: a resolved name or null (also
// while loading and for gated keys — no placeholder name ever shows).
export function useEnsName(address: string | undefined, chainId?: number): {
  data: string | null;
  loading: boolean;
} {
  const query = useEnsNameQuery([address, chainId]);
  return { data: query.data ?? null, loading: query.loading };
}
