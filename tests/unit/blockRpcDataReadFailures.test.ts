// Per-item RPC read failures in the RPC-direct transaction walk.
//
// The walk paged the chain's blocks with `getBlockTransactions(...).catch(()
// => [])`, i.e. a transport failure on ONE block was indistinguishable from
// "this block is empty": the walk recorded an empty block, advanced the
// cursor past it, and the page's `hasMore`/`nextCursor` still claimed the
// (blockNumber, transactionIndex) sequence tiles with no gap — those
// transactions were silently unreachable forever. `getLatestBlocks` did the
// same with `.catch(() => null)` (a silently shorter list).
//
// The receipt read had the sibling hole: ANY failure became `null`, which
// `formatTransaction` reads as status -1 ("no receipt yet"), so a transport
// hiccup turned a mined transaction into a "receipt unknown" row for the
// whole page render.
//
// A read that is retried once still fails => the failure must surface (the
// list/feed views already render an error + Retry), never be laundered into
// an empty block. A read that succeeds on the retry must keep its data.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getBlockTransactions,
  getLatestBlocks,
  getLatestTransactions,
} from '@/utils/blockRpcData';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/utils/realTimeData', () => ({ createRpcClient: vi.fn() }));

const HEAD = 102n;
const TX_HASH = '0xaaa0000000000000000000000000000000000000000000000000000000000001';

const txIn = (blockNumber: bigint) => ({
  hash: TX_HASH,
  blockNumber,
  transactionIndex: 0,
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
  value: 1_000n,
  gas: 21_000n,
  nonce: 0,
  type: 'eip1559',
  input: '0x',
});

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
  transactions: blockNumber === HEAD - 2n ? [txIn(blockNumber)] : [],
});

const receipt = { status: 'success', gasUsed: 21_000n, effectiveGasPrice: 2n, logs: [] };

const notFoundError = () => {
  const error = new Error(`Transaction with hash "${TX_HASH}" could not be found.`);
  error.name = 'TransactionReceiptNotFoundError';
  return error;
};

type ClientStub = {
  getBlockNumber: ReturnType<typeof vi.fn>;
  getBlock: ReturnType<typeof vi.fn>;
  getTransactionReceipt: ReturnType<typeof vi.fn>;
};

const installClient = (overrides: Partial<ClientStub> = {}): ClientStub => {
  const client: ClientStub = {
    getBlockNumber: vi.fn().mockResolvedValue(HEAD),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => blockFor(blockNumber)),
    getTransactionReceipt: vi.fn().mockResolvedValue(receipt),
    ...overrides,
  };
  vi.mocked(createRpcClient).mockResolvedValue(client as never);
  return client;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getLatestTransactions block-read failures', () => {
  it('rejects instead of silently skipping a block whose read keeps failing', async () => {
    installClient({
      getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => {
        if (blockNumber === HEAD - 2n) throw new Error('rate limited');
        return blockFor(blockNumber);
      }),
    });

    // The block holds a transaction; dropping it silently loses that tx for
    // good (the returned cursor pages past it).
    await expect(getLatestTransactions(1, 5)).rejects.toThrow(/block 100/i);
  });

  it('keeps the block’s transactions when the read fails once and then succeeds', async () => {
    let attempts = 0;
    const client = installClient({
      getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => {
        if (blockNumber === HEAD - 2n && attempts++ === 0) throw new Error('transient');
        return blockFor(blockNumber);
      }),
    });

    const page = await getLatestTransactions(1, 5);

    expect(page.transactions.map(tx => tx.hash)).toContain(TX_HASH);
    // The retry is a real second attempt, and only for the flaky block.
    const readsOfFlakyBlock = client.getBlock.mock.calls.filter(
      ([arg]) => (arg as { blockNumber: bigint }).blockNumber === HEAD - 2n,
    );
    expect(readsOfFlakyBlock).toHaveLength(2);
  });
});

describe('getLatestBlocks block-read failures', () => {
  it('rejects instead of returning a silently shorter block list', async () => {
    installClient({
      getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => {
        if (blockNumber === HEAD - 1n) throw new Error('rate limited');
        return blockFor(blockNumber);
      }),
    });

    await expect(getLatestBlocks(1, 3)).rejects.toThrow(/block 101/i);
  });
});

describe('receipt-read failures', () => {
  it('retries a transport failure and keeps the receipt-derived status', async () => {
    const getTransactionReceipt = vi
      .fn()
      .mockRejectedValueOnce(new Error('gateway timeout'))
      .mockResolvedValueOnce(receipt);
    installClient({ getTransactionReceipt });

    const [tx] = await getBlockTransactions(1, HEAD - 2n);

    expect(tx.status).toBe(1);
    expect(tx.gasUsed).toBe('21000');
    expect(getTransactionReceipt).toHaveBeenCalledTimes(2);
  });

  it('does not retry the not-found answer a genuinely pending tx gets', async () => {
    const getTransactionReceipt = vi.fn().mockRejectedValue(notFoundError());
    installClient({ getTransactionReceipt });

    const [tx] = await getBlockTransactions(1, HEAD - 2n);

    // No receipt yet: honest status -1, and exactly one attempt (a pending
    // tx must not cost double RPC traffic).
    expect(tx.status).toBe(-1);
    expect(getTransactionReceipt).toHaveBeenCalledTimes(1);
  });
});
