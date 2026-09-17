import { type Block, type TransactionReceipt } from 'viem';
import { createRpcClient } from './realTimeData';

export type RpcBlock = {
  number: string;
  hash: string;
  parentHash: string;
  timestamp: string;
  miner: string;
  gasUsed: string;
  gasLimit: string;
  baseFeePerGas?: string;
  transactionCount: number;
  sizeBytes?: number;
  difficulty?: string;
  totalDifficulty?: string;
  extraData?: string;
  logsBloom?: string;
  stateRoot?: string;
  transactionsRoot?: string;
  receiptsRoot?: string;
};

// Receipt log entry carried through the RPC layer for decoded-events views.
export type RpcLogEntry = {
  address: string;
  topics: string[];
  data: string;
  logIndex?: string;
};

export type RpcTransaction = {
  hash: string;
  blockNumber: string;
  transactionIndex: number;
  fromAddress: string;
  toAddress: string;
  value: string;
  gasLimit: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  maxFeePerBlobGas?: string;
  blobVersionedHashes?: readonly string[];
  gasUsed?: string;
  effectiveGasPrice?: string;
  nonce: string;
  status: number;
  type: number;
  timestamp?: string;
  inputData?: string;
  contractAddress?: string;
  logs: RpcLogEntry[];
};

const formatBlock = (block: Block, includeTimestamp = true): RpcBlock => ({
  number: (block.number ?? 0n).toString(),
  hash: block.hash ?? '',
  parentHash: block.parentHash,
  timestamp: includeTimestamp ? new Date(Number(block.timestamp) * 1000).toISOString() : '',
  miner: ((block as Record<string, unknown>).miner as string) ?? '',
  gasUsed: block.gasUsed.toString(),
  gasLimit: block.gasLimit.toString(),
  baseFeePerGas: block.baseFeePerGas?.toString(),
  transactionCount: block.transactions.length,
  sizeBytes: Number(block.size),
  difficulty: block.difficulty?.toString(),
  totalDifficulty: block.totalDifficulty?.toString(),
  extraData: block.extraData,
  logsBloom: block.logsBloom ?? undefined,
  stateRoot: block.stateRoot ?? undefined,
  transactionsRoot: block.transactionsRoot ?? undefined,
  receiptsRoot: block.receiptsRoot ?? undefined,
});

// viem's tx.type is a label ('eip1559', …) or a hex string, never a plain
// number — Number('eip1559') is NaN and rendered as "Type NaN".
// Mirror of the backend's toDbTxType (TransactionService).
const toRpcTxType = (txType: unknown): number => {
  if (typeof txType === 'number') return txType;
  if (txType === 'eip2930') return 1;
  if (txType === 'eip1559') return 2;
  if (txType === 'eip4844') return 3;
  if (txType === 'eip7702') return 4;
  if (txType === 'legacy' || txType === undefined || txType === null) return 0;
  const parsed = Number(txType);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatTransaction = (
  tx: Record<string, unknown>,
  receipt: TransactionReceipt | null,
  blockTimestamp?: bigint,
): RpcTransaction => ({
  hash: tx.hash as string,
  blockNumber: (tx.blockNumber as bigint)?.toString() ?? '0',
  transactionIndex: Number(tx.transactionIndex ?? 0),
  fromAddress: (tx.from as string) ?? '',
  toAddress: (tx.to as string) ?? '',
  value: (tx.value as bigint)?.toString() ?? '0',
  gasLimit: (tx.gas as bigint)?.toString() ?? '0',
  gasPrice: (tx.gasPrice as bigint | undefined)?.toString(),
  maxFeePerGas: (tx.maxFeePerGas as bigint | undefined)?.toString(),
  maxPriorityFeePerGas: (tx.maxPriorityFeePerGas as bigint | undefined)?.toString(),
  // EIP-4844 (type 3) blob-transaction fields; absent on other types.
  maxFeePerBlobGas: (tx.maxFeePerBlobGas as bigint | undefined)?.toString(),
  blobVersionedHashes: (tx.blobVersionedHashes as readonly string[] | undefined) ?? undefined,
  gasUsed: receipt?.gasUsed?.toString(),
  effectiveGasPrice: receipt?.effectiveGasPrice?.toString(),
  nonce: (tx.nonce as number)?.toString() ?? '0',
  status: receipt?.status === 'success' ? 1 : receipt ? 0 : -1,
  type: toRpcTxType(tx.type),
  timestamp: blockTimestamp ? new Date(Number(blockTimestamp) * 1000).toISOString() : undefined,
  inputData: tx.input as string,
  contractAddress: receipt?.contractAddress ?? undefined,
  // viem's Log.topics is a readonly tuple — copy to a mutable array the
  // view layer can treat as plain string[]. Pending txs (null receipt)
  // have no logs yet, hence the empty-array fallback.
  logs:
    receipt?.logs.map(log => ({
      address: log.address,
      topics: [...log.topics],
      data: log.data,
      logIndex: log.logIndex?.toString(),
    })) ?? [],
});

/**
 * Fetch the latest N blocks directly from RPC.
 * Paginates by walking backwards from the latest block number.
 */
export const getLatestBlocks = async (
  chainId: number,
  count: number,
  beforeBlock?: bigint,
): Promise<{ blocks: RpcBlock[]; latestBlockNumber: bigint }> => {
  const client = await createRpcClient(chainId);
  const latestBlockNumber = beforeBlock ?? (await client.getBlockNumber());

  const startBlock = latestBlockNumber;
  const endBlock = startBlock - BigInt(count - 1) > 0n ? startBlock - BigInt(count - 1) : 0n;

  const blockNumbers: bigint[] = [];
  for (let n = startBlock; n >= endBlock; n--) {
    blockNumbers.push(n);
  }

  const blocks = await Promise.all(
    blockNumbers.map(n =>
      client
        .getBlock({ blockNumber: n })
        .then(b => formatBlock(b))
        .catch(() => null),
    ),
  );

  return {
    blocks: blocks.filter((b): b is RpcBlock => b !== null),
    latestBlockNumber,
  };
};

/**
 * Fetch a single block by number directly from RPC.
 */
export const getBlockByNumber = async (chainId: number, blockNumber: bigint): Promise<RpcBlock> => {
  const client = await createRpcClient(chainId);
  const block = await client.getBlock({ blockNumber });
  return formatBlock(block);
};

/**
 * Fetch all transactions in a block with their receipts.
 */
export const getBlockTransactions = async (
  chainId: number,
  blockNumber: bigint,
): Promise<RpcTransaction[]> => {
  const client = await createRpcClient(chainId);
  const block = await client.getBlock({
    blockNumber,
    includeTransactions: true,
  });

  if (!block.transactions.length) return [];

  const txObjects = block.transactions.filter(tx => typeof tx !== 'string') as {
    hash: `0x${string}`;
  }[];

  const receipts = await Promise.all(
    txObjects.map(tx => client.getTransactionReceipt({ hash: tx.hash }).catch(() => null)),
  );

  return txObjects.map((tx, i) =>
    formatTransaction(tx as unknown as Record<string, unknown>, receipts[i], block.timestamp),
  );
};

// Composite transaction cursor: blockNumber * SCALE + transactionIndex.
// transactionIndex stays far below 1M on real chains, so the encoding is
// injective and compares identically to the (blockNumber, index) pair.
export const TX_CURSOR_SCALE = 1_000_000n;

// Per-page scan cap: without it a sparse or dead chain would walk its whole
// history inside a single request.
const MAX_SCAN_BLOCKS = 100;

/**
 * Cursor whose page starts at `blockNumber` and walks down: the position
 * (blockNumber + 1, 0) skips block `blockNumber` + 1 entirely (no
 * transaction index is below 0) and collects `blockNumber` and older blocks
 * in full — the initial cursor for a `?block=N` deep link.
 */
export const txCursorFromBlock = (blockNumber: bigint | number): bigint =>
  (BigInt(blockNumber) + 1n) * TX_CURSOR_SCALE;

/**
 * Fetch the most recent transactions directly from RPC.
 *
 * The cursor encodes a (blockNumber, transactionIndex) position and the page
 * collects transactions strictly OLDER than that position: within the cursor
 * block only indices below the cursor's index qualify, older blocks qualify
 * in full. Omit the cursor for the head page (start at the chain head). The
 * walk visits blocks downwards — skipping empty ones — until it fills
 * `count`, reaches genesis (block 0), or hits the per-page scan cap, so
 * dense chains no longer drop transactions mid-page and sparse chains page
 * past empty blocks instead of ending early.
 */
export const getLatestTransactions = async (
  chainId: number,
  count: number,
  cursor?: bigint,
): Promise<{
  transactions: RpcTransaction[];
  latestBlockNumber: bigint;
  /** false only when the walk consumed every block down to genesis. */
  hasMore: boolean;
  /** Continuation cursor for the next page; undefined when hasMore is false. */
  nextCursor: bigint | undefined;
}> => {
  const client = await createRpcClient(chainId);
  const latestBlockNumber = await client.getBlockNumber();

  // Decode the composite cursor. A negative cursor is malformed and falls
  // back to the head; a cursor block above the current head (stale deep
  // link) means "everything from the head down", which is exactly the
  // head page — dropping the cursor collects the head block in full (an
  // index-0 cursor on the head block would skip it entirely).
  let cursorBlock: bigint | undefined;
  let cursorIndex = 0;
  if (cursor !== undefined && cursor >= 0n) {
    cursorBlock = cursor / TX_CURSOR_SCALE;
    cursorIndex = Number(cursor % TX_CURSOR_SCALE);
    if (cursorBlock > latestBlockNumber) {
      cursorBlock = undefined;
      cursorIndex = 0;
    }
  }

  const transactions: RpcTransaction[] = [];
  const startBlock = cursorBlock ?? latestBlockNumber;
  let stopBlock = startBlock;
  let scannedBlocks = 0;
  let reachedGenesis = false;

  for (let n = startBlock; n >= 0n; n--) {
    stopBlock = n;
    const blockTxs = await getBlockTransactions(chainId, n).catch(() => []);
    // Page order is strictly descending (blockNumber, transactionIndex) —
    // newest first — so consecutive cursor pages tile the sequence with no
    // duplicate and no gap.
    blockTxs.sort((a, b) => b.transactionIndex - a.transactionIndex);
    for (const tx of blockTxs) {
      // Cursor block: only the portion with an index below the cursor's.
      if (n === cursorBlock && tx.transactionIndex >= cursorIndex) continue;
      transactions.push(tx);
      if (transactions.length >= count) break;
    }
    scannedBlocks += 1;

    if (n === 0n) {
      // Genesis block consumed: nothing older than the start position
      // exists, so the sequence is exhausted.
      reachedGenesis = true;
      break;
    }
    if (transactions.length >= count) break;
    if (scannedBlocks >= MAX_SCAN_BLOCKS) break;
  }

  // Boundary semantics: hasMore is false only when the walk reached genesis
  // — every block down to 0 was consumed, so no older transaction can exist.
  // Early stops (the LIMIT cut or the per-page scan cap) leave possible
  // transactions below them, so they report true.
  const hasMore = !reachedGenesis;

  // Continuation cursor: when the LIMIT cut the walk, the oldest returned
  // transaction's own position resumes exactly below it (its block keeps the
  // indices below its index, then older blocks). When the scan cap stopped
  // the walk every scanned block was fully consumed, so the position
  // (stopBlock, 0) skips it and resumes from the block below — empty
  // stretches therefore keep paging instead of dead-ending.
  let nextCursor: bigint | undefined;
  if (hasMore) {
    const oldest = transactions.length >= count ? transactions[count - 1] : undefined;
    nextCursor =
      oldest !== undefined
        ? BigInt(oldest.blockNumber) * TX_CURSOR_SCALE + BigInt(oldest.transactionIndex)
        : stopBlock * TX_CURSOR_SCALE;
  }

  return { transactions, latestBlockNumber, hasMore, nextCursor };
};

/**
 * Fetch a single transaction by hash with its receipt.
 */
export const getTransactionByHash = async (
  chainId: number,
  txHash: string,
): Promise<RpcTransaction> => {
  const client = await createRpcClient(chainId);
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: txHash as `0x${string}` }),
    client.getTransactionReceipt({ hash: txHash as `0x${string}` }).catch(() => null),
  ]);

  let blockTimestamp: bigint | undefined;
  if (tx.blockNumber) {
    const block = await client.getBlock({ blockNumber: tx.blockNumber }).catch(() => null);
    blockTimestamp = block?.timestamp;
  }

  return formatTransaction(tx, receipt, blockTimestamp);
};
