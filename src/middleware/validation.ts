import { Context } from "hono";
import {
  isValidChainId,
  isValidAddress,
  isValidTransactionHash,
  isValidBlockNumber,
  validatePaginationParams,
} from "../utils/validation";

/**
 * 验证链ID中间件
 */
export const validateChainId = async (c: Context, next: any) => {
  const chainId = c.req.param("chainId");

  if (!chainId || !isValidChainId(chainId)) {
    return con(
      {
        code: "INVALID_CHAIN_ID",
        message: "Invalid chain ID",
      },
      400
    );
  }

  // 将验证后的chainId添加到上下文
  c.set("chainId", parseInt(chainId, 10));
  await next();
};

/**
 * 验证地址中间件
 */
export const validateAddress = async (c: Context, next: any) => {
  const address = c.req.param("address");

  if (!address || !isValidAddress(address)) {
    return con(
      {
        code: "INVALID_ADDRESS",
        message: "Invalid Ethereum address",
      },
      400
    );
  }

  c.set("address", address.toLowerCase());
  await next();
};

/**
 * 验证交易哈希中间件
 */
export const validateTxHash = async (c: Context, next: any) => {
  const txHash = c.req.param("txHash");

  if (!txHash || !isValidTransactionHash(txHash)) {
    return con(
      {
        code: "INVALID_TX_HASH",
        message: "Invalid transaction hash",
      },
      400
    );
  }

  c.set("txHash", txHash.toLowerCase());
  await next();
};

/**
 * 验证区块号中间件
 */
export const validateBlockNumber = async (c: Context, next: any) => {
  const blockNumber = c.req.param("blockNumber");

  if (!blockNumber || !isValidBlockNumber(blockNumber)) {
    return con(
      {
        code: "INVALID_BLOCK_NUMBER",
        message: "Invalid block number",
      },
      400
    );
  }

  c.set("blockNumber", parseInt(blockNumber, 10));
  await next();
};

/**
 * 验证区块哈希中间件
 */
export const validateBlockHash = async (c: Context, next: any) => {
  const blockHash = c.req.param("blockHash");

  if (!blockHash || !isValidTransactionHash(blockHash)) {
    // 使用相同的哈希验证
    return con(
      {
        code: "INVALID_BLOCK_HASH",
        message: "Invalid block hash",
      },
      400
    );
  }

  c.set("blockHash", blockHash.toLowerCase());
  await next();
};

/**
 * 验证分页参数中间件
 */
export const validatePagination = async (c: Context, next: any) => {
  try {
    const page = c.req.query("page");
    const limit = c.req.query("limit");

    const pagination = validatePaginationParams(page, limit);
    c.set("pagination", pagination);

    await next();
  } catch (error) {
    return con(
      {
        code: "INVALID_PAGINATION",
        message:
          error instanceof Error
            ? error.message
            : "Invalid pagination parameters",
      },
      400
    );
  }
};
