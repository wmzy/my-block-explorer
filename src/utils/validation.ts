// 验证工具函数

import { isAddress, isHash } from 'viem';

/**
 * 验证以太坊地址
 */
export function isValidAddress(address: string): boolean {
  return isAddress(address);
}

/**
 * 验证交易哈希
 */
export function isValidTransactionHash(hash: string): boolean {
  return isHash(hash);
}

/**
 * 验证区块哈希
 */
export function isValidBlockHash(hash: string): boolean {
  return isHash(hash);
}

/**
 * 验证区块号
 */
export function isValidBlockNumber(blockNumber: string | number): boolean {
  const num = typeof blockNumber === 'string' ? parseInt(blockNumber, 10) : blockNumber;
  return !isNaN(num) && num >= 0 && num <= Number.MAX_SAFE_INTEGER;
}

/**
 * 验证链ID
 */
export function isValidChainId(chainId: string | number): boolean {
  const num = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId;
  return !isNaN(num) && num > 0;
}

/**
 * 验证分页参数
 */
export function validatePaginationParams(page?: string | number, limit?: string | number) {
  const pageNum = typeof page === 'string' ? parseInt(page, 10) : (page ?? 1);
  const limitNum = typeof limit === 'string' ? parseInt(limit, 10) : (limit ?? 20);

  if (isNaN(pageNum) || pageNum < 1) {
    throw new Error('Page must be a positive integer');
  }

  if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
    throw new Error('Limit must be between 1 and 100');
  }

  return { page: pageNum, limit: limitNum };
}

/**
 * 检测搜索输入类型
 */
export function detectSearchType(input: string): 'address' | 'hash' | 'block' | 'unknown' {
  if (!input || typeof input !== 'string') return 'unknown';

  const trimmed = input.trim();

  // 地址检测
  if (isValidAddress(trimmed)) {
    return 'address';
  }

  // 哈希检测 (交易或区块哈希)
  if (isValidTransactionHash(trimmed) || isValidBlockHash(trimmed)) {
    return 'hash';
  }

  // 区块号检测
  if (/^\d+$/.test(trimmed) && isValidBlockNumber(trimmed)) {
    return 'block';
  }

  return 'unknown';
}

/**
 * 清理和规范化输入
 */
export function sanitizeInput(input: string): string {
  if (!input || typeof input !== 'string') return '';

  // 移除首尾空格并转换为小写（除了需要保持大小写的情况）
  let cleaned = input.trim();

  // 对于地址和哈希，确保以0x开头
  if (/^[a-fA-F0-9]{40}$/.test(cleaned)) {
    cleaned = `0x${cleaned}`;
  }
  else if (/^[a-fA-F0-9]{64}$/.test(cleaned)) {
    cleaned = `0x${cleaned}`;
  }

  return cleaned;
}

/**
 * 验证时间范围
 */
export function validateTimeRange(from?: string, to?: string) {
  if (!from && !to) return { from: undefined, to: undefined };

  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;

  if (from && isNaN(fromDate!.getTime())) {
    throw new Error('Invalid from date format');
  }

  if (to && isNaN(toDate!.getTime())) {
    throw new Error('Invalid to date format');
  }

  if (fromDate && toDate && fromDate > toDate) {
    throw new Error('From date must be before to date');
  }

  return { from: fromDate, to: toDate };
}

/**
 * 验证区块范围
 */
export function validateBlockRange(fromBlock?: string | number, toBlock?: string | number) {
  if (!fromBlock && !toBlock) return { fromBlock: undefined, toBlock: undefined };

  const from = fromBlock
    ? typeof fromBlock === 'string'
      ? parseInt(fromBlock, 10)
      : fromBlock
    : undefined;
  const to = toBlock ? (typeof toBlock === 'string' ? parseInt(toBlock, 10) : toBlock) : undefined;

  if (fromBlock && (isNaN(from!) || from! < 0)) {
    throw new Error('Invalid from block number');
  }

  if (toBlock && (isNaN(to!) || to! < 0)) {
    throw new Error('Invalid to block number');
  }

  if (from && to && from > to) {
    throw new Error('From block must be before to block');
  }

  return { fromBlock: from, toBlock: to };
}
