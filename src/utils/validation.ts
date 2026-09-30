// Validation utility functions

import { isAddress, isHash } from 'viem';
import { normalize } from 'viem/ens';

// parseInt() accepts a valid prefix and ignores the rest, so "12abc",
// "0x1a", "1e5" and " 7 " all came back as 12/26/100000/7 — junk reached
// the RPC layer and silently addressed the WRONG block or chain. Every
// numeric string in this module must be a plain run of decimal digits.
const DECIMAL_INTEGER = /^\d+$/;

/**
 * Parse a plain decimal integer, or null when the input is not one.
 * Numbers pass through when finite and integral.
 *
 * Exported for the route query-param parsers (routes/{blocks,transactions,
 * contracts,addresses,events}.ts), which had the same parseInt prefix
 * acceptance: `?limit=20abc` was served as limit 20 instead of the 400
 * those parsers' own comments promise.
 */
export function parseStrictInteger(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value !== 'string' || !DECIMAL_INTEGER.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

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
  const num = parseStrictInteger(blockNumber);
  return num !== null && num >= 0;
}

/**
 * Validate a chain ID
 */
export function isValidChainId(chainId: string | number): boolean {
  const num = parseStrictInteger(chainId);
  return num !== null && num > 0;
}

/**
 * Validate pagination parameters
 */
export function validatePaginationParams(page?: string | number, limit?: string | number) {
  const pageNum = page === undefined ? 1 : parseStrictInteger(page);
  const limitNum = limit === undefined ? 20 : parseStrictInteger(limit);

  if (pageNum === null || pageNum < 1) {
    throw new Error('Page must be a positive integer');
  }

  if (limitNum === null || limitNum < 1 || limitNum > 100) {
    throw new Error('Limit must be between 1 and 100');
  }

  return { page: pageNum, limit: limitNum };
}

/**
 * Detect the type of a search input
 */
export function detectSearchType(input: string): 'address' | 'hash' | 'block' | 'ens' | 'unknown' {
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

  // ENS name detection (e.g. 'vitalik.eth', 'a.b.eth', 'übär.eth'). ENS
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
  } else if (/^[a-fA-F0-9]{64}$/.test(cleaned)) {
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
  if (fromBlock === undefined && toBlock === undefined) {
    return { fromBlock: undefined, toBlock: undefined };
  }

  // Absence is decided by undefined, never by truthiness: block 0 is
  // genesis, a real bound. The old `fromBlock ? … : undefined` guard
  // dropped a 0 from bound (so the span silently widened to the head) and
  // skipped the from>to check whenever either side was 0, letting
  // validateBlockRange(10, 0) return an inverted range.
  const from = fromBlock === undefined ? undefined : parseStrictInteger(fromBlock);
  const to = toBlock === undefined ? undefined : parseStrictInteger(toBlock);

  if (from !== undefined && (from === null || from < 0)) {
    throw new Error('Invalid from block number');
  }

  if (to !== undefined && (to === null || to < 0)) {
    throw new Error('Invalid to block number');
  }

  // Past the guards both bounds are undefined or a non-negative integer.
  if (from !== undefined && to !== undefined && from !== null && to !== null && from > to) {
    throw new Error('From block must be before to block');
  }

  return { fromBlock: from ?? undefined, toBlock: to ?? undefined };
}
