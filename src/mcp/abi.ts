// JSON → viem argument coercion for the MCP read_contract tool.
//
// MCP clients send tool arguments as JSON, where every integer arrives as
// a `number` (precision-unsafe past 2^53) or a decimal string, while
// viem's encoder wants real `bigint`s for int/uint inputs. This module
// walks the parsed ABI fragment's input types and converts each value,
// failing with a field path (`args[1]`) so an agent can correct the exact
// argument. It is the MCP-side counterpart of the Interact form's
// paramParsing — but operating on structured JSON values, not form
// strings, so no comma-list/JSON-string grammar is needed here.

import { parseAbiItem, type AbiFunction, type AbiParameter } from 'viem';

export class McpArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpArgError';
  }
}

/** Parse a human-readable signature into a function fragment, with a caller-friendly error. */
export function parseFunctionFragment(signature: string): AbiFunction {
  let parsed: unknown;
  try {
    // Runtime strings (not literals) resolve to the broad fragment union;
    // the object checks below narrow to a function fragment.
    parsed = parseAbiItem(signature.trim());
  } catch (error) {
    throw new McpArgError(
      `Could not parse function signature: ${error instanceof Error ? error.message : String(error)}. ` +
      `Expected human-readable Solidity syntax, e.g. "function balanceOf(address account) view returns (uint256)".`,
    );
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'type' in parsed &&
    (parsed as { type: string }).type === 'function' &&
    'inputs' in parsed
  ) {
    return parsed as AbiFunction;
  }
  throw new McpArgError(
    `Signature did not parse to a function fragment (got "${signature}"). ` +
    `Use "function name(type arg, ...) [view] [returns (...)]".`,
  );
}

/**
 * Coerce a JSON argument list to viem values following the fragment's
 * declared input types. Length is checked here so viem's encoder never
 * sees a truncated/overlong args array (its error names no field).
 */
export function coerceArgs(args: readonly unknown[], fragment: AbiFunction): unknown[] {
  if (args.length !== fragment.inputs.length) {
    throw new McpArgError(
      `${fragment.name} takes ${fragment.inputs.length} argument(s), got ${args.length}.`,
    );
  }
  return args.map((value, index) => coerceArg(value, fragment.inputs[index], `args[${index}]`));
}

function coerceArg(value: unknown, input: AbiParameter, path: string): unknown {
  const type = input.type;
  // Array types (fixed `T[k]` and dynamic `T[]`), possibly nested.
  const arrayMatch = /^(.*)\[(\d*)\]$/.exec(type);
  if (arrayMatch !== null) {
    const elementType = arrayMatch[1];
    if (!Array.isArray(value)) {
      throw new McpArgError(`${path}: expected a JSON array for type ${type}`);
    }
    if (arrayMatch[2] !== '' && value.length !== Number(arrayMatch[2])) {
      throw new McpArgError(`${path}: type ${type} requires exactly ${arrayMatch[2]} elements, got ${value.length}`);
    }
    return value.map((element, index) =>
      coerceArg(element, { ...input, type: elementType }, `${path}[${index}]`),
    );
  }
  if (elementTypeIsTuple(type)) {
    if (!Array.isArray(value)) {
      throw new McpArgError(`${path}: expected a JSON array (tuple) for type ${type}`);
    }
    // viem's AbiParameter only carries components on its tuple variant;
    // this module keys off the type string, so read the field defensively.
    const components = (input as { components?: readonly AbiParameter[] }).components ?? [];
    if (components.length !== value.length) {
      throw new McpArgError(
        `${path}: tuple expects ${components.length} components, got ${value.length}`,
      );
    }
    return value.map((component, index) => coerceArg(component, components[index], `${path}[${index}]`));
  }
  return coerceScalar(value, type, path);
}

function elementTypeIsTuple(type: string): boolean {
  // After array unwrapping, a remaining base type starting with 'tuple'.
  return type === 'tuple' || type.startsWith('tuple ');
}

function coerceScalar(value: unknown, type: string, path: string): unknown {
  if (type === 'address') {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new McpArgError(`${path}: expected a 20-byte hex address, got ${preview(value)}`);
    }
    return value;
  }
  if (type === 'bool') {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new McpArgError(`${path}: expected true/false, got ${preview(value)}`);
  }
  if (type === 'string') {
    if (typeof value !== 'string') {
      throw new McpArgError(`${path}: expected a string, got ${preview(value)}`);
    }
    return value;
  }
  if (type.startsWith('uint') || type.startsWith('int')) {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
      if (!Number.isInteger(value)) {
        throw new McpArgError(`${path}: ${value} is not an integer — pass big values as decimal strings to keep precision`);
      }
      // JSON has no big integers, so JSON.parse already rounded a literal
      // past 2^53 (10000000000000001 became 10000000000000000) before this
      // function ever saw it. `isInteger` passes such a value, and sending
      // it would read a DIFFERENT number than the caller asked for — name
      // the value and the exact fix.
      if (!Number.isSafeInteger(value)) {
        throw new McpArgError(
          `${path}: ${value} exceeds the exact integer range — pass it as a decimal string to keep precision`,
        );
      }
      return BigInt(value);
    }
    if (typeof value === 'string' && /^(0x[0-9a-fA-F]+|-?\d+)$/.test(value)) {
      return BigInt(value);
    }
    throw new McpArgError(
      `${path}: expected an integer (number, decimal string, or 0x-hex string) for ${type}, got ${preview(value)}`,
    );
  }
  if (type.startsWith('bytes') || type === 'function') {
    if (typeof value !== 'string' || !value.startsWith('0x')) {
      throw new McpArgError(`${path}: expected a 0x-prefixed hex string for ${type}, got ${preview(value)}`);
    }
    return value;
  }
  // Unknown base type: pass through and let viem's encoder judge it —
  // its error is still surfaced verbatim to the caller.
  return value;
}

function preview(value: unknown): string {
  const text = typeof value === 'string' ? `"${value}"` : String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}
