/**
 * 序列化工具
 * 处理BigInt等特殊类型的JSON序列化
 */

import { createLogger } from '../server/logger';

const logger = createLogger('serialization');

/**
 * 自定义JSON序列化，处理BigInt类型和循环引用
 */
export function serializeForJson(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // 使用WeakSet来跟踪已遍历的对象，避免循环引用
  const seen = new WeakSet();

  try {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
      // 跳过Socket、Parser等会导致循环引用的属性
      if (key === 'socket' || key === 'parser' || key === '_socket' || key === 'req' || key === 'res' || key === 'client') {
        return '[Unserializable]';
      }

      if (typeof value === 'object' && value !== null) {
        // 检查循环引用
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }

      // 处理BigInt
      if (typeof value === 'bigint') {
        return value.toString();
      }

      // 处理Date
      if (value instanceof Date) {
        return value.toISOString();
      }

      // 处理Error
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }

      // 跳过函数
      if (typeof value === 'function') {
        return '[Function]';
      }

      return value;
    }));
  }
  catch (error) {
    logger.error({ err: error }, 'Serialization error');
    return {
      error: 'Failed to serialize object',
      type: typeof obj,
      message: String(obj).substring(0, 100),
    };
  }
}

/** JSON-serializable value (result of JSON.parse) */
type JsonLike = object | string | number | boolean | null;

/**
 * 安全的JSON响应序列化
 */
export function safeJsonResponse(data: unknown): JsonLike {
  try {
    return serializeForJson(data);
  }
  catch (error) {
    logger.error({ err: error }, 'JSON serialization error');
    return {
      error: 'Serialization failed',
      message: 'Unable to serialize response data',
    };
  }
}

/**
 * 格式化区块数据用于API响应
 */
export function formatBlockForApi(block: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!block) return null;

  return {
    ...block,
    number: block.number != null ? String(block.number) : undefined,
    gasLimit: block.gasLimit != null ? String(block.gasLimit) : undefined,
    gasUsed: block.gasUsed != null ? String(block.gasUsed) : undefined,
    baseFeePerGas: block.baseFeePerGas != null ? String(block.baseFeePerGas) : undefined,
    timestamp: block.timestamp instanceof Date ? block.timestamp.toISOString() : undefined,
  };
}

/**
 * 格式化交易数据用于API响应
 */
export function formatTransactionForApi(transaction: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!transaction) return null;

  return {
    ...transaction,
    blockNumber: transaction.blockNumber != null ? String(transaction.blockNumber) : undefined,
    gasLimit: transaction.gasLimit != null ? String(transaction.gasLimit) : undefined,
    gasPrice: transaction.gasPrice != null ? String(transaction.gasPrice) : undefined,
    maxFeePerGas: transaction.maxFeePerGas != null ? String(transaction.maxFeePerGas) : undefined,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas != null ? String(transaction.maxPriorityFeePerGas) : undefined,
    gasUsed: transaction.gasUsed != null ? String(transaction.gasUsed) : undefined,
    effectiveGasPrice: transaction.effectiveGasPrice != null ? String(transaction.effectiveGasPrice) : undefined,
    nonce: transaction.nonce != null ? String(transaction.nonce) : undefined,
    cumulativeGasUsed: transaction.cumulativeGasUsed != null ? String(transaction.cumulativeGasUsed) : undefined,
    timestamp: transaction.timestamp instanceof Date ? transaction.timestamp.toISOString() : undefined,
  };
}

/**
 * 格式化地址数据用于API响应
 */
export function formatAddressForApi(address: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!address) return null;

  return {
    ...address,
    firstSeenBlock: address.firstSeenBlock != null ? String(address.firstSeenBlock) : undefined,
    lastSeenBlock: address.lastSeenBlock != null ? String(address.lastSeenBlock) : undefined,
    lastQueried: address.lastQueried instanceof Date ? address.lastQueried.toISOString() : undefined,
  };
}

/**
 * 格式化统计数据用于API响应
 */
export function formatStatsForApi(stats: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!stats) return null;

  return {
    ...stats,
    latestBlock: stats.latestBlock != null ? String(stats.latestBlock) : undefined,
    totalBlocks: Number(stats.totalBlocks) || 0,
    totalTransactions: Number(stats.totalTransactions) || 0,
  };
}
