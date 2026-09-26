// Signature-lookup service (frontend): resolves unknown function selectors
// and event topic0 hashes through the backend's openchain-backed cache
// (GET /api/signatures). Signatures are chain-agnostic — a selector hashes
// the same canonical text on every chain — so nothing here is keyed by
// chain and the module cache is shared across every surface.
//
// Layering: a query-cache entry keyed by the sorted selector digest (one
// batched GET per visible set, reactive via createQueryHook) sits on top of
// a module-level per-selector memo (the TokenTransfers tokenMetaCache
// pattern) so overlapping sets — the function selector alone vs the whole
// page's set — never refetch an already-known selector within the session.
// Resolved and notFound outcomes are facts and memoize; an upstream
// failure resolves as { unavailable: true } WITHOUT memoizing, so a later
// view retries instead of pinning the outage. fetchSignatures never
// rejects: signature names are an enhancement layered over raw hex and
// must never surface an error state or block a render. The strict twin
// (fetchSignaturesStrict + useSignatureLookup below) exists for the one
// surface whose whole purpose IS the lookup — the /signatures tool page —
// and lets transport failures surface as first-class errors so the view
// can attribute backend-offline precisely.
import { api, get, withSignal } from '@/util/http';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';

export type SignatureKind = 'function' | 'event';

/** The found member of SignatureOutcome, named for the surfaced-lookup hook below. */
export type ResolvedSignatures = {
  kind: SignatureKind;
  signatures: string[];
  source: 'openchain';
};

export type SignatureOutcome =
  | ResolvedSignatures
  | { kind: SignatureKind; signatures: []; notFound: true }
  | { unavailable: true };

type SignaturesResponse = {
  results?: Record<string, SignatureOutcome>;
};

// Shape guards mirroring the API's validation: only well-formed selectors
// are ever sent, so one malformed string can never 400 the whole batch.
const FUNCTION_SELECTOR_RE = /^0x[0-9a-f]{8}$/;
const EVENT_TOPIC0_RE = /^0x[0-9a-f]{64}$/;

const isRequestable = (selector: string): boolean =>
  FUNCTION_SELECTOR_RE.test(selector) || EVENT_TOPIC0_RE.test(selector);

// selector → settled outcome (found or notFound; never unavailable).
const selectorOutcomeCache = new Map<string, SignatureOutcome>();

/** Test-only: clear the module-level per-selector memo. */
export function resetSignatureOutcomeCacheForTests(): void {
  selectorOutcomeCache.clear();
}

export const signaturesCache = createQueryCache<Record<string, SignatureOutcome>, [string]>(
  'signature-lookup',
);

// The query key is the sorted comma-joined digest of the selector set;
// ',' never occurs inside a selector, so it round-trips through split().

// Split a digest's selectors into memo hits and requestable misses.
// Malformed digest entries land in neither — they have nothing to ask
// the API for and simply stay absent, so callers render them as unknown.
const partitionSelectors = (joined: string): {
  outcomes: Record<string, SignatureOutcome>;
  misses: string[];
} => {
  const outcomes: Record<string, SignatureOutcome> = {};
  const misses: string[] = [];
  for (const selector of joined.split(',')) {
    if (selector === '') continue;
    const cached = selectorOutcomeCache.get(selector);
    if (cached !== undefined) {
      outcomes[selector] = cached;
    } else if (isRequestable(selector)) {
      misses.push(selector);
    }
  }
  return { outcomes, misses };
};

// The lookup core shared by the two fetch functions below: memo hits,
// requestable misses, one batched GET, and the response→outcome mapping.
// Transport failures (backend offline, degraded discovery, HTTP errors)
// THROW here — the wrappers decide how a throw surfaces. A backend that
// answers while its openchain upstream fails resolves those selectors as
// { unavailable: true } WITHOUT memoizing, so a later call retries
// instead of pinning the outage.
export async function fetchSignaturesStrict(
  joined: string,
  signal?: AbortSignal,
): Promise<Record<string, SignatureOutcome>> {
  const { outcomes, misses } = partitionSelectors(joined);
  if (misses.length === 0) return outcomes;

  const params: Record<string, string> = {};
  const functions = misses.filter(selector => FUNCTION_SELECTOR_RE.test(selector));
  const events = misses.filter(selector => EVENT_TOPIC0_RE.test(selector));
  if (functions.length > 0) params.function = functions.join(',');
  if (events.length > 0) params.event = events.join(',');

  const response = await get<SignaturesResponse>(
    '/api/signatures',
    params,
    withSignal(api, signal),
  );
  for (const selector of [...functions, ...events]) {
    const outcome = response.results?.[selector];
    if (outcome !== undefined && !('unavailable' in outcome)) {
      // Found and notFound are durable facts about immutable data —
      // memoize per selector so any other selector set reuses them.
      selectorOutcomeCache.set(selector, outcome);
      outcomes[selector] = outcome;
    } else {
      // Absent from the response body or explicitly unavailable: honest
      // unknown for this call, left un-memoized so it can be retried.
      outcomes[selector] = { unavailable: true };
    }
  }
  return outcomes;
}

export async function fetchSignatures(
  joined: string,
  signal?: AbortSignal,
): Promise<Record<string, SignatureOutcome>> {
  try {
    return await fetchSignaturesStrict(joined, signal);
  } catch {
    // Backend offline / degraded discovery / HTTP failure — every miss
    // resolves unavailable; the raw-hex UI this layer enhances stays up.
    // Memoized facts stay visible; only the misses degrade.
    const { outcomes, misses } = partitionSelectors(joined);
    for (const selector of misses) {
      outcomes[selector] = { unavailable: true };
    }
    return outcomes;
  }
}

const querySignatures = bindQueryFn(fetchSignatures, signaturesCache);

const useSignaturesQuery = createQueryHook({ queryFn: querySignatures });

const EMPTY_OUTCOMES: Record<string, SignatureOutcome> = {};

/**
 * Resolve openchain signatures for the selectors visible on a surface.
 * One batched GET per selector set; resolved facts are shared across sets
 * through the module memo. While in flight (or failed — fetchSignatures
 * never rejects) the hook returns {}, so callers keep their raw rendering
 * until names land: the lookup enhances, never blocks.
 */
export function useSignatures(selectors: readonly string[]): Record<string, SignatureOutcome> {
  const digest = [...new Set(selectors.filter(selector => selector !== ''))].sort().join(',');
  const query = useSignaturesQuery([digest]);
  return query.data ?? EMPTY_OUTCOMES;
}

/** The /api/signatures cap: at most 25 selectors per request. */
export const MAX_SELECTORS_PER_REQUEST = 25;

// useSignaturesBatched calls useSignatures a FIXED number of times per
// render (rules of hooks); 4 slots × 25 selectors = 100 selectors per
// surface, far above any visible page (a 20-row list needs one slot).
// Selectors beyond the ceiling stay unresolved and render their raw
// fallback — requests are never unbounded.
const MAX_BATCH_CHUNKS = 4;

/**
 * Pure: split a list into consecutive chunks of at most `maxPerChunk`
 * items, order preserved. `maxPerChunk` below 1 is clamped to 1; an empty
 * list yields no chunks.
 */
export function chunkSelectors<T>(items: readonly T[], maxPerChunk: number): T[][] {
  const size = Math.max(1, Math.floor(maxPerChunk));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Resolve openchain signatures for a selector set that may exceed the
 * API's 25-selector request cap: the set is chunked (≤ cap per chunk) and
 * every chunk rides its own batched GET; the outcomes merge into one map.
 * Chunks are disjoint by construction, so the merge never overwrites.
 * Selectors resolved earlier in the session answer from the module memo
 * with no request — paging back over an already-seen page is free.
 */
export function useSignaturesBatched(
  selectors: readonly string[],
): Record<string, SignatureOutcome> {
  const chunks = chunkSelectors(
    [...new Set(selectors.filter(selector => selector !== ''))],
    MAX_SELECTORS_PER_REQUEST,
  ).slice(0, MAX_BATCH_CHUNKS);
  // Fixed hook-call count: unused slots resolve an empty set — the ''
  // digest answers from the query cache without any request.
  const chunk0 = useSignatures(chunks[0] ?? []);
  const chunk1 = useSignatures(chunks[1] ?? []);
  const chunk2 = useSignatures(chunks[2] ?? []);
  const chunk3 = useSignatures(chunks[3] ?? []);
  return { ...chunk0, ...chunk1, ...chunk2, ...chunk3 };
}

// ---------------------------------------------------------------------------
// /signatures tool page lookup
//
// Unlike the enhancement hooks above, the tool page's whole purpose is the
// lookup, so failures surface as first-class states instead of raw-hex
// fallbacks:
// - 'error': the backend itself was unreachable (no API base, dead network
//   path) or answered with an HTTP error — the view renders the standard
//   offline/error attribution from the surfaced Error object.
// - 'unavailable': the backend answered but its openchain upstream failed —
//   a retryable temporary state, distinct from both a miss and an outage.
// - 'ok': a settled registry fact (found candidates or an honest notFound).
//
// The strict query shares the digest cache with the enhancement layer, so
// a selector resolved on any table answers here without a request (and
// vice versa); refetch deletes the args' cache entry first, so Retry
// genuinely re-asks.
// ---------------------------------------------------------------------------

const querySignaturesStrict = bindQueryFn(fetchSignaturesStrict, signaturesCache);

const useSignaturesStrictQuery = createQueryHook({ queryFn: querySignaturesStrict });

/** One surfaced lookup's state for the /signatures page (see block above). */
export type SignatureLookup =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; outcome: ResolvedSignatures }
  | { status: 'miss' }
  | { status: 'unavailable' }
  | { status: 'error'; error: unknown };

const idleLookup = { status: 'idle' } as const;

/**
 * Resolve one selector/topic0 for the /signatures tool page. `selector`
 * undefined (no valid query to run) resolves idle without any request.
 * A settled registry fact discriminates found (candidates) from miss
 * (honest no-match) so views branch without outcome-shape gymnastics.
 */
export function useSignatureLookup(
  selector: string | undefined,
): SignatureLookup & { refetch: () => void | Promise<unknown> } {
  // The '' digest answers from the query cache without any request, so
  // the idle case costs nothing — and the hook is called unconditionally,
  // keeping the rules of hooks intact.
  const query = useSignaturesStrictQuery([selector ?? '']);
  if (selector === undefined) return { ...idleLookup, refetch: query.refetch };
  if (query.error !== undefined) {
    return { status: 'error', error: query.error, refetch: query.refetch };
  }
  // Per-key presence is the settle guard (Contracts/List pattern): after
  // an argument switch the store may still hold the previous digest's
  // data, whose keys never include the new selector — that renders as
  // loading, never as someone else's outcome.
  const outcome = query.data?.[selector];
  if (outcome === undefined) return { status: 'loading', refetch: query.refetch };
  if ('unavailable' in outcome) return { status: 'unavailable', refetch: query.refetch };
  if ('notFound' in outcome) return { status: 'miss', refetch: query.refetch };
  return { status: 'found', outcome, refetch: query.refetch };
}
