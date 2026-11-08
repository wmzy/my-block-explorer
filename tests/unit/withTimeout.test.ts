// withTimeout/withTimeoutOrNull contract tests: the race guard rejects
// with a TYPED TimeoutError (label + window in the message), propagates
// real errors untouched, and — the part each caller's timer-hygiene test
// depends on — clears the losing timer on BOTH outcomes so no ms-later
// setTimeout outlives its race. withTimeoutOrNull keeps the stats
// route's resolve-null contract: timeout → null, real error → reject.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimeoutError, withTimeout, withTimeoutOrNull } from '@/utils/withTimeout';

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Nothing pending may leak past a test — the whole point of the
    // clear-the-loser discipline.
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('rejects with a typed TimeoutError carrying the label and window', async () => {
    const pending = withTimeout(new Promise<string>(() => {}), 1_500, 'Probe');
    // Handler attached BEFORE the timer fires, so the rejection is never
    // even momentarily unhandled.
    const observed = pending.then(
      () => undefined,
      (e: unknown) => e,
    );

    await vi.advanceTimersByTimeAsync(1_500);
    const error = await observed;

    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Probe timed out after 1500ms');
  });

  it('returns the winning value and clears the losing timer', async () => {
    let resolve!: (value: number) => void;
    const wrapped = new Promise<number>(r => {
      resolve = r;
    });
    const raced = withTimeout(wrapped, 5_000, 'Fast');

    await vi.advanceTimersByTimeAsync(10);
    resolve(7);
    await expect(raced).resolves.toBe(7);

    // Far past the race window: the loser was cleared, not left to fire.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates a real rejection as-is (typed only for timeouts) and clears the timer', async () => {
    const boom = new Error('connection refused');
    const raced = withTimeout(
      new Promise<number>((_, reject) => {
        setTimeout(() => reject(boom), 100);
      }),
      5_000,
      'Real error',
    );
    // Handler attached BEFORE the rejection fires (see the test above).
    const observed = raced.then(
      () => undefined,
      (e: unknown) => e,
    );

    await vi.advanceTimersByTimeAsync(100);
    expect(await observed).toBe(boom);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('withTimeoutOrNull', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('resolves null on timeout (the stats resolve-null contract)', async () => {
    const pending = withTimeoutOrNull(new Promise<bigint>(() => {}), 3_000);

    await vi.advanceTimersByTimeAsync(3_000);
    await expect(pending).resolves.toBeNull();
  });

  it('returns the winning value and rejects real errors', async () => {
    await expect(withTimeoutOrNull(Promise.resolve(42n), 3_000)).resolves.toBe(42n);

    const boom = new Error('connection refused');
    await expect(withTimeoutOrNull(Promise.reject(boom), 3_000)).rejects.toBe(boom);
  });
});
