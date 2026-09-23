// Pure transaction-input and revert-payload decoding helpers. No network,
// no React — every function is deterministic and unit-testable in isolation.
import {
  decodeAbiParameters,
  decodeErrorResult,
  decodeFunctionData,
  getAddress,
  type Abi,
  type AbiParameter,
  type Hex,
} from 'viem';

export type DecodedFunctionCall = {
  functionName: string;
  args: readonly unknown[];
};

// ABI-encoded `Error(string)` — the payload Solidity's `revert("…")` emits.
const ERROR_STRING_SELECTOR = '0x08c379a0';
// ABI-encoded `Panic(uint256)` — compiler-inserted assertion failures.
const PANIC_SELECTOR = '0x4e487b71';

// Solidity's documented panic codes; only the well-known byte values.
const PANIC_CODES: Record<string, string> = {
  '0x00': 'generic panic (reserved)',
  '0x01': 'assert failed',
  '0x11': 'arithmetic overflow/underflow',
  '0x12': 'division by zero',
  '0x21': 'invalid enum value',
  '0x22': 'corrupt storage byte array',
  '0x31': 'pop on empty array',
  '0x32': 'array index out of range',
  '0x41': 'memory allocation overflow',
  '0x51': 'uninitialized function pointer called',
};

/**
 * First 4 bytes of the transaction input as a 0x-prefixed selector.
 * Returns null when the input is shorter than '0x' + 8 hex chars or is
 * not a hex selector at all (plain-transfer '0x' inputs included).
 */
export function selectorOf(inputData: string | undefined): Hex | null {
  if (typeof inputData !== 'string' || inputData.length < 10) return null;
  const selector = inputData.slice(0, 10).toLowerCase();
  return /^0x[0-9a-f]{8}$/.test(selector) ? (selector as Hex) : null;
}

/**
 * Decode a contract call against an ABI via viem's decodeFunctionData.
 * Returns null when the input is empty, malformed, or the selector does
 * not match any function in the ABI (e.g. an unverified contract's ABI).
 */
export function decodeFunctionCall(inputData: string, abi: Abi): DecodedFunctionCall | null {
  try {
    const { functionName, args } = decodeFunctionData({ abi, data: inputData as Hex });
    // viem types args as possibly-undefined for generic ABIs; an undefined
    // arg list is display-equivalent to an empty one.
    return { functionName, args: args ?? [] };
  } catch {
    return null;
  }
}

/**
 * Decode a raw revert payload into a readable reason string:
 * (a) `Error(string)` reverts — the Solidity `revert("…")` encoding,
 * (b) `Panic(uint256)` — mapped through the documented Solidity code table,
 * (c) custom errors declared in the provided ABI via decodeErrorResult.
 * Returns null when nothing decodes (unknown selector, truncated payload…).
 * Thin legacy wrapper over describeRevertData/formatRevertDescription — the
 * structured pair is the source of truth for all decoding.
 */
export function decodeRevertReason(data: string, abi?: Abi): string | null {
  const description = describeRevertData(data, abi);
  // Legacy semantics: an unreadable payload is "no reason", not raw hex.
  if (description === null || description.kind === 'unknown') return null;
  return formatRevertDescription(description);
}

/**
 * Structured classification of a revert payload. `string`/`panic` need no
 * ABI (standard Solidity encodings); `custom` requires an ABI that declares
 * the error; `unknown` is any other well-formed selector-prefixed payload.
 */
export type RevertDescription =
  | { kind: 'string'; message: string }
  | { kind: 'panic'; code: bigint; description: string }
  | { kind: 'custom'; name: string; argsText: string }
  | { kind: 'unknown'; selector: string; data: string };

/**
 * Classify a raw revert payload into a structured description without ever
 * throwing. Empty '0x' (and payloads without a full 4-byte selector) are
 * NOT reverts — null, so callers can distinguish "no revert data" from
 * "revert data we cannot read". Standard Error(string)/Panic(uint256)
 * selectors decode without an ABI exactly like decodeRevertReason; every
 * other selector is decoded against the provided ABI via viem's
 * decodeErrorResult (which throws when nothing matches — the 'unknown'
 * fallback). Truncated/corrupt payloads of a known selector also land in
 * 'unknown' rather than throwing.
 */
export function describeRevertData(data: string, abi?: Abi): RevertDescription | null {
  if (typeof data !== 'string' || !data.startsWith('0x') || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();

  if (selector === ERROR_STRING_SELECTOR) {
    try {
      const [message] = decodeAbiParameters(
        [{ type: 'string' }] as readonly AbiParameter[],
        // slice(10) drops the selector but also the 0x prefix; re-prefix —
        // viem's size arithmetic assumes the 0x and mis-measures without it.
        `0x${data.slice(10)}`,
      );
      if (typeof message === 'string') return { kind: 'string', message };
    } catch {
      // Truncated/corrupt Error(string) payload — fall through to unknown.
    }
  } else if (selector === PANIC_SELECTOR) {
    try {
      const [code] = decodeAbiParameters(
        [{ type: 'uint256' }] as readonly AbiParameter[],
        // Same re-prefixing as the Error(string) branch above.
        `0x${data.slice(10)}`,
      );
      if (typeof code === 'bigint') return { kind: 'panic', code, description: panicDescription(code) };
    } catch {
      // Truncated/corrupt Panic(uint256) payload — fall through to unknown.
    }
  } else if (abi !== undefined && abi.length > 0) {
    try {
      const { errorName, args } = decodeErrorResult({ abi, data: data as Hex });
      return { kind: 'custom', name: errorName, argsText: formatErrorArgs(args) };
    } catch {
      // Selector matches no error in the ABI (or the payload is truncated)
      // — fall through to unknown.
    }
  }

  return { kind: 'unknown', selector, data };
}

/** Solidity panic-code table lookup shared by both revert decoders. */
function panicDescription(code: bigint): string {
  const codeHex = `0x${code.toString(16).padStart(2, '0')}`;
  return PANIC_CODES[codeHex] ?? 'unknown panic code';
}

/**
 * Display string for a RevertDescription: Error(string) keeps its plain
 * message, Panic keeps the exact `Panic 0xNN: cause` shape decodeRevertReason
 * has always produced (zero-ABI rendering stays byte-identical), custom
 * errors render as `Name(args)`, unknown payloads fall back to raw hex.
 */
export function formatRevertDescription(description: RevertDescription): string {
  switch (description.kind) {
    case 'string':
      return description.message;
    case 'panic': {
      const codeHex = `0x${description.code.toString(16).padStart(2, '0')}`;
      return `Panic ${codeHex}: ${description.description}`;
    }
    case 'custom':
      return description.argsText !== '' ? `${description.name}(${description.argsText})` : description.name;
    case 'unknown':
      return description.data;
  }
}

// Decimal grouping separator for large custom-error integers: a thin space
// keeps the digits readable without looking like a different value the way
// a comma can in mixed-locale contexts.
const THIN_SPACE = '\u2009';
const groupDecimal = (value: bigint): string =>
  value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);

// Hex blobs longer than this render truncated; short ones stay verbatim.
const MAX_RAW_HEX_DISPLAY = 20;
const truncateHex = (value: string): string =>
  value.length <= MAX_RAW_HEX_DISPLAY ? value : `${value.slice(0, 10)}…${value.slice(-8)}`;

/**
 * BigInt-safe display form for one decoded custom-error argument:
 * addresses render checksummed, uints as grouped decimals, long byte blobs
 * truncated, and nested tuples/structs as compact JSON (bigints flattened
 * to their grouped-decimal strings so JSON.stringify can never throw).
 */
function formatErrorArg(value: unknown): string {
  if (typeof value === 'bigint') return groupDecimal(value);
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
      try {
        return getAddress(value);
      } catch {
        return value;
      }
    }
    if (/^0x[0-9a-fA-F]+$/.test(value)) return truncateHex(value);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(formatErrorArg).join(', ')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .map(([key, entry]) => `${JSON.stringify(key)}:${formatErrorArg(entry)}`)
      .join(',')}}`;
  }
  return String(value);
}

/** Display form for a decoded custom-error arg list: `arg1, arg2, …`. */
function formatErrorArgs(args: unknown): string {
  if (args === null || args === undefined) return '';
  // viem returns an array for decoded error args (named or positional);
  // a name-keyed object is accepted defensively and flattened by value.
  if (Array.isArray(args)) return args.map(formatErrorArg).join(', ');
  if (typeof args === 'object') {
    return Object.values(args as Record<string, unknown>).map(formatErrorArg).join(', ');
  }
  return formatErrorArg(args);
}

/**
 * Walk a viem error's `cause` chain for the raw 0x revert payload. viem
 * wraps node reverts (CallExecutionError → RpcError → …), and the hex data
 * sits on a `data` property somewhere along that chain.
 */
export function extractRevertData(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; typeof current === 'object' && current !== null && depth < 6; depth++) {
    const data = (current as { data?: unknown }).data;
    if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) return data;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** Display form for a single decoded ABI value. */
export function formatArgValue(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    // Hex blobs (addresses, hashes, bytes) stay verbatim; human strings
    // keep their quotes so "0x…" text args stay visually distinct.
    return /^0x[0-9a-fA-F]*$/.test(value) ? value : JSON.stringify(value);
  }
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Display form for a decoded arg list: `arg1, arg2, …`. */
export function formatCallArgs(args: readonly unknown[]): string {
  return args.map(formatArgValue).join(', ');
}
