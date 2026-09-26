import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

// In-process token-bucket rate limiter for the recomputation-heavy read
// endpoints (CSV export, on-demand transfer sweeps, contract interaction).
// Zero external dependencies on purpose, mirroring cors-origins.ts: this
// module rides the api-app import graph, which is also loaded by the Vite
// dev bridge, so only project-local packages (@hono/node-server is already
// a server.ts dependency) and relative imports are allowed here.

export type RateLimiterConfig = {
  /** Bucket namespace: buckets are per client IP within one name. */
  name: string;
  /** Sustained allowance — tokens refilled per minute. */
  requestsPerMinute: number;
  /** Bucket capacity — requests allowed in an instant before refills. */
  burst: number;
};

type Bucket = {
  tokens: number;
  lastRefillMs: number;
};

// Shared across every limiter so one sweep covers all buckets. Keys are
// `${name}|${client}`; the map itself is unbounded — the sweeper below is
// the bound, so a stream of unique IPs cannot grow it forever.
const buckets = new Map<string, Bucket>();

// Ops statistics (read-only, additive — see getRateLimitStats): per-NAME
// totals only. Deliberately never keyed or sliced by client IP, and never
// consulted by the allow/deny path, so the limiting behavior is untouched.
const limiterStats = new Map<string, { hits: number; rejected: number }>();

// Static config registry: one row per limiter created in this process, so a
// limiter with zero traffic still reports its shape. Populated at
// createRateLimiter time and intentionally NOT cleared by
// resetRateLimiterState (route files create their limiters once at module
// scope; clearing would orphan them for the rest of the process).
const limiterConfigs = new Map<string, RateLimiterConfig>();

// A bucket refills to full within at most 60s for every configured limiter
// (burst <= requestsPerMinute holds for all of them), so anything idle for
// 5 minutes is indistinguishable from a fresh bucket — safe to drop.
const SWEEP_INTERVAL_MS = 60_000;
const BUCKET_IDLE_TTL_MS = 300_000;

let lastSweepMs = 0;

// Drop buckets that have been idle past the TTL. Sweeping piggybacks on
// request handling (checked once per SWEEP_INTERVAL_MS) instead of a
// setInterval: no timer keeps the process alive, and the sweep stays
// deterministic under test. A traffic drought cannot leak either — without
// requests no new buckets are created.
export function sweepStaleBuckets(now: number = Date.now()): number {
  let swept = 0;
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefillMs > BUCKET_IDLE_TTL_MS) {
      buckets.delete(key);
      swept++;
    }
  }
  lastSweepMs = now;
  return swept;
}

// Test hook: the module-level state is otherwise shared across every
// limiter in the process for its whole lifetime. Runtime counters (buckets,
// stats totals) reset; the static limiter-config registry stays (see above).
export function resetRateLimiterState(): void {
  buckets.clear();
  limiterStats.clear();
  lastSweepMs = 0;
}

// One row of the ops snapshot: a limiter's shape plus its in-process
// totals. Counters start at process start and reset on restart (the ops
// dashboard copy says so); `hits` counts every request the limiter
// evaluated (admitted or rejected), `rejected` the subset answered 429.
export type RateLimitBucketStats = {
  /** Bucket namespace (the limiter's configured name). */
  name: string;
  /** Instantaneous capacity — the burst allowance. */
  capacity: number;
  /** Sustained allowance — tokens refilled per minute. */
  requestsPerMinute: number;
  hits: number;
  rejected: number;
};

// Totals snapshot for the ops dashboard (GET /api/ops/summary): one row per
// limiter created in this process, zero-traffic limiters included, sorted
// by name for a stable response. Purely additive read-only stats — no
// per-IP data leaves this module through this export.
export function getRateLimitStats(): RateLimitBucketStats[] {
  return [...limiterConfigs.entries()]
    .map(([name, config]) => {
      const totals = limiterStats.get(name);
      return {
        name,
        capacity: config.burst,
        requestsPerMinute: config.requestsPerMinute,
        hits: totals?.hits ?? 0,
        rejected: totals?.rejected ?? 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Counter side-effect for the ops snapshot. Called once per evaluated
// request, after the decision — it cannot influence the outcome.
function recordLimiterHit(name: string, allowed: boolean): void {
  const totals = limiterStats.get(name);
  if (totals === undefined) {
    limiterStats.set(name, { hits: 1, rejected: allowed ? 0 : 1 });
    return;
  }
  totals.hits++;
  if (!allowed) totals.rejected++;
}

// IPv4-mapped IPv6 (::ffff:203.0.113.7) and plain IPv4 must share one
// bucket or the same peer would get two allowances on dual-stack hosts.
function normalizeClientAddress(address: string): string {
  return address.replace(/^::ffff:/, '');
}

// The remote address comes from the @hono/node-server socket. When it is
// unavailable — the Vite dev bridge serves api-app via app.fetch() with no
// conninfo binding — every caller collapses into one shared fallback
// bucket per limiter name: still rate-limited (conservative), just not
// per-client.
function clientKey(c: Context): string {
  try {
    const { remote } = getConnInfo(c);
    if (remote.address) return normalizeClientAddress(remote.address);
  } catch {
    // No conninfo binding on the context — fall through to the shared key.
  }
  return 'unknown';
}

export function createRateLimiter(config: RateLimiterConfig): MiddlewareHandler {
  const { name, requestsPerMinute, burst } = config;
  if (!Number.isFinite(requestsPerMinute) || requestsPerMinute < 1) {
    throw new Error(`rate limiter "${name}": requestsPerMinute must be >= 1`);
  }
  if (!Number.isFinite(burst) || burst < 1) {
    throw new Error(`rate limiter "${name}": burst must be >= 1`);
  }

  // Read-only ops stats registration (see getRateLimitStats): the shape of
  // this limiter, so the dashboard can list it before any traffic arrives.
  limiterConfigs.set(name, config);

  const refillPerMs = requestsPerMinute / 60_000;

  const evaluate = (
    client: string,
    now: number,
  ): { allowed: boolean; retryAfterMs: number } => {
    const key = `${name}|${client}`;
    const bucket = buckets.get(key);

    if (!bucket) {
      // First hit starts at a full bucket minus this request's token.
      buckets.set(key, { tokens: burst - 1, lastRefillMs: now });
      return { allowed: true, retryAfterMs: 0 };
    }

    const elapsed = Math.max(0, now - bucket.lastRefillMs);
    const tokens = Math.min(burst, bucket.tokens + elapsed * refillPerMs);

    // The epsilon absorbs float dust: elapsed * refillPerMs can land a few
    // ulps under an exact whole token, which must not delay an on-time
    // refill by a full refill period.
    if (tokens + 1e-9 >= 1) {
      bucket.tokens = tokens - 1;
      bucket.lastRefillMs = now;
      return { allowed: true, retryAfterMs: 0 };
    }

    // Rejected requests still advance the refill clock while keeping the
    // fractional tokens, so polling does not reset accumulated refill.
    bucket.tokens = tokens;
    bucket.lastRefillMs = now;
    return { allowed: false, retryAfterMs: Math.ceil((1 - tokens) / refillPerMs) };
  };

  return async (c, next) => {
    // Re-read per request (cors-origins.ts precedent): config changes apply
    // without a server restart, and the disabled path stays zero-cost.
    if (process.env.RATE_LIMIT_DISABLED === '1') return next();

    const now = Date.now();
    if (now - lastSweepMs >= SWEEP_INTERVAL_MS) sweepStaleBuckets(now);

    const { allowed, retryAfterMs } = evaluate(clientKey(c), now);
    // Read-only ops counter (see getRateLimitStats): recorded after the
    // decision, never consulted by it.
    recordLimiterHit(name, allowed);
    if (allowed) return next();

    // The -1ms guards the ceil against the same float dust (deficit/rate
    // can overshoot an exact second boundary by picoseconds).
    const retryAfterSeconds = Math.max(1, Math.ceil((retryAfterMs - 1) / 1000));
    c.header('Retry-After', String(retryAfterSeconds));
    return c.json(
      {
        error: 'rate_limited',
        message: `Rate limit exceeded for ${name}; retry after ${retryAfterSeconds}s.`,
        retryAfterSeconds,
      },
      429,
    );
  };
}
