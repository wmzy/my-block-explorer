// Hard race guard for a promise that may never settle. The timeout
// rejection is TYPED (not a plain Error) so callers can distinguish "the
// call hung" from real provider errors — the scan services map it to
// their honest budget outcomes (empty partial / scan-failed) instead of
// failing the request.

/** Rejection type of {@link withTimeout}'s race: the wrapped promise never settled in time. */
export class TimeoutError extends Error {}

// The losing timer is cleared on settle (crossChainProbe withinBudget
// pattern): a winning call must not leave a live ms-later timer pending
// for every request — a dangling setTimeout keeps the event loop (and the
// losing promise's frame) alive until the timer fires.
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

// The stats route's resolve-null contract: a timeout is a MISSING VALUE,
// not an error — the caller degrades the field to null (e.g. a null head
// with rpcConnected:false) while real errors still reject for their own
// catch. The timer hygiene is withTimeout's (cleared on both outcomes).
export async function withTimeoutOrNull<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  try {
    return await withTimeout(promise, ms, 'Timed operation');
  } catch (error) {
    if (error instanceof TimeoutError) return null;
    throw error;
  }
}
