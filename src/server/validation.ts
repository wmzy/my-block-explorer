import { HTTPException } from 'hono/http-exception';
import { getAddress } from 'viem';
import { isValidTransactionHash, isValidBlockNumber } from '../utils/validation';
import { isChainSupported } from '../config/chains';

// 0x-prefixed, 40 hex characters — the address shape everything below
// this line assumes.
const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function getValidatedAddress(address: string) {
  // Tier 1 — shape: wrong length or non-hex characters.
  if (!HEX_ADDRESS_RE.test(address)) {
    throw new HTTPException(400, { message: 'Invalid address format' });
  }
  // viem's getAddress silently checksum-corrects ANY hex-shaped input, so
  // the EIP-55 check is explicit: only a MIXED-case address carries
  // checksum information (all-lower/all-upper are the checksum-less
  // convention and pass through normalized), and it must match its
  // checksum exactly. Tier 2 — checksum mismatch.
  const checksummed = getAddress(address);
  const body = address.slice(2);
  const isMixedCase = /[a-f]/.test(body) && /[A-F]/.test(body);
  if (isMixedCase && address !== checksummed) {
    throw new HTTPException(400, { message: 'Invalid address checksum' });
  }
  return checksummed;
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
