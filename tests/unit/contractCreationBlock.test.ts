/**
 * getContractCreationBlock must never return a fabricated boundary.
 *
 * Every consumer in EventIndexingService treats this value as
 * authoritative and the code says so at each site:
 *
 *   - getContractCreationBlockCached: "Null is the honest answer:
 *     callers must never receive a fabricated boundary (e.g.
 *     latest - 100k)."
 *   - addIndexingRange: "Unknown creation block: skip the clamp rather
 *     than invent a boundary."
 *   - createRangeFirst: "Contract creation block unknown — enter a
 *     start block manually."
 *
 * The implementation violated all three. It probed seven DISJOINT
 * 10k-block windows (offsets 10k, 50k, 200k, 1M, 5M, 10M, 20M below the
 * head) and returned `min(earliest hit) - 100` as "the creation block".
 * A hit in one window proves nothing about the unprobed gaps between
 * them, so the value could be far above the real creation block — and
 * it returned that fabricated number with no way to signal doubt.
 *
 * Consequences, all real:
 *   - createRangeAll starts full-history indexing AT the wrong block, so
 *     every event between the real creation block and the probed one is
 *     silently never indexed.
 *   - addIndexingRange REJECTS a user's correct, earlier fromBlock with
 *     "fromBlock cannot be before contract creation block (<wrong>)".
 *   - createRangeFirst builds its "first N blocks after creation" range
 *     from the wrong number.
 *   - With no hits at all it returned `latest - 100_000`, which is the
 *     exact fabrication the comment names.
 *   - On any chain younger than 10k blocks every offset was skipped
 *     (`if (offset > latestBlock) continue`), so it probed nothing and
 *     still answered with a number.
 */
import { describe, it, expect } from 'vitest';
import { getContractCreationBlock } from '@/utils/events';

type Log = { blockNumber: bigint };

/** Records every getLogs window so a test can assert what was probed. */
const makeClient = (latest: bigint, eventsAt: (from: bigint, to: bigint) => Log[]) => {
  const windows: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  return {
    windows,
    client: {
      getBlockNumber: async () => latest,
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        windows.push({ fromBlock, toBlock });
        return eventsAt(fromBlock, toBlock);
      },
    },
  };
};

const ADDR = '0x1111111111111111111111111111111111111111' as `0x${string}`;

describe('getContractCreationBlock refuses to fabricate a boundary', () => {
  it('returns null (not a guessed block) when no events are found anywhere', async () => {
    // Every window empty: the old code answered `latest - 100_000`,
    // inventing a creation block 100k blocks in the future of the truth.
    const { client } = makeClient(10_000_000n, () => []);

    const result = await getContractCreationBlock(client, ADDR);

    expect(result).toBeNull();
  });

  it('returns null on a chain too young for any probe window instead of answering 0', async () => {
    // head 5000: every offset (smallest 10k) is above it, so the old code
    // skipped every window and answered `0` — claiming the contract was
    // created at genesis without probing a single block.
    const { client } = makeClient(5_000n, () => []);

    const result = await getContractCreationBlock(client, ADDR);

    expect(result).toBeNull();
  });

  it('returns null when the RPC fails, instead of a fabricated fallback', async () => {
    const client = {
      getBlockNumber: async () => {
        throw new Error('node unreachable');
      },
      getLogs: async () => [],
    };

    const result = await getContractCreationBlock(client, ADDR);

    expect(result).toBeNull();
  });

  it('bounds a contract that emits in every window at the first window, never below', async () => {
    // A contract created at 9_970_000 that emits in EVERY block, on a
    // chain whose head is 10_000_000. The newest window already contains
    // events, so the honest bound is that window's start: 9_989_901.
    // The walk must not report a block ABOVE the first event, and must
    // not wander below it either.
    const created = 9_970_000n;
    const latest = 10_000_000n;
    const { client } = makeClient(latest, (from, to) => {
      const logs: Log[] = [];
      const start = from > created ? from : created;
      for (let b = start; b <= to; b += 1_000n) logs.push({ blockNumber: b });
      return logs;
    });

    const result = await getContractCreationBlock(client, ADDR);

    expect(result).not.toBeNull();
    // Above the true first event? Never. Below it is also wrong here —
    // the first window proved where the events start.
    expect(result as bigint).toBe(9_989_901n);
  });

  it('descends past empty recent blocks to find events in an older band', async () => {
    // The decisive regression case. A contract that emitted only in
    // [14_000_000..15_000_000] and has been silent since, on a chain
    // whose head is 22_000_000. The old sparse windows probed
    // [21_990_000..21_999_999] and [21_950_000..21_959_999] — both past
    // the active band, both empty — then hit at the 5M offset, and
    // returned 16_999_900: ~3M blocks above the real first event, so
    // `createRangeAll` would have started indexing 3M blocks too late
    // and never indexed the band's events at all.
    const created = 14_000_000n;
    const activeUntil = 15_000_000n;
    const latest = 22_000_000n;
    const { client, windows } = makeClient(latest, (from, to) => {
      if (to < created || from > activeUntil) return [];
      return [{ blockNumber: from > created ? from : created }];
    });

    const result = await getContractCreationBlock(client, ADDR);

    // A bound at or below the true first event — never above it.
    expect(result).not.toBeNull();
    expect(result as bigint).toBeLessThanOrEqual(created);
    // And the walk really did descend through the empty recent region.
    expect(windows.length).toBeGreaterThan(1);
  });

  it('tiles the chain with abutting windows, never leaving an unprobed gap', async () => {
    // The structural property the sparse-offset walk violated: every
    // window must start exactly where the previous one ended, so no block
    // is ever skipped. A gap is how the old code missed an older hit.
    const latest = 22_000_000n;
    const { client, windows } = makeClient(latest, () => []);

    await getContractCreationBlock(client, ADDR);

    expect(windows.length).toBeGreaterThan(1);
    let expectedTo = latest;
    for (const w of windows) {
      expect(w.toBlock).toBe(expectedTo);
      expect(w.toBlock).toBeGreaterThanOrEqual(w.fromBlock);
      expectedTo = w.fromBlock - 1n;
    }
    // The walk reached past genesis rather than stopping short.
    expect(expectedTo).toBeLessThan(0n);
  });
});
