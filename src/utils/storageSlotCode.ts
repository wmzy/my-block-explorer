// Symbolic slot expressions and copyable read snippets for the storage
// explorer. A SlotExpr is a TypeScript expression evaluating to a Hex or
// bigint slot — kept symbolic (not a final hex) so users can see and
// tweak every substitution point.
//
// The marker idiom `(/* <comment>< */3n/* >*/ + <base>)` comes from the
// upstream storage-explorer-fe reference: the comment markers bracket
// each compiler-supplied number, making it obvious which literals can be
// swapped (key, index, member slot offset) when adapting a snippet.

import { getDefaultRpcUrl } from '@/config/chains';
import type { Hex } from 'viem';

/** A TS expression evaluating to a Hex/bigint slot. */
export type SlotExpr = string;

/**
 * `<base> + delta` in the bigint domain. delta 0 returns the base
 * unchanged (a no-op addition would only add noise). With a comment the
 * delta literal is wrapped in substitution markers — a bracketed comment
 * before and after the number (see the module header for the idiom).
 */
export function exprAdd(base: SlotExpr, delta: number | bigint, comment?: string): SlotExpr {
  const n = BigInt(delta);
  if (n === 0n) return base;
  return comment === undefined ? `(${n}n + ${base})` : `(/* ${comment}< */${n}n/* >*/ + ${base})`;
}

/** `pad(<base>, { size: 32 })` — the 32-byte slot word before keccak256. */
export function exprPad(base: SlotExpr): SlotExpr {
  return `pad(${base}, { size: 32 })`;
}

/** `keccak256(concat([<left>, <right>]))` — h(key) ⌢ slot hashing. */
export function exprKeccakConcat(left: SlotExpr, right: SlotExpr): SlotExpr {
  return `keccak256(concat([${left}, ${right}]))`;
}

// Well-known chain ids → named exports from 'viem/chains'. viem ≥2.16
// renamed the BNB Smart Chain export from `bnb` to `bsc`; this tree pins
// viem 2.x with `bsc`, and the snippet must import a name that exists.
const VIEM_CHAIN_EXPORTS: Record<number, string> = {
  1: 'mainnet',
  137: 'polygon',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
  100: 'gnosis',
  43114: 'avalanche',
  56: 'bsc',
  42220: 'celo',
  324: 'zksync',
};

// viem names a symbolic expression may reference; the snippet imports
// exactly the ones used so it is copy-paste runnable as-is.
const EXPR_HELPER_IDENTIFIERS = ['concat', 'keccak256', 'pad', 'toHex'] as const;

function exprHelperImports(expr: string): readonly string[] {
  return EXPR_HELPER_IDENTIFIERS.filter(name => new RegExp(`\\b${name}\\(`).test(expr));
}

/**
 * A runnable TypeScript snippet that reads one storage slot with viem.
 * Well-known chains get their named chain; an unknown id falls back to
 * mainnet with a TODO comment (never a fabricated chain).
 */
export function buildViemReadSnippet(opts: {
  chainId: number;
  address: string;
  slotExpr: SlotExpr;
}): string {
  const chainName = VIEM_CHAIN_EXPORTS[opts.chainId] ?? 'mainnet';
  const chainLine =
    VIEM_CHAIN_EXPORTS[opts.chainId] === undefined
      ? `  chain: mainnet, // TODO: chainId ${opts.chainId} — import the right chain from 'viem/chains'`
      : `  chain: ${chainName},`;
  // toHex is used by the snippet body itself (bigint → Hex for
  // getStorageAt); helpers appear only when the expression uses them.
  const imports = ['createPublicClient', 'http', 'toHex', ...exprHelperImports(opts.slotExpr)]
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort()
    .join(', ');

  return `// Reads one raw storage slot with viem (chain default RPC).
import { ${imports} } from 'viem';
import { ${chainName} } from 'viem/chains';

const client = createPublicClient({
${chainLine}
  transport: http(),
});

const slot = ${opts.slotExpr};
const value = await client.getStorageAt({
  address: '${opts.address}',
  slot: typeof slot === 'bigint' ? toHex(slot) : slot,
});
console.log(value);
`;
}

/**
 * `cast storage <address> <slot>` mirroring src/utils/castCommand.ts:
 * the active chain's default RPC is appended via --rpc-url (the same
 * getDefaultRpcUrl source the Interact form uses). When no default RPC
 * is known for the chain the flag carries a literal <RPC_URL>
 * placeholder — the command stays complete and honest about the one
 * value it cannot supply, the same way castCommand never fabricates a
 * private key.
 */
export function buildCastStorageCommand(opts: {
  address: string;
  slot: Hex;
  chainId: number;
}): string {
  const rpcUrl = getDefaultRpcUrl(opts.chainId);
  return `cast storage ${opts.address} ${opts.slot} --rpc-url ${rpcUrl === '' ? '<RPC_URL>' : rpcUrl}`;
}
