// Token-metadata service: human-readable token labels (symbol/decimals)
// for the transaction-detail readability wave. One aggregated viem
// multicall per uncached batch against the canonical Multicall3 contract;
// reverted calls decode to honest nulls, and a transport-level failure
// resolves every token to all-null instead of rejecting — this layer never
// fabricates metadata and never throws out of a fetch. The hook collapses
// the token list into a content digest so identity-churn re-renders (fresh
// array literals from the parent) do not refetch.

import { useEffect, useState } from 'react';
import { parseAbi, type Address, type ContractFunctionParameters } from 'viem';

import { createRpcClient } from '@/utils/realTimeData';

/** Human-readable labels for one token, or honest nulls when unknown. */
export type TokenMetadata = { symbol: string | null; decimals: number | null };

/** One token to resolve; decimals() is only called when the token is an ERC-20. */
export type TokenMetadataRequest = { address: string; includeDecimals: boolean };

// Canonical Multicall3 deployment. The viem client built by
// utils/realTimeData is not tied to a single chain type, so viem cannot
// infer the multicall address from chain config — pass it explicitly.
const MULTICALL3_ADDRESS: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const symbolAbi = parseAbi(['function symbol() view returns (string)']);
const decimalsAbi = parseAbi(['function decimals() view returns (uint8)']);

const NULL_METADATA: TokenMetadata = { symbol: null, decimals: null };

type CacheEntry = { metadata: TokenMetadata; expires: number };

// `${chainId}:${lowercase address}` → cache entry. TTL eviction is lazy:
// expired entries are simply refetched and overwritten on the next request.
const metadataCache = new Map<string, CacheEntry>();

// `${chainId}:${lowercase address}` → never-rejecting in-flight promise.
// Concurrent callers of the same token share one multicall batch instead
// of duplicating network work.
const inflight = new Map<string, Promise<TokenMetadata>>();

const cacheKey = (chainId: number, addressLower: string): string =>
  `${chainId}:${addressLower}`;

/** Test-only hook to clear module state between test cases. */
export function resetTokenMetadataCacheForTests(): void {
  metadataCache.clear();
  inflight.clear();
}

// Narrows one viem multicall outcome to its primitive value. With
// allowFailure, viem wraps each result as { status: 'success', result } or
// { status: 'failure', error }; test doubles may hand back a bare null for
// a reverted call. Anything unrecognized decodes to null.
const readMulticallValue = (outcome: unknown): string | number | null => {
  if (typeof outcome !== 'object' || outcome === null || !('status' in outcome)) {
    return null;
  }
  const record: { status: unknown; result?: unknown } = outcome;
  if (record.status !== 'success') return null;
  const value: unknown = record.result;
  return typeof value === 'string' || typeof value === 'number' ? value : null;
};

// Runs one aggregated multicall for a group of uncached tokens and returns
// their metadata. Per-token call-level failures (reverts) resolve to null
// fields and ARE cached for the TTL — the token genuinely answered, it just
// has no standard symbol()/decimals(). A transport-level failure (client
// creation or the multicall request throwing) resolves every token to
// all-null WITHOUT caching, so the next call retries the RPC.
const runTokenBatch = async (
  chainId: number,
  tokens: readonly { lower: string; includeDecimals: boolean }[],
): Promise<Map<string, TokenMetadata>> => {
  const contracts: ContractFunctionParameters[] = [];
  const slots: Array<{ lower: string; field: 'symbol' | 'decimals' }> = [];

  for (const token of tokens) {
    contracts.push({
      address: token.lower as Address,
      abi: symbolAbi,
      functionName: 'symbol',
    });
    slots.push({ lower: token.lower, field: 'symbol' });
    if (token.includeDecimals) {
      contracts.push({
        address: token.lower as Address,
        abi: decimalsAbi,
        functionName: 'decimals',
      });
      slots.push({ lower: token.lower, field: 'decimals' });
    }
  }

  let outcomes: readonly unknown[];
  try {
    const client = await createRpcClient(chainId);
    outcomes = await client.multicall({
      contracts,
      allowFailure: true,
      multicallAddress: MULTICALL3_ADDRESS,
    });
  } catch {
    return new Map(
      tokens.map((token) => [token.lower, { ...NULL_METADATA }]),
    );
  }

  const symbols = new Map<string, string | null>();
  const decimals = new Map<string, number | null>();
  slots.forEach((slot, index) => {
    const value = readMulticallValue(outcomes[index]);
    if (slot.field === 'symbol' && typeof value === 'string') {
      symbols.set(slot.lower, value);
    } else if (slot.field === 'decimals' && typeof value === 'number') {
      decimals.set(slot.lower, value);
    }
  });

  const resolved = new Map<string, TokenMetadata>();
  for (const token of tokens) {
    const metadata: TokenMetadata = {
      symbol: symbols.get(token.lower) ?? null,
      decimals: token.includeDecimals
        ? (decimals.get(token.lower) ?? null)
        : null,
    };
    resolved.set(token.lower, metadata);
    metadataCache.set(cacheKey(chainId, token.lower), {
      metadata,
      expires: Date.now() + CACHE_TTL_MS,
    });
  }
  return resolved;
};

// Registers one never-rejecting promise per token in the in-flight map,
// then drives them all from a single multicall batch. Every caller that
// grabbed a promise observes the same resolution.
const launchTokenBatch = (
  chainId: number,
  tokens: readonly { lower: string; includeDecimals: boolean }[],
): Map<string, Promise<TokenMetadata>> => {
  const promises = new Map<string, Promise<TokenMetadata>>();
  const reservations: Array<{
    lower: string;
    resolve: (metadata: TokenMetadata) => void;
  }> = [];

  for (const token of tokens) {
    let resolveToken: (metadata: TokenMetadata) => void = () => {};
    const promise = new Promise<TokenMetadata>((resolve) => {
      resolveToken = resolve;
    });
    promises.set(token.lower, promise);
    inflight.set(cacheKey(chainId, token.lower), promise);
    reservations.push({ lower: token.lower, resolve: resolveToken });
  }

  const finish = (resolved: Map<string, TokenMetadata>): void => {
    for (const { lower, resolve } of reservations) {
      resolve(resolved.get(lower) ?? NULL_METADATA);
    }
    for (const token of tokens) {
      inflight.delete(cacheKey(chainId, token.lower));
    }
  };

  void runTokenBatch(chainId, tokens)
    .then(finish)
    .catch(() =>
      finish(
        new Map(tokens.map((token) => [token.lower, NULL_METADATA])),
      ),
    );

  return promises;
};

/**
 * Resolve symbol (and, for ERC-20s, decimals) for the given tokens.
 * Keys are lowercase addresses; failed lookups resolve to null fields and
 * the function never rejects. Fresh (≤1h) cache entries skip the network,
 * and concurrent calls for the same token share one in-flight batch.
 */
export async function fetchTokenMetadata(
  chainId: number,
  requests: readonly TokenMetadataRequest[],
): Promise<Map<string, TokenMetadata>> {
  const out = new Map<string, TokenMetadata>();
  if (requests.length === 0 || !(chainId > 0)) return out;

  const now = Date.now();
  const uncached = new Map<string, TokenMetadataRequest>();
  for (const request of requests) {
    const lower = request.address.toLowerCase();
    if (out.has(lower) || uncached.has(lower)) continue;
    const entry = metadataCache.get(cacheKey(chainId, lower));
    if (entry !== undefined && entry.expires > now) {
      out.set(lower, entry.metadata);
    } else {
      uncached.set(lower, request);
    }
  }

  const pending: Array<{ lower: string; promise: Promise<TokenMetadata> }> = [];
  const toBatch: Array<{ lower: string; includeDecimals: boolean }> = [];
  for (const [lower, request] of uncached) {
    const existing = inflight.get(cacheKey(chainId, lower));
    if (existing !== undefined) {
      pending.push({ lower, promise: existing });
    } else {
      toBatch.push({ lower, includeDecimals: request.includeDecimals });
    }
  }

  if (toBatch.length > 0) {
    for (const [lower, promise] of launchTokenBatch(chainId, toBatch)) {
      pending.push({ lower, promise });
    }
  }

  await Promise.all(
    pending.map(async ({ lower, promise }) => {
      out.set(lower, await promise);
    }),
  );
  return out;
}

// Content digest of the token list: lowercase address plus the
// includeDecimals flag, order-insensitive. The effect below depends on this
// string only, so a parent passing a fresh array literal each render does
// not refetch.
const tokenListKey = (
  tokens: ReadonlyArray<{ address: string; kind: 'erc20' | 'erc721' | 'erc1155' }>,
): string =>
  [...tokens]
    .map(
      (token) =>
        `${token.address.toLowerCase()}:${token.kind === 'erc20' ? 1 : 0}`,
    )
    .sort()
    .join('|');

// Round-trips a tokenListKey digest back into fetch requests. Addresses
// contain no ':', so splitting on the last one is unambiguous.
const requestsFromKey = (key: string): TokenMetadataRequest[] =>
  key
    .split('|')
    .filter((entry) => entry !== '')
    .map((entry) => {
      const separator = entry.lastIndexOf(':');
      return {
        address: entry.slice(0, separator),
        includeDecimals: entry.slice(separator + 1) === '1',
      };
    });

// Shared constant for the empty-token case: defined immediately, no
// network, stable identity across renders.
const EMPTY_TOKEN_METADATA_MAP = new Map<string, TokenMetadata>();

/**
 * Plain state/effect hook over fetchTokenMetadata. Returns undefined until
 * the fetch lands, then the metadata Map; an empty token list returns an
 * empty Map without any network access.
 */
export function useTokenMetadata(
  chainId: number,
  tokens: ReadonlyArray<{ address: string; kind: 'erc20' | 'erc721' | 'erc1155' }>,
): Map<string, TokenMetadata> | undefined {
  const key = tokenListKey(tokens);

  const [metadata, setMetadata] = useState<Map<string, TokenMetadata> | undefined>(
    () => (key === '' ? EMPTY_TOKEN_METADATA_MAP : undefined),
  );

  useEffect(() => {
    if (key === '') return;
    // A changed key means a different token set: drop the previous map so
    // consumers see the honest loading state instead of stale labels.
    setMetadata(undefined);
    let cancelled = false;
    void fetchTokenMetadata(chainId, requestsFromKey(key)).then((fetched) => {
      if (!cancelled) setMetadata(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [chainId, key]);

  return key === '' ? EMPTY_TOKEN_METADATA_MAP : metadata;
}
