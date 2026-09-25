import { invalidateRpcClients } from './realTimeData';
import { del, get, post } from '@/util/http';

// RPC configuration management service
export type RpcConfig = {
  id: string;
  chainId: number;
  name: string;
  url: string;
  isCustom: boolean;
  supportsHistory?: boolean;
  maxEventRange?: number;
};

export type RpcTestResult = {
  status: 'success' | 'failed' | 'testing';
  latency?: number;
  error?: string;
  detectedChainId?: number;
  supportsHistory?: boolean;
  maxEventRange?: number;
};

// Get all RPC configurations
export async function getRpcConfigs(): Promise<RpcConfig[]> {
  const data = await get<{ configs?: RpcConfig[] }>('/api/rpc-configs');
  return data.configs ?? [];
}

// Save an RPC configuration
export async function saveRpcConfig(config: {
  chainId: number;
  name: string;
  url: string;
  supportsHistory?: boolean;
  maxEventRange?: number;
}): Promise<void> {
  // Error text note: handler failures answer {error} not {message} and
  // surface as ApiError('HTTP <status>'), but a 403 from the admin-token
  // gate carries {message} explaining how to enable admin operations —
  // consumers surface that message on 403.
  await post('/api/rpc-configs', config);

  invalidateRpcClients();
}

// Delete an RPC configuration
export async function deleteRpcConfig(chainId: number): Promise<void> {
  await del(`/api/rpc-configs/${chainId}`);

  invalidateRpcClients();
}

// Test an RPC connection
export async function testRpcConnection(
  url: string,
  expectedChainId: number,
): Promise<RpcTestResult> {
  const startTime = Date.now();

  try {
    // 1. Test basic connectivity
    const chainIdResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
    });

    if (!chainIdResponse.ok) {
      return {
        status: 'failed',
        error: `HTTP ${chainIdResponse.status}: ${chainIdResponse.statusText}`,
      };
    }

    const chainIdData = await chainIdResponse.json();
    if (chainIdData.error) {
      return {
        status: 'failed',
        error: `Chain ID error: ${chainIdData.error.message}`,
      };
    }

    const detectedChainId = parseInt(chainIdData.result, 16);
    const latency = Date.now() - startTime;

    if (detectedChainId !== expectedChainId) {
      return {
        status: 'failed',
        error: `Chain ID mismatch: expected ${expectedChainId}, got ${detectedChainId}`,
        detectedChainId,
        latency,
      };
    }

    // 2. Test historical data support
    const blockNumberResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 2,
      }),
    });

    let supportsHistory = false;
    let maxEventRange = 0;

    if (blockNumberResponse.ok) {
      const blockNumberData = await blockNumberResponse.json();
      if (!blockNumberData.error) {
        const currentBlock = parseInt(blockNumberData.result, 16);

        // Test a historical block query
        const testBlock = Math.max(1, currentBlock - 1000);
        const historicalResponse = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_getBlockByNumber',
            params: [`0x${testBlock.toString(16)}`, false],
            id: 3,
          }),
        });

        if (historicalResponse.ok) {
          const historicalData = await historicalResponse.json();
          supportsHistory = !historicalData.error && historicalData.result;
        }

        // Test event query ranges
        if (supportsHistory) {
          const testRanges = [10000, 5000, 2000, 1000, 500];
          for (const range of testRanges) {
            try {
              const fromBlock = Math.max(1, currentBlock - range);
              const logsResponse = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  method: 'eth_getLogs',
                  params: [
                    {
                      fromBlock: `0x${fromBlock.toString(16)}`,
                      toBlock: `0x${currentBlock.toString(16)}`,
                      topics: [
                        '0x0000000000000000000000000000000000000000000000000000000000000000',
                      ], // nonexistent topic
                    },
                  ],
                  id: 4,
                }),
              });

              if (logsResponse.ok) {
                const logsData = await logsResponse.json();
                if (!logsData.error) {
                  maxEventRange = range;
                  break;
                }
              }
            } catch {
              continue;
            }
          }
        }
      }
    }

    return {
      status: 'success',
      latency,
      detectedChainId,
      supportsHistory,
      maxEventRange: maxEventRange > 0 ? maxEventRange : undefined,
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      latency: Date.now() - startTime,
    };
  }
}
