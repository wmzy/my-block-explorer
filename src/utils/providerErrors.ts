/**
 * Shared provider-error classification for shrink-and-retry strategies.
 *
 * Public RPC providers cap eth_getLogs block spans, rate-limit bursts, and
 * reset sockets. When a requested span (or chunk) fails with one of these
 * error shapes, halving the span and retrying smaller is the productive
 * response — deterministic same-span retries just burn the budget. Both
 * walk engines (EventIndexingService's event ranges and
 * AddressScanService's balance-checkpoint walk) use this predicate to
 * decide when to shrink; it was previously a conscious copy in each
 * service, which is how the two definitions drift.
 *
 * Scope note: TokenTransferService/ApprovalScanService keep their own
 * RETRYABLE_CHUNK_ERROR — chunk-ladder retryability has different
 * semantics (a chunk may be retryable without the span being shrinkable).
 */

export const SHRINKABLE_PROVIDER_ERROR_RE =
  /rate.?limit|too many requests|429|exceed|limit|timeout|timed out|econnreset|econnrefused|socket hang up|network|fetch failed/i;

export const isShrinkableProviderError = (err: unknown): boolean =>
  SHRINKABLE_PROVIDER_ERROR_RE.test(err instanceof Error ? err.message : String(err));
