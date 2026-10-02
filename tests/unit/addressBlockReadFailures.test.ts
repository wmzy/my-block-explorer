// Block reads inside the address-transaction discovery walk must never
// turn a per-block RPC failure into DATA. The repo already fixed this
// class in one walker (utils/blockRpcData.ts: withOneRetry, whose comment
// names `.catch(() => null)` as the cause of "the paginated transaction
// walk then paged past (losing those transactions for good)"); the address
// heuristic scan kept the same shape and stayed broken.
//
// Three failure modes, three correct answers:
//   1. transient getBlock failure   -> retried once, the block's
//      transactions are discovered (no data loss, no inflated cost).
//   2. a failure that survives the retry, while the BALANCE probe for the
//      same scan window succeeds -> the search reports none/search-failed
//      (an honest "we could not search this"), never a short plausible
//      list that pages past the hole for good.
//   3. `getBlock` answering null/undefined (viem folds a '0x' empty block
//      into undefined) is DATA, not a failure: that block really has no
//      transactions.
import { describe, it, expect, vi } from 'vitest';
import { createAddressService } from '@/services/AddressService';

const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const LATEST = 64n;

type Block = {
  number: bigint;
  timestamp: bigint;
  transactions: { hash: string; from: string; to: string | null; value: bigint; input: string }[];
};

const blockWith = (number: bigint, ...txs: Block['transactions']): Block => ({
  number,
  timestamp: 1_700_000_000n,
  transactions: txs,
});

const inTx = (block: bigint) => ({
  hash: `0xtx-${block.toString()}`,
  from: '0xdddddddddddddddddddddddddddddddddddddddd',
  to: A,
  value: 1_000n,
  input: '0x',
});

const outTx = (block: bigint) => ({
  hash: `0xout-${block.toString()}`,
  from: A,
  to: '0xcccccccccccccccccccccccccccccccccccccccc',
  value: 7_000n,
  input: '0x',
});

// The balance profile is a step at 40: every block >= 40 reads 2n, below it
// 1n. The binary search therefore always descends into [lo..40] and
// linearly scans that half (scanBlocksForAddress walks from `to` down to
// `from`), so block 40 and its neighbours are guaranteed to be fetched.
const balanceProfile = async ({ blockNumber }: { blockNumber?: bigint }) =>
  blockNumber === undefined || blockNumber >= 40n ? 2n : 1n;

const makeService = (getBlock: (blockNumber: bigint) => Promise<Block | null | undefined>) => {
  const client = {
    getTransactionCount: vi.fn().mockResolvedValue(4),
    getBlockNumber: vi.fn().mockResolvedValue(LATEST),
    getBalance: vi.fn(balanceProfile),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => getBlock(blockNumber)),
  };
  const service = createAddressService({
    db: undefined as unknown as Parameters<typeof createAddressService>[0]['db'],
    indexedAddresses: undefined as unknown as Parameters<
      typeof createAddressService
    >[0]['indexedAddresses'],
    rpcManager: { getClient: vi.fn().mockResolvedValue(client) } as unknown as Parameters<
      typeof createAddressService
    >[0]['rpcManager'],
    contractSourceService: undefined as unknown as Parameters<
      typeof createAddressService
    >[0]['contractSourceService'],
  });
  return { service, client };
};

// Every block except 40 is empty; 40 carries one incoming and one outgoing
// transaction, so the step block is the only discovered row.
const blocksWithHit = (blockNumber: bigint): Block =>
  blockNumber === 40n ? blockWith(40n, inTx(40n), outTx(40n)) : blockWith(blockNumber);

describe('address discovery walk — a failed block read is never data', () => {
  it('retries a transient getBlock failure once and still discovers the block', async () => {
    const attempts = new Map<bigint, number>();
    const { service, client } = makeService(async blockNumber => {
      attempts.set(blockNumber, (attempts.get(blockNumber) ?? 0) + 1);
      // First attempt at the step block dies with a transport error; the
      // retry must reach the RPC again and answer with the real block.
      if (blockNumber === 40n && attempts.get(40n) === 1) throw new Error('socket hang up');
      return blocksWithHit(blockNumber);
    });

    const result = await service.getAddressTransactions(120, A, 20, 0);

    expect(result.coverage).toBe('partial');
    // Newest first by block; inside one block the block's own transaction
    // order is preserved (the sort is stable, the walk is not).
    expect(result.transactions.map(row => row.hash)).toEqual(['0xtx-40', '0xout-40']);
    expect(attempts.get(40n)).toBe(2);
    // Only the failing block is asked twice — the retry is per block, not
    // a repeat of the whole batch.
    const others = [...attempts.entries()].filter(([block]) => block !== 40n);
    expect(others.every(([, count]) => count === 1)).toBe(true);
    expect(client.getBlock).toHaveBeenCalled();
  });

  it('a block read that survives the retry fails the search honestly instead of dropping its transactions', async () => {
    // The balance probe keeps answering, so the search really is unable
    // to see this window: 'search-failed' is the truth. Silently
    // continuing would return the other blocks' rows and page past the
    // missing one forever (and cache that short list for 60s).
    const { service } = makeService(async blockNumber => {
      if (blockNumber === 40n) throw new Error('provider 500');
      return blocksWithHit(blockNumber);
    });

    const result = await service.getAddressTransactions(121, A, 20, 0);

    expect(result).toMatchObject({
      transactions: [],
      total: 0,
      method: 'fallback',
      coverage: 'none',
      reason: 'search-failed',
    });
  });

  it('a null/undefined block (viem folding a 0x empty block) is data, not a failure', async () => {
    // The scan must not burn a second RPC call on a well-answered
    // 'this block has no transactions'.
    const { service, client } = makeService(async blockNumber => {
      if (blockNumber === 40n) return undefined;
      return blockWith(blockNumber);
    });

    const result = await service.getAddressTransactions(122, A, 20, 0);

    // Honest: this block answered 'no transactions', so nothing was
    // discovered and the coverage verdict still reflects a successful
    // heuristic search.
    expect(result.coverage).toBe('partial');
    expect(result.transactions).toEqual([]);
    expect(result.reason).toBeUndefined();
    const stepBlockCalls = client.getBlock.mock.calls.filter(
      call => call[0].blockNumber === 40n,
    );
    expect(stepBlockCalls).toHaveLength(1);
  });
});
