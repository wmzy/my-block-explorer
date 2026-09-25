/**
 * Serialization utilities
 * JSON serialization for BigInt and other special types
 */

import { createLogger } from '../server/logger';

const logger = createLogger('serialization');

/**
 * Custom JSON serialization handling BigInt and circular references
 */
export function serializeForJson(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Track visited objects with a WeakSet to avoid cycles
  const seen = new WeakSet();

  try {
    return JSON.parse(
      JSON.stringify(obj, (key, value) => {
        // Skip properties like socket/parser that cause cycles
        if (
          key === 'socket'
          || key === 'parser'
          || key === '_socket'
          || key === 'req'
          || key === 'res'
          || key === 'client'
        ) {
          return '[Unserializable]';
        }

        if (typeof value === 'object' && value !== null) {
          // Check for circular references
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }

        // Handle BigInt
        if (typeof value === 'bigint') {
          return value.toString();
        }

        // Handle Date
        if (value instanceof Date) {
          return value.toISOString();
        }

        // Handle Error
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack,
          };
        }

        // Skip functions
        if (typeof value === 'function') {
          return '[Function]';
        }

        return value;
      }),
    );
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
 * Safe JSON response serialization
 */
export function safeJsonResponse(data: unknown): JsonLike {
  try {
    const result = serializeForJson(data);
    if (result === undefined) {
      return null;
    }
    return result;
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
 * Format block data for API responses
 */
export function formatBlockForApi(
  block: Record<string, unknown> | null,
): Record<string, unknown> | null {
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
 * Format transaction data for API responses
 */
export function formatTransactionForApi(
  transaction: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!transaction) return null;

  return {
    ...transaction,
    blockNumber: transaction.blockNumber != null ? String(transaction.blockNumber) : undefined,
    gasLimit: transaction.gasLimit != null ? String(transaction.gasLimit) : undefined,
    gasPrice: transaction.gasPrice != null ? String(transaction.gasPrice) : undefined,
    maxFeePerGas: transaction.maxFeePerGas != null ? String(transaction.maxFeePerGas) : undefined,
    maxPriorityFeePerGas:
      transaction.maxPriorityFeePerGas != null
        ? String(transaction.maxPriorityFeePerGas)
        : undefined,
    gasUsed: transaction.gasUsed != null ? String(transaction.gasUsed) : undefined,
    effectiveGasPrice:
      transaction.effectiveGasPrice != null ? String(transaction.effectiveGasPrice) : undefined,
    nonce: transaction.nonce != null ? String(transaction.nonce) : undefined,
    cumulativeGasUsed:
      transaction.cumulativeGasUsed != null ? String(transaction.cumulativeGasUsed) : undefined,
    timestamp:
      transaction.timestamp instanceof Date ? transaction.timestamp.toISOString() : undefined,
  };
}

/**
 * Format address data for API responses
 */
export function formatAddressForApi(
  address: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!address) return null;

  return {
    ...address,
    firstSeenBlock: address.firstSeenBlock != null ? String(address.firstSeenBlock) : undefined,
    lastSeenBlock: address.lastSeenBlock != null ? String(address.lastSeenBlock) : undefined,
    lastQueried:
      address.lastQueried instanceof Date ? address.lastQueried.toISOString() : undefined,
  };
}

/**
 * Format statistics data for API responses
 */
export function formatStatsForApi(
  stats: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!stats) return null;

  return {
    ...stats,
    latestBlock: stats.latestBlock != null ? String(stats.latestBlock) : undefined,
    totalBlocks: Number(stats.totalBlocks) || 0,
    totalTransactions: Number(stats.totalTransactions) || 0,
  };
}
