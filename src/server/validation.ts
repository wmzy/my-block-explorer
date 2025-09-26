import { HTTPException } from "hono/http-exception";
import { getAddress } from "viem";
import {
  isValidTransactionHash,
  isValidBlockNumber,
} from "../utils/validation";
import { isChainSupported } from "../config/chains";

export function getValidatedAddress(address: string) {
  try {
    return getAddress(address);
  } catch {
    throw new HTTPException(400, { message: "Invalid address" });
  }
}

export function getValidatedChainId(chainId: string | number): number {
  const id = typeof chainId === "string" ? parseInt(chainId, 10) : chainId;

  if (isNaN(id) || id <= 0) {
    throw new HTTPException(400, { message: "Invalid chain ID" });
  }

  if (!isChainSupported(id)) {
    throw new HTTPException(400, { message: "Unsupported chain" });
  }

  return id;
}

export function getValidatedTxHash(txHash: string): string {
  if (!txHash || !isValidTransactionHash(txHash)) {
    throw new HTTPException(400, { message: "Invalid transaction hash" });
  }
  return txHash.toLowerCase();
}

export function getValidatedBlockNumber(blockNumber: string | number): number {
  const num =
    typeof blockNumber === "string" ? parseInt(blockNumber, 10) : blockNumber;

  if (!isValidBlockNumber(num)) {
    throw new HTTPException(400, { message: "Invalid block number" });
  }

  return num;
}
