import { Context, Next } from "hono";
import { formatAddress, isValidAddress } from "../utils/address";
import type { Address } from "viem";

/**
 * 地址验证中间件
 * 验证并格式化路径参数中的地址
 */
export function validateAddress(paramName: string = "address") {
  return async (c: Context, next: Next) => {
    const rawAddress = c.req.param(paramName);

    if (!rawAddress) {
      return c.json(
        {
          error: "Address parameter is required",
          code: "MISSING_ADDRESS",
        },
        400
      );
    }

    if (!isValidAddress(rawAddress)) {
      return c.json(
        {
          error: "Invalid address format",
          code: "INVALID_ADDRESS",
          received: rawAddress,
        },
        400
      );
    }

    // 格式化地址并存储在上下文中
    const formattedAddress = formatAddress(rawAddress);
    c.set(`validated_${paramName}`, formattedAddress as Address);

    await next();
  };
}

/**
 * 批量地址验证中间件
 * 验证请求体中的地址数组
 */
export function validateAddresses(fieldName: string = "addresses") {
  return async (c: Context, next: Next) => {
    const body = await c.req.json().catch(() => ({}));
    const addresses = body[fieldName];

    if (!Array.isArray(addresses)) {
      return c.json(
        {
          error: `${fieldName} must be an array`,
          code: "INVALID_ADDRESSES_FORMAT",
        },
        400
      );
    }

    const validatedAddresses: Address[] = [];
    const errors: string[] = [];

    for (let i = 0; i < addresses.length; i++) {
      const addr = addresses[i];
      if (typeof addr !== "string") {
        errors.push(`Address at index ${i} must be a string`);
        continue;
      }

      if (!isValidAddress(addr)) {
        errors.push(`Invalid address at index ${i}: ${addr}`);
        continue;
      }

      validatedAddresses.push(formatAddress(addr) as Address);
    }

    if (errors.length > 0) {
      return c.json(
        {
          error: "Address validation failed",
          code: "INVALID_ADDRESSES",
          details: errors,
        },
        400
      );
    }

    // 存储验证后的地址
    c.set(`validated_${fieldName}`, validatedAddresses);

    await next();
  };
}

/**
 * 链ID验证中间件
 */
export function validateChainId() {
  return async (c: Context, next: Next) => {
    const rawChainId = c.req.param("chainId");

    if (!rawChainId) {
      return c.json(
        {
          error: "Chain ID parameter is required",
          code: "MISSING_CHAIN_ID",
        },
        400
      );
    }

    const chainId = parseInt(rawChainId, 10);

    if (isNaN(chainId) || chainId <= 0) {
      return c.json(
        {
          error: "Invalid chain ID format",
          code: "INVALID_CHAIN_ID",
          received: rawChainId,
        },
        400
      );
    }

    // 存储验证后的链ID
    c.set("validated_chainId", chainId);

    await next();
  };
}

/**
 * 获取验证后的地址
 */
export function getValidatedAddress(
  c: Context,
  paramName: string = "address"
): Address {
  return c.get(`validated_${paramName}`);
}

/**
 * 获取验证后的地址数组
 */
export function getValidatedAddresses(
  c: Context,
  fieldName: string = "addresses"
): Address[] {
  return c.get(`validated_${fieldName}`);
}

/**
 * 获取验证后的链ID
 */
export function getValidatedChainId(c: Context): number {
  return c.get("validated_chainId");
}
