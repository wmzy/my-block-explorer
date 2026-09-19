// ENS reverse-resolution service: address → ENS name, resolved in the
// browser against a mainnet client (where the ENS registry lives) — the
// same pinning the search bar's forward resolution uses; the chain the
// address is viewed on never changes the lookup target. The result is
// reverse + forward roundtrip verified — a reverse record that does not
// forward-resolve back to the same address renders as no name. Reverse
// records are set arbitrarily by the address owner, so an unverified one
// is a spoofing surface for the address page title; only the roundtrip
// proves the name actually belongs to the address. Unverified names (RPC
// failure, unregistered/expired forward record, address mismatch),
// unregistered reverse records, and any RPC failure settle as data null —
// the hook never throws and never invents a name.
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
    // Both the reverse lookup and the forward verification reuse this one
    // mainnet client instance.
    const client = await createRpcClient(ENS_CHAIN_ID);
    const name = await client.getEnsName({ address: address as `0x${string}` });
    if (!name) return null;
    // Roundtrip check on the same client: forward-resolve the name and
    // keep it only when it points back at the original address. A
    // throw here (RPC failure, ENSIP-15 normalization of a bogus name),
    // a null (no/expired forward record), or a different address all
    // mean unverifiable — render as no name rather than trust the
    // owner-controlled reverse record.
    const forwardAddress = await client.getEnsAddress({ name });
    if (!forwardAddress) return null;
    return forwardAddress.toLowerCase() === address.toLowerCase() ? name : null;
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
