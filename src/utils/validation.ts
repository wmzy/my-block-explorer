// Validation utility functions

import { isAddress, isHash } from 'viem';
import { normalize } from 'viem/ens';

/**
 * Validate an Ethereum address
 */
export function isValidAddress(address: string): boolean {
  return isAddress(address);
}

/**
 * Validate a transaction hash
 */
export function isValidTransactionHash(hash: string): boolean {
  return isHash(hash);
}

/**
 * Validate a block hash
 */
export function isValidBlockHash(hash: string): boolean {
  return isHash(hash);
}

/**
 * Validate a block number
 */
export function isValidBlockNumber(blockNumber: string | number): boolean {
  const num = typeof blockNumber === 'string' ? parseInt(blockNumber, 10) : blockNumber;
  return !isNaN(num) && num >= 0 && num <= Number.MAX_SAFE_INTEGER;
}

/**
 * Validate a chain ID
 */
export function isValidChainId(chainId: string | number): boolean {
  const num = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId;
  return !isNaN(num) && num > 0;
}

/**
 * Validate pagination parameters
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
 * Detect the type of a search input
 */
export function detectSearchType(
  input: string,
): 'address' | 'hash' | 'block' | 'ens' | 'unknown' {
  if (!input || typeof input !== 'string') return 'unknown';

  const trimmed = input.trim();

  // Address detection
  if (isValidAddress(trimmed)) {
    return 'address';
  }

  // Hash detection (transaction or block hash)
  if (isValidTransactionHash(trimmed) || isValidBlockHash(trimmed)) {
    return 'hash';
  }

  // Block number detection
  if (/^\d+$/.test(trimmed) && isValidBlockNumber(trimmed)) {
    return 'block';
  }

  // ENS name detection (e.g. 'vitalik.eth', 'a.b.eth', '日本.eth'). ENS
  // names are resolved in the browser against a mainnet client; consumers
  // must handle the 'ens' type without a server round-trip. Validity is
  // ENSIP-15: viem's normalize accepts the full Unicode name space (IDN
  // labels, emoji) and throws on malformed names, so exotic-but-valid
  // names classify as 'ens' while junk stays 'unknown'.
  if (/\.eth$/i.test(trimmed)) {
    try {
      if (normalize(trimmed).endsWith('.eth')) return 'ens';
    } catch {
      // Not a valid ENS name — falls through to 'unknown'.
    }
  }

  return 'unknown';
}

/**
 * Clean and normalize input: trim surrounding whitespace and prefix '0x' onto
 * bare 40/64-character hex strings. Letter case is preserved (EVM hex values
 * are case-insensitive, but checksummed addresses keep their casing).
 */
export function sanitizeInput(input: string): string {
  if (!input || typeof input !== 'string') return '';

  let cleaned = input.trim();

  // Ensure addresses and hashes start with '0x'
  if (/^[a-fA-F0-9]{40}$/.test(cleaned)) {
    cleaned = `0x${cleaned}`;
  }
  else if (/^[a-fA-F0-9]{64}$/.test(cleaned)) {
    cleaned = `0x${cleaned}`;
  }

  return cleaned;
}

/**
 * Validate a time range
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
 * Validate a block range
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
