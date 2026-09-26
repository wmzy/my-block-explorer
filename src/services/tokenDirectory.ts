// Token directory service for /chain/:chainId/tokens: the honest union of
// (1) the curated per-chain knownTokens list (config/knownTokens — display
// hints only, exactly like the address page's Known Tokens section) and
// (2) tokens OPENED in this browser (localStorage, the be:searchHistory
// precedent — a server-side list would leak every visitor's browsing to
// everyone). Never a complete registry: the view carries that caveat in
// every state.
//
// Layering follows the established service shapes: storage is best-effort
// per-browser (searchHistory/watchlist precedent — reads degrade to [],
// writes are swallowed in private mode), row enrichment is ONE Multicall3
// batch of name()/symbol()/decimals()/totalSupply() (tokenMetadata's
// multicall pattern; a transport-level failure REJECTS so the query hook
// surfaces a retryable error — knownTokenBalances' convention), and prices
// resolve in the view through the existing prices.ts spot batch. The
// "ERC-20" claim reuses classifyTokenOverview's rule verbatim: decimals()
// AND totalSupply() must both have responded.

import { parseAbi, getAddress, type Address, type ContractFunctionParameters } from 'viem';

import { knownTokensForChain, type KnownToken } from '@/config/knownTokens';
import { classifyTokenOverview } from '@/views/Address/tokenOverview';
import { createRpcClient } from '@/utils/realTimeData';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';

// ---------------------------------------------------------------------------
// Viewed-token storage (per browser, per chain)
// ---------------------------------------------------------------------------

export const VIEWED_TOKENS_STORAGE_PREFIX = 'be:viewedTokens:';

export const VIEWED_TOKENS_MAX_ENTRIES = 50;

/** One token opened in this browser; hints are display-only, chain is truth. */
export type ViewedTokenEntry = {
  /** EIP-55 checksummed contract address. */
  address: string;
  /** Symbol as last seen on the token page, when it resolved. */
  symbol?: string;
  /** Name as last seen on the token page, when it resolved. */
  name?: string;
  /** ISO timestamp of the FIRST open in this browser (re-visits keep it). */
  firstSeen: string;
};

/** Metadata the token page hands the recorder; null = not resolved. */
export type ViewedTokenMeta = { symbol?: string | null; name?: string | null };

/** Storage seam for tests: the two members this module actually uses. */
export type ViewedTokenStorage = Pick<Storage, 'getItem' | 'setItem'>;

const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const viewedTokensStorageKey = (chainId: number): string =>
  `${VIEWED_TOKENS_STORAGE_PREFIX}${chainId}`;

const nonEmpty = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

// Narrows one stored payload element to an entry. Storage is user-editable;
// a hand-corrupted row degrades to null (dropped on read), never crashes.
const toEntry = (value: unknown): ViewedTokenEntry | null => {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as { address?: unknown; symbol?: unknown; name?: unknown; firstSeen?: unknown };
  if (
    typeof record.address !== 'string'
    || !HEX_ADDRESS_RE.test(record.address)
    || typeof record.firstSeen !== 'string'
  ) {
    return null;
  }
  const symbol = nonEmpty(record.symbol);
  const name = nonEmpty(record.name);
  return {
    address: record.address,
    ...(symbol !== undefined ? { symbol } : {}),
    ...(name !== undefined ? { name } : {}),
    firstSeen: record.firstSeen,
  };
};

/** Pure JSON-parse shape of the stored payload: valid entries, capped, corrupt rows dropped. */
export function parseViewedTokens(raw: string | null): ViewedTokenEntry[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(toEntry)
    .filter((entry): entry is ViewedTokenEntry => entry !== null)
    .slice(0, VIEWED_TOKENS_MAX_ENTRIES);
}

/** Viewed tokens of one chain, newest-first, never past the cap. Best-effort: storage failures read as []. */
export function readViewedTokens(
  chainId: number,
  storage: ViewedTokenStorage = localStorage,
): ViewedTokenEntry[] {
  try {
    return parseViewedTokens(storage.getItem(viewedTokensStorageKey(chainId)));
  } catch {
    return [];
  }
}

// Best-effort persist (searchHistory precedent): a full/private-mode
// storage swallows the write while the returned list still reflects it.
const writeViewedTokens = (
  chainId: number,
  entries: readonly ViewedTokenEntry[],
  storage: ViewedTokenStorage,
): ViewedTokenEntry[] => {
  try {
    storage.setItem(viewedTokensStorageKey(chainId), JSON.stringify(entries));
  } catch {
    // Quota/private mode — the directory silently stops persisting.
  }
  return [...entries];
};

/**
 * Pure insert/refresh: the entry moves to the front (newest-first), an
 * existing record of the same address is replaced — keeping its original
 * firstSeen and any hints the new visit could not resolve — and the list
 * stays capped. Dedupe is case-insensitive (the writer stores checksummed,
 * but hand-edited storage may not be).
 */
export function mergeViewedEntries(
  existing: readonly ViewedTokenEntry[],
  next: ViewedTokenEntry,
  cap: number = VIEWED_TOKENS_MAX_ENTRIES,
): ViewedTokenEntry[] {
  const lower = next.address.toLowerCase();
  const prior = existing.find((entry) => entry.address.toLowerCase() === lower);
  const symbol = next.symbol ?? prior?.symbol;
  const name = next.name ?? prior?.name;
  const merged: ViewedTokenEntry = {
    address: next.address,
    ...(symbol !== undefined ? { symbol } : {}),
    ...(name !== undefined ? { name } : {}),
    firstSeen: prior?.firstSeen ?? next.firstSeen,
  };
  return [
    merged,
    ...existing.filter((entry) => entry.address.toLowerCase() !== lower),
  ].slice(0, cap);
}

/**
 * Record that this browser opened a token (called by the token page's
 * effect). The address is normalized to its EIP-55 checksummed form —
 * viem's getAddress silently corrects any hex-shaped input, exactly the
 * watchlist store's convention — while a malformed input performs no
 * write. Re-visits dedupe by address.
 */
export function recordViewedToken(
  chainId: number,
  address: string,
  meta: ViewedTokenMeta = {},
  storage: ViewedTokenStorage = localStorage,
): ViewedTokenEntry[] {
  let checksummed: string;
  try {
    checksummed = getAddress(address);
  } catch {
    // Malformed hex/length: not an address — no write.
    return readViewedTokens(chainId, storage);
  }
  const symbol = nonEmpty(meta.symbol);
  const name = nonEmpty(meta.name);
  const entry: ViewedTokenEntry = {
    address: checksummed,
    ...(symbol !== undefined ? { symbol } : {}),
    ...(name !== undefined ? { name } : {}),
    firstSeen: new Date().toISOString(),
  };
  return writeViewedTokens(
    chainId,
    mergeViewedEntries(readViewedTokens(chainId, storage), entry),
    storage,
  );
}

// ---------------------------------------------------------------------------
// Directory merge + filter (pure, testable without storage or RPC)
// ---------------------------------------------------------------------------

/** Where a directory row came from — the view renders it as a source chip. */
export type TokenProvenance = 'curated' | 'viewed';

/** One directory row before runtime enrichment; symbol/name are hints only. */
export type TokenDirectoryRow = {
  /** EIP-55 checksummed contract address. */
  address: string;
  /** Display hint (curated list or last visit); chain truth resolves at runtime. */
  symbol: string | null;
  /** Display hint from a prior visit, when one learned a name. */
  name: string | null;
  provenance: TokenProvenance;
};

/**
 * Merge the curated list with this browser's viewed tokens: curated rows
 * first (config order, provenance 'curated' — a curated address always
 * outranks the viewed copy), then viewed rows not already curated (storage
 * order = newest-first, provenance 'viewed'). A curated token that was
 * also opened here keeps its curated symbol but adopts the visited name
 * as its name hint — hints only either way.
 */
export function mergeDirectory(
  known: readonly KnownToken[],
  viewed: readonly ViewedTokenEntry[],
): TokenDirectoryRow[] {
  const viewedByLower = new Map(
    viewed.map((entry) => [entry.address.toLowerCase(), entry]),
  );
  const curatedLowers = new Set(known.map((token) => token.address.toLowerCase()));
  const rows: TokenDirectoryRow[] = known.map((token) => ({
    address: token.address,
    symbol: token.symbol,
    name: viewedByLower.get(token.address.toLowerCase())?.name ?? null,
    provenance: 'curated',
  }));
  for (const entry of viewed) {
    if (curatedLowers.has(entry.address.toLowerCase())) continue;
    rows.push({
      address: entry.address,
      symbol: entry.symbol ?? null,
      name: entry.name ?? null,
      provenance: 'viewed',
    });
  }
  return rows;
}

/**
 * Case-insensitive substring filter over symbol, name and address. An
 * empty/whitespace query returns the rows unchanged (a copy). Generic in
 * the row shape so the view can filter already-enriched rows (runtime
 * values first, hints as fallback) while tests filter plain objects.
 */
export function filterByQuery<
  Row extends { address: string; symbol: string | null; name: string | null },
>(rows: readonly Row[], q: string | undefined): Row[] {
  const needle = (q ?? '').trim().toLowerCase();
  if (needle === '') return [...rows];
  return rows.filter(
    (row): boolean =>
      row.address.toLowerCase().includes(needle)
      || (row.symbol?.toLowerCase().includes(needle) ?? false)
      || (row.name?.toLowerCase().includes(needle) ?? false),
  );
}

/** The merged directory of one chain: curated ∪ viewed (pure over the storage read). */
export function directoryRowsForChain(chainId: number): TokenDirectoryRow[] {
  return mergeDirectory(knownTokensForChain(chainId), readViewedTokens(chainId));
}

// ---------------------------------------------------------------------------
// Row enrichment (ONE Multicall3 batch — tokenMetadata's multicall pattern)
// ---------------------------------------------------------------------------

/** Canonical Multicall3 deployment (same constant as services/tokenMetadata.ts). */
const MULTICALL3_ADDRESS: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';

const nameAbi = parseAbi(['function name() view returns (string)']);
const symbolAbi = parseAbi(['function symbol() view returns (string)']);
const decimalsAbi = parseAbi(['function decimals() view returns (uint8)']);
const totalSupplyAbi = parseAbi(['function totalSupply() view returns (uint256)']);

/** Runtime token reads for one directory row; null = that call reverted. */
export type TokenDirectoryReads = {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: bigint | null;
};

/** Settled enrichment payload; the echoes drive the view's settle guard. */
export type TokenDirectoryPage = {
  chainId: number;
  /** Content digest of the enriched address set (tokenDirectoryAddressesKey). */
  addressesKey: string;
  /** Reads keyed by lowercase address. */
  reads: Map<string, TokenDirectoryReads>;
};

// Narrows one viem multicall outcome to its primitive value (string/uint8
// returns). With allowFailure, viem wraps each result as
// { status: 'success', result } or { status: 'failure', error }; test
// doubles may hand back a bare null for a reverted call. Anything
// unrecognized decodes to null.
const readMulticallValue = (outcome: unknown): string | number | null => {
  if (typeof outcome !== 'object' || outcome === null || !('status' in outcome)) {
    return null;
  }
  const record: { status: unknown; result?: unknown } = outcome;
  if (record.status !== 'success') return null;
  const value: unknown = record.result;
  return typeof value === 'string' || typeof value === 'number' ? value : null;
};

// Narrows one viem multicall outcome to its bigint value (uint256 returns
// such as totalSupply) — tokenMetadata's readMulticallBigint twin.
const readMulticallBigint = (outcome: unknown): bigint | null => {
  if (typeof outcome !== 'object' || outcome === null || !('status' in outcome)) {
    return null;
  }
  const record: { status?: unknown; result?: unknown } = outcome;
  return record.status === 'success' && typeof record.result === 'bigint'
    ? record.result
    : null;
};

/**
 * Content digest of an address set: deduped lowercase addresses, sorted,
 * comma-joined (prices.ts' digest convention). The enrichment query is
 * keyed by it, and the settled payload echoes it so the view can refuse a
 * settle that raced an argument switch (Contracts/List settle guard).
 */
export function tokenDirectoryAddressesKey(addresses: readonly string[]): string {
  return [...new Set(addresses.map((address) => address.toLowerCase()))]
    .sort()
    .join(',');
}

/**
 * Read name()/symbol()/decimals()/totalSupply() for every directory token
 * in ONE Multicall3 batch. Per-call reverts decode to honest nulls (the
 * contract answered — it just lacks that interface); a transport-level
 * failure (client creation or the multicall request throwing) REJECTS so
 * the query hook surfaces a retryable error (knownTokenBalances'
 * convention). A disabled request (chainId <= 0 or no addresses) settles
 * an empty page with zero network access.
 */
export async function fetchTokenDirectoryReads(
  chainId: number,
  addressesKey: string,
): Promise<TokenDirectoryPage> {
  const lowers = addressesKey === '' ? [] : addressesKey.split(',');
  if (!(chainId > 0) || lowers.length === 0) {
    return { chainId, addressesKey, reads: new Map() };
  }

  const contracts: ContractFunctionParameters[] = [];
  for (const lower of lowers) {
    contracts.push(
      { address: lower as Address, abi: nameAbi, functionName: 'name' },
      { address: lower as Address, abi: symbolAbi, functionName: 'symbol' },
      { address: lower as Address, abi: decimalsAbi, functionName: 'decimals' },
      { address: lower as Address, abi: totalSupplyAbi, functionName: 'totalSupply' },
    );
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
    throw new Error('Could not read token details from the RPC');
  }

  const reads = new Map<string, TokenDirectoryReads>();
  lowers.forEach((lower, tokenIndex) => {
    const base = tokenIndex * 4;
    const name = readMulticallValue(outcomes[base]);
    const symbol = readMulticallValue(outcomes[base + 1]);
    const decimals = readMulticallValue(outcomes[base + 2]);
    reads.set(lower, {
      name: typeof name === 'string' ? name : null,
      symbol: typeof symbol === 'string' ? symbol : null,
      decimals: typeof decimals === 'number' ? decimals : null,
      totalSupply: readMulticallBigint(outcomes[base + 3]),
    });
  });
  return { chainId, addressesKey, reads };
}

// Directory reads are effectively immutable (a token's interface and
// supply change, if ever, on the scale of the 5min default cache window).
export const tokenDirectoryReadsCache = createQueryCache<
  TokenDirectoryPage,
  [number, string]
>('token-directory-reads');

const queryTokenDirectoryReads = bindQueryFn(
  fetchTokenDirectoryReads,
  tokenDirectoryReadsCache,
);

const useTokenDirectoryReadsQuery = createQueryHook({
  queryFn: queryTokenDirectoryReads,
});

/**
 * Enrichment hook over fetchTokenDirectoryReads. Args are keyed by the
 * address-set digest, so a directory that grew (a token page recorded a
 * new visit) re-keys honestly instead of serving the previous set's reads.
 */
export function useTokenDirectoryReads(
  chainId: number,
  addresses: readonly string[],
) {
  return useTokenDirectoryReadsQuery([chainId, tokenDirectoryAddressesKey(addresses)]);
}

/**
 * The directory's Standard column: 'ERC-20' exactly when decimals() AND
 * totalSupply() both responded — the identical claim classifyTokenOverview
 * makes for the address page's overview card. No reads yet, a reverted
 * probe or a transport failure all render no claim (the view shows '—').
 */
export function directoryStandardLabel(
  reads: TokenDirectoryReads | undefined,
): 'ERC-20' | null {
  return classifyTokenOverview(reads)?.isErc20 === true ? 'ERC-20' : null;
}
