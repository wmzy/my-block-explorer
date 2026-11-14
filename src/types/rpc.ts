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

/**
 * A rendered RPC failure verdict (NOT utils/errorHandler's RpcError
 * class): the alert card's data shape — what failed, on which chain, and
 * the user-facing remedy.
 */
export type RpcErrorInfo = {
  chainId: number;
  error: string;
  suggestion: string;
};
