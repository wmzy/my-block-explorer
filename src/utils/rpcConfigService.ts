import { invalidateRpcClients } from './realTimeData';

// RPC配置管理服务
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

// 获取所有RPC配置
export async function getRpcConfigs(): Promise<RpcConfig[]> {
  const response = await fetch('/api/rpc-configs');
  if (!response.ok) {
    throw new Error('Failed to fetch RPC configs');
  }
  const data = await response.json();
  return data.configs;
}

// 保存RPC配置
export async function saveRpcConfig(config: {
  chainId: number;
  name: string;
  url: string;
  supportsHistory?: boolean;
  maxEventRange?: number;
}): Promise<void> {
  const response = await fetch('/api/rpc-configs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to save RPC config');
  }

  invalidateRpcClients();
}

// 删除RPC配置
export async function deleteRpcConfig(chainId: number): Promise<void> {
  const response = await fetch(`/api/rpc-configs/${chainId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete RPC config');
  }

  invalidateRpcClients();
}

// 测试RPC连接
export async function testRpcConnection(
  url: string,
  expectedChainId: number,
): Promise<RpcTestResult> {
  const startTime = Date.now();

  try {
    // 1. 测试基本连接
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

    // 2. 测试历史数据支持
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

        // 测试历史区块查询
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

        // 测试事件查询范围
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
                      ], // 不存在的topic
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
            }
            catch {
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
  }
  catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      latency: Date.now() - startTime,
    };
  }
}
