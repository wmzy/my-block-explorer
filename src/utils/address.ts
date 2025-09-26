import { getAddress, isAddress } from "viem";

/**
 * 格式化以太坊地址为校验和格式 (EIP-55)
 * @param address 原始地址
 * @returns 校验和格式的地址，如果无效则返回原地址
 */
export function formatAddress(address: string): `0x${string}` {
  try {
    if (!address || !isAddress(address)) {
      return address as `0x${string}`;
    }
    return getAddress(address);
  } catch {
    return address as `0x${string}`;
  }
}

/**
 * 比较两个以太坊地址是否相等（忽略大小写）
 * @param address1 地址1
 * @param address2 地址2
 * @returns 是否相等
 */
export function addressEquals(address1: string, address2: string): boolean {
  if (!address1 || !address2) return false;
  try {
    return getAddress(address1) === getAddress(address2);
  } catch {
    return address1.toLowerCase() === address2.toLowerCase();
  }
}

/**
 * 验证地址格式是否有效
 * @param address 地址
 * @returns 是否有效
 */
export function isValidAddress(address: string): boolean {
  return isAddress(address);
}
