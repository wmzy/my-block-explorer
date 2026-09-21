// Signature lookup service: resolves unknown function selectors (4-byte)
// and event topic0 hashes (32-byte) against the openchain signature
// database, with DuckDB as the durable first layer.
//
// Cache semantics (mirroring ContractSourceService/StorageLayoutService):
// - A resolved selector is immutable — the same bytes always hash the same
//   canonical signature — so non-negative rows serve forever, no TTL.
// - A NOT_FOUND answer is persisted as a null-signature row but only
//   trusted for a bounded window (24h): signatures get submitted to
//   openchain over time, so a miss must be re-askable, never sticky.
// - An upstream failure (timeout, HTTP error, malformed payload) resolves
//   as { unavailable: true } and persists NOTHING — the caller renders the
//   retry-able unknown, exactly the pre-feature UI. Missing cache rows are
//   never treated as data.
// Multiple candidates keep openchain's order (most popular first).
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, signatureCache } from '../database/init';
import { createLogger } from '../server/logger';

const logger = createLogger('signature-service');

const OPENCHAIN_LOOKUP_URL = 'https://api.openchain.xyz/signature-database/v1/lookup';
const FETCH_TIMEOUT_MS = 5_000;
const MS_PER_HOUR = 1000 * 60 * 60;

// Negative entries expire after 24h: a selector unknown to openchain today
// can gain a signature as the database grows, and 24h is long enough that a
// hot unknown selector costs at most one upstream round trip per day.
export const NOT_FOUND_CACHE_TTL_HOURS = 24;

export type SignatureKind = 'function' | 'event';

export type SelectorLookup = {
  kind: SignatureKind;
  selector: string;
};

export type SignatureLookupOutcome =
  | { kind: SignatureKind; signatures: string[]; source: 'openchain' }
  | { kind: SignatureKind; signatures: []; notFound: true }
  | { unavailable: true };

type QueuedLookup = {
  request: SelectorLookup;
  resolve: (outcome: SignatureLookupOutcome) => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// One openchain candidate entry: { name: "transfer(address,uint256)" }.
// Anything else (missing/non-string/blank name) is dropped defensively —
// the upstream payload is untrusted shape-wise.
const extractNames = (entry: unknown): string[] => {
  if (!Array.isArray(entry)) return [];
  const names: string[] = [];
  for (const item of entry) {
    if (isRecord(item) && typeof item.name === 'string' && item.name.trim() !== '') {
      names.push(item.name);
    }
  }
  return names;
};

// Stored payloads are JSON arrays of candidate strings. Returns null for a
// corrupt/empty payload so the caller treats the row as a cache miss and
// refetches (the upsert then overwrites the bad row).
const parseStoredSignatures = (stored: string): string[] | null => {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return null;
    const names = parsed.filter((name): name is string => typeof name === 'string');
    return names.length > 0 ? names : null;
  } catch {
    return null;
  }
};

export class SignatureService {
  // In-flight dedup per `${kind}:${selector}`: concurrent lookups asking
  // for the same selector share one resolution instead of racing.
  private readonly inflight = new Map<string, Promise<SignatureLookupOutcome>>();

  // Queued lookups flushed in one microtask: every caller within the same
  // tick (one HTTP request's selector list, or several concurrent ones)
  // joins a single batched openchain round trip.
  private queue: QueuedLookup[] = [];
  private flushScheduled = false;

  /**
   * Resolve a batch of selectors. Every requested selector gets an entry
   * in the returned map (keyed by selector string — the two shapes cannot
   * collide). Never throws: upstream and database failures surface as
   * { unavailable: true } outcomes.
   */
  async lookup(
    requests: readonly SelectorLookup[],
  ): Promise<Map<string, SignatureLookupOutcome>> {
    const settled = await Promise.all(
      requests.map(
        async request =>
          [request.selector, await this.resolveSelector(request)] as const,
      ),
    );
    return new Map(settled);
  }

  private resolveSelector(request: SelectorLookup): Promise<SignatureLookupOutcome> {
    const key = `${request.kind}:${request.selector}`;
    const running = this.inflight.get(key);
    if (running) return running;

    const promise = new Promise<SignatureLookupOutcome>(resolve => {
      this.queue.push({ request, resolve });
      this.scheduleFlush();
    });
    this.inflight.set(key, promise);
    // Clear the dedup slot once settled so later calls retry rather than
    // pinning a transient { unavailable } forever. The finally chain is
    // discarded; callers await the original promise.
    void promise.finally(() => {
      if (this.inflight.get(key) === promise) this.inflight.delete(key);
    });
    return promise;
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      const batch = this.queue.splice(0, this.queue.length);
      void this.runBatch(batch);
    });
  }

  private async runBatch(batch: readonly QueuedLookup[]): Promise<void> {
    // resolveSelector dedupes through the inflight map, so batch keys are
    // unique by construction; the map grouping stays as a cheap invariant.
    const byKey = new Map<string, QueuedLookup>();
    for (const entry of batch) byKey.set(`${entry.request.kind}:${entry.request.selector}`, entry);

    // 1) Database first: resolved rows are immutable, negative rows are
    // honored while younger than the TTL. A read failure degrades to
    // "all misses" — the openchain round trip still answers honestly.
    const cachedRows = new Map<string, { signature: string | null; fetchedAt: Date | null }>();
    try {
      const selectors = [...byKey.values()].map(entry => entry.request.selector);
      const rows = await db
        .select()
        .from(signatureCache)
        .where(inArray(signatureCache.selector, selectors));
      for (const row of rows) {
        cachedRows.set(`${row.kind}:${row.selector}`, {
          signature: row.signature,
          fetchedAt: row.fetchedAt,
        });
      }
    } catch (error) {
      logger.warn({ err: error }, 'signature cache read failed; treating batch as misses');
    }

    const toFetch: QueuedLookup[] = [];
    for (const [key, entry] of byKey) {
      const cached = cachedRows.get(key);
      if (cached === undefined) {
        toFetch.push(entry);
        continue;
      }
      if (cached.signature !== null) {
        const names = parseStoredSignatures(cached.signature);
        if (names !== null) {
          entry.resolve({
            kind: entry.request.kind,
            signatures: names,
            source: 'openchain',
          });
          continue;
        }
        // Corrupt payload: fall through to a refetch that overwrites it.
        toFetch.push(entry);
        continue;
      }
      // Negative row: only trust it inside the TTL window. An expired one
      // is refetched (and the upsert below refreshes fetchedAt either way).
      const ageHours = (Date.now() - (cached.fetchedAt?.getTime() ?? 0)) / MS_PER_HOUR;
      if (ageHours < NOT_FOUND_CACHE_TTL_HOURS) {
        entry.resolve({ kind: entry.request.kind, signatures: [], notFound: true });
        continue;
      }
      toFetch.push(entry);
    }

    if (toFetch.length === 0) return;

    // 2) One batched openchain round trip for everything the cache could
    // not answer. A total failure marks the whole group unavailable.
    const fetched = await this.fetchFromOpenchain(toFetch.map(entry => entry.request));

    // Outcomes are prepared first but resolved only AFTER the persist
    // below settles: lookup() must not return while the cache write is
    // still in flight, or an immediate repeat lookup could race past the
    // cache and refetch upstream.
    const resolved: Array<{ entry: QueuedLookup; outcome: SignatureLookupOutcome }> = [];
    const upsertRows: Array<typeof signatureCache.$inferInsert> = [];
    for (const entry of toFetch) {
      const key = `${entry.request.kind}:${entry.request.selector}`;
      if (fetched === null) {
        resolved.push({ entry, outcome: { unavailable: true } });
        continue;
      }
      const names = fetched.get(key) ?? [];
      if (names.length === 0) {
        resolved.push({
          entry,
          outcome: { kind: entry.request.kind, signatures: [], notFound: true },
        });
        upsertRows.push({
          kind: entry.request.kind,
          selector: entry.request.selector,
          source: 'openchain',
          signature: null,
          fetchedAt: new Date(),
        });
      } else {
        resolved.push({
          entry,
          outcome: { kind: entry.request.kind, signatures: names, source: 'openchain' },
        });
        upsertRows.push({
          kind: entry.request.kind,
          selector: entry.request.selector,
          source: 'openchain',
          signature: JSON.stringify(names),
          fetchedAt: new Date(),
        });
      }
    }

    // 3) Persist answers (candidates AND misses) so repeat lookups hit
    // DuckDB, not openchain. Unavailable outcomes persist nothing.
    if (upsertRows.length > 0) {
      try {
        await db
          .insert(signatureCache)
          .values(upsertRows)
          .onConflictDoUpdate({
            target: [signatureCache.kind, signatureCache.selector],
            set: {
              signature: sql`excluded.signature`,
              source: sql`excluded.source`,
              fetchedAt: sql`excluded.fetched_at`,
            },
          });
      } catch (error) {
        logger.warn({ err: error }, 'failed to persist signature cache rows');
      }
    }

    for (const { entry, outcome } of resolved) entry.resolve(outcome);
  }

  // Returns null on any upstream failure (timeout, HTTP error, bad JSON,
  // wrong envelope) — the caller must not confuse that with "no match".
  private async fetchFromOpenchain(
    requests: readonly SelectorLookup[],
  ): Promise<Map<string, string[]> | null> {
    const params = new URLSearchParams();
    const functions = requests
      .filter(request => request.kind === 'function')
      .map(request => request.selector)
      .join(',');
    const events = requests
      .filter(request => request.kind === 'event')
      .map(request => request.selector)
      .join(',');
    if (functions !== '') params.set('function', functions);
    if (events !== '') params.set('event', events);
    const url = `${OPENCHAIN_LOOKUP_URL}?${params.toString()}`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        logger.warn({ status: response.status }, 'openchain lookup answered non-OK');
        return null;
      }
      const payload: unknown = await response.json();
      if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.result)) {
        logger.warn('openchain lookup payload failed envelope validation');
        return null;
      }
      const maps: Record<SignatureKind, Record<string, unknown>> = {
        function: isRecord(payload.result.function) ? payload.result.function : {},
        event: isRecord(payload.result.event) ? payload.result.event : {},
      };
      const results = new Map<string, string[]>();
      for (const request of requests) {
        const names = extractNames(maps[request.kind][request.selector]);
        if (names.length > 0) {
          results.set(`${request.kind}:${request.selector}`, names);
        }
      }
      return results;
    } catch (error) {
      logger.warn({ err: error }, 'openchain signature lookup failed');
      return null;
    }
  }

  /** Test/debug helper: drop cached rows for the given selectors. */
  async clearCache(requests: readonly SelectorLookup[]): Promise<void> {
    try {
      for (const request of requests) {
        await db
          .delete(signatureCache)
          .where(
            and(
              eq(signatureCache.kind, request.kind),
              eq(signatureCache.selector, request.selector),
            ),
          );
      }
    } catch (error) {
      logger.warn({ err: error }, 'failed to clear signature cache rows');
    }
  }
}

export const signatureService = new SignatureService();
