// Unit tests for the MCP server, driven through the real protocol path:
// an SDK Client connected to the explorer McpServer over an in-memory
// transport pair. REST is exercised via a stubbed global fetch; RPC via a
// stubbed RpcReader — the two seams the production wiring injects.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExplorerMcpServer } from '@/mcp/server';
import { ExplorerApi } from '@/mcp/rest';
import type { ChainMeta, RpcReader } from '@/mcp/rpc';

const CHAIN: ChainMeta = {
  chainId: 1,
  name: 'Ethereum',
  symbol: 'ETH',
  rpcUrl: 'http://rpc.test',
  rpcSource: 'viem-default',
};

function stubRpc(overrides: Partial<RpcReader> = {}): RpcReader {
  return {
    chainMeta: async () => CHAIN,
    getBlock: async () => ({ number: 19000000n, timestamp: 1700000000n }),
    getTransactionWithReceipt: async () => ({ transaction: { hash: '0xabc' }, receipt: { status: 'success' } }),
    getAddressState: async () => ({ chain: CHAIN, balance: 1234500000000000000n, nonce: 42, code: '0x' }),
    getStorageAt: async () => '0x0000dead',
    callReadonly: async () => 18n,
    ...overrides,
  };
}

type FetchCall = { url: string };

function stubFetch(handler: (url: string) => { status: number; body: unknown } | null) {
  const calls: FetchCall[] = [];
  const impl = async (url: string, _init: unknown): Promise<Response> => {
    calls.push({ url });
    const answer = handler(url);
    if (answer === null) throw new TypeError('fetch failed');
    return new Response(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  vi.stubGlobal('fetch', impl);
  return calls;
}

async function connect(rpc: RpcReader) {
  const api = new ExplorerApi('http://127.0.0.1:8201/');
  const server = createExplorerMcpServer({ api, rpc });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const close = async () => {
    await client.close();
    await server.close();
  };
  return { client, server, close };
}

let restoreClose: (() => Promise<void>) | null = null;

beforeEach(() => {
  restoreClose = null;
});

afterEach(async () => {
  await restoreClose?.();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function textOf(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  const first = content[0] as { text?: unknown } | undefined;
  return typeof first?.text === 'string' ? first.text : '';
}

describe('MCP server over the real protocol path', () => {
  it('exposes the full read-only tool set', async () => {
    stubFetch(() => ({ status: 200, body: {} }));
    const handle = await connect(stubRpc());
    restoreClose = handle.close;
    const list = await handle.client.listTools();
    const names = list.tools.map(tool => tool.name).sort();
    expect(names).toEqual([
      'get_address_overview',
      'get_address_transactions',
      'get_block',
      'get_contract',
      'get_events',
      'get_indexing_status',
      'get_storage_at',
      'get_transaction',
      'health',
      'list_chains',
      'read_contract',
      'search',
    ]);
    // Every tool is annotated read-only — the MCP surface is non-mutating by design.
    for (const tool of list.tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    }
  });

  it('health returns the backend payload', async () => {
    stubFetch(url => (url.endsWith('/api/health') ? { status: 200, body: { status: 'ok', version: '1.3.0' } } : null));
    const handle = await connect(stubRpc());
    restoreClose = handle.close;
    const result = await handle.client.callTool({ name: 'health', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('"version": "1.3.0"');
  });

  it('surfaces backend-down with start advice', async () => {
    stubFetch(() => null);
    const handle = await connect(stubRpc());
    restoreClose = handle.close;
    const result = await handle.client.callTool({ name: 'search', arguments: { q: 'weth' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('npx my-block-explorer');
  });

  it('surfaces HTTP error envelopes with status and code', async () => {
    stubFetch(() => ({ status: 429, body: { error: 'rate_limited', message: 'slow down' } }));
    const handle = await connect(stubRpc());
    restoreClose = handle.close;
    const result = await handle.client.callTool({ name: 'search', arguments: { q: 'weth', chainId: 1 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('HTTP 429');
    expect(textOf(result)).toContain('rate_limited');
    expect(textOf(result)).toContain('slow down');
  });

  it('search forwards q and chainId to the backend', async () => {
    const calls = stubFetch(() => ({ status: 200, body: { query: 'weth', type: 'unknown', found: false } }));
    const handle = await connect(stubRpc());
    restoreClose = handle.close;
    await handle.client.callTool({ name: 'search', arguments: { q: 'weth', chainId: 137 } });
    expect(calls[0]?.url).toBe('http://127.0.0.1:8201/api/search?q=weth&chainId=137');
  });

  it('get_address_overview classifies EOAs and serializes bigint balances as strings', async () => {
    stubFetch(() => null);
    const handle = await connect(
      stubRpc({
        getAddressState: async () => ({
          chain: CHAIN,
          balance: 1234500000000000000n,
          nonce: 7,
          code: '0x',
        }),
      }),
    );
    restoreClose = handle.close;
    const result = await handle.client.callTool({
      name: 'get_address_overview',
      arguments: { chainId: 1, address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
    });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text).toContain('"classification": "eoa"');
    expect(text).toContain('"balanceWei": "1234500000000000000"');
  });

  it('get_address_overview reports EIP-7702 delegates with their delegate address', async () => {
    stubFetch(() => null);
    const delegate = 'aabbccdd'.repeat(5); // 40 hex chars
    const handle = await connect(
      stubRpc({
        getAddressState: async () => ({
          chain: CHAIN,
          balance: 0n,
          nonce: 1,
          code: (`0xef0100${delegate}` as const),
        }),
      }),
    );
    restoreClose = handle.close;
    const result = await handle.client.callTool({
      name: 'get_address_overview',
      arguments: { chainId: 1, address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
    });
    expect(textOf(result)).toContain('"classification": "eip-7702-delegated"');
    expect(textOf(result).toLowerCase()).toContain(delegate.toLowerCase());
  });

  it('get_transaction fails honestly when the RPC does not know the hash', async () => {
    stubFetch(() => null);
    const handle = await connect(
      stubRpc({ getTransactionWithReceipt: async () => ({ transaction: null, receipt: null }) }),
    );
    restoreClose = handle.close;
    const result = await handle.client.callTool({
      name: 'get_transaction',
      arguments: { chainId: 1, hash: `0x${'ab'.repeat(32)}` },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('not found');
  });

  it('get_contract parses the stringified ABI and can omit source', async () => {
    const calls = stubFetch(url =>
      url.includes('/source')
        ? {
            status: 200,
            body: {
              chainId: 1,
              chainName: 'Ethereum',
              address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
              contractSource: {
                name: 'WETH9',
                compilerVersion: 'v0.4.18+commit.9cf6e910',
                verificationStatus: 'verified',
                verificationSource: 'sourcify',
                abi: JSON.stringify([{ type: 'function', name: 'deposit', stateMutability: 'payable' }]),
                sourceCode: 'pragma solidity ^0.4.18;',
                isProxy: false,
              },
            },
          }
        : null,
    );
    const handle = await connect(stubRpc());
    restoreClose = handle.close;
    const result = await handle.client.callTool({
      name: 'get_contract',
      arguments: { chainId: 1, address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', includeSource: false },
    });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text).toContain('"name": "WETH9"');
    expect(text).toContain('"deposit"');
    expect(text).toContain('sourceOmitted');
    expect(text).not.toContain('pragma solidity');
    expect(calls[0]?.url).toContain('/api/chains/1/contracts/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/source');
  });

  it('get_contract translates not_a_contract into an EOA explanation', async () => {
    stubFetch(() => ({ status: 404, body: { code: 'not_a_contract', message: 'no deployed code' } }));
    const handle = await connect(stubRpc());
    restoreClose = handle.close;
    const result = await handle.client.callTool({
      name: 'get_contract',
      arguments: { chainId: 1, address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('EOA');
  });

  it('read_contract coerces JSON args and passes bigint to the RPC layer', async () => {
    stubFetch(() => null);
    const seen: Array<{ args: readonly unknown[]; functionName: string }> = [];
    const handle = await connect(
      stubRpc({
        callReadonly: async (_chainId, params) => {
          seen.push({ args: params.args, functionName: params.fragment.name });
          return [1n, 2n];
        },
      }),
    );
    restoreClose = handle.close;
    const result = await handle.client.callTool({
      name: 'read_contract',
      arguments: {
        chainId: 1,
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        signature: 'function getBalances(address owner) view returns (uint256[2])',
        args: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
      },
    });
    expect(result.isError).toBeFalsy();
    expect(seen[0]?.functionName).toBe('getBalances');
    expect(seen[0]?.args[0]).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    expect(textOf(result)).toContain('[\n    "1",\n    "2"\n  ]');
  });

  it('read_contract rejects non-view functions and bad args with field paths', async () => {
    stubFetch(() => null);
    const handle = await connect(stubRpc());
    restoreClose = handle.close;
    const write = await handle.client.callTool({
      name: 'read_contract',
      arguments: {
        chainId: 1,
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        signature: 'function transfer(address to, uint256 amount)',
        args: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', '1'],
      },
    });
    expect(write.isError).toBe(true);
    expect(textOf(write)).toContain('read-only');

    const badArgs = await handle.client.callTool({
      name: 'read_contract',
      arguments: {
        chainId: 1,
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        signature: 'function balanceOf(address account) view returns (uint256)',
        args: ['not-an-address'],
      },
    });
    expect(badArgs.isError).toBe(true);
    expect(textOf(badArgs)).toContain('args[0]');
  });

  it('get_events adds the indexed-ranges-only note on empty results', async () => {
    const calls = stubFetch(url =>
      url.includes('/events')
        ? {
            status: 200,
            body: {
              chainId: 137,
              chainName: 'Polygon',
              events: [],
              total: 0,
              page: 1,
              pageSize: 50,
              totalPages: 0,
            },
          }
        : null,
    );
    const handle = await connect(stubRpc());
    restoreClose = handle.close;
    const result = await handle.client.callTool({
      name: 'get_events',
      arguments: { chainId: 137, address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', eventName: 'Transfer' },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('ONLY block ranges');
    expect(calls[0]?.url).toContain('eventName=Transfer');
  });

  it('get_address_transactions passes filters through and relays coverage verbatim', async () => {
    const calls = stubFetch(url =>
      url.includes('/transactions')
        ? {
            status: 200,
            body: {
              transactions: [],
              total: 0,
              coverage: 'partial',
              reason: 'window-limited',
            },
          }
        : null,
    );
    const handle = await connect(stubRpc());
    restoreClose = handle.close;
    const result = await handle.client.callTool({
      name: 'get_address_transactions',
      arguments: {
        chainId: 1,
        address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        minValue: '1000000000000000',
        method: '0xa9059cbb',
      },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('"coverage": "partial"');
    expect(calls[0]?.url).toContain('minValue=1000000000000000');
    expect(calls[0]?.url).toContain('method=0xa9059cbb');
  });

  it('get_storage_at tolerates decimal and padded-hex slot forms', async () => {
    stubFetch(() => null);
    const seen: Array<{ slot: bigint }> = [];
    const handle = await connect(
      stubRpc({
        getStorageAt: async (_chainId, _address, slot) => {
          seen.push({ slot });
          return `0x${'00'.repeat(31)}2a`;
        },
      }),
    );
    restoreClose = handle.close;
    const result = await handle.client.callTool({
      name: 'get_storage_at',
      arguments: { chainId: 1, address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', slot: '3' },
    });
    expect(result.isError).toBeFalsy();
    expect(seen[0]?.slot).toBe(3n);
    expect(textOf(result)).toContain('"slot": "3"');

    const padded = await handle.client.callTool({
      name: 'get_storage_at',
      arguments: {
        chainId: 1,
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        slot: `0x${'0'.repeat(63)}3`,
      },
    });
    expect(padded.isError).toBeFalsy();
    expect(seen[1]?.slot).toBe(3n);
  });

  it('get_block defaults to latest and offers full transactions on demand', async () => {
    stubFetch(() => null);
    const seen: Array<{ includeTransactions: boolean }> = [];
    const handle = await connect(
      stubRpc({
        getBlock: async (_chainId, ref, includeTransactions) => {
          seen.push({ includeTransactions });
          expect(ref).toEqual({ blockTag: 'latest' });
          return { number: 1n };
        },
      }),
    );
    restoreClose = handle.close;
    await handle.client.callTool({ name: 'get_block', arguments: { chainId: 1 } });
    await handle.client.callTool({ name: 'get_block', arguments: { chainId: 1, blockNumber: 19000000, includeTransactions: true } });
    expect(seen.map(entry => entry.includeTransactions)).toEqual([false, true]);
  });

  it('get_indexing_status degrades one section while serving the other', async () => {
    stubFetch(url =>
      url.includes('/ranges')
        ? { status: 200, body: { ranges: [{ rangeId: 1, status: 'completed' }] } }
        : url.includes('/statistics')
          ? { status: 503, body: { error: 'indexing_status_unavailable', message: 'status failed' } }
          : null,
    );
    const handle = await connect(stubRpc());
    restoreClose = handle.close;
    const result = await handle.client.callTool({
      name: 'get_indexing_status',
      arguments: { chainId: 137, address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174' },
    });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text).toContain('"status": "completed"');
    expect(text).toContain('"statistics": null');
    expect(text).toContain('indexing_status_unavailable');
  });

  it('list_chains works backend-less and flags the gap', async () => {
    stubFetch(() => null);
    const handle = await connect(stubRpc());
    restoreClose = handle.close;
    const result = await handle.client.callTool({ name: 'list_chains', arguments: {} });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text).toContain('"chainId": 1');
    expect(text).toContain('backend unreachable');
  });

  it('rejects invalid tool arguments through the schema (zod v4 path)', async () => {
    stubFetch(() => null);
    const handle = await connect(stubRpc());
    restoreClose = handle.close;
    // callTool's declared return unions in the task-result variant; a
    // plain tool result is what actually arrives here.
    const result = (await handle.client.callTool({
      name: 'get_address_transactions',
      arguments: { chainId: 1, address: '0xabc', limit: 999 },
    })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
    // Schema violations surface as isError tool results carrying the
    // validation message, not as silent passthroughs.
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Input validation error');
    expect(textOf(result)).toContain('limit');
  });
});
