// Fiat price service: USD valuations from DefiLlama's keyless, CORS-open
// coins API (https://coins.llama.fi/prices/current/{ids}). This layer is
// browser-side only — no backend, no DB — and follows the tokenMetadata
// service shape exactly: module-level Map caches with a TTL (including
// honest negative entries), never-rejecting in-flight promises shared by
// concurrent callers, and plain state/effect hooks on top. The honesty
// contract: a chain or token absent from the maps below never fetches and
// never guesses; a failed or timed-out request settles every subject
// unavailable with ONE console.warn and is retried at most once per TTL
// window per subject (no retry storms). Consumers render nothing when a
// price is unavailable — USD is always an enhancement, never a fixture.
//
// A sibling historical layer (fetchPriceHistory, verified live
// 2026-09-23) pulls daily series from the same host's /chart endpoint
// with the same contract: never throws, settles every subject to ok or
// unavailable-with-reason, caches each verdict (positive AND negative)
// for one TTL window, and never fabricates a day the API did not answer.
//
// Both id maps below were verified live against the API on 2026-09-22
// (one native-coin request + https://coins.llama.fi/chains for slugs).

import { useEffect, useState } from 'react';
import { getAddress } from 'viem';

/** One usable price observation: the USD value and when we fetched it. */
export type UsdPriceSnapshot = { usd: number; fetchedAt: number };

// How long a settled price (or a settled-unavailable verdict) is trusted
// before the next call refetches.
const PRICE_TTL_MS = 60 * 1000;

// The API accepts long comma lists, but bounded requests keep a single
// holdings batch from turning into one oversized URL.
const MAX_IDS_PER_REQUEST = 30;

// A price request that cannot answer within the budget settles
// unavailable — the surfaces degrade to nothing instead of waiting.
const REQUEST_TIMEOUT_MS = 8_000;

const API_URL = 'https://coins.llama.fi/prices/current/';

// chainId → coingecko id of the chain's NATIVE coin (verified live:
// mainnet ethereum; polygon is the POL era id polygon-ecosystem-token;
// arbitrum/base/optimism are ETH-franchises reusing coingecko:ethereum;
// avalanche is avalanche-2; bsc/fantom/celo/gnosis use their plain ids).
const NATIVE_COINGECKO_IDS: Readonly<Record<number, string>> = {
  1: 'ethereum',
  10: 'ethereum',
  56: 'binancecoin',
  100: 'gnosis',
  137: 'polygon-ecosystem-token',
  250: 'fantom',
  8453: 'ethereum',
  42161: 'ethereum',
  42220: 'celo',
  43114: 'avalanche-2',
};

// chainId → DefiLlama chain slug for token pricing ({slug}:{address}).
// From https://coins.llama.fi/chains — note gnosis is "xdai" and
// avalanche is "avax" there, NOT the obvious guesses.
const LLAMA_CHAIN_SLUGS: Readonly<Record<number, string>> = {
  1: 'ethereum',
  10: 'optimism',
  56: 'bsc',
  100: 'xdai',
  137: 'polygon',
  250: 'fantom',
  8453: 'base',
  42161: 'arbitrum',
  42220: 'celo',
  43114: 'avax',
};

/** DefiLlama coin id of a chain's native coin, or null when unmapped. */
export function nativePriceId(chainId: number): string | null {
  if (!Number.isInteger(chainId) || chainId <= 0) return null;
  const id = NATIVE_COINGECKO_IDS[chainId];
  return id === undefined ? null : `coingecko:${id}`;
}

/**
 * DefiLlama coin id for an ERC-20 at `address` (checksummed — the API
 * echoes ids verbatim), or null when the chain is unmapped or the
 * address is not a valid hex address. Never guesses a slug.
 */
export function tokenPriceId(chainId: number, address: string): string | null {
  const slug = LLAMA_CHAIN_SLUGS[chainId];
  if (slug === undefined) return null;
  try {
    return `${slug}:${getAddress(address)}`;
  } catch {
    return null;
  }
}

type CacheEntry = { snapshot: UsdPriceSnapshot | null; expires: number };

// coin id → cache entry. A null snapshot is an honest negative: the API
// answered (or failed) within this TTL window and that verdict stands
// until expiry — one attempt per window per subject.
const priceCache = new Map<string, CacheEntry>();

// coin id → never-rejecting in-flight promise. Concurrent callers for
// overlapping subject sets share one request instead of duplicating work.
const inflight = new Map<string, Promise<UsdPriceSnapshot | null>>();

/** Test-only hook to clear module state between test cases. */
export function resetPricesForTests(): void {
  priceCache.clear();
  inflight.clear();
  priceHistoryCache.clear();
  priceHistoryInflight.clear();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// Ids travel inside a URL path segment: anything empty or containing
// separators/whitespace is rejected before it can corrupt the request.
const validId = (id: string): boolean =>
  id.length > 0 && !/[,/\s]/.test(id);

// Narrows one API coin record to a usable price. Zero/negative or
// non-finite numbers are treated as no price — never displayed.
const readPrice = (coin: unknown): number | null => {
  if (!isRecord(coin)) return null;
  const price = coin.price;
  return typeof price === 'number' && Number.isFinite(price) && price > 0
    ? price
    : null;
};

// One HTTP GET for up to MAX_IDS_PER_REQUEST ids. Resolves every id —
// absent from the response, unusable price, or failed request — to its
// settled snapshot (or null) and caches the verdict for the TTL. A
// failed request logs ONE console.warn for the whole chunk.
const runChunk = async (
  chunk: readonly string[],
): Promise<Map<string, UsdPriceSnapshot | null>> => {
  const settled = new Map<string, UsdPriceSnapshot | null>();
  let coins: Record<string, unknown> | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_URL}${chunk.join(',')}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed: unknown = await response.json();
      if (isRecord(parsed) && isRecord(parsed.coins)) {
        coins = parsed.coins;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.warn(
      `[prices] DefiLlama price request failed (${chunk.length} ids):`,
      error instanceof Error ? error.message : error,
    );
  }

  const fetchedAt = Date.now();
  for (const id of chunk) {
    const usd = coins === null ? null : readPrice(coins[id]);
    const snapshot: UsdPriceSnapshot | null =
      usd === null ? null : { usd, fetchedAt };
    settled.set(id, snapshot);
    priceCache.set(id, { snapshot, expires: fetchedAt + PRICE_TTL_MS });
  }
  return settled;
};

// Launches one shared request per ≤30-id chunk, registering a
// never-rejecting promise per id in the in-flight map first so callers
// arriving mid-flight join the same resolution (tokenMetadata's
// launchTokenBatch pattern).
const launchChunks = (
  ids: readonly string[],
): Map<string, Promise<UsdPriceSnapshot | null>> => {
  const promises = new Map<string, Promise<UsdPriceSnapshot | null>>();
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += MAX_IDS_PER_REQUEST) {
    chunks.push(ids.slice(index, index + MAX_IDS_PER_REQUEST));
  }

  for (const chunk of chunks) {
    const reservations: Array<{
      id: string;
      resolve: (snapshot: UsdPriceSnapshot | null) => void;
    }> = [];
    for (const id of chunk) {
      let resolveId: (snapshot: UsdPriceSnapshot | null) => void = () => {};
      const promise = new Promise<UsdPriceSnapshot | null>((resolve) => {
        resolveId = resolve;
      });
      promises.set(id, promise);
      inflight.set(id, promise);
      reservations.push({ id, resolve: resolveId });
    }

    const finish = (settled: Map<string, UsdPriceSnapshot | null>): void => {
      for (const { id, resolve } of reservations) {
        resolve(settled.get(id) ?? null);
      }
      // Safe unconditionally: fetchUsdPrices only registers an id that
      // is absent from this map, so each key still points at OUR
      // promise when the chunk settles.
      for (const id of chunk) {
        inflight.delete(id);
      }
    };

    void runChunk(chunk)
      .then(finish)
      .catch(() => finish(new Map()));
  }

  return promises;
};

/**
 * Resolve USD prices for the given DefiLlama coin ids. Never rejects.
 * Returns a Map from id to its snapshot — null means the lookup settled
 * without a usable price (unknown coin, failed request). Fresh (≤60s)
 * cache entries skip the network; concurrent calls for overlapping ids
 * share one in-flight request.
 */
export async function fetchUsdPrices(
  ids: readonly string[],
): Promise<Map<string, UsdPriceSnapshot | null>> {
  const out = new Map<string, UsdPriceSnapshot | null>();

  const unique: string[] = [];
  for (const id of ids) {
    if (out.has(id) || !validId(id)) continue;
    out.set(id, null); // reserve; overwritten below
    unique.push(id);
  }

  const now = Date.now();
  const pending: Array<{ id: string; promise: Promise<UsdPriceSnapshot | null> }> = [];
  const toFetch: string[] = [];
  for (const id of unique) {
    const entry = priceCache.get(id);
    if (entry !== undefined && entry.expires > now) {
      out.set(id, entry.snapshot);
      continue;
    }
    const existing = inflight.get(id);
    if (existing !== undefined) {
      pending.push({ id, promise: existing });
    } else {
      toFetch.push(id);
    }
  }

  for (const [id, promise] of launchChunks(toFetch)) {
    pending.push({ id, promise });
  }

  await Promise.all(
    pending.map(async ({ id, promise }) => {
      out.set(id, await promise);
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Hooks (tokenMetadata's useState/useEffect shape: undefined while the
// lookup is in flight, then the settled snapshot or null)
// ---------------------------------------------------------------------------

/**
 * USD price of a chain's native coin. `undefined` while the request is
 * in flight (or before it exists), `null` once the lookup settled
 * without a usable price — including an unmapped chain, which never
 * fetches at all.
 */
export function useNativeUsdPrice(
  chainId: number,
): UsdPriceSnapshot | null | undefined {
  const id = nativePriceId(chainId);
  const [snapshot, setSnapshot] = useState<UsdPriceSnapshot | null | undefined>(
    () => (id === null ? null : undefined),
  );

  useEffect(() => {
    if (id === null) {
      setSnapshot(null);
      return;
    }
    // A changed id means a different subject: drop the previous snapshot
    // so consumers see the honest in-flight state, not another chain's
    // price.
    setSnapshot(undefined);
    let cancelled = false;
    void fetchUsdPrices([id]).then((fetched) => {
      if (!cancelled) setSnapshot(fetched.get(id) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return id === null ? null : snapshot;
}

/**
 * USD price of one ERC-20 token. Same settle semantics as
 * useNativeUsdPrice; an unmapped chain or invalid address settles null
 * without any network access.
 */
export function useTokenUsdPrice(
  chainId: number,
  address: string,
): UsdPriceSnapshot | null | undefined {
  const id = tokenPriceId(chainId, address);
  const [snapshot, setSnapshot] = useState<UsdPriceSnapshot | null | undefined>(
    () => (id === null ? null : undefined),
  );

  useEffect(() => {
    if (id === null) {
      setSnapshot(null);
      return;
    }
    setSnapshot(undefined);
    let cancelled = false;
    void fetchUsdPrices([id]).then((fetched) => {
      if (!cancelled) setSnapshot(fetched.get(id) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return id === null ? null : snapshot;
}

// Shared constant for the empty-list case: settled immediately, no
// network, stable identity across renders.
const EMPTY_PRICE_MAP = new Map<string, UsdPriceSnapshot>();

/**
 * Batched USD prices for a set of ERC-20 tokens on one chain — one
 * DefiLlama request per ≤30 uncached ids. Returns `undefined` while in
 * flight, then a Map keyed by LOWERCASE address holding only the tokens
 * that resolved a usable price (an absent key is a settled unavailable —
 * unknown token or unknown chain, which never fetches).
 */
export function useTokenUsdPrices(
  chainId: number,
  addresses: readonly string[],
): Map<string, UsdPriceSnapshot> | undefined {
  const digest = `${chainId}|${[...addresses]
    .map((address) => address.toLowerCase())
    .sort()
    .join(',')}`;

  const [prices, setPrices] = useState<
    Map<string, UsdPriceSnapshot> | undefined
  >(() => (digest.endsWith('|') ? EMPTY_PRICE_MAP : undefined));

  useEffect(() => {
    if (digest.endsWith('|')) return;
    setPrices(undefined);
    let cancelled = false;
    const lowers = digest
      .slice(digest.indexOf('|') + 1)
      .split(',')
      .filter((entry) => entry !== '');
    const requests = lowers
      .map((lower) => ({ lower, id: tokenPriceId(chainId, lower) }))
      .filter((entry): entry is { lower: string; id: string } => entry.id !== null);
    void fetchUsdPrices(requests.map((entry) => entry.id)).then((fetched) => {
      if (cancelled) return;
      const usable = new Map<string, UsdPriceSnapshot>();
      for (const { lower, id } of requests) {
        const snapshot = fetched.get(id);
        if (snapshot !== null && snapshot !== undefined) {
          usable.set(lower, snapshot);
        }
      }
      setPrices(usable);
    });
    return () => {
      cancelled = true;
    };
  }, [digest, chainId]);

  return digest.endsWith('|') ? EMPTY_PRICE_MAP : prices;
}

// ---------------------------------------------------------------------------
// Pure amount arithmetic (float multiply at display precision only)
// ---------------------------------------------------------------------------

/**
 * USD value of a native-coin amount in wei. `Number(wei)` is exact for
 * every realistic tx value (< 2^53 wei); rounding happens only at format
 * time in the renderer, never here.
 */
export function nativeAmountToUsd(
  wei: bigint,
  price: UsdPriceSnapshot,
): number {
  return (Number(wei) / 1e18) * price.usd;
}

/** USD value of a token amount with the token's own decimals. */
export function tokenAmountToUsd(
  amount: bigint,
  decimals: number,
  price: UsdPriceSnapshot,
): number {
  return (Number(amount) / 10 ** decimals) * price.usd;
}

/**
 * USD cost of a plain transfer at a given total gas price (base fee +
 * tip) in gwei — e.g. the Home gas panel's per-tier 21,000-gas figure.
 */
export function gasTransferCostUsd(
  gasUnits: number,
  gweiPrice: number,
  price: UsdPriceSnapshot,
): number {
  return ((gasUnits * gweiPrice) / 1e9) * price.usd;
}

// ---------------------------------------------------------------------------
// Historical price series (DefiLlama /chart — same keyless, CORS-open
// host as the spot layer, same honesty contract)
// ---------------------------------------------------------------------------

/** One usable historical observation: epoch-seconds timestamp + USD price. */
export type PricePoint = { timestamp: number; price: number };

/** Supported history windows in days; anything else normalizes to 30. */
export type PriceHistoryWindow = 7 | 30;

/** min/max over a series' prices — ready for axis scaling. */
export type PriceHistoryExtent = { min: number; max: number };

/** Why a history lookup settled unavailable — short, display-ready. */
export type PriceHistoryReason =
  | 'unmapped chain or token'
  | 'request failed'
  | 'malformed response'
  | 'no usable points in the window';

export type PriceHistoryOk = {
  status: 'ok';
  /** Usable observations inside the window: ascending, deduplicated. */
  points: PricePoint[];
  /** min/max over the points' prices. */
  extent: PriceHistoryExtent;
  /** API-reported coin symbol, when it answered with one. */
  symbol: string | null;
  /** API-reported confidence (0–1), when it answered with one. */
  confidence: number | null;
  /** The window's `start` request param (epoch seconds) — the grid origin. */
  start: number;
  windowDays: PriceHistoryWindow;
};

export type PriceHistoryOutcome = PriceHistoryOk | {
  status: 'unavailable';
  reason: PriceHistoryReason;
};

// A daily series moves slowly: a settled result (or settled-unavailable
// verdict) is trusted far longer than a spot price before refetching.
const PRICE_HISTORY_TTL_MS = 10 * 60 * 1000;

const SECONDS_PER_DAY = 86_400;

const CHART_API_URL = 'https://coins.llama.fi/chart/';

type HistoryCacheEntry = { outcome: PriceHistoryOutcome; expires: number };

// cache key (chain|token|window) → settled outcome + expiry. An
// unavailable outcome is an honest negative exactly like the spot
// layer's null snapshot: the verdict stands for one TTL window — one
// attempt per window, no retry storms.
const priceHistoryCache = new Map<string, HistoryCacheEntry>();

// cache key → never-rejecting in-flight promise, shared by concurrent
// callers for the same subject/window.
const priceHistoryInflight = new Map<string, Promise<PriceHistoryOutcome>>();

// Cache key per subject+window. The '' token slot is the native coin;
// ids are derived deterministically from these same inputs, so the pair
// is a faithful identity for the request.
const historyKey = (
  chainId: number,
  tokenAddress: string | undefined,
  windowDays: PriceHistoryWindow,
): string => `${chainId}|${tokenAddress ?? ''}|${windowDays}`;

const normalizeWindow = (windowDays: number): PriceHistoryWindow =>
  windowDays === 7 ? 7 : 30;

/**
 * Pure: the /chart request URL for one coin id and window —
 * `?start=now-windowDays*86400&span=windowDays&period=1d&searchWidth=600`
 * (the contract probed live 2026-09-23).
 */
export function priceHistoryUrl(
  coinId: string,
  windowDays: PriceHistoryWindow,
  nowEpochSeconds: number,
): string {
  const start = nowEpochSeconds - windowDays * SECONDS_PER_DAY;
  return `${CHART_API_URL}${coinId}?start=${start}&span=${windowDays}&period=1d&searchWidth=600`;
}

// Narrows one raw prices[] entry to a usable point. Non-record entries,
// non-finite/negative timestamps and zero/negative/non-finite prices are
// dropped — never displayed, never interpolated over. Points before the
// window start (searchWidth can pull pre-window neighbors) go too.
const readPoint = (
  entry: unknown,
  windowStart: number,
): PricePoint | null => {
  if (!isRecord(entry)) return null;
  const { timestamp, price } = entry;
  if (
    typeof timestamp !== 'number' ||
    !Number.isFinite(timestamp) ||
    timestamp < 0 ||
    timestamp < windowStart
  ) {
    return null;
  }
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  return { timestamp, price };
};

/**
 * Pure shaping of a raw /chart `prices` array: drop malformed entries and
 * pre-window points, keep the LAST occurrence of a duplicated timestamp,
 * sort ascending. Missing days are NEVER fabricated — the output carries
 * exactly the observations the API answered with, so downstream renders
 * gaps as gaps (the Charts page series contract: no zero-fill, no
 * interpolation). A non-array input shapes to zero points. Returns the
 * points plus their min/max extent for axis scaling; zero usable points
 * → empty points and a null extent (the caller classifies that verdict).
 */
export function shapePriceHistory(
  prices: unknown,
  windowStartEpochSeconds: number,
): { points: PricePoint[]; extent: PriceHistoryExtent | null } {
  if (!Array.isArray(prices)) return { points: [], extent: null };
  // Map insert-overwrite keeps the LAST duplicate; ascending order comes
  // from the sort, not iteration order.
  const byTimestamp = new Map<number, PricePoint>();
  for (const entry of prices) {
    const point = readPoint(entry, windowStartEpochSeconds);
    if (point !== null) byTimestamp.set(point.timestamp, point);
  }
  const points = [...byTimestamp.values()].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  let min = Infinity;
  let max = -Infinity;
  for (const { price } of points) {
    if (price < min) min = price;
    if (price > max) max = price;
  }
  return { points, extent: points.length > 0 ? { min, max } : null };
}

const readSymbol = (coin: Record<string, unknown>): string | null =>
  typeof coin.symbol === 'string' && coin.symbol.length > 0
    ? coin.symbol
    : null;

const readConfidence = (coin: Record<string, unknown>): number | null => {
  const { confidence } = coin;
  return (
    typeof confidence === 'number' &&
    Number.isFinite(confidence) &&
    confidence >= 0 &&
    confidence <= 1
      ? confidence
      : null
  );
};

// One /chart GET for a single coin id. Classifies every failure mode
// into the outcome taxonomy: HTTP/network/timeout → 'request failed'
// (ONE console.warn, mirroring the spot chunk), a non-record coins
// wrapper or non-array prices → 'malformed response', and an answered-
// but-empty series → 'no usable points in the window'. Never throws.
const runHistoryRequest = async (
  coinId: string,
  windowDays: PriceHistoryWindow,
  nowEpochSeconds: number,
): Promise<PriceHistoryOutcome> => {
  const start = nowEpochSeconds - windowDays * SECONDS_PER_DAY;
  let parsed: unknown;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(
        priceHistoryUrl(coinId, windowDays, nowEpochSeconds),
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      parsed = await response.json();
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.warn(
      '[prices] DefiLlama chart request failed:',
      error instanceof Error ? error.message : error,
    );
    return { status: 'unavailable', reason: 'request failed' };
  }

  const coins = isRecord(parsed) && isRecord(parsed.coins) ? parsed.coins : null;
  const coin = coins !== null ? coins[coinId] : undefined;
  if (!isRecord(coin)) {
    // A missing/invalid coins wrapper is malformed transport; a valid
    // wrapper without our key is the API's definitive "unknown coin".
    return {
      status: 'unavailable',
      reason:
        coins === null ? 'malformed response' : 'no usable points in the window',
    };
  }
  if (!Array.isArray(coin.prices)) {
    return { status: 'unavailable', reason: 'malformed response' };
  }
  const { points, extent } = shapePriceHistory(coin.prices, start);
  if (extent === null) {
    return { status: 'unavailable', reason: 'no usable points in the window' };
  }
  return {
    status: 'ok',
    points,
    extent,
    symbol: readSymbol(coin),
    confidence: readConfidence(coin),
    start,
    windowDays,
  };
};

/**
 * Historical USD price series for a chain's native coin (no
 * `tokenAddress`) or one ERC-20 (`tokenAddress`), over the last
 * `windowDays` days (30 default; 7 supported — anything else normalizes
 * to 30). Never throws: an unmapped chain/token settles without any
 * network access, and HTTP failures, timeouts and malformed bodies all
 * settle `{status:'unavailable', reason}`. Every verdict — ok AND
 * unavailable — is cached for one ~10min TTL window (one attempt per
 * window, mirroring the spot layer's negative entries); concurrent calls
 * for the same subject/window share one in-flight request.
 */
export async function fetchPriceHistory(
  chainId: number,
  tokenAddress?: string,
  windowDays: PriceHistoryWindow = 30,
): Promise<PriceHistoryOutcome> {
  const window = normalizeWindow(windowDays);
  const key = historyKey(chainId, tokenAddress, window);
  const nowMs = Date.now();

  const cached = priceHistoryCache.get(key);
  if (cached !== undefined && cached.expires > nowMs) return cached.outcome;

  const existing = priceHistoryInflight.get(key);
  if (existing !== undefined) return existing;

  const coinId =
    tokenAddress === undefined
      ? nativePriceId(chainId)
      : tokenPriceId(chainId, tokenAddress);

  const settle = (outcome: PriceHistoryOutcome): PriceHistoryOutcome => {
    priceHistoryCache.set(key, { outcome, expires: Date.now() + PRICE_HISTORY_TTL_MS });
    priceHistoryInflight.delete(key);
    return outcome;
  };

  const launched: Promise<PriceHistoryOutcome> =
    coinId === null
      ? Promise.resolve<PriceHistoryOutcome>({
          status: 'unavailable',
          reason: 'unmapped chain or token',
        })
      : runHistoryRequest(coinId, window, Math.floor(nowMs / 1000));
  // runHistoryRequest never rejects by construction; the rejection arm
  // only future-proofs the never-throw contract — and still caches its
  // verdict so a pathological loop cannot become a retry storm.
  const tracked = launched.then(settle, () =>
    settle({ status: 'unavailable', reason: 'request failed' }),
  );
  priceHistoryInflight.set(key, tracked);
  return tracked;
}

// Fresh cached outcome for a key, synchronously — the hook's no-flash
// fast path for already-known series (e.g. toggling the window back).
const peekHistory = (key: string): PriceHistoryOutcome | undefined => {
  const entry = priceHistoryCache.get(key);
  return entry !== undefined && entry.expires > Date.now()
    ? entry.outcome
    : undefined;
};

/**
 * Price history for one subject through fetchPriceHistory, with this
 * module's hook shape: `undefined` while in flight, then the settled
 * outcome (ok or unavailable-with-reason — the unavailable state is a
 * displayable fact here, not just null). A fresh cache entry surfaces
 * synchronously on mount, so revisiting a known series never flashes
 * the loading state.
 */
export function usePriceHistory(
  chainId: number,
  tokenAddress?: string,
  windowDays: PriceHistoryWindow = 30,
): PriceHistoryOutcome | undefined {
  const key = historyKey(chainId, tokenAddress, normalizeWindow(windowDays));
  const [outcome, setOutcome] = useState<PriceHistoryOutcome | undefined>(() =>
    peekHistory(key),
  );

  useEffect(() => {
    // Same-key cache hit: settle synchronously, zero network.
    const cached = peekHistory(key);
    setOutcome(cached);
    if (cached !== undefined) return;
    let cancelled = false;
    void fetchPriceHistory(chainId, tokenAddress, windowDays).then((settled) => {
      if (!cancelled) setOutcome(settled);
    });
    return () => {
      cancelled = true;
    };
  }, [key, chainId, tokenAddress, windowDays]);

  return outcome;
}
