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

/**
 * A JSON-RPC hex QUANTITY (`0x`-prefixed, non-negative) as a safe integer,
 * or null when the answer is not one.
 *
 * parseInt(value, 16) is not this: it accepts a valid prefix and ignores
 * the rest, so '0x1zz' read as 1 and '137abc' read as 1276604 — a
 * fabricated chain id / block height that the probe would then compare
 * against the user's configuration and report as a match. BigInt first
 * (quantities are uint64 in JSON-RPC), then a safe-integer gate so a
 * value past 2^53 is rejected rather than silently rounded. Mirrors the
 * canonical reader in src/routes/chains.ts and src/util/wallet.ts.
 */
function parseHexQuantity(value: unknown): number | null {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  const parsed = Number(BigInt(value));
  return Number.isSafeInteger(parsed) ? parsed : null;
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

    // Strict hex QUANTITY parse: parseInt(result, 16) accepted a valid
    // prefix and ignored the rest, so a node answering '0x1zz' probed
    // as chain 1 and the modal reported a match for a chain the user
    // never configured. Same shape as routes/chains.ts and the wallet
    // facade: shape-check, BigInt for uint64, then a safe-integer gate.
    const detectedChainId = parseHexQuantity(chainIdData.result);
    if (detectedChainId === null) {
      return {
        status: 'failed',
        error: `The endpoint's eth_chainId answer was not a hex chain id: ${JSON.stringify(chainIdData.result)}.`,
        latency: Date.now() - startTime,
      };
    }
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
        const currentBlock = parseHexQuantity(blockNumberData.result);
        // A non-hex head disables the historical/event-range probes
        // rather than continuing with a fabricated block number.
        if (currentBlock !== null) {
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

          // Test event query ranges. The reported number must be the window
          // the node actually SERVED, not the ladder step it was derived
          // from: `fromBlock` is clamped at 1, so on a chain shorter than
          // the step the probe is narrower than the step (head 5000 with the
          // 10000 step probes only 5000 blocks) and the inclusive window is
          // `range + 1`. Reporting the step stored a capability larger than
          // the one that answered — the RPC modal persists it as the chain's
          // maxEventRange and renders it as "Recommended event range".
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
                  // fromBlock is INCLUSIVE and so is toBlock, so the
                  // width is `to - from + 1` — exactly the window the node
                  // just served, whether the clamp narrowed it or not.
                    maxEventRange = currentBlock - fromBlock + 1;
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
