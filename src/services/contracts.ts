// Contracts service: source/abi/creation/storage-layout (immutable once
// indexed), decoded function list, and the write-side contract read.
import type { StorageLayout } from '@/types/storage';

import { api, get, post, withSignal } from '@/util/http';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';

// Immutable data never changes once the indexer has it; 24h is effectively
// "for the lifetime of a session" while still reclaiming memory eventually.
export const IMMUTABLE_CACHE_TIME = 24 * 60 * 60 * 1000;

export type ContractSource = Record<string, unknown>;
export type ContractAbi = Record<string, unknown>;
export type ContractFunctions = Record<string, unknown>;
export type ContractCreation = Record<string, unknown>;
export type ContractReadResult = Record<string, unknown>;

// The endpoint answers {found, layout, ...} on 200 (a missing layout is a 404
// mapped to ApiError by the http layer), so the fetch unwraps to the layout
// itself — the behavior the old src/hooks/useStorageLayout.ts implemented.
export type StorageLayoutResponse = {
  found: boolean;
  layout?: StorageLayout;
};

export function fetchContractSource(
  chainId: number,
  address: string,
  signal?: AbortSignal,
): Promise<ContractSource | undefined> {
  if (!(chainId > 0) || address.length === 0) return Promise.resolve(undefined);
  return get<ContractSource>(
    `/api/chains/${chainId}/contracts/${address}/source`,
    undefined,
    withSignal(api, signal),
  );
}

export function fetchContractAbi(
  chainId: number,
  address: string,
  signal?: AbortSignal,
): Promise<ContractAbi | undefined> {
  if (!(chainId > 0) || address.length === 0) return Promise.resolve(undefined);
  return get<ContractAbi>(
    `/api/chains/${chainId}/contracts/${address}/abi`,
    undefined,
    withSignal(api, signal),
  );
}

export function fetchContractFunctions(
  chainId: number,
  address: string,
  signal?: AbortSignal,
): Promise<ContractFunctions | undefined> {
  if (!(chainId > 0) || address.length === 0) return Promise.resolve(undefined);
  return get<ContractFunctions>(
    `/api/chains/${chainId}/contracts/${address}/functions`,
    undefined,
    withSignal(api, signal),
  );
}

export function fetchContractCreation(
  chainId: number,
  address: string,
  signal?: AbortSignal,
): Promise<ContractCreation | undefined> {
  if (!(chainId > 0) || address.length === 0) return Promise.resolve(undefined);
  return get<ContractCreation>(
    `/api/chains/${chainId}/contracts/${address}/creation`,
    undefined,
    withSignal(api, signal),
  );
}

export function fetchStorageLayout(
  chainId: number,
  address: string,
  signal?: AbortSignal,
): Promise<StorageLayout | undefined> {
  if (!(chainId > 0) || address.length === 0) return Promise.resolve(undefined);
  return get<StorageLayoutResponse>(
    `/api/chains/${chainId}/contracts/${address}/storage-layout`,
    undefined,
    withSignal(api, signal),
  ).then(data => data.layout);
}

// Write side (no hook): the ABI-driven forms call this directly.
export function readContract(
  chainId: number,
  address: string,
  functionName: string,
  args: unknown[] = [],
  signal?: AbortSignal,
): Promise<ContractReadResult> {
  return post<ContractReadResult>(
    `/api/chains/${chainId}/contracts/${address}/read`,
    { functionName, args },
    withSignal(api, signal),
  );
}

// Immutable endpoints get the 24h cacheTime; `functions` is decoded on the
// fly and stays on the default.
export const contractSourceCache = createQueryCache<
  ContractSource | undefined,
  [number, string]
>('contracts-source', IMMUTABLE_CACHE_TIME);

export const contractAbiCache = createQueryCache<ContractAbi | undefined, [
  number,
  string,
]>('contracts-abi', IMMUTABLE_CACHE_TIME);

export const contractFunctionsCache = createQueryCache<
  ContractFunctions | undefined,
  [number, string]
>('contracts-functions');

export const contractCreationCache = createQueryCache<
  ContractCreation | undefined,
  [number, string]
>('contracts-creation', IMMUTABLE_CACHE_TIME);

export const storageLayoutCache = createQueryCache<
  StorageLayout | undefined,
  [number, string]
>('contracts-storage-layout', IMMUTABLE_CACHE_TIME);

const queryContractSource = bindQueryFn(fetchContractSource, contractSourceCache);
const queryContractAbi = bindQueryFn(fetchContractAbi, contractAbiCache);
const queryContractFunctions = bindQueryFn(
  fetchContractFunctions,
  contractFunctionsCache,
);
const queryContractCreation = bindQueryFn(
  fetchContractCreation,
  contractCreationCache,
);
const queryStorageLayout = bindQueryFn(fetchStorageLayout, storageLayoutCache);

const useContractSourceQuery = createQueryHook({ queryFn: queryContractSource });
const useContractAbiQuery = createQueryHook({ queryFn: queryContractAbi });
const useContractFunctionsQuery = createQueryHook({
  queryFn: queryContractFunctions,
});
const useContractCreationQuery = createQueryHook({
  queryFn: queryContractCreation,
});
// staleTime mirrors the old TanStack `staleTime: Infinity`: a cached layout
// is served without a background revalidation for as long as the entry lives.
const useStorageLayoutQuery = createQueryHook({
  queryFn: queryStorageLayout,
  staleTime: IMMUTABLE_CACHE_TIME,
});

// Old positional call signatures kept; the scenario hooks take args tuples.
export function useContractSource(chainId: number, address: string) {
  return useContractSourceQuery([chainId, address]);
}

export function useContractAbi(chainId: number, address: string) {
  return useContractAbiQuery([chainId, address]);
}

export function useContractFunctions(chainId: number, address: string) {
  return useContractFunctionsQuery([chainId, address]);
}

export function useContractCreation(chainId: number, address: string) {
  return useContractCreationQuery([chainId, address]);
}

export function useStorageLayout(chainId: number, address: string) {
  return useStorageLayoutQuery([chainId, address]);
}
