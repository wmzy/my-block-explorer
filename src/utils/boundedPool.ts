// Bounded-concurrency pool over an ordered list: outcomes land at their
// input index, so the aggregate order is the input order, not completion
// order. Four backend services and internalTxScan's runTracePool
// hand-rolled this same shared-cursor scheduling loop; this import-free
// leaf is the one home for it. Per-item error policy stays with the
// caller's worker (settle/throw as before); `shouldStop` is polled before
// claiming the next item so a worker failure can drain the pool early
// (AddressScanService's unsupported-probe exit) without abandoning
// already-claimed work.
export async function runBoundedPool<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  worker: (item: TItem, index: number) => Promise<TResult>,
  options: { shouldStop?: () => boolean } = {},
): Promise<TResult[]> {
  const outcomes: TResult[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      for (;;) {
        if (options.shouldStop?.()) return;
        // Read-and-increment is synchronous, so workers never claim the
        // same slot despite sharing the cursor across awaits.
        const index = next;
        next += 1;
        if (index >= items.length) return;
        outcomes[index] = await worker(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return outcomes;
}
