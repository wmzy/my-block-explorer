// Blockchain data type definitions
// Builds on viem's built-in types with multi-chain support

import type {
  Block as ViemBlock,
  Transaction as ViemTransaction,
  Address,
  Hash,
} from 'viem';

// Base entity type - every record carries a chain ID
export type BaseEntity = {
  chainId: number; // chain ID as the data dimension
};

// Extended block type
export type Block = ViemBlock & BaseEntity & {
  network: string; // network name
  transactionCount: number; // transaction count
};

// Extended transaction type
export type Transaction = ViemTransaction & BaseEntity & {
  gasUsed?: bigint; // gas actually used (from the receipt)
  status?: number; // transaction status (from the receipt)
  timestamp: bigint; // timestamp
  network: string; // network name
};

// Address info type
export type AddressInfo = BaseEntity & {
  address: Address; // viem's Address type
  balance: string;
  transactionCount: number;
  isContract: boolean;
  network: string; // network name
  label?: string; // user-defined label
  firstSeenBlock?: number;
  lastSeenBlock?: number;
  totalReceived?: string;
  totalSent?: string;
  updatedAt?: string;
};

// Token transfer type
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

// Network statistics type
export type NetworkStats = BaseEntity & {
  latestBlock: number;
  avgBlockTime: number;
  avgGasPrice: string;
  tps: number; // transactions per second
  totalTransactions: number;
  price?: {
    usd: number;
    change24h: number;
  };
};

// Daily statistics type
export type DailyStats = BaseEntity & {
  date: string; // date (YYYY-MM-DD)
  transactionCount: number; // transaction count
  blockCount: number; // block count
  avgGasPrice: string; // average gas price
  totalGasUsed: string; // total gas used
  activeAddresses: number; // active address count
  totalValue: string; // total transferred value
  avgBlockTime: number; // average block time
};
