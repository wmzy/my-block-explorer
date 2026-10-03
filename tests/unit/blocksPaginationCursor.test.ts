// Block-list pagination cursor polarity.
//
// The Blocks list derives every page cursor as an EXCLUSIVE upper bound
// (`anchor + 1` for page 1, `anchor - (page-1)*LIMIT + 1` for page N — see
// views/Blocks/List.tsx), the same polarity as the transaction walk's
// composite cursor. getLatestBlocks read the cursor as an INCLUSIVE start
// block instead, so the anchored page 1 asked the RPC for `head + 1` — a
// block that cannot exist yet — and the whole list rendered "Failed to read
// block … from RPC" instead of the newest blocks once the anchor was
// adopted (which happens on the first head answer, i.e. on every load).
//
// The tests below drive the real service through a client stub that refuses
// blocks above the head, and assert the contract the view is written
// against: an exclusively-bounded page returns exactly the blocks below the
// cursor, consecutive pages tile without overlap or gap, and a page never
// reads past the head.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLatestBlocks } from '@/utils/blockRpcData';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/utils/realTimeData', () => ({ createRpcClient: vi.fn() }));

const HEAD = 100n;
const LIMIT = 20;

const blockFor = (blockNumber: bigint) => ({
  number: blockNumber,
  hash: `0xblock${blockNumber}`,
  parentHash: '0xparent',
  timestamp: 1_700_000_000n,
  miner: '0x9999999999999999999999999999999999999999',
  gasUsed: 21_000n,
  gasLimit: 30_000_000n,
  baseFeePerGas: 1n,
  size: 1000n,
  transactions: [],
});

const installClient = (): ReturnType<typeof vi.fn> => {
  const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => {
    if (blockNumber > HEAD) throw new Error(`Block ${blockNumber} not found`);
    return blockFor(blockNumber);
  });
  vi.mocked(createRpcClient).mockResolvedValue({
    getBlockNumber: vi.fn().mockResolvedValue(HEAD),
    getBlock,
  } as never);
  return getBlock;
};

const numbersOf = (blocks: { number: string }[]): number[] => blocks.map(b => Number(b.number));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getLatestBlocks cursor polarity', () => {
  it('page 1 under the view’s exclusive cursor is the head page, never a read above the head', async () => {
    installClient();

    const head = await getLatestBlocks(1, LIMIT);
    // views/Blocks/List.tsx: cursor = anchored.head - (page-1)*LIMIT + 1
    const anchored = await getLatestBlocks(1, LIMIT, HEAD + 1n);

    expect(numbersOf(anchored.blocks)).toEqual(numbersOf(head.blocks));
    expect(numbersOf(anchored.blocks)).toEqual(
      Array.from({ length: LIMIT }, (_, i) => Number(HEAD) - i),
    );
  });

  it('consecutive pages tile the block sequence with no duplicate and no gap', async () => {
    installClient();

    const page1 = await getLatestBlocks(1, LIMIT, HEAD + 1n);
    const page2 = await getLatestBlocks(1, LIMIT, HEAD - BigInt(LIMIT) + 1n);

    const p1 = numbersOf(page1.blocks);
    const p2 = numbersOf(page2.blocks);
    expect(Math.min(...p1) - 1).toBe(Math.max(...p2));
    expect(new Set([...p1, ...p2]).size).toBe(p1.length + p2.length);
  });

  it('caps the walk at genesis when the cursor is clamped to 1n', async () => {
    installClient();

    // views/Blocks/List.tsx clamps a cursor that would fall below the
    // genesis boundary up to 1n: that page re-reads block 0 and stops.
    const deepest = await getLatestBlocks(1, LIMIT, 1n);

    expect(numbersOf(deepest.blocks)).toEqual([0]);
  });
});
