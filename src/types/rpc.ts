export type RpcConfig = {
  chainId: number;
  name: string;
  url: string;
  isDefault: boolean;
  isCustom: boolean;
};

export type RpcStatus = {
  chainId: number;
  url: string;
  status: 'connected' | 'error' | 'testing';
  latency?: number;
  error?: string;
  lastChecked: Date;
};

export type RpcError = {
  chainId: number;
  error: string;
  suggestion: string;
};
