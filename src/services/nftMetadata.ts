// Per-item NFT metadata service (name/description/image) for the NFT
// inventory views. Each (chainId, contract, tokenId) is resolved entirely
// browser-side: tokenURI(uint256) / uri(uint256) through the shared viem
// client, ERC-1155 {id} substitution, ipfs:// rewriting through the
// user's gateway preference, then one JSON fetch. Honesty contract:
// definitive answers (contract revert, non-string uri return, unparseable
// token id, non-http(s) metadata URI, sparse-but-real JSON) resolve to
// 'none' or 'ok' and ARE cached for the TTL; transport failures (RPC
// throw without a revert marker, JSON fetch reject, non-object JSON)
// resolve to 'unavailable' and are NOT cached so the next call retries.
// This layer never rejects and never throws out of a fetch. The hook
// collapses the item list into a content digest (plus chain and gateway)
// so identity-churn re-renders (fresh array literals from the parent) do
// not refetch.

import { useEffect, useState } from 'react';
import { parseAbi, type Address } from 'viem';

import { createRpcClient } from '@/utils/realTimeData';

/** localStorage key holding the user's preferred IPFS gateway. */
export const IPFS_GATEWAY_STORAGE_KEY = 'be:ipfsGateway';

export const DEFAULT_IPFS_GATEWAY = 'https://ipfs.io';

export const NFT_METADATA_CACHE_TTL_MS = 60 * 60 * 1000;

export const NFT_METADATA_FETCH_TIMEOUT_MS = 5_000;

/** Which per-token URI function an item's contract implements. */
export type NftMetadataStandard = 'erc721' | 'erc1155';

/** One NFT to resolve metadata for. tokenId is the plain decimal string. */
export type NftMetadataItem = {
  contract: string;
  tokenId: string;
  standard: NftMetadataStandard;
};

/**
 * Honest per-item result: 'ok' carries whatever the metadata JSON really
 * said (fields may be null — sparse metadata is real metadata), 'none'
 * means the chain definitively has no resolvable metadata URI, and
 * 'unavailable' means the transport failed (retryable, not cached).
 */
export type NftMetadataOutcome =
  | { status: 'ok'; name: string | null; image: string | null; description: string | null }
  | { status: 'none' }
  | { status: 'unavailable' };

/** Stable per-item identity: lowercase contract + raw decimal token id. */
export function nftMetadataKey(contract: string, tokenId: string): string {
  return `${contract.toLowerCase()}:${tokenId}`;
}

// --- pure URI helpers ---

// A plain decimal non-negative integer; anything else is unparseable and
// never reaches the contract read.
const DECIMAL_TOKEN_ID = /^\d+$/;

const parseTokenId = (tokenId: string): bigint | null => {
  if (!DECIMAL_TOKEN_ID.test(tokenId)) return null;
  try {
    return BigInt(tokenId);
  } catch {
    // BigInt rejects shapes like leading zeros even though the regex
    // accepted them; treat as unparseable.
    return null;
  }
};

const tokenIdToHex64 = (tokenId: string): string | null => {
  const parsed = parseTokenId(tokenId);
  return parsed === null ? null : parsed.toString(16).padStart(64, '0');
};

/**
 * ERC-1155 {id} substitution: replace the literal placeholder with the
 * 64-char zero-padded lowercase hex of the token id (per the spec, no
 * 0x prefix). A URI without {id} is returned unchanged (ERC-721 path and
 * lazy ERC-1155 contracts); a placeholder plus unparseable id → null.
 */
export function substituteUriId(uri: string, tokenId: string): string | null {
  if (!uri.includes('{id}')) return uri;
  const hex = tokenIdToHex64(tokenId);
  return hex === null ? null : uri.replaceAll('{id}', hex);
}

// Bare-CID heuristics apply ONLY when unambiguous: a 46-char CIDv0
// (Qm + 44 base58 chars) or a lowercase base32 CIDv1 (baf + 10+ chars).
const CIDV0_PATTERN = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CIDV1_PATTERN = /^baf[a-z0-9]{10,}$/;

/**
 * Pure rewrite of one metadata/image URI into a fetchable https URL
 * through the given gateway (assumed already normalized, no trailing
 * slash). http(s)/data URIs pass through unchanged; anything that is
 * neither an ipfs form nor an unambiguous bare CID resolves to null.
 */
export function resolveIpfsUri(uri: string, gateway: string): string | null {
  if (
    uri.startsWith('http://') ||
    uri.startsWith('https://') ||
    uri.startsWith('data:')
  ) {
    return uri;
  }

  if (uri.startsWith('ipfs://')) {
    let rest = uri.slice('ipfs://'.length);
    // Some contracts double-prefix: ipfs://ipfs/<cid>.
    if (rest.startsWith('ipfs/')) rest = rest.slice('ipfs/'.length);
    return rest === '' ? null : `${gateway}/ipfs/${rest}`;
  }

  // Unschemed path form: "ipfs/<cid>" or "/ipfs/<cid>", sub-path kept.
  const pathForm = uri.startsWith('/') ? uri.slice(1) : uri;
  if (pathForm.startsWith('ipfs/')) {
    const rest = pathForm.slice('ipfs/'.length);
    return rest === '' ? null : `${gateway}/ipfs/${rest}`;
  }

  if (CIDV0_PATTERN.test(uri) || CIDV1_PATTERN.test(uri)) {
    return `${gateway}/ipfs/${uri}`;
  }

  // CID-like but wrong length/charset, or plain garbage: no honest URL.
  return null;
}

// --- gateway preference ---

/**
 * Normalize a user gateway input: trim, strip ALL trailing slashes,
 * prepend https:// when no scheme is present. Empty/whitespace-only (or
 * all-slash) input normalizes to '' (meaning: use the default).
 */
export function normalizeIpfsGateway(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  const bare = trimmed.replace(/\/+$/, '');
  if (bare === '') return '';
  return bare.includes('://') ? bare : `https://${bare}`;
}

/** Current gateway preference, defaulting when unset or empty. */
export function getIpfsGateway(): string {
  let stored: string | null;
  try {
    stored = globalThis.localStorage?.getItem(IPFS_GATEWAY_STORAGE_KEY) ?? null;
  } catch {
    // Storage unavailable (private mode): fall back to the default.
    stored = null;
  }
  const normalized = stored === null ? '' : normalizeIpfsGateway(stored);
  return normalized === '' ? DEFAULT_IPFS_GATEWAY : normalized;
}

/** Persist the gateway preference; an empty value clears it (default). */
export function setIpfsGateway(value: string): void {
  const normalized = normalizeIpfsGateway(value);
  try {
    if (normalized === '') {
      globalThis.localStorage.removeItem(IPFS_GATEWAY_STORAGE_KEY);
    } else {
      globalThis.localStorage.setItem(IPFS_GATEWAY_STORAGE_KEY, normalized);
    }
  } catch {
    // Storage unavailable (private mode): preference is not persisted.
  }
}

// --- metadata JSON shaping ---

type NftMetadataFields = {
  name: string | null;
  image: string | null;
  description: string | null;
};

// Display strings are trimmed; empty/whitespace or non-string → null.
const readTrimmedField = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

// The image chain of the de-facto metadata schema: first non-empty
// string wins. The RAW (untrimmed) value is kept — the caller rewrites
// it through resolveIpfsUri afterwards.
const IMAGE_FIELDS = ['image', 'image_url', 'image_data'] as const;

/**
 * Pick name/description/image out of a fetched metadata document. Input
 * that is not a plain object (null, array, primitive) is malformed →
 * null. Missing/empty/non-string fields stay honest nulls.
 */
// Plain-object check: `typeof x === 'object'` alone narrows unknown to
// `object`, which has no index signature — this predicate is what makes
// the record view below type-safe.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function pickNftMetadataFields(json: unknown): NftMetadataFields | null {
  if (!isRecord(json)) {
    return null;
  }
  const record = json;
  const image = IMAGE_FIELDS.map((field) => record[field]).find(
    (value) => typeof value === 'string' && value.trim() !== '',
  );
  return {
    name: readTrimmedField(record.name),
    image: typeof image === 'string' ? image : null,
    description: readTrimmedField(record.description),
  };
}

// --- failure classification ---

// Collects the error's whole cause chain (gasHistory-style): viem wraps
// contract reverts several layers deep.
const errorChainText = (error: unknown): string => {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.length > 0 ? parts.join(' ') : String(error);
};

/**
 * Whether an error chain carries a contract revert (the call executed
 * and the contract refused) — the definitive-answer marker. Anything
 * else (transport, timeout, decode) is retryable.
 */
export function isContractRevertError(error: unknown): boolean {
  return /revert/i.test(errorChainText(error));
}

// --- batch resolution ---

/** Injectable contract read: one tokenURI/uri call per item. */
export type NftUriReader = (call: {
  address: string;
  functionName: 'tokenURI' | 'uri';
  tokenId: bigint;
}) => Promise<unknown>;

/** Injectable metadata-document fetcher. */
export type NftJsonFetcher = (url: string) => Promise<unknown>;

export type NftMetadataDeps = {
  readUri?: NftUriReader;
  fetchJson?: NftJsonFetcher;
};

const tokenUriAbi = parseAbi(['function tokenURI(uint256 tokenId) view returns (string)']);
const uriAbi = parseAbi(['function uri(uint256 id) view returns (string)']);

// Shared viem client type without importing viem's client types directly.
type RpcClient = Awaited<ReturnType<typeof createRpcClient>>;

/**
 * Default reader over the shared browser RPC client. The client promise
 * is memoized per batch so one invocation performs at most one
 * createRpcClient call no matter how many items it resolves; a rejected
 * client surfaces as a readUri rejection per item.
 */
const makeDefaultReadUri = (chainId: number): NftUriReader => {
  let clientPromise: Promise<RpcClient> | undefined;
  return async (call) => {
    clientPromise ??= createRpcClient(chainId);
    const client = await clientPromise;
    // Branch per function so viem infers each readContract's return type
    // from its own ABI slice.
    if (call.functionName === 'tokenURI') {
      return client.readContract({
        address: call.address as Address,
        abi: tokenUriAbi,
        functionName: 'tokenURI',
        args: [call.tokenId],
      });
    }
    return client.readContract({
      address: call.address as Address,
      abi: uriAbi,
      functionName: 'uri',
      args: [call.tokenId],
    });
  };
};

/**
 * Default metadata fetcher: plain fetch with a 5s timeout signal,
 * non-2xx → reject. AbortSignal.timeout is feature-detected for
 * environments (older jsdom) that lack it.
 */
const defaultFetchJson = async (url: string): Promise<unknown> => {
  const init: RequestInit =
    typeof AbortSignal !== 'undefined' &&
    typeof AbortSignal.timeout === 'function'
      ? { signal: AbortSignal.timeout(NFT_METADATA_FETCH_TIMEOUT_MS) }
      : {};
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const NONE_OUTCOME: NftMetadataOutcome = Object.freeze({ status: 'none' });
const UNAVAILABLE_OUTCOME: NftMetadataOutcome = Object.freeze({
  status: 'unavailable',
});

type CacheEntry = { outcome: NftMetadataOutcome; expires: number };

// `${gateway}|${chainId}:${lower contract}:${tokenId}` → cache entry.
// The gateway rides in the key so switching the preference refetches
// naturally. TTL eviction is lazy: expired entries are refetched and
// overwritten on the next request.
const metadataCache = new Map<string, CacheEntry>();

// Same key → never-rejecting in-flight promise. Concurrent batches for
// one item share a single resolution; the entry is deleted on settle.
const inflight = new Map<string, Promise<NftMetadataOutcome>>();

const outcomeCacheKey = (
  gateway: string,
  chainId: number,
  itemKey: string,
): string => `${gateway}|${chainId}:${itemKey}`;

/** Test-only hook to clear module state between test cases. */
export function resetNftMetadataCacheForTests(): void {
  metadataCache.clear();
  inflight.clear();
}

/**
 * Resolve one item's outcome. Never throws: every failure path maps to
 * the honesty split (definitive → 'none', transport → 'unavailable').
 */
const resolveOne = async (
  item: NftMetadataItem,
  gateway: string,
  readUri: NftUriReader,
  fetchJson: NftJsonFetcher,
): Promise<NftMetadataOutcome> => {
  // Unparseable token id: definitively unresolvable, no contract call.
  const tokenId = parseTokenId(item.tokenId);
  if (tokenId === null) return NONE_OUTCOME;

  let rawUri: unknown;
  try {
    rawUri = await readUri({
      address: item.contract,
      functionName: item.standard === 'erc1155' ? 'uri' : 'tokenURI',
      tokenId,
    });
  } catch (error) {
    // A revert is the contract's definitive "no metadata URI" answer;
    // anything else is a transport failure worth retrying.
    return isContractRevertError(error) ? NONE_OUTCOME : UNAVAILABLE_OUTCOME;
  }
  if (typeof rawUri !== 'string') return NONE_OUTCOME;

  const substituted = substituteUriId(rawUri, item.tokenId);
  if (substituted === null) return NONE_OUTCOME;

  // The JSON fetch stage requires an http(s) URL: rewrite ipfs forms,
  // keep http(s) as-is, and treat data:/unresolvable URIs as definitive
  // 'none' (this browser layer does not decode inline payloads).
  const url = resolveIpfsUri(substituted, gateway);
  if (
    url === null ||
    (!url.startsWith('http://') && !url.startsWith('https://'))
  ) {
    return NONE_OUTCOME;
  }

  let json: unknown;
  try {
    json = await fetchJson(url);
  } catch {
    return UNAVAILABLE_OUTCOME;
  }

  const fields = pickNftMetadataFields(json);
  if (fields === null) return UNAVAILABLE_OUTCOME;

  return {
    status: 'ok',
    name: fields.name,
    description: fields.description,
    image:
      fields.image === null ? null : resolveIpfsUri(fields.image, gateway),
  };
};

// Launches one item's resolution as a never-rejecting in-flight promise,
// caching definitive outcomes (ok/none) for the TTL and dropping the
// in-flight entry on settle.
const launchOne = (
  entryKey: string,
  work: () => Promise<NftMetadataOutcome>,
): Promise<NftMetadataOutcome> => {
  const promise = work()
    .then((outcome) => {
      if (outcome.status !== 'unavailable') {
        metadataCache.set(entryKey, {
          outcome,
          expires: Date.now() + NFT_METADATA_CACHE_TTL_MS,
        });
      }
      return outcome;
    })
    .catch(() => UNAVAILABLE_OUTCOME)
    .finally(() => {
      inflight.delete(entryKey);
    });
  inflight.set(entryKey, promise);
  return promise;
};

/**
 * Resolve metadata for a batch of items. Never rejects; keys are
 * nftMetadataKey values. Fresh (≤1h) cache entries and in-flight
 * resolutions are shared instead of duplicating network work; duplicate
 * input items collapse to one entry; chainId <= 0 or an empty list
 * returns an empty Map with zero network access.
 */
export async function fetchNftMetadataBatch(
  chainId: number,
  items: readonly NftMetadataItem[],
  deps?: NftMetadataDeps,
): Promise<Map<string, NftMetadataOutcome>> {
  const out = new Map<string, NftMetadataOutcome>();
  if (items.length === 0 || !(chainId > 0)) return out;

  const gateway = getIpfsGateway();
  const now = Date.now();

  // Collapse duplicates by item key; first occurrence wins.
  const unique = new Map<string, NftMetadataItem>();
  for (const item of items) {
    const itemKey = nftMetadataKey(item.contract, item.tokenId);
    if (!unique.has(itemKey)) unique.set(itemKey, item);
  }

  // The default reader memoizes createRpcClient inside this invocation,
  // so a fully-cached batch performs zero client work.
  const readUri = deps?.readUri ?? makeDefaultReadUri(chainId);
  const fetchJson = deps?.fetchJson ?? defaultFetchJson;

  const pending: Array<{ itemKey: string; promise: Promise<NftMetadataOutcome> }> =
    [];
  for (const [itemKey, item] of unique) {
    const entryKey = outcomeCacheKey(gateway, chainId, itemKey);
    const cached = metadataCache.get(entryKey);
    if (cached !== undefined && cached.expires > now) {
      out.set(itemKey, cached.outcome);
      continue;
    }
    const existing = inflight.get(entryKey);
    if (existing !== undefined) {
      pending.push({ itemKey, promise: existing });
      continue;
    }
    pending.push({
      itemKey,
      promise: launchOne(entryKey, () =>
        resolveOne(item, gateway, readUri, fetchJson),
      ),
    });
  }

  await Promise.all(
    pending.map(async ({ itemKey, promise }) => {
      out.set(itemKey, await promise);
    }),
  );
  return out;
}

// Content digest of the item list: lowercase contract + token id plus
// the standard flag, order-insensitive. The effect below depends on this
// string (plus chain and gateway) only, so a parent passing a fresh
// array literal each render does not refetch.
const nftItemsKey = (items: readonly NftMetadataItem[]): string =>
  [...items]
    .map(
      (item) =>
        `${nftMetadataKey(item.contract, item.tokenId)}:${item.standard === 'erc1155' ? 1 : 0}`,
    )
    .sort()
    .join('|');

// Round-trips a digest back into fetch items. Contract addresses and
// decimal token ids contain no ':', so splitting is unambiguous: the
// trailing segment is the standard flag, the first separator splits
// contract from token id.
const itemsFromKey = (key: string): NftMetadataItem[] =>
  key
    .split('|')
    .filter((entry) => entry !== '')
    .map((entry) => {
      const flagSeparator = entry.lastIndexOf(':');
      const idSeparator = entry.indexOf(':');
      return {
        contract: entry.slice(0, idSeparator),
        tokenId: entry.slice(idSeparator + 1, flagSeparator),
        standard: entry.slice(flagSeparator + 1) === '1' ? 'erc1155' : 'erc721',
      };
    });

// Shared constant for the empty-item case: defined immediately, no
// network, stable identity across renders.
const EMPTY_NFT_METADATA_MAP = new Map<string, NftMetadataOutcome>();

/**
 * Plain state/effect hook over fetchNftMetadataBatch. Returns undefined
 * until the batch lands, then the outcome Map keyed by nftMetadataKey;
 * an empty item list returns an empty Map without any network access.
 */
export function useNftMetadata(
  chainId: number,
  items: readonly NftMetadataItem[],
): Map<string, NftMetadataOutcome> | undefined {
  const key = nftItemsKey(items);
  // Read at digest time: a gateway switch must refetch, and the batch
  // cache is gateway-keyed so the miss is natural.
  const gateway = getIpfsGateway();

  const [metadata, setMetadata] = useState<
    Map<string, NftMetadataOutcome> | undefined
  >(() => (key === '' ? EMPTY_NFT_METADATA_MAP : undefined));

  useEffect(() => {
    if (key === '') return;
    // A changed digest means a different item set (or gateway): drop the
    // previous map so consumers see the honest loading state.
    setMetadata(undefined);
    let cancelled = false;
    void fetchNftMetadataBatch(chainId, itemsFromKey(key)).then((fetched) => {
      if (!cancelled) setMetadata(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [chainId, key, gateway]);

  return key === '' ? EMPTY_NFT_METADATA_MAP : metadata;
}
