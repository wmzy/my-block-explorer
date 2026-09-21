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
// view retries instead of pinning the outage. The fetch never rejects:
// signature names are an enhancement layered over raw hex and must never
// surface an error state or block a render.
import { api, get, withSignal } from '@/util/http';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';

export type SignatureKind = 'function' | 'event';

export type SignatureOutcome =
  | { kind: SignatureKind; signatures: string[]; source: 'openchain' }
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
export async function fetchSignatures(
  joined: string,
  signal?: AbortSignal,
): Promise<Record<string, SignatureOutcome>> {
  const selectors = joined.split(',').filter(selector => selector !== '');
  const outcomes: Record<string, SignatureOutcome> = {};
  const misses: string[] = [];
  for (const selector of selectors) {
    const cached = selectorOutcomeCache.get(selector);
    if (cached !== undefined) {
      outcomes[selector] = cached;
    } else if (isRequestable(selector)) {
      misses.push(selector);
    }
    // A malformed digest entry has nothing to ask the API for and simply
    // stays absent — callers render it as unknown.
  }
  if (misses.length === 0) return outcomes;

  const params: Record<string, string> = {};
  const functions = misses.filter(selector => FUNCTION_SELECTOR_RE.test(selector));
  const events = misses.filter(selector => EVENT_TOPIC0_RE.test(selector));
  if (functions.length > 0) params.function = functions.join(',');
  if (events.length > 0) params.event = events.join(',');

  try {
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
  } catch {
    // Backend offline / degraded discovery / HTTP failure — every miss
    // resolves unavailable; the raw-hex UI this layer enhances stays up.
    for (const selector of misses) {
      outcomes[selector] = { unavailable: true };
    }
  }
  return outcomes;
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
