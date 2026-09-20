// Pending-transaction serialization tests (A1): a transaction that has not
// been mined yet carries blockNumber/transactionIndex null from the RPC,
// and the serializer must keep them null — the old '0'/0 fallbacks rendered
// "Block Number: 0" and produced /block/0 links. The real walk in
// utils/blockRpcData runs against a mocked RPC client (the only network
// edge), so getTransactionByHash exercises the genuine formatTransaction
// path for both the pending and the mined shape.
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getTransactionByHash } from '@/utils/blockRpcData';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(),
}));

const TX_HASH = '0xabc0000000000000000000000000000000000000000000000000000000000def';

// Minimal viem-shaped transaction objects — formatTransaction reads them
// as records, so only the fields under test need to be realistic.
const pendingRpcTx = {
  hash: TX_HASH,
  blockNumber: null,
  transactionIndex: null,
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
  value: 1_000_000_000_000_000_000n,
  gas: 21_000n,
  nonce: 7,
  type: 'eip1559',
  input: '0x',
};

const minedRpcTx = {
  ...pendingRpcTx,
  blockNumber: 18_000_001n,
  transactionIndex: 5,
};

const receipt = {
  status: 'success',
  gasUsed: 21_000n,
  effectiveGasPrice: 20_000_000_000n,
  logs: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getTransactionByHash block-position serialization', () => {
  it('serializes a pending transaction (null blockNumber) with null fields, not 0', async () => {
    const getBlock = vi.fn();
    vi.mocked(createRpcClient).mockResolvedValue({
      getTransaction: vi.fn().mockResolvedValue(pendingRpcTx),
      // No receipt yet: the RPC rejects and the fetch degrades to null.
      getTransactionReceipt: vi.fn().mockRejectedValue(new Error('not found')),
      getBlock,
    } as never);

    const tx = await getTransactionByHash(1, TX_HASH);

    // The core A1 contract: pending position is null, never '0'/0.
    expect(tx.blockNumber).toBeNull();
    expect(tx.transactionIndex).toBeNull();
    // Pending status rides the same honest-null story: -1, not failed.
    expect(tx.status).toBe(-1);
    // No block to read a timestamp from — and none is requested.
    expect(tx.timestamp).toBeUndefined();
    expect(getBlock).not.toHaveBeenCalled();
  });

  it('serializes a mined transaction with string blockNumber and numeric index', async () => {
    vi.mocked(createRpcClient).mockResolvedValue({
      getTransaction: vi.fn().mockResolvedValue(minedRpcTx),
      getTransactionReceipt: vi.fn().mockResolvedValue(receipt),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_700_000_000n }),
    } as never);

    const tx = await getTransactionByHash(1, TX_HASH);

    expect(tx.blockNumber).toBe('18000001');
    expect(tx.transactionIndex).toBe(5);
    expect(tx.status).toBe(1);
    expect(tx.timestamp).toBe(new Date(1_700_000_000_000).toISOString());
  });
});
