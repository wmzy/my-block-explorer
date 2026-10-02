// One retry for an IDEMPOTENT read, in one place.
//
// Public RPCs drop a single getBlock / getReceipt under load; a retry
// converts most of those transient failures into data. A failure that
// SURVIVES the retry is real and must be reported to the caller — never
// laundered into a plausible value.
//
// Why this module exists (the class it closes): the block walker in
// utils/blockRpcData.ts carried the pattern as a private helper, while
// services/AddressService.ts kept the older shape —
// `client.getBlock(...).catch(() => null)` inside a batched paginated
// walk, with the null then read as "this block is empty". One transient
// failure therefore removed every transaction of that block from the
// discovered set for good (the cursor pages past it and the short list
// gets cached), and the response still answered
// `coverage: 'partial'` — indistinguishable from a healthy heuristic
// search. Two implementations of the same rule is how that happened;
// this is the single shared one, and both call sites now use it.

/**
 * Run an idempotent read, retrying exactly once on rejection.
 *
 * The first error is attached as `cause` on the surviving one when the
 * provider did not set one itself, so a log keeps both attempts.
 *
 * `onRetry` fires when a retry is actually issued — callers that meter
 * their own RPC budget need it, because a walk that pre-charges the
 * budget for an attempt that never happens silently discovers less, and
 * one that does NOT charge it can report a failing window as "exhausted"
 * instead of the honest failure verdict.
 */
export const withOneRetry = async <T>(read: () => Promise<T>, onRetry?: () => void): Promise<T> => {
  try {
    return await read();
  } catch (firstError) {
    onRetry?.();
    try {
      return await read();
    } catch (error) {
      throw error instanceof Error && error.cause === undefined
        ? Object.assign(error, { cause: firstError })
        : error;
    }
  }
};
