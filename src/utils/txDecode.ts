// Pure transaction-input and revert-payload decoding helpers. No network,
// no React — every function is deterministic and unit-testable in isolation.
import {
  decodeAbiParameters,
  decodeErrorResult,
  decodeFunctionData,
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
 */
export function decodeRevertReason(data: string, abi?: Abi): string | null {
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
      return typeof message === 'string' ? message : null;
    } catch {
      return null;
    }
  }

  if (selector === PANIC_SELECTOR) {
    try {
      const [code] = decodeAbiParameters(
        [{ type: 'uint256' }] as readonly AbiParameter[],
        // Same re-prefixing as the Error(string) branch above.
        `0x${data.slice(10)}`,
      );
      const codeHex = `0x${(code as bigint).toString(16).padStart(2, '0')}`;
      return `Panic ${codeHex}: ${PANIC_CODES[codeHex] ?? 'unknown panic code'}`;
    } catch {
      return null;
    }
  }

  if (abi !== undefined && abi.length > 0) {
    try {
      const { errorName, args } = decodeErrorResult({ abi, data: data as Hex });
      const argList = args ?? [];
      return argList.length > 0
        ? `${errorName}(${formatCallArgs(argList)})`
        : errorName;
    } catch {
      // Selector matches no error in the ABI — fall through.
    }
  }

  return null;
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
