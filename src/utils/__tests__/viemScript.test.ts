// viemScript builder tests: the Interact form's "Copy as viem" output is
// a complete runnable TypeScript snippet — read functions use
// createPublicClient + readContract, writes use createWalletClient +
// writeContract with a literal '<ENTER_YOUR_KEY>' placeholder, the ten
// popular chains import viem/chains while every other id gets an inline
// defineChain, the abi const embeds the panel's error entries verbatim,
// int args render as bigint literals and composites as nested arrays,
// and unbuildable states (invalid/empty-required/null args) surface as
// reasons instead of fabricated scripts.
import { describe, it, expect } from 'vitest';
import * as viemChains from 'viem/chains';

import { buildViemScript, VIEM_CHAIN_EXPORTS, type ViemChainInfo } from '@/utils/viemScript';
import { getDefaultRpcUrl, POPULAR_CHAINS } from '@/config/chains';
import type { ContractFunctionInput, EnhancedContractFunction } from '@/utils/contractInteraction';

const ADDR_A = '0x1111111111111111111111111111111111111111';
const ADDR_B = '0x2222222222222222222222222222222222222222';
const CONTRACT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RPC_1 = getDefaultRpcUrl(1);

const CHAIN_1: ViemChainInfo = {
  id: 1,
  name: 'Ethereum',
  nativeSymbol: 'ETH',
  rpcUrls: [RPC_1],
};

const CHAIN_137: ViemChainInfo = {
  id: 137,
  name: 'Polygon',
  nativeSymbol: 'POL',
  rpcUrls: ['https://polygon-rpc.com'],
};

// Base Sepolia: a real viem chain that is NOT one of the ten curated
// popular ids — the case that must take the defineChain fallback.
const CHAIN_84532: ViemChainInfo = {
  id: 84532,
  name: 'Base Sepolia',
  nativeSymbol: 'ETH',
  rpcUrls: ['https://sepolia.base.org'],
};

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

const build = (
  func: TestFunction,
  rawArgs: string[],
  extra?: {
    valueWei?: string;
    overloadInputCounts?: readonly number[];
    chain?: ViemChainInfo;
    errors?: readonly unknown[];
  },
) =>
  buildViemScript({
    func,
    rawArgs,
    contractAddress: CONTRACT,
    rpcUrl: extra?.chain === undefined ? RPC_1 : (extra.chain.rpcUrls[0] ?? RPC_1),
    valueWei: extra?.valueWei,
    overloadInputCounts: extra?.overloadInputCounts,
    chain: extra?.chain ?? CHAIN_1,
    errors: extra?.errors,
  });

describe('buildViemScript read functions', () => {
  it('produces a public-client readContract script with literalized args', () => {
    const func = makeFunc(
      [
        { name: 'who', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'addrs', type: 'address[]' },
      ],
      'register',
    );

    const result = build(func, [ADDR_A, '1000', `${ADDR_A},${ADDR_B}`]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const { script } = result;
      expect(script).toContain('import { createPublicClient, http } from \'viem\'');
      expect(script).toContain('import { mainnet } from \'viem/chains\'');
      expect(script).toContain('const client = createPublicClient({');
      expect(script).toContain('chain: mainnet');
      expect(script).toContain(`transport: http('${RPC_1}')`);
      expect(script).toContain('await client.readContract({');
      expect(script).toContain(`address: '${CONTRACT}'`);
      expect(script).toContain('functionName: \'register\'');
      // Scalar address, bigint literal for the int, array literal for the
      // address[] — the shapes viem's strict arg types accept verbatim.
      expect(script).toContain(`'${ADDR_A}'`);
      expect(script).toContain('1000n');
      expect(script).toContain(`['${ADDR_A}', '${ADDR_B}']`);
      expect(script).toContain('console.log(result)');
      // A read never mentions keys or wallet plumbing.
      expect(script).not.toContain('privateKeyToAccount');
      expect(script).not.toContain('writeContract');
    }
  });

  it('literalizes tuples element-wise with their component types', () => {
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

    const result = build(func, [`5,${ADDR_A}`]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // The parser yields a positional array for tuples; the snippet
      // keeps it positional, ints inside as bigint literals.
      expect(result.script).toContain(`args: [\n    [5n, '${ADDR_A}']\n  ],`);
    }
  });

  it('omits the args line entirely for zero-arg functions', () => {
    const result = build(makeFunc([], 'decimals'), []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.script).not.toContain('args:');
    }
  });
});

describe('buildViemScript write functions', () => {
  const transfer = makeFunc(
    [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    'transfer',
    'nonpayable',
  );

  it('produces a wallet-client writeContract script with the key placeholder', () => {
    const result = build(transfer, [ADDR_A, '100']);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const { script } = result;
      expect(script).toContain(
        'import { createWalletClient, http, privateKeyToAccount } from \'viem\'',
      );
      expect(script).toContain('const account = privateKeyToAccount(\'<ENTER_YOUR_KEY>\');');
      // One-line trailing comment telling the user to replace it.
      expect(script).toContain('// Replace with your own private key');
      expect(script).toContain('const client = createWalletClient({');
      expect(script).toContain('  account,');
      expect(script).toContain('await client.writeContract({');
      expect(script).toContain(`address: '${CONTRACT}'`);
      expect(script).toContain('functionName: \'transfer\'');
      expect(script).toContain('100n');
      expect(script).toContain('console.log(hash)');
      expect(script).not.toContain('readContract');
      // Nonpayable: no value line even though other fields are present.
      expect(script).not.toContain('value:');
    }
  });

  it('embeds the wei amount as a bigint value only for payable writes', () => {
    const deposit = makeFunc([], 'deposit', 'payable');

    const withValue = build(deposit, [], { valueWei: '1000000000000000000' });
    expect(withValue.ok).toBe(true);
    if (withValue.ok) {
      expect(withValue.script).toContain('value: 1000000000000000000n,');
    }

    // Payable but the form's value field is empty — no value line.
    const withoutValue = build(deposit, []);
    expect(withoutValue.ok).toBe(true);
    if (withoutValue.ok) {
      expect(withoutValue.script).not.toContain('value:');
    }

    // A wei amount on a nonpayable write must not leak into the call.
    const nonpayable = build(transfer, [ADDR_A, '1'], { valueWei: '5' });
    expect(nonpayable.ok).toBe(true);
    if (nonpayable.ok) {
      expect(nonpayable.script).not.toContain('value:');
    }
  });
});

describe('buildViemScript chain selection', () => {
  const func = makeFunc([{ name: 'who', type: 'address' }], 'balanceOf');

  it('imports the curated viem/chains export for a popular id', () => {
    const result = build(func, [ADDR_A], { chain: CHAIN_137 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.script).toContain('import { polygon } from \'viem/chains\'');
      expect(result.script).toContain('chain: polygon');
      expect(result.script).not.toContain('defineChain');
    }
  });

  it('falls back to an inline defineChain for an unmapped id', () => {
    const result = build(func, [ADDR_A], { chain: CHAIN_84532 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const { script } = result;
      expect(script).toContain('import { createPublicClient, defineChain, http } from \'viem\'');
      expect(script).not.toContain('from \'viem/chains\'');
      expect(script).toContain('const chain = defineChain({');
      expect(script).toContain('id: 84532,');
      expect(script).toContain('name: \'Base Sepolia\',');
      expect(script).toContain(
        'nativeCurrency: { name: \'Base Sepolia\', symbol: \'ETH\', decimals: 18 },',
      );
      expect(script).toContain('rpcUrls: { default: { http: [\'https://sepolia.base.org\'] } },');
      expect(script).toContain('chain: chain,');
      expect(script).toContain('transport: http(\'https://sepolia.base.org\')');
    }
  });

  it('curates exactly the popular ids, each a real viem/chains export', () => {
    for (const name of VIEM_CHAIN_EXPORTS.values()) {
      expect(viemChains).toHaveProperty(name);
    }
    expect([...VIEM_CHAIN_EXPORTS.keys()].sort((a, b) => a - b)).toEqual(
      [...POPULAR_CHAINS.map(chain => chain.id)].sort((a, b) => a - b),
    );
  });
});

describe('buildViemScript abi const', () => {
  const func = makeFunc([{ name: 'who', type: 'address' }], 'balanceOf');

  it('embeds the function entry and every raw error entry verbatim', () => {
    const result = build(func, [ADDR_A], {
      errors: [
        { type: 'error', name: 'TransferRejected', inputs: [] },
        {
          type: 'error',
          name: 'InsufficientBalance',
          inputs: [
            { name: 'available', type: 'uint256' },
            { name: 'required', type: 'uint256' },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const { script } = result;
      expect(script).toContain('const abi = [');
      expect(script).toContain('] as const;');
      expect(script).toContain('"type": "function"');
      expect(script).toContain('"name": "balanceOf"');
      expect(script).toContain('"type": "error"');
      expect(script).toContain('"name": "TransferRejected"');
      expect(script).toContain('"name": "InsufficientBalance"');
      // The comment flags the error block and carries no trailing comma.
      expect(script).toContain(
        '\n    // Contract error entries (verbatim) so a revert decodes to its name and args.\n',
      );
    }
  });

  it('omits the error mention when no error entries are supplied', () => {
    const result = build(func, [ADDR_A]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.script).not.toContain('"type": "error"');
      expect(result.script).not.toContain('error entries');
    }
  });
});

describe('buildViemScript unbuildable states', () => {
  it('refuses when a required arg is empty with the field-level reason', () => {
    const func = makeFunc(
      [
        { name: 'owner', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      'info',
    );

    expect(build(func, ['', '5'])).toEqual({ ok: false, reason: 'owner: required' });
  });

  it('refuses with the first field error when an arg is invalid', () => {
    const func = makeFunc(
      [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      'send',
    );

    expect(build(func, ['nope', 'abc'])).toEqual({ ok: false, reason: 'to: invalid address' });
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
