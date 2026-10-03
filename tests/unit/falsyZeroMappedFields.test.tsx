// A zero quantity read as an ABSENT one — the third pair of the class
// fixed in tests/unit/falsyZeroWritePath.test.ts (genesis tx blockNumber,
// genesis tx nonce, genesis-only getBlockStats latestBlock), found in the
// row→API mappers instead of the write path.
//
// `x ? x : undefined` / `x || undefined` on a value that can legitimately
// be 0 does not "guard" anything: it deletes the field, and every
// consumer then has to guess. Two live sites:
//
//   1. BlockService.formatBlock mapped the two integer columns that way
//      (`transactionCount: (get(...) as number) || undefined`), while the
//      BIGNUM columns one line above use `get(...) ? BigInt(...) :
//      undefined` and are safe ONLY because a bignum zero arrives as the
//      truthy string "0". An empty block stored transaction_count = 0, so
//      the API dropped the key entirely: views/Blocks/List renders a blank
//      Txs cell, the Detail page links "View  Transactions", and
//      InternalTxnsSection (every branch keyed on transactionCount === 0 /
//      > 0) renders NO state at all instead of its honest "this block
//      contains no transactions". The OpenAPI spec declares the field
//      required.
//   2. IndexingRangeManager's progress math tested `if (!range.currentBlock)`
//      and gated its Progress row on `range.currentBlock &&`, so a range
//      genuinely checkpointed at block 0 (a backward range that walked
//      down to genesis) reported 0% and then dropped the whole Progress
//      line. The module's own furthestIndexedBlock/EventStatistics
//      siblings use `!== null`, and the DTO's currentBlock is `bigint |
//      null`, so `0n` is a real walked position, not an absence.
//
// These drive the real service factory and the real component, so they
// assert what the API and the DOM actually carry.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBlockService } from '@/services/BlockService';
import { formatBlockForApi } from '@/utils/serialization';

// The HTTP layer is mocked before the component under test imports it
// (same convention as tests/unit/indexingRangeManager.test.tsx).
const { mockGet, mockPost, mockDel } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockDel: vi.fn(),
}));

vi.mock('@/util/http', () => ({
  get: mockGet,
  post: mockPost,
  del: mockDel,
  put: vi.fn(),
}));

const CHAIN_ID = 1;
const ADDR = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const rangesUrl = `/api/chains/${CHAIN_ID}/contracts/${ADDR}/events/ranges`;
const statusUrl = `${rangesUrl.replace(/\/ranges$/, '')}/indexing-status`;
const HASH = '0xfeed0000000000000000000000000000000000000000000000000000000000ff';

// The component's polled range list; the BlockService tests never fetch.
let ranges: unknown[] = [];

beforeEach(() => {
  ranges = [];
  mockGet.mockReset().mockImplementation(async (url: string) => {
    if (url === rangesUrl) return { ranges };
    if (url === statusUrl) return { latestBlock: 30_000 };
    return {};
  });
  mockPost.mockReset().mockResolvedValue({});
  mockDel.mockReset();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asAny = (value: unknown): any => value;

const chainable = (rows: unknown[]): unknown => {
  const node: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy', 'limit', 'offset', 'groupBy']) {
    node[method] = () => node;
  }
  node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return node;
};

// The stored row of a block that contained no transactions: both integer
// columns are 0 (indexBlock writes transactions.length and the byte size).
const emptyBlockRow = {
  chainId: CHAIN_ID,
  number: 0n,
  hash: HASH,
  parentHash: '0xparent',
  gasLimit: 30_000_000n,
  gasUsed: 0n,
  transactionCount: 0,
  sizeBytes: 540,
  timestamp: 1_700_000_000,
  indexedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const makeBlockService = (row: Record<string, unknown>) =>
  createBlockService({
    db: { select: () => chainable([row]) } as never,
    blocks: asAny({}),
    rpcManager: asAny({}),
    blockCache: { get: () => undefined, set: () => undefined },
    createRetryableRpcCall: ((fn: unknown) => fn) as never,
    createRetryableDbCall: ((fn: unknown) => fn) as never,
    logError: () => undefined,
  } as never);

describe('BlockService.formatBlock — a stored zero is a value, not an absence', () => {
  it('reports transactionCount 0 for an empty block instead of dropping the field', async () => {
    const service = makeBlockService(emptyBlockRow);

    const block = await service.getBlockByNumber(CHAIN_ID, 0n);

    expect(block?.transactionCount).toBe(0);
    expect(block?.sizeBytes).toBe(540);
  });

  it('serves 0 over the API instead of an absent key', async () => {
    const service = makeBlockService(emptyBlockRow);

    const block = await service.getBlockByNumber(CHAIN_ID, 0n);
    const payload = formatBlockForApi(block);

    // The key must EXIST: views/Blocks/List renders `{block.transactionCount}`
    // and InternalTxnsSection branches on `transactionCount === 0`.
    expect(Object.hasOwn(payload ?? {}, 'transactionCount')).toBe(true);
    expect(payload?.transactionCount).toBe(0);
  });

  it('still reports a genuinely unknown size as absent', async () => {
    const service = makeBlockService({ ...emptyBlockRow, sizeBytes: null });

    const block = await service.getBlockByNumber(CHAIN_ID, 0n);

    expect(block?.transactionCount).toBe(0);
    expect(block?.sizeBytes).toBeUndefined();
  });
});

describe('IndexingRangeManager walked progress from the checkpoint', () => {
  // currentBlock is the LAST COVERED block (the walk checkpoints batchTo
  // going forward and batchFrom going backward), clipped into the range
  // bounds. A backward walk runs from toBlock down to fromBlock, so a
  // backward range that reached genesis is `fromBlock: 0` with
  // `currentBlock: 0n` — fully covered, and `0n` is a real walked
  // position, not "progress unknown".
  const backwardRange = {
    chainId: CHAIN_ID,
    address: ADDR,
    rangeId: 3,
    fromBlock: 0n,
    toBlock: 20_000n,
    direction: 'backward' as const,
    currentBlock: 0n,
    status: 'indexing' as const,
    totalEventsIndexed: 0,
    errorMessage: null,
    priority: 0,
    createdAt: null,
    updatedAt: null,
  };

  // A FORWARD range that just checkpointed its middle block: block 10,000
  // is covered, so 10,001 of 20,001 blocks — 50%. The old arithmetic
  // counted `current - from`, reporting 50% only by accident of the
  // rounding; at the far end of a range the same off-by-one printed 100%
  // one block early.
  const forwardRange = { ...backwardRange, direction: 'forward' as const, currentBlock: 10_000n };

  // A PAUSED range can carry a checkpoint PAST its end bound: the walk
  // aborts with `currentBlock` already stepped past the last batch, and
  // that value is what gets persisted. The old unclamped
  // `current - from + 1` then printed 105% — progress above 100% is not a
  // rendering, it is arithmetic claiming more blocks than the range has.
  // (A completed range never renders this row — the checkpointed statuses
  // are indexing/paused/error — and always reports a full span.)
  const pausedPastEnd = { ...forwardRange, currentBlock: 21_000n, status: 'paused' as const };

  const renderProgress = async () => {
    const { render, screen } = await import('@testing-library/react');
    const { default: IndexingRangeManager } = await import('@/components/events/IndexingRangeManager');

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDR} />);

    // The row must be present at all: `range.currentBlock && (...)` dropped
    // the entire block for a 0n checkpoint.
    const node = await screen.findByText(/Progress:/);
    return node.textContent ?? '';
  };

  it('reports a backward range that reached genesis as fully covered', async () => {
    ranges = [backwardRange];
    expect(await renderProgress()).toContain('100%');
  });

  it('counts the checkpointed block itself (inclusive covered prefix)', async () => {
    ranges = [forwardRange];
    // 10,001 of 20,001 blocks.
    expect(await renderProgress()).toContain('50%');
  });

  it('never reports more than 100% for a checkpoint that overshoots the end bound', async () => {
    ranges = [pausedPastEnd];
    const text = await renderProgress();
    expect(text).toContain('100%');
    expect(text).not.toContain('101%');
    expect(text).not.toContain('105%');
  });
});
