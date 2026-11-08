// Validation utility functions

import { isAddress, isHash } from 'viem';
import { normalize } from 'viem/ens';

import { isChainSupported } from '../config/chains';
import { addressVerdict } from './address';
import { parseStrictInteger } from './strictInteger';

/**
 * Parse a plain decimal integer, or null when the input is not one.
 * Numbers pass through when finite and integral.
 *
 * Exported for the route query-param parsers (routes/{blocks,transactions,
 * contracts,addresses,events}.ts), which had the same parseInt prefix
 * acceptance: `?limit=20abc` was served as limit 20 instead of the 400
 * those parsers' own comments promise.
 *
 * The implementation lives in ./strictInteger (import-free) so the CLI
 * can share this one definition without pulling viem into its entry graph;
 * re-exported here because this module is the canonical import site.
 * parseInt() accepted a valid prefix and ignored the rest, so "12abc",
 * "0x1a", "1e5" and " 7 " all came back as 12/26/100000/7 — junk reached
 * the RPC layer and silently addressed the WRONG block or chain.
 */
export { parseStrictInteger };

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
 * Options for parsePaginationParams. Every row encodes an observed
 * divergence between the four former per-route implementations; the
 * defaults are the blocks/transactions/contracts majority.
 */
export type PaginationParseOptions = {
  /**
   * Upper bound for the limit after the minimum-1 check. Omitted = no
   * cap (no live site omits it for a real limit param; the address
   * export passes none because it takes no limit at all).
   */
  maxLimit?: number;
  /**
   * Limit served when ?limit= is absent or empty. 20 (blocks/
   * transactions / the address transactions list); 50 (contracts
   * directory, address internal-transactions).
   */
  defaultLimit?: number;
  /**
   * Over-cap limit handling. 'clamp' (default — blocks, transactions,
   * the address endpoints) serves the cap; 'reject' 400s (contracts
   * directory: its page always asks for the fixed page size, so an
   * over-cap ask is a client bug worth surfacing, not silently
   * shrinking).
   */
  limitOverCap?: 'clamp' | 'reject';
  /**
   * Upper bound for the offset. Omitted = uncapped (the address export
   * chunks by its own row budget and the internal-transactions page is
   * bounded by the scan's findings, so neither carries a scan-depth
   * cap).
   */
  maxOffset?: number;
  /**
   * Value served when the offset param is absent or empty. 0 for offset
   * sites; 1 for the page-shaped slot (the address list's ?page=).
   */
  defaultOffset?: number;
  /**
   * Lower bound a parsed value clamps to. 0 for offsets; 1 for the
   * page-shaped slot (page 0 reads as page 1).
   */
  minOffset?: number;
  /**
   * Negative input handling. 'clamp' (default — blocks/transactions/
   * contracts: '-5' parses via Number() and clamps to minOffset, the
   * documented negative-offset policy) or 'reject' (the address
   * endpoints: a '-' spelling is junk like every other non-strict-
   * decimal input).
   */
  negativeOffset?: 'clamp' | 'reject';
};

/**
 * Parse a route's ?offset= (or page-shaped) and ?limit= query params
 * under the ONE shared clamp-based contract. Returns the clamped values,
 * with null marking the input each route must answer with its own 400
 * envelope (invalid_offset / invalid_limit / invalid_page).
 *
 * Semantics preserved verbatim from the four former per-route copies
 * (the parseOffsetParam/parseLimitParam pairs in routes/{blocks,
 * transactions,contracts}.ts and the inline derivations in routes/
 * addresses.ts):
 * - absent or empty keeps its default (offset 0 / limit 20 unless
 *   overridden);
 * - strict decimal parse: '5abc', '0x5', '1e5' and ' 5' are junk, never
 *   their parseInt prefix;
 * - in clamp mode a '-'-prefixed value goes through Number() so a
 *   genuine '-5' clamps to minOffset instead of erroring, while '-abc'
 *   and '-5.5' still fail the safe-integer check;
 * - non-safe integers ('99999999999999999999') are rejected; a safe
 *   over-cap offset clamps at maxOffset and an over-cap limit clamps or
 *   rejects per limitOverCap.
 */
export function parsePaginationParams(
  offsetRaw: string | undefined,
  limitRaw: string | undefined,
  options: PaginationParseOptions = {},
): { offset: number | null; limit: number | null } {
  const {
    maxLimit,
    defaultLimit = 20,
    limitOverCap = 'clamp',
    maxOffset,
    defaultOffset = 0,
    minOffset = 0,
    negativeOffset = 'clamp',
  } = options;

  let offset: number | null;
  if (offsetRaw === undefined || offsetRaw === '') {
    offset = defaultOffset;
  } else {
    const parsed =
      negativeOffset === 'clamp' && offsetRaw.startsWith('-')
        ? Number(offsetRaw)
        : parseStrictInteger(offsetRaw);
    if (parsed === null || !Number.isSafeInteger(parsed)) {
      offset = null;
    } else {
      const floored = Math.max(parsed, minOffset);
      offset = maxOffset === undefined ? floored : Math.min(floored, maxOffset);
    }
  }

  let limit: number | null;
  if (limitRaw === undefined || limitRaw === '') {
    limit = defaultLimit;
  } else {
    const parsed = parseStrictInteger(limitRaw);
    if (parsed === null || parsed < 1) {
      limit = null;
    } else if (maxLimit === undefined) {
      limit = parsed;
    } else if (limitOverCap === 'reject') {
      limit = parsed > maxLimit ? null : parsed;
    } else {
      limit = Math.min(parsed, maxLimit);
    }
  }

  return { offset, limit };
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

/**
 * The neutral two-param validator for /chains/:chainId/.../:address
 * route paths: the shared core that routes/{labels,watch,events}.ts each
 * wrapped around getValidatedChainId + getValidatedAddress with their own
 * error envelopes. Each route maps this result onto ITS existing wire
 * contract (labels/watch: 400 {error: 'invalid_request', message};
 * events: an invalid_address JSON body for address failures and the
 * escaped-HTTPException surface for chain failures).
 *
 * The semantics are server/validation.ts's getValidatedChainId and
 * getValidatedAddress re-expressed as values instead of throws (the
 * address tiers come from the same shared addressVerdict leaf), so this
 * module must not import that one — server/validation already depends on
 * utils/validation. Chain is checked first: with both params invalid the
 * chain error wins, exactly as the throw-based originals behaved. The
 * returned address is lowercased (storage keys stay lowercase, C-3).
 */
export type ParsedChainAndAddressParams =
  | { chainId: number; address: `0x${string}` }
  | {
    error:
      | 'invalid_chain_id'
      | 'unsupported_chain'
      | 'invalid_address_format'
      | 'invalid_address_checksum';
    message: string;
  };

export function parseChainAndAddressParams(
  chainIdRaw: string,
  addressRaw: string,
): ParsedChainAndAddressParams {
  // Same two checks getValidatedChainId performs: strict decimal shape
  // (parseInt accepted '1abc' as 1, silently addressing the wrong chain),
  // then registry membership.
  const chainId = Number(chainIdRaw);
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !/^\d+$/.test(chainIdRaw)) {
    return { error: 'invalid_chain_id', message: 'Invalid chain ID' };
  }
  if (!isChainSupported(chainId)) {
    return { error: 'unsupported_chain', message: 'Unsupported chain' };
  }

  // Same two tiers getValidatedAddress exposes: shape first, then EIP-55
  // checksum for mixed-case input (all-lowercase/all-uppercase pass as
  // the checksum-less convention).
  const verdict = addressVerdict(addressRaw);
  if (verdict.tier === 'invalid-shape') {
    return { error: 'invalid_address_format', message: 'Invalid address format' };
  }
  if (verdict.tier === 'invalid-checksum') {
    return { error: 'invalid_address_checksum', message: 'Invalid address checksum' };
  }
  return { chainId, address: verdict.checksummed.toLowerCase() as `0x${string}` };
}
