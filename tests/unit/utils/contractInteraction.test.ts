// Pure-function tests for the Interact utils: the canonical
// functionSignature (name + input types) that keys results per overload,
// and parseContractFunctionsUnified's proxy/impl merge — same-name
// overloads with different parameters are distinct entries; only an exact
// signature match is deduped. The networked paths resolve their viem
// client through the async createRpcClient factory (user RPC config +
// custom chains), so any chain the factory serves works — including ids
// outside every hardcoded list — and factory failures flow through the
// documented error contracts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  functionSignature,
  parseContractFunctionsUnified,
  readContract,
  simulateContract,
  estimateContractGas,
} from '@/utils/contractInteraction';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/utils/realTimeData', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/realTimeData')>();
  return { ...actual, createRpcClient: vi.fn() };
});

const fn = (
  name: string,
  inputs: { name: string; type: string }[],
  stateMutability = 'nonpayable',
) => ({ name, inputs, outputs: [], stateMutability });

const abi = (...fns: ReturnType<typeof fn>[]) =>
  JSON.stringify(fns.map(f => ({ type: 'function', ...f })));

describe('functionSignature', () => {
  it('renders the bare name for a no-arg function', () => {
    expect(functionSignature({ name: 'totalSupply', inputs: [] })).toBe('totalSupply()');
  });

  it('joins multiple parameter types with commas', () => {
    expect(
      functionSignature({
        name: 'transfer',
        inputs: [
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
      }),
    ).toBe('transfer(address,uint256)');
  });

  it('keeps composite types verbatim', () => {
    expect(
      functionSignature({
        name: 'swap',
        inputs: [
          { name: 'pairs', type: '(uint256,address)[2]' },
          { name: 'data', type: 'bytes32[]' },
        ],
      }),
    ).toBe('swap((uint256,address)[2],bytes32[])');
  });
});

describe('parseContractFunctionsUnified overload dedupe', () => {
  it('keeps same-name overloads with different signatures from both ABIs', () => {
    const functions = parseContractFunctionsUnified(
      abi(
        fn('transfer', [
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'extraData', type: 'bytes' },
        ]),
      ),
      abi(
        fn('transfer', [
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ]),
      ),
    );

    const transfers = functions.filter(f => f.name === 'transfer');
    expect(transfers.map(f => functionSignature(f))).toEqual([
      'transfer(address,uint256)',
      'transfer(address,uint256,bytes)',
    ]);
    // Impl entries come first; the proxy-only overload is tagged 'proxy'.
    expect(transfers[0].source).toBe('impl');
    expect(transfers[1].source).toBe('proxy');
  });

  it('dedupes a proxy entry whose signature exactly matches the impl', () => {
    // Different parameter names keep the ABI JSON strings distinct (the
    // merge loop only runs for differing strings) while the signatures
    // still collide: to/amount vs recipient/value, both address,uint256.
    const functions = parseContractFunctionsUnified(
      abi(
        fn('transfer', [
          { name: 'recipient', type: 'address' },
          { name: 'value', type: 'uint256' },
        ]),
      ),
      abi(
        fn('transfer', [
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ]),
      ),
    );

    const transfers = functions.filter(f => f.name === 'transfer');
    expect(transfers).toHaveLength(1);
    expect(transfers[0].source).toBe('impl');
  });

  it('treats a proxy entry without an inputs key as a zero-arg signature', () => {
    // Raw ABI JSON may omit `inputs` entirely; it must count as name(),
    // not crash the dedupe (impl has transfer(address,uint256), so the
    // zero-arg proxy overload is a distinct entry and is kept).
    const functions = parseContractFunctionsUnified(
      JSON.stringify([
        { type: 'function', name: 'transfer', outputs: [], stateMutability: 'view' },
      ]),
      abi(
        fn('transfer', [
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ]),
      ),
    );

    expect(functions.map(f => functionSignature(f))).toEqual([
      'transfer(address,uint256)',
      'transfer()',
    ]);
  });

  it('keeps same-name overloads inside a single ABI untouched', () => {
    const functions = parseContractFunctionsUnified(
      undefined,
      abi(
        fn('get', [{ name: 'slot', type: 'uint256' }], 'view'),
        fn('get', [{ name: 's', type: 'string' }], 'view'),
      ),
    );

    expect(functions.map(f => functionSignature(f))).toEqual(['get(uint256)', 'get(string)']);
    expect(functions.every(f => f.source === 'impl')).toBe(true);
  });
});

describe('RPC client resolution (createRpcClient factory)', () => {
  const CONTRACT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  beforeEach(() => {
    vi.mocked(createRpcClient).mockReset();
  });

  it('reads through a client resolved for a chain outside the legacy six (custom 31337)', async () => {
    const readSpy = vi.fn().mockResolvedValue(42n);
    vi.mocked(createRpcClient).mockResolvedValue({
      readContract: readSpy,
    } as unknown as Awaited<ReturnType<typeof createRpcClient>>);

    const result = await readContract({
      chainId: 31337,
      contractAddress: CONTRACT,
      functionName: 'totalSupply',
      args: [],
      abi: '[]',
    });

    expect(createRpcClient).toHaveBeenCalledWith(31337);
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, result: '42' });
  });

  it('simulates through a client resolved for another outside chain (56)', async () => {
    const simulateSpy = vi.fn().mockResolvedValue({ result: 1n, request: { gas: 21000n } });
    vi.mocked(createRpcClient).mockResolvedValue({
      simulateContract: simulateSpy,
    } as unknown as Awaited<ReturnType<typeof createRpcClient>>);

    const result = await simulateContract({
      chainId: 56,
      contractAddress: CONTRACT,
      functionName: 'deposit',
      args: [],
      abi: '[]',
    });

    expect(createRpcClient).toHaveBeenCalledWith(56);
    expect(result).toEqual({ success: true, result: '1', gasUsed: 21000n });
  });

  it('keeps the read error contract when client creation fails', async () => {
    vi.mocked(createRpcClient).mockRejectedValue(new Error('Unsupported chain ID: 999999'));

    const result = await readContract({
      chainId: 999999,
      contractAddress: CONTRACT,
      functionName: 'totalSupply',
      args: [],
      abi: '[]',
    });

    expect(result).toEqual({ success: false, error: 'Unsupported chain ID: 999999' });
  });

  it('returns null from gas estimation when client creation fails', async () => {
    vi.mocked(createRpcClient).mockRejectedValue(new Error('Unsupported chain ID: 999999'));

    await expect(
      estimateContractGas({
        chainId: 999999,
        contractAddress: CONTRACT,
        functionName: 'deposit',
        args: [],
      }),
    ).resolves.toBeNull();
  });
});
