import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";
import { Address } from "viem";

// ✅ DuckDB 兼容的基础类型 - 直接重导出，确保兼容性
export { integer, varchar, text, boolean } from "drizzle-orm/pg-core";

// ✅ DuckDB 兼容的 bigint - 使用 varchar 存储大数字以避免精度问题
export const bignum = customType<{
  data: bigint;
  driverData: string;
}>({
  dataType: () => "BIGNUM",
  toDriver: (value: bigint) => value.toString(),
  fromDriver: (value: string) => BigInt(value),
});

export const uint256 = bignum;

// unix timestamp, second precision
export const timestamp = customType<{
  data: number;
  driverData: number;
}>({
  dataType: () => "TIMESTAMP_S",
});

export const address = customType<{
  data: Address;
  driverData: string;
}>({
  dataType: () => `char(42)`,
});

// EVM 特定类型定义

// 交易哈希 - 32 字节，0x 前缀
export const txHash = customType<{
  data: `0x${string}`;
  driverData: string;
}>({
  dataType: () => `char(66)`,
});

// 区块哈希 - 32 字节，0x 前缀
export const blockHash = customType<{
  data: `0x${string}`;
  driverData: string;
}>({
  dataType: () => `char(66)`,
});

// 通用哈希 - 32 字节，0x 前缀（用于 state root, receipts root 等）
export const hash32 = customType<{
  data: `0x${string}`;
  driverData: string;
}>({
  dataType: () => "char(66)",
});

// 字节数据 - 可变长度的十六进制数据
export const hexData = customType<{
  data: `0x${string}`;
  driverData: string;
}>({
  dataType: () => "text",
});

// 交易类型 (0: Legacy, 1: EIP-2930, 2: EIP-1559, etc.)
export const txType = customType<{
  data: number;
  driverData: number;
}>({
  dataType: () => "integer",
});

// 交易状态 (0: 失败, 1: 成功)
export const txStatus = customType<{
  data: 0 | 1;
  driverData: number;
}>({
  dataType: () => "integer",
});

// 日期时间类型
export const datetime = customType<{
  data: Date;
  driverData: string;
}>({
  dataType: () => "TIMESTAMP_MS",
  toDriver: (value: Date) => value.toISOString(),
  fromDriver: (value: string) => new Date(value),
});

// ✅ DuckDB 兼容的表构造器
export { pgTable as duckdbTable } from "drizzle-orm/pg-core";

// ✅ DuckDB 兼容的约束构造器
export { primaryKey, unique } from "drizzle-orm/pg-core";

// ✅ DuckDB 兼容的索引构造器 - 不支持指定索引类型
export { index as duckdbIndex } from "drizzle-orm/pg-core";
