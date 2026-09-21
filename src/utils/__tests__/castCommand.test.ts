// castCommand builder tests: the Interact form's "Copy as cast" output is
// a runnable foundry command — primitive args bare, strings/bytes quoted
// with shell-escaped quotes, arrays/tuples falling back to viem-encoded
// calldata, the form's trailing-omit rule mirrored, mutability selecting
// call vs send, and unbuildable states (invalid/empty-required/null args)
// surfacing as reasons instead of fabricated commands.
import { describe, it, expect } from 'vitest';
import { encodeFunctionData } from 'viem';
import type { AbiFunction } from 'viem';

import { buildCastCommand } from '@/utils/castCommand';
import { getDefaultRpcUrl } from '@/config/chains';
import type { ContractFunctionInput, EnhancedContractFunction } from '@/utils/contractInteraction';

const ADDR = '0x1111111111111111111111111111111111111111';
const CONTRACT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RPC = getDefaultRpcUrl(1);

type TestFunction = EnhancedContractFunction;

const makeFunc = (
  inputs: ContractFunctionInput[],
  name: string,
  stateMutability: TestFunction['stateMutability'] = 'view',
): TestFunction => ({
  name,
  type: 'function',
  inputs,
  outputs: [],
  stateMutability,
  interactionType: stateMutability === 'view' || stateMutability === 'pure' ? 'read' : 'write',
  source: 'impl',
});

const build = (func: TestFunction, rawArgs: string[], extra?: { valueWei?: string }) =>
  buildCastCommand({
    func,
    rawArgs,
    contractAddress: CONTRACT,
    rpcUrl: RPC,
    valueWei: extra?.valueWei,
  });

describe('buildCastCommand signature form', () => {
  it('formats primitives bare and quotes strings and bytes', () => {
    const func = makeFunc(
      [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'flag', type: 'bool' },
        { name: 'label', type: 'string' },
        { name: 'data', type: 'bytes' },
      ],
      'register',
    );

    const result = build(func, [ADDR, '100', 'true', 'hello world', '0xdeadbeef']);

    expect(result).toEqual({
      ok: true,
      mode: 'call',
      form: 'signature',
      command:
        `cast call ${CONTRACT} "register(address,uint256,bool,string,bytes)" ` +
        `${ADDR} 100 true 'hello world' '0xdeadbeef' --rpc-url ${RPC}`,
      calldata: expect.stringMatching(/^0x[0-9a-f]+$/),
    });
  });

  it('normalizes bools cast can parse and escapes embedded quotes shell-style', () => {
    const func = makeFunc(
      [
        { name: 'flag', type: 'bool' },
        { name: 'label', type: 'string' },
      ],
      'setFlag',
    );

    const result = build(func, ['True', 'it\'s fine']);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command).toBe(
        `cast call ${CONTRACT} "setFlag(bool,string)" true 'it'\\''s fine' --rpc-url ${RPC}`,
      );
    }
  });

  it('omits the trailing run of empty args from both command and signature', () => {
    const func = makeFunc(
      [
        { name: 'owner', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      'info',
    );

    const result = build(func, [ADDR, '']);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Shortened signature + only the filled arg: identical selection to
      // the form's submit path (viem picks the shorter overload).
      expect(result.command).toBe(`cast call ${CONTRACT} "info(address)" ${ADDR} --rpc-url ${RPC}`);
    }
  });
});

describe('buildCastCommand calldata fallback', () => {
  it('falls back to encoded calldata for array args', () => {
    const func = makeFunc([{ name: 'values', type: 'uint256[3]' }], 'sum3');

    const result = build(func, ['1,2,3']);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.form).toBe('calldata');
      // Same bytes the form's submit path encodes (viem, same ABI entry).
      // Annotated as a plain AbiFunction[] so args stays unknown[] — the
      // narrow literal type would demand bigint values.
      const expectedAbi: AbiFunction[] = [
        {
          type: 'function',
          name: 'sum3',
          stateMutability: 'view',
          inputs: [{ name: 'values', type: 'uint256[3]' }],
          outputs: [],
        },
      ];
      const expected = encodeFunctionData({
        abi: expectedAbi,
        functionName: 'sum3',
        args: [['1', '2', '3']],
      });
      expect(result.calldata).toBe(expected);
      expect(result.command).toBe(`cast call ${CONTRACT} ${expected} --rpc-url ${RPC}`);
    }
  });

  it('falls back to encoded calldata for tuple args with components', () => {
    const func = makeFunc(
      [
        {
          name: 'p',
          type: 'tuple',
          components: [
            { name: 'x', type: 'uint256' },
            { name: 'y', type: 'address' },
          ],
        },
      ],
      'move',
    );

    const result = build(func, [`5,${ADDR}`]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const expectedAbi: AbiFunction[] = [
        {
          type: 'function',
          name: 'move',
          stateMutability: 'view',
          inputs: [
            {
              name: 'p',
              type: 'tuple',
              components: [
                { name: 'x', type: 'uint256' },
                { name: 'y', type: 'address' },
              ],
            },
          ],
          outputs: [],
        },
      ];
      const expected = encodeFunctionData({
        abi: expectedAbi,
        functionName: 'move',
        args: [['5', ADDR]],
      });
      expect(result.calldata).toBe(expected);
      expect(result.command).toBe(`cast call ${CONTRACT} ${expected} --rpc-url ${RPC}`);
    }
  });
});

describe('buildCastCommand mutability and value', () => {
  it('selects cast call for view and pure functions', () => {
    for (const stateMutability of ['view', 'pure'] as const) {
      const result = build(
        makeFunc([{ name: 'who', type: 'address' }], 'balanceOf', stateMutability),
        [ADDR],
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.mode).toBe('call');
        expect(result.command).toContain('cast call ');
        expect(result.command).not.toContain('--private-key');
      }
    }
  });

  it('selects cast send with an explicit key placeholder for writes', () => {
    const result = build(
      makeFunc(
        [
          { name: 'to', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        'transfer',
        'nonpayable',
      ),
      [ADDR, '100'],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe('send');
      expect(result.command).toBe(
        `cast send ${CONTRACT} "transfer(address,uint256)" ${ADDR} 100 ` +
        `--rpc-url ${RPC} --private-key <ENTER_YOUR_KEY>`,
      );
    }
  });

  it('carries the payable wei amount as a bare (wei-denominated) --value flag', () => {
    const result = build(makeFunc([], 'deposit', 'payable'), [], {
      valueWei: '1000000000000000000',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command).toBe(
        `cast send ${CONTRACT} "deposit()" --value 1000000000000000000 ` +
        `--rpc-url ${RPC} --private-key <ENTER_YOUR_KEY>`,
      );
    }
  });

  it('omits --value when no wei amount is supplied', () => {
    const result = build(makeFunc([], 'deposit', 'payable'), []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command).not.toContain('--value');
    }
  });
});

describe('buildCastCommand unbuildable states', () => {
  it('refuses when a non-trailing required arg is empty', () => {
    const func = makeFunc(
      [
        { name: 'owner', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      'info',
    );

    const result = build(func, ['', '5']);

    expect(result).toEqual({ ok: false, reason: 'owner: required' });
  });

  it('refuses with the first field error when an arg is invalid', () => {
    const func = makeFunc(
      [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      'send',
    );

    const result = build(func, ['nope', 'abc']);

    expect(result).toEqual({ ok: false, reason: 'to: invalid address' });
  });

  it('refuses an explicit null/undefined argument instead of omitting it', () => {
    const func = makeFunc([{ name: 'to', type: 'address' }], 'claim');

    expect(build(func, [null as unknown as string])).toEqual({
      ok: false,
      reason: 'missing argument value',
    });
    expect(build(func, [undefined as unknown as string])).toEqual({
      ok: false,
      reason: 'missing argument value',
    });
  });
});
