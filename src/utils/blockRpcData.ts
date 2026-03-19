import { formatEther, type Block, type TransactionReceipt } from 'viem';
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
  gasUsed?: string;
  effectiveGasPrice?: string;
  nonce: string;
  status: number;
  type: number;
  timestamp?: string;
  inputData?: string;
  contractAddress?: string;
};

const formatBlock = (block: Block, includeTimestamp = true): RpcBlock => ({
  number: block.number.toString(),
  hash: block.hash!,
  parentHash: block.parentHash,
  timestamp: includeTimestamp
    ? new Date(Number(block.timestamp) * 1000).toISOString()
    : '',
  miner: (block as Record<string, unknown>).miner as string ?? '',
  gasUsed: block.gasUsed.toString(),
  gasLimit: block.gasLimit.toString(),
  baseFeePerGas: block.baseFeePerGas?.toString(),
  transactionCount: block.transactions.length,
  sizeBytes: Number(block.size),
  difficulty: block.difficulty?.toString(),
  totalDifficulty: block.totalDifficulty?.toString(),
  extraData: block.extraData,
  logsBloom: block.logsBloom,
  stateRoot: block.stateRoot,
  transactionsRoot: block.transactionsRoot,
  receiptsRoot: block.receiptsRoot,
});

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
  gasPrice: (tx.gasPrice as bigint)?.toString(),
  maxFeePerGas: (tx.maxFeePerGas as bigint)?.toString(),
  maxPriorityFeePerGas: (tx.maxPriorityFeePerGas as bigint)?.toString(),
  gasUsed: receipt?.gasUsed?.toString(),
  effectiveGasPrice: receipt?.effectiveGasPrice?.toString(),
  nonce: (tx.nonce as number)?.toString() ?? '0',
  status: receipt?.status === 'success' ? 1 : receipt ? 0 : -1,
  type: Number(tx.type ?? 0),
  timestamp: blockTimestamp
    ? new Date(Number(blockTimestamp) * 1000).toISOString()
    : undefined,
  inputData: tx.input as string,
  contractAddress: receipt?.contractAddress ?? undefined,
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
  const endBlock
    = startBlock - BigInt(count - 1) > 0n
      ? startBlock - BigInt(count - 1)
      : 0n;

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
export const getBlockByNumber = async (
  chainId: number,
  blockNumber: bigint,
): Promise<RpcBlock> => {
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

  const txObjects = block.transactions.filter(
    (tx): tx is Record<string, unknown> => typeof tx !== 'string',
  );

  const receipts = await Promise.all(
    txObjects.map(tx =>
      client
        .getTransactionReceipt({ hash: tx.hash })
        .catch(() => null),
    ),
  );

  return txObjects.map((tx, i) =>
    formatTransaction(tx, receipts[i], block.timestamp),
  );
};

/**
 * Fetch transactions from the most recent blocks.
 * Walks backwards through blocks until `count` transactions are collected.
 */
export const getLatestTransactions = async (
  chainId: number,
  count: number,
  beforeBlock?: bigint,
): Promise<{
  transactions: RpcTransaction[];
  latestBlockNumber: bigint;
}> => {
  const client = await createRpcClient(chainId);
  const latestBlockNumber = beforeBlock ?? (await client.getBlockNumber());

  const transactions: RpcTransaction[] = [];
  const maxBlocksToScan = 5;

  for (
    let n = latestBlockNumber;
    n > 0n && transactions.length < count && latestBlockNumber - n < maxBlocksToScan;
    n--
  ) {
    const blockTxs = await getBlockTransactions(chainId, n).catch(() => []);
    transactions.push(...blockTxs);
  }

  return {
    transactions: transactions.slice(0, count),
    latestBlockNumber,
  };
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
    client
      .getTransactionReceipt({ hash: txHash as `0x${string}` })
      .catch(() => null),
  ]);

  let blockTimestamp: bigint | undefined;
  if (tx.blockNumber) {
    const block = await client
      .getBlock({ blockNumber: tx.blockNumber })
      .catch(() => null);
    blockTimestamp = block?.timestamp;
  }

  return formatTransaction(
    tx as unknown as Record<string, unknown>,
    receipt,
    blockTimestamp,
  );
};
