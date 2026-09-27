// Unit tests for the symbolic slot expressions and the copyable
// read snippets. Snippet assertions check the exact runnable shape —
// imports must cover every viem identifier the expression references.
import { describe, expect, it } from 'vitest';
import { getDefaultRpcUrl } from '@/config/chains';
import {
  buildCastStorageCommand,
  buildViemReadSnippet,
  exprAdd,
  exprKeccakConcat,
  exprPad,
} from '@/utils/storageSlotCode';
import type { Hex } from 'viem';

const ADDR = '0x1111111111111111111111111111111111111111';
const asHex = (value: string) => value as Hex;

describe('exprAdd', () => {
  it('adds a delta in the bigint domain', () => {
    expect(exprAdd('3n', 2)).toBe('(2n + 3n)');
    expect(exprAdd('(2n + 3n)', 1n)).toBe('(1n + (2n + 3n))');
  });

  it('wraps the delta in substitution markers when commented', () => {
    expect(exprAdd('3n', 2, 'owner')).toBe('(/* owner< */2n/* >*/ + 3n)');
  });

  it('returns the base unchanged for zero deltas', () => {
    expect(exprAdd('3n', 0)).toBe('3n');
    expect(exprAdd('3n', 0n, 'owner')).toBe('3n');
  });
});

describe('exprPad / exprKeccakConcat', () => {
  it('pads an expression to 32 bytes', () => {
    expect(exprPad('3n')).toBe('pad(3n, { size: 32 })');
  });

  it('hashes a key⌢slot concat', () => {
    expect(exprKeccakConcat('a', 'b')).toBe('keccak256(concat([a, b]))');
  });
});

describe('buildViemReadSnippet', () => {
  it('builds a runnable mainnet snippet with a bare bigint slot', () => {
    const snippet = buildViemReadSnippet({ chainId: 1, address: ADDR, slotExpr: '3n' });
    expect(snippet).toBe(
      `// Reads one raw storage slot with viem (chain default RPC).
import { createPublicClient, http, toHex } from 'viem';
import { mainnet } from 'viem/chains';

const client = createPublicClient({
  chain: mainnet,
  transport: http(),
});

const slot = 3n;
const value = await client.getStorageAt({
  address: '${ADDR}',
  slot: typeof slot === 'bigint' ? toHex(slot) : slot,
});
console.log(value);
`,
    );
    // No helper import that the expression does not use.
    expect(snippet).not.toContain('keccak256');
    expect(snippet).not.toContain('pad(');
    expect(snippet).not.toContain('concat');
  });

  it('imports exactly the viem helpers the expression uses', () => {
    const expr = exprKeccakConcat(
      'pad(toHex(BigInt(/* key< */7/* >*/)), { size: 32 })',
      exprPad('/* names< */2n/* >*/'),
    );
    const snippet = buildViemReadSnippet({ chainId: 137, address: ADDR, slotExpr: expr });
    expect(snippet).toContain(
      'import { concat, createPublicClient, http, keccak256, pad, toHex } from \'viem\';',
    );
    expect(snippet).toContain('import { polygon } from \'viem/chains\';');
    expect(snippet).toContain('chain: polygon,');
    expect(snippet).toContain(`const slot = ${expr};`);
  });

  it('includes keccak256 (but not concat) for a dynamic-array data slot expression', () => {
    const expr = 'keccak256(pad(/* whitelist< */3n/* >*/, { size: 32 }))';
    const snippet = buildViemReadSnippet({ chainId: 10, address: ADDR, slotExpr: expr });
    expect(snippet).toContain(
      'import { createPublicClient, http, keccak256, pad, toHex } from \'viem\';',
    );
  });

  it('falls back to mainnet with a TODO for an unknown chain id', () => {
    const snippet = buildViemReadSnippet({ chainId: 31337, address: ADDR, slotExpr: '0n' });
    expect(snippet).toContain('import { mainnet } from \'viem/chains\';');
    expect(snippet).toContain('chain: mainnet, // TODO: chainId 31337');
    expect(snippet).not.toContain('chainId 1,');
  });

  it.each([
    [42161, 'arbitrum'],
    [8453, 'base'],
    [100, 'gnosis'],
    [43114, 'avalanche'],
    [56, 'bsc'],
    [42220, 'celo'],
    [324, 'zksync'],
  ])('uses the named viem chain export for id %i (%s)', (chainId, chainName) => {
    const snippet = buildViemReadSnippet({ chainId, address: ADDR, slotExpr: '0n' });
    expect(snippet).toContain(`import { ${chainName} } from 'viem/chains';`);
    expect(snippet).toContain(`chain: ${chainName},`);
  });
});

describe('buildCastStorageCommand', () => {
  it('mirrors the castCommand --rpc-url policy with the chain default RPC', () => {
    const rpc = getDefaultRpcUrl(1);
    expect(rpc).not.toBe('');
    expect(buildCastStorageCommand({ address: ADDR, slot: asHex('0x5'), chainId: 1 })).toBe(
      `cast storage ${ADDR} 0x5 --rpc-url ${rpc}`,
    );
  });

  it('uses an explicit <RPC_URL> placeholder when no default is known', () => {
    // 482918233 is not a known chain — no default RPC exists for it.
    expect(buildCastStorageCommand({ address: ADDR, slot: asHex('0x0'), chainId: 482918233 })).toBe(
      `cast storage ${ADDR} 0x0 --rpc-url <RPC_URL>`,
    );
  });
});
