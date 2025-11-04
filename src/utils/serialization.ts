/**
 * 序列化工具
 * 处理BigInt等特殊类型的JSON序列化
 */

/**
 * 自定义JSON序列化，处理BigInt类型和循环引用
 */
export function serializeForJson(obj: any): any {
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
  } catch (error) {
    console.error('Serialization error for key:', key, 'value:', value, 'error:', error);
    return {
      error: 'Failed to serialize object',
      type: typeof obj,
      message: String(obj).substring(0, 100)
    };
  }
}

/**
 * 安全的JSON响应序列化
 */
export function safeJsonResponse(data: any): any {
  try {
    return serializeForJson(data);
  } catch (error) {
    console.error('JSON serialization error:', error);
    return {
      error: 'Serialization failed',
      message: 'Unable to serialize response data'
    };
  }
}

/**
 * 格式化区块数据用于API响应
 */
export function formatBlockForApi(block: any): any {
  if (!block) return null;
  
  return {
    ...block,
    number: block.number?.toString(),
    gasLimit: block.gasLimit?.toString(),
    gasUsed: block.gasUsed?.toString(),
    baseFeePerGas: block.baseFeePerGas?.toString(),
    timestamp: block.timestamp?.toISOString()
  };
}

/**
 * 格式化交易数据用于API响应
 */
export function formatTransactionForApi(transaction: any): any {
  if (!transaction) return null;
  
  return {
    ...transaction,
    blockNumber: transaction.blockNumber?.toString(),
    gasLimit: transaction.gasLimit?.toString(),
    gasPrice: transaction.gasPrice?.toString(),
    maxFeePerGas: transaction.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas?.toString(),
    gasUsed: transaction.gasUsed?.toString(),
    effectiveGasPrice: transaction.effectiveGasPrice?.toString(),
    nonce: transaction.nonce?.toString(),
    cumulativeGasUsed: transaction.cumulativeGasUsed?.toString(),
    timestamp: transaction.timestamp?.toISOString()
  };
}

/**
 * 格式化地址数据用于API响应
 */
export function formatAddressForApi(address: any): any {
  if (!address) return null;
  
  return {
    ...address,
    firstSeenBlock: address.firstSeenBlock?.toString(),
    lastSeenBlock: address.lastSeenBlock?.toString(),
    lastQueried: address.lastQueried?.toISOString()
  };
}

/**
 * 格式化统计数据用于API响应
 */
export function formatStatsForApi(stats: any): any {
  if (!stats) return null;
  
  return {
    ...stats,
    latestBlock: stats.latestBlock?.toString(),
    totalBlocks: Number(stats.totalBlocks) || 0,
    totalTransactions: Number(stats.totalTransactions) || 0
  };
}
