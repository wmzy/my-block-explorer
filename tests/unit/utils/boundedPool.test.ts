// The shared-cursor bounded pool behind the cross-chain probe, the block
// timestamp fan-out, the watch sweep and the address trace walk. The
// contract under test: outcomes land at their INPUT index no matter the
// completion order, the width cap is never exceeded, shouldStop drains
// the pool without claiming new items (in-flight work still settles),
// and empty input resolves to [].
import { describe, it, expect, vi } from 'vitest';
import { runBoundedPool } from '@/utils/boundedPool';

/** A promise the test controls from the outside. */
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('runBoundedPool — shared-cursor scheduling', () => {
  it('returns [] for empty input without invoking the worker', async () => {
    const worker = vi.fn(async (item: number) => item);

    await expect(runBoundedPool([], 4, worker)).resolves.toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });

  it('lands outcomes in input order under out-of-order completion', async () => {
    // Width 3 lets every item start at once; the gates then complete in
    // REVERSE order, so only index-addressed slots can keep the aggregate
    // in input order.
    const gates = [deferred<number>(), deferred<number>(), deferred<number>()];
    const worker = (item: number, index: number) => gates[index].promise.then(() => item * 2);

    const pool = runBoundedPool([10, 20, 30], 3, worker);
    gates[2].resolve(0);
    gates[1].resolve(0);
    gates[0].resolve(0);

    await expect(pool).resolves.toEqual([20, 40, 60]);
  });

  it('never exceeds the concurrency cap while items are still claimed', async () => {
    const gates = Array.from({ length: 5 }, () => deferred<number>());
    let inFlight = 0;
    let maxInFlight = 0;

    const pool = runBoundedPool(
      [0, 1, 2, 3, 4],
      2,
      index =>
        new Promise<number>(resolve => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          void gates[index].promise.then(() => {
            inFlight -= 1;
            resolve(index);
          });
        }),
    );

    // Let queued work claim and settle before releasing the gates, so the
    // cap is genuinely exercised rather than trivially unhit.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(inFlight).toBe(2);
    for (const gate of gates) gate.resolve(0);

    await expect(pool).resolves.toEqual([0, 1, 2, 3, 4]);
    expect(maxInFlight).toBe(2);
  });

  it('shouldStop stops claiming new items; unclaimed slots stay holes', async () => {
    const claimed: number[] = [];
    const stop = { tripped: false };

    const result = await runBoundedPool(
      [0, 1, 2, 3, 4, 5],
      1,
      async index => {
        claimed.push(index);
        if (index === 2) stop.tripped = true;
        return index * 10;
      },
      { shouldStop: () => stop.tripped },
    );

    expect(claimed).toEqual([0, 1, 2]);
    expect(result.length).toBe(6);
    expect(result.slice(0, 3)).toEqual([0, 10, 20]);
    expect(result[3]).toBeUndefined();
    expect(result[4]).toBeUndefined();
    expect(result[5]).toBeUndefined();
    // Holes (never claimed), not claimed-but-undefined slots.
    expect(3 in result).toBe(false);
  });

  it('shouldStop drains in-flight work — an already-claimed item still lands', async () => {
    const releaseSlow = deferred<number>();
    const claimed: number[] = [];
    const stop = { tripped: false };

    const pool = runBoundedPool(
      [0, 1, 2, 3],
      2,
      index => {
        claimed.push(index);
        if (index === 0) {
          // Claimed first, settles LAST — after the flag has tripped.
          return releaseSlow.promise.then(() => 'slow');
        }
        return Promise.resolve('fast').then(value => {
          if (index === 1) stop.tripped = true;
          return value;
        });
      },
      { shouldStop: () => stop.tripped },
    );

    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(claimed).toEqual([0, 1]);

    releaseSlow.resolve(0);
    // The slow in-flight item settled into its input slot; the rest are
    // unclaimed holes.
    const outcomes = await pool;
    expect(outcomes.length).toBe(4);
    expect(outcomes[0]).toBe('slow');
    expect(outcomes[1]).toBe('fast');
    expect(2 in outcomes).toBe(false);
    expect(claimed).toEqual([0, 1]);
  });
});
