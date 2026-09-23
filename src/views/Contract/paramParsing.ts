// Pure argument parsing for the contract Interact form.
//
// viem's encoder takes scalars as strings (decimal ints, hex bytes) but a
// composite input typed as the raw string '[0x..,0x..]' throws
// InvalidArrayError, and the failure reaches the user as a generic
// encoding error with no pointer to the offending field. This module turns
// raw form strings into real JS values (arrays, tuples, booleans) and
// validates every field — array elements and tuple components included —
// so failures surface inline with messages like `addrs[1]: invalid address`.
//
// Composite input syntax: a JSON-style array ('["0x..","0x.."]', single
// quotes tolerated), a bare comma-separated list ('0x..,0x..'), and — for
// tuples — a parenthesized list ('(1, 0x..)'). Lists are split on the raw
// text (never JSON.parse values) so huge integer literals keep full
// precision.
//
// Empty-input rule: only the trailing run of empty inputs may be left
// empty; it is omitted from the encoded call (with an overloaded ABI, viem
// then selects the shorter signature). An empty input followed by a filled
// one is a field-level 'required' error.

import type { Abi } from 'viem';

import { ApiError } from '@/util/apiError';
import { describeRevertData, extractRevertData } from '@/utils/txDecode';

// A nested ABI component as viem models it: `name` is optional (unnamed
// tuple members exist), so labels fall back to the position.
export type ParamComponent = {
  name?: string;
  type: string;
  internalType?: string;
  components?: readonly ParamComponent[];
};

// ABI input shape consumed by the parser. `components` rides on tuple
// inputs (preserved by parseContractFunctionsUnified) and is what makes
// recursive tuple validation possible.
export type ParamDescriptor = ParamComponent & {
  name: string;
};

export type ParsedArgs = {
  // viem-ready values; the trailing run of omitted inputs is truncated
  // away so the encoder receives only what the user filled in.
  values: unknown[];
  // One message per input ('' when the input is valid or legally omitted).
  fieldErrors: string[];
  // False as soon as any field error is set.
  isValid: boolean;
};

type ParseResult = { value?: unknown; error?: string };

// Exported for the Interact form's From-address inline validation (same
// 0x-prefixed 40-hex shape the parser accepts for address parameters).
export const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BOOL_PATTERN = /^(true|false)$/i;
const HEX_PATTERN = /^0x[0-9a-fA-F]*$/;
const INT_PATTERN = /^(u?)int(\d+)?$/;
// Rightmost array suffix: 'address[]', 'uint256[3]', 'tuple[2]', and the
// outer suffix of nested shapes like 'uint256[2][]'.
const ARRAY_SUFFIX_PATTERN = /^(.*)\[(\d*)\]$/;

// Human-facing field label: the ABI parameter name when present, else the
// position, so error messages always identify the input.
export function paramLabel(input: ParamDescriptor, index: number): string {
  return input.name !== '' ? input.name : `arg ${index}`;
}

// Parse the raw string inputs of a function form against its ABI inputs.
export function parseFunctionArgs(
  inputs: readonly ParamDescriptor[],
  rawArgs: readonly string[],
): ParsedArgs {
  const trimmed = inputs.map((_, i) => (rawArgs[i] ?? '').trim());
  // Index of the last filled input; everything after it is the trailing
  // run that may be left empty and omitted from the call.
  const lastFilled = trimmed.reduce((last, value, i) => (value !== '' ? i : last), -1);

  const fieldErrors: string[] = inputs.map(() => '');
  const values: unknown[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const label = paramLabel(inputs[i], i);
    if (trimmed[i] === '') {
      if (i <= lastFilled) {
        fieldErrors[i] = `${label}: required`;
      }
      continue;
    }
    const result = parseValue(inputs[i], trimmed[i], label);
    if (result.error === undefined) {
      values[i] = result.value;
    } else {
      fieldErrors[i] = result.error;
    }
  }

  return {
    values: values.slice(0, lastFilled + 1),
    fieldErrors,
    isValid: fieldErrors.every(err => err === ''),
  };
}

function parseValue(desc: ParamComponent, raw: string, label: string): ParseResult {
  const arrayMatch = ARRAY_SUFFIX_PATTERN.exec(desc.type);
  if (arrayMatch) {
    const elementType = arrayMatch[1];
    if (elementType === '') {
      return { error: `${label}: unsupported type '${desc.type}'` };
    }
    const fixedLength = arrayMatch[2] === '' ? undefined : Number(arrayMatch[2]);
    return parseArray(desc, elementType, fixedLength, raw, label);
  }
  if (desc.type === 'tuple') {
    return parseTuple(desc, raw, label);
  }
  const scalar = parseScalar(desc.type, raw);
  // Scalar messages ('invalid address') are composed at their label so
  // both top-level fields and nested elements read `name[i]: reason`.
  return scalar.error === undefined ? scalar : { error: `${label}: ${scalar.error}` };
}

function parseArray(
  desc: ParamComponent,
  elementType: string,
  fixedLength: number | undefined,
  raw: string,
  label: string,
): ParseResult {
  const split = splitList(raw);
  if ('error' in split) {
    return { error: `${label}: ${split.error}` };
  }
  if (fixedLength !== undefined && split.elements.length !== fixedLength) {
    return { error: `${label}: expected ${fixedLength} items, got ${split.elements.length}` };
  }

  // Tuple component metadata stays attached while the suffix is peeled.
  const elementDesc: ParamDescriptor = {
    name: '',
    type: elementType,
    components: desc.components,
  };

  const values: unknown[] = [];
  for (let i = 0; i < split.elements.length; i++) {
    const result = parseValue(elementDesc, split.elements[i], `${label}[${i}]`);
    if (result.error !== undefined) {
      return { error: result.error };
    }
    values.push(result.value);
  }
  return { value: values };
}

function parseTuple(desc: ParamComponent, raw: string, label: string): ParseResult {
  const components = desc.components ?? [];
  const split = splitList(raw);
  if ('error' in split) {
    return { error: `${label}: ${split.error}` };
  }
  if (split.elements.length !== components.length) {
    return {
      error: `${label}: expected ${components.length} tuple values, got ${split.elements.length}`,
    };
  }

  const values: unknown[] = [];
  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    const componentLabel = component.name ? `${label}.${component.name}` : `${label}[${i}]`;
    const result = parseValue(component, split.elements[i], componentLabel);
    if (result.error !== undefined) {
      return { error: result.error };
    }
    values.push(result.value);
  }
  return { value: values };
}

function parseScalar(type: string, raw: string): ParseResult {
  if (type === 'address') {
    return ADDRESS_PATTERN.test(raw) ? { value: raw } : { error: 'invalid address' };
  }

  if (type === 'bool') {
    if (!BOOL_PATTERN.test(raw)) {
      return { error: 'invalid bool — use true or false' };
    }
    return { value: raw.toLowerCase() === 'true' };
  }

  if (type === 'string') {
    return { value: raw };
  }

  if (type === 'bytes' || /^bytes\d+$/.test(type)) {
    if (!HEX_PATTERN.test(raw)) {
      return { error: `invalid ${type} — expected 0x-prefixed hex` };
    }
    const hex = raw.slice(2);
    if (type === 'bytes') {
      // Odd-length hex would be silently padded by the encoder; reject it
      // so the user sees the bytes they will actually send.
      if (hex.length % 2 !== 0) {
        return { error: 'invalid bytes — odd hex length' };
      }
      return { value: raw };
    }
    const expected = Number(type.slice(5)) * 2;
    if (hex.length !== expected) {
      return { error: `invalid ${type} — expected ${expected} hex digits` };
    }
    return { value: raw };
  }

  const intMatch = INT_PATTERN.exec(type);
  if (intMatch) {
    const signed = intMatch[1] !== 'u';
    const bits = intMatch[2] === undefined ? 256 : Number(intMatch[2]);
    let parsed: bigint;
    try {
      parsed = BigInt(raw);
    } catch {
      return { error: `invalid ${type} — expected an integer` };
    }
    const limit = 1n << BigInt(bits - (signed ? 1 : 0));
    if (parsed >= limit || (signed ? parsed < -limit : parsed < 0n)) {
      return { error: `value out of range for ${type}` };
    }
    // Decimal (and 0x-hex) strings are BigInt-safe in the encoder.
    return { value: raw };
  }

  // Unknown/exotic types pass through; the encoder reports them honestly.
  return { value: raw };
}

type SplitResult = { elements: string[] } | { error: string };

// Splits a list literal into element strings, respecting nesting brackets
// and quoted strings. Splits the raw text rather than JSON.parse values so
// integer literals beyond Number.MAX_SAFE_INTEGER keep full precision.
function splitList(raw: string): SplitResult {
  let text = raw.trim();
  const open = text[0];
  const close = text[text.length - 1];
  if (open === '[' && close === ']') {
    text = text.slice(1, -1);
  } else if (open === '(' && close === ')') {
    text = text.slice(1, -1);
  } else if (open === '[' || open === '(') {
    return { error: 'malformed list — missing closing bracket' };
  }

  if (text.trim() === '') {
    return { elements: [] };
  }

  const elements: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === '\\') {
        current += ch + (text[i + 1] ?? '');
        i++;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === '\'') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '[' || ch === '(') {
      depth++;
    } else if (ch === ']' || ch === ')') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      elements.push(unquote(current));
      current = '';
      continue;
    }
    current += ch;
  }
  if (quote !== null || depth !== 0) {
    return { error: 'malformed list — unbalanced brackets or quotes' };
  }
  elements.push(unquote(current));
  return { elements };
}

// Trims an element and removes one matching pair of surrounding quotes
// (single or double), un-escaping simple backslash escapes.
function unquote(element: string): string {
  const trimmed = element.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
      return trimmed.slice(1, -1).replace(/\\(['"\\])/g, '$1');
    }
  }
  return trimmed;
}

// Revert-data enrichment for read/simulate/send failures: walks the viem
// BaseError cause chain for the raw 0x revert payload (the hex sits on a
// `data` property of some inner error) and decodes it against the panel's
// ABI. Only custom errors produce output — viem's own message already
// carries Error(string)/Panic reasons, while custom errors surface as a
// generic "The contract function 'x' reverted." dump when the raw error is
// unavailable. Returns null when there is nothing to decode so callers
// keep their existing classification untouched.
export function describeRevertedCall(error: unknown, abi?: Abi): string | null {
  if (abi === undefined || abi.length === 0) return null;
  const data = extractRevertData(error);
  if (data === null) return null;
  const description = describeRevertData(data, abi);
  if (description?.kind !== 'custom') return null;
  return `ContractFunctionReverted: ${description.name}(${description.argsText})`;
}

// Faithful error rendering for read/simulate call failures: ApiError keeps
// its status, encoder errors keep their message, and only transport
// failures (fetch TypeErrors, viem's 'HTTP request failed') get the
// network label. Nothing is collapsed into a generic message. When an ABI
// is supplied and the failure carries decodable revert data, the decoded
// custom error leads instead — enrichment, not replacement: every other
// path renders exactly as before.
export function describeCallError(error: unknown, abi?: Abi): string {
  const reverted = describeRevertedCall(error, abi);
  if (reverted !== null) return reverted;

  if (error instanceof ApiError) {
    return `API error (${error.status}): ${error.message}`;
  }
  if (error instanceof TypeError) {
    return `Network error: ${error.message}`;
  }
  if (error instanceof Error) {
    if (/^HTTP request failed/i.test(error.message)) {
      return `Network error: ${error.message}`;
    }
    return error.message;
  }
  if (typeof error === 'string' && error !== '') {
    return error;
  }
  return 'Unknown error';
}
