// RPC error handling and user feedback utilities

import { isTransientRpcMessage } from './errorHandler';

export type RpcErrorDetails = {
  error: string;
  blockNumber?: number;
  contractAddress?: string;
  rpcUrl?: string;
  chainId?: number;
  suggestion: string;
  castCommand?: string;
  retryable: boolean;
  troubleshooting: string[];
};

export function analyzeRpcError(
  error: unknown,
  context: {
    blockNumber?: number;
    contractAddress?: string;
    rpcUrl?: string;
    chainId?: number;
  },
): RpcErrorDetails {
  const errorMessage = (error as { message?: string }).message ?? String(error);
  const { blockNumber, contractAddress, rpcUrl, chainId } = context;

  // One cast command for every block-scoped diagnosis below (five
  // branches used to hand-roll this same ternary).
  const castCodeCommand = blockNumber
    ? `cast code ${contractAddress} --block ${blockNumber} --rpc-url ${rpcUrl}`
    : `cast code ${contractAddress} --rpc-url ${rpcUrl}`;

  // Transient branches (503/429/timeout) derive `retryable` from the
  // SAME shared predicate the retry loop uses (errorHandler), so the
  // analysis and createRetryableRpcCall can never disagree on a
  // rate-limited or timed-out request again.

  // Classify known RPC error types
  if (errorMessage.includes('no backends available for method')) {
    return {
      error: 'RPC node does not support this method or historical data queries',
      blockNumber,
      contractAddress,
      rpcUrl,
      chainId,
      suggestion:
        'This RPC node may not support state queries for historical blocks. Switch to an RPC node with full historical data.',
      castCommand: castCodeCommand,
      retryable: false,
      troubleshooting: [
        '1. Check whether the RPC node supports historical data queries',
        '2. Try using an archive node',
        '3. Contact the RPC provider to confirm historical data availability',
        '4. Consider a service with full historical data such as Alchemy, Infura, or QuickNode',
      ],
    };
  }

  if (errorMessage.includes('503') || errorMessage.includes('Service Unavailable')) {
    return {
      error: 'RPC service temporarily unavailable',
      blockNumber,
      contractAddress,
      rpcUrl,
      chainId,
      suggestion:
        'The RPC server is temporarily unavailable; this is usually transient. Try again later.',
      castCommand: castCodeCommand,
      retryable: isTransientRpcMessage(errorMessage),
      troubleshooting: [
        '1. Wait 5-10 minutes and retry',
        '2. Check the RPC provider status page',
        '3. Try a backup RPC endpoint',
        '4. If the problem persists, contact RPC provider support',
      ],
    };
  }

  if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
    return {
      error: 'Rate limit exceeded',
      blockNumber,
      contractAddress,
      rpcUrl,
      chainId,
      suggestion:
        'Requests are too frequent and hit the RPC node rate limit. Lower the request rate or upgrade the RPC service plan.',
      castCommand: castCodeCommand,
      retryable: isTransientRpcMessage(errorMessage),
      troubleshooting: [
        '1. Wait for the rate limit to reset (usually 1 minute)',
        '2. Upgrade to a higher RPC service tier',
        '3. Load-balance across multiple RPC endpoints',
        '4. Cache requests to avoid repeated queries',
      ],
    };
  }

  if (errorMessage.includes('timeout') || errorMessage.includes('TIMEOUT')) {
    return {
      error: 'RPC request timed out',
      blockNumber,
      contractAddress,
      rpcUrl,
      chainId,
      suggestion: 'The RPC request timed out, possibly due to network issues or a slow RPC node.',
      castCommand: castCodeCommand,
      retryable: isTransientRpcMessage(errorMessage),
      troubleshooting: [
        '1. Check the network connection',
        '2. Increase the request timeout',
        '3. Try a geographically closer RPC endpoint',
        '4. When querying historical data, consider narrowing the range',
      ],
    };
  }

  if (errorMessage.includes('missing trie node') || errorMessage.includes('state not available')) {
    return {
      error: 'Historical state data unavailable',
      blockNumber,
      contractAddress,
      rpcUrl,
      chainId,
      suggestion:
        'The RPC node is missing state data for the requested block. This typically happens on light nodes or incomplete archive nodes.',
      castCommand: castCodeCommand,
      retryable: false,
      troubleshooting: [
        '1. Use a full archive node',
        '2. Try querying a more recent block',
        '3. Contact the RPC provider to confirm historical data coverage',
        '4. Consider a dedicated historical data service',
      ],
    };
  }

  if (errorMessage.includes('connection refused') || errorMessage.includes('ECONNREFUSED')) {
    return {
      error: 'Unable to connect to the RPC node',
      blockNumber,
      contractAddress,
      rpcUrl,
      chainId,
      suggestion:
        'The RPC node refused the connection; check that the URL is correct and the node is online.',
      castCommand: `cast chain-id --rpc-url ${rpcUrl}`,
      retryable: true,
      troubleshooting: [
        '1. Verify the RPC URL is correct',
        '2. Check network firewall settings',
        '3. Confirm the RPC node is online',
        '4. Try a different network environment',
      ],
    };
  }

  // Generic error handling
  return {
    error: errorMessage,
    blockNumber,
    contractAddress,
    rpcUrl,
    chainId,
    suggestion: 'An unknown RPC error occurred. Check the RPC node status or try another endpoint.',
    castCommand: castCodeCommand,
    retryable: true,
    troubleshooting: [
      '1. Check the RPC node status',
      '2. Verify the request parameters',
      '3. Try a different RPC endpoint',
      '4. Contact RPC provider technical support',
    ],
  };
}

export function shouldRetryRpcError(errorDetails: RpcErrorDetails): boolean {
  return errorDetails.retryable;
}
