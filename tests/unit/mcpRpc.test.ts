// Unit tests for the MCP RPC gateway's URL precedence and caching, with
// REST stubbed (no viem client is ever dialed — only chainMeta is
// exercised; the viem calls sit behind clientFor and are covered by the
// live smoke).

import { describe, expect, it, vi } from 'vitest';
import { getSupportedChainIds } from '@/config/chains';
import { RpcGateway } from '@/mcp/rpc';
import { ExplorerApi } from '@/mcp/rest';

// viem ships ~700 chains including odd ids; find one it really does not.
const UNKNOWN_CHAIN_ID = [987654321, 1234567890, 555555555].find(id => !getSupportedChainIds().includes(id)) as number;

function gatewayFor(handler: (url: string) => { status: number; body: unknown } | null, now: () => number = () => 1_000_000) {
  const fetchImpl = vi.fn(async (url: string) => {
    const answer = handler(url);
    if (answer === null) throw new TypeError('fetch failed');
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as unknown as typeof fetch;
  const api = new ExplorerApi('http://127.0.0.1:8201', fetchImpl);
  return { gateway: new RpcGateway(api, now), fetchImpl };
}

describe('RpcGateway.chainMeta precedence', () => {
  it('prefers the backend-stored user RPC config', async () => {
    const { gateway } = gatewayFor(url => {
      if (url.endsWith('/api/rpc-configs')) {
        return {
          status: 200,
          body: { configs: [{ chainId: 1, url: 'http://my-eth-node:8545', urlRedacted: false }] },
        };
      }
      if (url.endsWith('/api/chains/custom')) return { status: 200, body: { chains: [] } };
      return null;
    });
    const meta = await gateway.chainMeta(1);
    expect(meta).toMatchObject({ rpcUrl: 'http://my-eth-node:8545', rpcSource: 'user-config', name: 'Ethereum' });
  });

  it('skips redacted config rows and falls back to the viem default', async () => {
    const { gateway } = gatewayFor(url => {
      if (url.endsWith('/api/rpc-configs')) {
        return { status: 200, body: { configs: [{ chainId: 137, url: 'https://host', urlRedacted: true }] } };
      }
      if (url.endsWith('/api/chains/custom')) return { status: 200, body: { chains: [] } };
      return null;
    });
    const meta = await gateway.chainMeta(137);
    expect(meta.rpcSource).toBe('viem-default');
    expect(meta.rpcUrl).not.toBe('https://host');
  });

  it('serves registered custom chains with their RPC url', async () => {
    const { gateway } = gatewayFor(url => {
      if (url.endsWith('/api/rpc-configs')) return { status: 200, body: { configs: [] } };
      if (url.endsWith('/api/chains/custom')) {
        return {
          status: 200,
          body: { chains: [{ chainId: 31337, name: 'local anvil', symbol: 'ANV', rpcUrl: 'http://127.0.0.1:8545' }] },
        };
      }
      return null;
    });
    const meta = await gateway.chainMeta(31337);
    expect(meta).toMatchObject({ name: 'local anvil', symbol: 'ANV', rpcUrl: 'http://127.0.0.1:8545', rpcSource: 'custom-chain' });
  });

  it('rejects unknown chain ids with a pointer to list_chains', async () => {
    const { gateway } = gatewayFor(() => ({ status: 200, body: { configs: [], chains: [] } }));
    await expect(gateway.chainMeta(UNKNOWN_CHAIN_ID)).rejects.toThrow(/list_chains/);
  });

  it('keeps built-ins working backend-less over viem defaults', async () => {
    const { gateway } = gatewayFor(() => null);
    const meta = await gateway.chainMeta(1);
    expect(meta.rpcSource).toBe('viem-default');
    expect(meta.rpcUrl).toMatch(/^https?:/);
  });

  it('caches the remote state for the TTL window', async () => {
    let tick = 1_000_000;
    const { gateway, fetchImpl } = gatewayFor(url => {
      if (url.endsWith('/api/rpc-configs')) return { status: 200, body: { configs: [] } };
      if (url.endsWith('/api/chains/custom')) return { status: 200, body: { chains: [] } };
      return null;
    }, () => tick);
    await gateway.chainMeta(1);
    await gateway.chainMeta(137);
    // One load serves both calls (and both endpoints).
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    tick += 61_000;
    await gateway.chainMeta(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
