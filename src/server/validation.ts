import { HTTPException } from 'hono/http-exception';
import {
  isValidTransactionHash,
  isValidBlockNumber,
  parseChainAndAddressParams,
} from '../utils/validation';
import { addressVerdict } from '../utils/address';
import { isChainSupported } from '../config/chains';

export function getValidatedAddress(address: string) {
  // The shared two-tier verdict (utils/address.ts) expressed as the
  // route layer's contract: tier 1 — shape (wrong length or non-hex
  // characters); tier 2 — EIP-55 checksum mismatch.
  const verdict = addressVerdict(address);
  if (verdict.tier === 'invalid-shape') {
    throw new HTTPException(400, { message: 'Invalid address format' });
  }
  if (verdict.tier === 'invalid-checksum') {
    throw new HTTPException(400, { message: 'Invalid address checksum' });
  }
  return verdict.checksummed;
}

export function getValidatedChainId(chainId: string | number): number {
  // Strict decimal parse: parseInt() would accept "1abc", "0x1" and "1e3"
  // as 1, letting a junk route param address the wrong chain.
  const id = typeof chainId === 'string' ? Number(chainId) : chainId;

  if (!Number.isSafeInteger(id) || id <= 0 || !/^\d+$/.test(String(chainId))) {
    throw new HTTPException(400, { message: 'Invalid chain ID' });
  }

  if (!isChainSupported(id)) {
    throw new HTTPException(400, { message: 'Unsupported chain' });
  }

  return id;
}

/**
 * The labels/watch wire contract over the neutral two-param validator
 * (parseChainAndAddressParams): both sub-apps answer :chainId/:address
 * param failures with the same bare {error: 'invalid_request', message}
 * 400 body — NOT the createApiError envelope — so the mapping lives here
 * once instead of as byte-identical local wrappers in each route file.
 * Callers render the error arm with `c.json(parsed, 400)` as-is.
 */
export function parseChainAndAddressRequest(
  chainIdStr: string,
  addressStr: string,
): { chainId: number; address: `0x${string}` } | { error: string; message: string } {
  const parsed = parseChainAndAddressParams(chainIdStr, addressStr);
  if ('error' in parsed) return { error: 'invalid_request', message: parsed.message };
  return parsed;
}

export function getValidatedTxHash(txHash: string): string {
  if (!txHash || !isValidTransactionHash(txHash)) {
    throw new HTTPException(400, { message: 'Invalid transaction hash' });
  }
  return txHash.toLowerCase();
}

export function getValidatedBlockNumber(blockNumber: string | number): number | string {
  // Handle null/undefined
  if (blockNumber == null) {
    throw new HTTPException(400, { message: 'Invalid block number' });
  }

  // Handle "latest" keyword
  if (blockNumber === 'latest') {
    return 'latest';
  }

  // The string is handed to isValidBlockNumber unparsed: parsing it here
  // with parseInt() first would let "12abc" through as 12 and address the
  // wrong block.
  if (!isValidBlockNumber(blockNumber)) {
    throw new HTTPException(400, { message: 'Invalid block number' });
  }

  return typeof blockNumber === 'string' ? Number(blockNumber) : blockNumber;
}
