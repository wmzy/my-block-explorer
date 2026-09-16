import type { AbiParameter } from 'viem';
import type { ContractFunction } from '@/utils/contractInteraction';

export type ProxyType =
  | 'transparent'
  | 'uups'
  | 'beacon'
  | 'minimal'
  | 'zeppelinos'
  | 'gnosis-safe'
  | 'diamond'
  | 'eip1167'
  | 'unknown';

export type ContractFile = {
  filename: string;
  content: string;
};

export type ContractSource = {
  chainId: number;
  address: string;
  name?: string;
  compilerVersion?: string;
  optimizationEnabled?: boolean;
  optimizationRuns?: number;
  sourceCode: string;
  sourceFiles?: ContractFile[];
  abi: string;
  constructorArguments?: string;
  verificationStatus: 'verified' | 'unverified' | 'partial';
  verificationSource: 'sourcify' | 'etherscan' | 'mantle-explorer' | 'manual' | 'unknown';
  verifiedAt?: string;
  lastChecked: string;
  isProxy?: boolean;
  proxyType?: ProxyType;
  implementationAddress?: string;
  implementationContract?: ContractSource;
};

export type ContractCreationInfo = {
  txHash: string;
  blockNumber: number;
  creator: string;
  timestamp: number;
  gasUsed: string;
  gasPrice: string;
};

export type ContractEvent = {
  name: string;
  inputs: AbiParameter[];
  signature: string;
};

export type ContractABI = {
  abi: string;
  functions: ContractFunction[];
  events: ContractEvent[];
  errors: AbiParameter[];
  verificationStatus: string;
};
