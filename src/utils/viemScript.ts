// viem script builder for the contract Interact form.
//
// The Interact tab only simulates calls in the browser; users who want
// the same call as runnable TypeScript get a paste-ready viem snippet
// here. Read functions (view/pure) produce a createPublicClient +
// readContract script that logs the result; writes (nonpayable/payable)
// produce a createWalletClient + writeContract script carrying a literal
// '<ENTER_YOUR_KEY>' private-key placeholder — complete and honest about
// the one secret it cannot supply, never a fabricated key.
//
// Chains viem ships under a curated name (exactly the explorer's ten
// popular chains) import from 'viem/chains'; every other id gets an
// inline defineChain serialized from the caller-resolved chain metadata.
// The embedded abi const carries the selected function's entry plus the
// panel's raw ABI error entries, so a revert in the pasted script decodes
// to its name and args.
//
// Everything here is pure string assembly over the SAME validation the
// form uses (paramParsing.parseFunctionArgs), so the script is buildable
// exactly when the form's submit would encode successfully.

import {
  parseFunctionArgs,
  type ParamComponent,
} from '@/views/Contract/paramParsing';
import { type CastableFunction, toAbiFunction } from './castCommand';

export type { CastableFunction } from './castCommand';

// The chain metadata the builder serializes; the caller resolves it (the
// form via getChainInfo) so this module stays pure over its inputs.
export type ViemChainInfo = {
  id: number;
  name: string;
  nativeSymbol: string;
  rpcUrls: readonly string[];
};

export type ViemScript =
  | {
    ok: true;
    script: string;
  }
  | {
    ok: false;
    reason: string;
  };

const INT_TYPE_PATTERN = /^(u?)int(\d+)?$/;
// Rightmost array suffix — the same shape paramParsing peels, so any
// array (fixed, dynamic, nested) is literalized element-wise.
const ARRAY_SUFFIX_PATTERN = /^(.*)\[(\d*)]$/;

// viem/chains export names for exactly the explorer's ten popular chain
// ids — the curated set where the snippet imports viem's own chain object
// instead of defining an inline twin. Every other id (testnets, custom
// registrations) goes through the defineChain fallback below.
export const VIEM_CHAIN_EXPORTS: ReadonlyMap<number, string> = new Map([
  [1, 'mainnet'],
  [137, 'polygon'],
  [56, 'bsc'],
  [42161, 'arbitrum'],
  [8453, 'base'],
  [10, 'optimism'],
  [43114, 'avalanche'],
  [250, 'fantom'],
  [42220, 'celo'],
  [100, 'gnosis'],
]);

// Build the viem snippet for one function's current form state. `rawArgs`
// are the form's raw input strings; a null/undefined entry is a missing
// value and makes the script unbuildable (the caller disables its copy
// button with the reason). `valueWei` carries a payable function's parsed
// wei amount, embedded as a bigint literal. `chain` and `rpcUrl` come
// from the caller's chain resolution — the snippet always embeds one rpc
// endpoint, so it never needs a "default RPC known" gate of its own.
export function buildViemScript({
  func,
  rawArgs,
  contractAddress,
  rpcUrl,
  valueWei,
  overloadInputCounts,
  chain,
  errors,
}: {
  func: CastableFunction;
  rawArgs: readonly (string | null | undefined)[];
  contractAddress: string;
  rpcUrl: string;
  valueWei?: string;
  /** Same-name overload input counts (`sameNameInputCounts` output). */
  overloadInputCounts?: readonly number[];
  chain: ViemChainInfo;
  /** Raw ABI error entries embedded verbatim so reverts decode. */
  errors?: readonly unknown[];
}): ViemScript {
  // An explicit null/undefined argument cannot be literalized; refuse it
  // instead of silently treating it as a missing trailing empty.
  if (rawArgs.some(arg => arg == null)) {
    return { ok: false, reason: 'missing argument value' };
  }
  const args = rawArgs as readonly string[];

  const parsed = parseFunctionArgs(func.inputs, args, overloadInputCounts);
  if (!parsed.isValid) {
    return {
      ok: false,
      reason: parsed.fieldErrors.find(err => err !== '') ?? 'invalid arguments',
    };
  }

  // The form's trailing-empty rule: the trailing run of empty inputs is
  // omitted from the encoded call (only when a same-name overload
  // accepts the filled count — otherwise the parse above refused). The
  // snippet mirrors the omission on both fronts: the embedded abi entry
  // AND the args list use the shortened inputs, so viem encodes exactly
  // what the form's submit path sends.
  const effectiveInputs = func.inputs.slice(0, parsed.values.length);

  const isRead = func.stateMutability === 'view' || func.stateMutability === 'pure';
  const exportName = VIEM_CHAIN_EXPORTS.get(chain.id);
  const includeDefineChain = exportName === undefined;

  const lines: string[] = [];

  // Imports: viem members alphabetical, then the curated chain import.
  lines.push(
    isRead
      ? `import { createPublicClient, ${includeDefineChain ? 'defineChain, ' : ''}http } from 'viem';`
      : `import { createWalletClient, ${includeDefineChain ? 'defineChain, ' : ''}http, privateKeyToAccount } from 'viem';`,
  );
  if (exportName !== undefined) {
    lines.push(`import { ${exportName} } from 'viem/chains';`);
  }
  lines.push('');

  // Chain resolution: viem's own object for the curated ids, an inline
  // definition serialized from the passed chain metadata otherwise.
  let chainExpression: string;
  if (exportName !== undefined) {
    chainExpression = exportName;
  } else {
    lines.push(
      `// ${chain.name} is not exported by viem/chains — defined inline from this explorer's metadata.`,
    );
    lines.push('const chain = defineChain({');
    lines.push(`  id: ${chain.id},`);
    lines.push(`  name: ${tsString(chain.name)},`);
    lines.push(
      `  nativeCurrency: { name: ${tsString(chain.name)}, symbol: ${tsString(chain.nativeSymbol)}, decimals: 18 },`,
    );
    lines.push(
      `  rpcUrls: { default: { http: [${chain.rpcUrls.map(url => tsString(url)).join(', ')}] } },`,
    );
    lines.push('});');
    lines.push('');
    chainExpression = 'chain';
  }

  // Writes sign from a local account; the literal placeholder keeps the
  // snippet complete and honest — the one secret it cannot supply.
  if (!isRead) {
    lines.push(
      'const account = privateKeyToAccount(\'<ENTER_YOUR_KEY>\'); // Replace with your own private key before running — never commit a real one.',
    );
    lines.push('');
  }

  if (isRead) {
    lines.push('const client = createPublicClient({');
  } else {
    lines.push('const client = createWalletClient({');
    lines.push('  account,');
  }
  lines.push(`  chain: ${chainExpression},`);
  lines.push(`  transport: http(${tsString(rpcUrl)}),`);
  lines.push('});');
  lines.push('');

  // The abi const: the selected function's entry (over the EFFECTIVE
  // inputs, matching the omission rule above) plus every raw error entry
  // the panel knows, verbatim — a revert in the pasted script decodes to
  // its name and args instead of a generic call-failed dump.
  const functionEntry = formatAbiEntry(toAbiFunction(func, effectiveInputs));
  lines.push('const abi = [');
  if (errors !== undefined && errors.length > 0) {
    lines.push(`${functionEntry},`);
    // Comment lines carry no trailing comma — only real entries do.
    lines.push('    // Contract error entries (verbatim) so a revert decodes to its name and args.');
    errors.forEach((error, index) => {
      const suffix = index === errors.length - 1 ? '' : ',';
      lines.push(`${formatAbiEntry(error)}${suffix}`);
    });
  } else {
    lines.push(functionEntry);
  }
  lines.push('] as const;');
  lines.push('');

  if (isRead) {
    lines.push('const result = await client.readContract({');
  } else {
    lines.push('const hash = await client.writeContract({');
  }
  lines.push(`  address: ${tsString(contractAddress)},`);
  lines.push('  abi,');
  lines.push(`  functionName: ${tsString(func.name)},`);
  if (parsed.values.length > 0) {
    lines.push('  args: [');
    lines.push(
      effectiveInputs.map((input, index) => `    ${literalizeArg(input, parsed.values[index])}`).join(',\n'),
    );
    lines.push('  ],');
  }
  // Only a payable write carries value, and only when the form parsed a
  // wei amount — mirrored from the submit path's own value gate.
  if (
    !isRead &&
    func.stateMutability === 'payable' &&
    valueWei !== undefined &&
    valueWei !== ''
  ) {
    lines.push(`  value: ${valueWei}n,`);
  }
  lines.push('});');
  lines.push('');

  lines.push(isRead ? 'console.log(result);' : 'console.log(hash);');

  return { ok: true, script: lines.join('\n') };
}

// Single-quoted TS string literal (the viem-docs style the snippet's
// hand-written lines use; ABI entries below stay JSON-verbatim instead).
function tsString(value: string): string {
  return `'${value
    .replaceAll('\\', '\\\\')
    .replaceAll('\'', '\\\'')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')}'`;
}

// One ABI entry as indented TypeScript: JSON.stringify is already valid
// TS object syntax (the entries are plain JSON data), every line
// re-indented to sit inside the `const abi = [` literal.
function formatAbiEntry(entry: unknown): string {
  return JSON.stringify(entry, null, 2)
    .split('\n')
    .map(line => `    ${line}`)
    .join('\n');
}

// Type-aware arg literalizer: walks the param descriptor alongside the
// parsed value. The parser keeps ints as their raw BigInt-safe strings,
// but viem's strict arg types demand bigint — so int-typed values render
// as `123n` literals, address/bytes/string as quoted strings, bools as
// bare literals, and arrays/tuples (the parser produces positional
// arrays for both) element-wise with the peeled element descriptors.
function literalizeArg(desc: ParamComponent | undefined, value: unknown): string {
  if (desc !== undefined) {
    const arrayMatch = ARRAY_SUFFIX_PATTERN.exec(desc.type);
    if (arrayMatch && Array.isArray(value)) {
      // Tuple component metadata stays attached while the suffix is
      // peeled — the same elementDesc paramParsing itself builds.
      const elementDesc: ParamComponent = {
        name: '',
        type: arrayMatch[1],
        components: desc.components,
      };
      return `[${value.map(element => literalizeArg(elementDesc, element)).join(', ')}]`;
    }
    if (desc.type === 'tuple' && Array.isArray(value)) {
      const components = desc.components ?? [];
      return `[${value.map((element, index) => literalizeArg(components[index], element)).join(', ')}]`;
    }
    if (INT_TYPE_PATTERN.test(desc.type)) {
      if (typeof value === 'bigint') return `${value.toString()}n`;
      try {
        return `${BigInt(String(value)).toString()}n`;
      } catch {
        // Not numeric — fall through to the value-only formatter.
      }
    }
  }
  return literalizeValue(value);
}

// Value-only fallback for shapes without a descriptor (defensive — the
// parser's own outputs are fully covered above): bigint → `123n`, string
// → JSON-quoted, boolean/number → literal, arrays and objects →
// recursive. Never JSON.stringify the whole array: bigint throws there.
function literalizeValue(value: unknown): string {
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'string') return tsString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map(literalizeValue).join(', ')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(
      ([key, element]) => `${JSON.stringify(key)}: ${literalizeValue(element)}`,
    );
    return `{ ${entries.join(', ')} }`;
  }
  return String(value);
}
