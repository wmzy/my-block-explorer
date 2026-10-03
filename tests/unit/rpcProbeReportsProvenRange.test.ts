// The RPC connection probe reported a getLogs range it never tested.
//
// testRpcConnection walks a descending ladder of windows (10000, 5000,
// 2000, 1000, 500) and records the ladder step that first answered without
// a JSON-RPC error. The window it actually asks for is
// `fromBlock = max(1, currentBlock - range) .. currentBlock`, so two
// things diverge from the reported number:
//
//  - the window can be silently NARROWER than the step (a chain shorter
//    than the step, e.g. head 5000 for step 10000 → a 5000-block probe),
//    and the narrower probe is recorded as 10000;
//  - the inclusive window is `range + 1` blocks, so even the honest case
//    is off by one.
//
// The value is not a cosmetic label: the RPC settings modal persists it
// as the chain's `maxEventRange` and renders it as "Recommended event
// range: N blocks", and EventIndexingService starts each new range with
// that window. An endpoint is therefore configured with, and shown, a
// capability larger than the one that answered.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { testRpcConnection } from '@/utils/rpcConfigService';

const URL = 'http://localhost:8545';
const EXPECTED_CHAIN = 1;

const json = (result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/**
 * A node with a real head, a real historical block, and a getLogs ceiling
 * of `maxLogsRange` blocks. The ceiling is checked against the WINDOW the
 * request actually asks for, exactly as a provider does.
 */
const makeFetch = (head: number, maxLogsRange: number) => {
  const logCalls: Array<{ from: number; to: number }> = [];
  const impl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    switch (body.method) {
      case 'eth_chainId':
        return json(`0x${EXPECTED_CHAIN.toString(16)}`);
      case 'eth_blockNumber':
        return json(`0x${head.toString(16)}`);
      case 'eth_getBlockByNumber':
        return json({ number: body.params[0] });
      case 'eth_getLogs': {
        const range = body.params[0] as { fromBlock: string; toBlock: string };
        const from = Number.parseInt(range.fromBlock, 16);
        const to = Number.parseInt(range.toBlock, 16);
        logCalls.push({ from, to });
        const width = to - from + 1;
        if (width > maxLogsRange) {
          return new Response(
            JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'query returned more than 10000 results' } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return json([]);
      }
      default:
        return json(null);
    }
  });
  return { impl: impl as unknown as typeof fetch, logCalls };
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('testRpcConnection reports the range it actually proved', () => {
  it('never claims a window larger than the one that answered', async () => {
    // Head 5000, so the FIRST ladder step (10000) probes only
    // [1..5000] — a 5000-block window. The ceiling is 5000, so that probe
    // succeeds and the step value 10000 would be reported.
    const { impl, logCalls } = makeFetch(5_000, 5_000);
    vi.stubGlobal('fetch', impl);

    const result = await testRpcConnection(URL, EXPECTED_CHAIN);

    // The probe that succeeded covered 5000 blocks; nothing proved 10000.
    expect(logCalls[0]).toEqual({ from: 1, to: 5_000 });
    expect(result.maxEventRange).toBe(5_000);
  });

  it('reports the largest range that is fully within the ceiling', async () => {
    // Ceiling 2000: steps 10000 and 5000 probe 10001 and 5001 blocks and
    // must fail; the 2000 step probes 2001 blocks and fails too; step 1000
    // probes 1001 blocks and succeeds. The reported range is that window.
    const { impl, logCalls } = makeFetch(20_000_000, 2_000);
    vi.stubGlobal('fetch', impl);

    const result = await testRpcConnection(URL, EXPECTED_CHAIN);

    expect(result.status).toBe('success');
    expect(logCalls.map(c => c.to - c.from + 1)).toEqual([10_001, 5_001, 2_001, 1_001]);
    expect(result.maxEventRange).toBe(1_001);
  });

  it('leaves the range unset on a node with no historical data', async () => {
    const impl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'eth_chainId') return json(`0x${EXPECTED_CHAIN.toString(16)}`);
      if (body.method === 'eth_blockNumber') return json('0x14');
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'missing trie node' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', impl);

    const result = await testRpcConnection(URL, EXPECTED_CHAIN);

    expect(result.status).toBe('success');
    expect(result.supportsHistory).toBe(false);
    // No range was ever proven: the field must stay absent so the modal
    // stores nothing and renders no recommendation.
    expect(result.maxEventRange).toBeUndefined();
  });
});
