// 区块链数据类型定义
// 使用viem内置类型并扩展多链支持

import type {
  Block as ViemBlock,
  Transaction as ViemTransaction,
  Address,
  Hash,
} from 'viem';

// 基础实体类型 - 所有数据都包含链ID
export type BaseEntity = {
  chainId: number; // 链ID作为数据维度
};

// 扩展区块类型
export type Block = ViemBlock & BaseEntity & {
  network: string; // 网络名称
  transactionCount: number; // 交易数量统计
};

// 扩展交易类型
export type Transaction = ViemTransaction & BaseEntity & {
  gasUsed?: bigint; // 实际使用Gas（从receipt获取）
  status?: number; // 交易状态（从receipt获取）
  timestamp: bigint; // 时间戳
  network: string; // 网络名称
};

// 地址信息类型
export type AddressInfo = BaseEntity & {
  address: Address; // 使用viem的Address类型
  balance: string;
  transactionCount: number;
  isContract: boolean;
  network: string; // 网络名称
  label?: string; // 用户自定义标签
  firstSeenBlock?: number;
  lastSeenBlock?: number;
  totalReceived?: string;
  totalSent?: string;
  updatedAt?: string;
};

// 代币转账类型
export type TokenTransfer = BaseEntity & {
  transactionHash: Hash;
  blockNumber: number;
  logIndex: number;
  from: Address;
  to: Address;
  value: string;
  tokenAddress: Address;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  timestamp: bigint;
};

// 网络统计类型
export type NetworkStats = BaseEntity & {
  latestBlock: number;
  avgBlockTime: number;
  avgGasPrice: string;
  tps: number; // 每秒交易数
  totalTransactions: number;
  price?: {
    usd: number;
    change24h: number;
  };
};

// 日统计类型
export type DailyStats = BaseEntity & {
  date: string; // 日期 (YYYY-MM-DD)
  transactionCount: number; // 交易数量
  blockCount: number; // 区块数量
  avgGasPrice: string; // 平均Gas价格
  totalGasUsed: string; // 总Gas使用量
  activeAddresses: number; // 活跃地址数
  totalValue: string; // 总转账金额
  avgBlockTime: number; // 平均出块时间
};
