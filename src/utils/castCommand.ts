// Foundry `cast` command builder for the contract Interact form.
//
// The Interact tab only simulates calls in the browser; users who want to
// run the same call from a terminal (or broadcast a write with their own
// key) get a paste-ready `cast` command here. Two shapes are produced:
//
//  - signature form: `cast call <address> "name(type,...)" <args...>` —
//    used whenever every filled argument is a scalar the cast CLI can
//    parse inline;
//  - calldata form: `cast call <address> 0x<calldata>` — the fallback for
//    array/tuple arguments (the cast CLI cannot express composites
//    inline), encoded with viem's encodeFunctionData so the bytes are
//    exactly what this form's submit path sends through readContract /
//    simulateContract.
//
// Write functions select `cast send` and carry a literal
// `<ENTER_YOUR_KEY>` private-key placeholder: the command is complete and
// honest about the one secret it cannot supply — never a fabricated key.
//
// Everything here is pure string assembly over the SAME validation the
// form uses (paramParsing.parseFunctionArgs), so the command is buildable
// exactly when the form's submit would encode successfully.

import { encodeFunctionData } from 'viem';
import type { AbiFunction, AbiParameter } from 'viem';
import {
  parseFunctionArgs,
  type ParamComponent,
  type ParamDescriptor,
} from '@/views/Contract/paramParsing';

// Subset of EnhancedContractFunction the builder needs; the full form
// function object satisfies it structurally.
export type CastableFunction = {
  name: string;
  inputs: readonly ParamDescriptor[];
  stateMutability: 'pure' | 'view' | 'nonpayable' | 'payable';
};

export type CastCommand =
  | {
    ok: true;
    mode: 'call' | 'send';
    /** 'signature' = inline CLI args, 'calldata' = raw 0x fallback. */
    form: 'signature' | 'calldata';
    command: string;
    calldata: string;
  }
  | {
    ok: false;
    reason: string;
  };

const INT_TYPE_PATTERN = /^(u?)int(\d+)?$/;
// Rightmost array suffix — the same shape paramParsing peels, so any
// array (fixed, dynamic, nested) is detected.
const ARRAY_SUFFIX_PATTERN = /^(.*)\[(\d*)]$/;

// Build the cast command for one function's current form state. `rawArgs`
// are the form's raw input strings; a null/undefined entry is a missing
// value and makes the command unbuildable (the caller disables its copy
// button with the reason). `valueWei` carries a payable function's parsed
// wei amount (cast interprets a bare --value as wei).
export function buildCastCommand({
  func,
  rawArgs,
  contractAddress,
  rpcUrl,
  valueWei,
}: {
  func: CastableFunction;
  rawArgs: readonly (string | null | undefined)[];
  contractAddress: string;
  rpcUrl: string;
  valueWei?: string;
}): CastCommand {
  // An explicit null/undefined argument cannot be formatted; refuse it
  // instead of silently treating it as an omitted trailing empty.
  if (rawArgs.some(arg => arg == null)) {
    return { ok: false, reason: 'missing argument value' };
  }
  const args = rawArgs as readonly string[];

  const parsed = parseFunctionArgs(func.inputs, args);
  if (!parsed.isValid) {
    return {
      ok: false,
      reason: parsed.fieldErrors.find(err => err !== '') ?? 'invalid arguments',
    };
  }

  // The form's trailing-empty rule: the trailing run of empty inputs is
  // omitted from the encoded call (with an overloaded ABI, viem then
  // selects the shorter signature). The command mirrors that on both
  // fronts — its argument list AND its signature use the shortened
  // inputs, so calldata and signature agree with what submit sends.
  const effectiveInputs = func.inputs.slice(0, parsed.values.length);

  let calldata: string;
  try {
    calldata = encodeFunctionData({
      abi: [toAbiFunction(func, effectiveInputs)],
      functionName: func.name,
      args: parsed.values,
    });
  } catch (error) {
    return { ok: false, reason: `cannot encode calldata: ${describeError(error)}` };
  }

  const mode =
    func.stateMutability === 'view' || func.stateMutability === 'pure' ? 'call' : 'send';
  const useCalldataForm = effectiveInputs.some(input => isCompositeType(input.type));

  const parts = [`cast ${mode}`, contractAddress];
  if (useCalldataForm) {
    parts.push(calldata);
  } else {
    parts.push(`"${canonicalSignature(func.name, effectiveInputs)}"`);
    effectiveInputs.forEach((input, index) => {
      parts.push(formatCastArg(input.type, parsed.values[index]));
    });
  }
  if (valueWei !== undefined) {
    parts.push(`--value ${valueWei}`);
  }
  parts.push(`--rpc-url ${rpcUrl}`);
  if (mode === 'send') {
    parts.push('--private-key <ENTER_YOUR_KEY>');
  }

  return {
    ok: true,
    mode,
    form: useCalldataForm ? 'calldata' : 'signature',
    command: parts.join(' '),
    calldata,
  };
}

// cast cannot express arrays or tuples as inline CLI arguments — any such
// input forces the pre-encoded calldata form.
function isCompositeType(type: string): boolean {
  return type === 'tuple' || ARRAY_SUFFIX_PATTERN.test(type);
}

// Canonical name(types) signature over the EFFECTIVE inputs, matching the
// shortened signature viem's overload selection would encode.
function canonicalSignature(name: string, inputs: readonly ParamDescriptor[]): string {
  return `${name}(${inputs.map(input => input.type).join(',')})`;
}

// One CLI word per argument: address/int/bool go bare (cast parses them
// natively, and the form has already validated their shape); strings,
// bytes, and any exotic passthrough type are single-quoted so spaces and
// punctuation survive the shell.
function formatCastArg(type: string, value: unknown): string {
  if (type === 'bool') {
    return value === true ? 'true' : 'false';
  }
  if (type === 'address' || INT_TYPE_PATTERN.test(type)) {
    return String(value);
  }
  return shellQuote(String(value));
}

// POSIX single-quoting: wrap in '…' and splice every embedded quote as
// '\'' so the pasted command survives any POSIX shell.
function shellQuote(text: string): string {
  return `'${text.replaceAll('\'', '\'\\\'\'')}'`;
}

// Single-entry ABI for viem's encoder, built from the same input
// descriptors the form validates against (tuple components preserved).
function toAbiFunction(func: CastableFunction, inputs: readonly ParamDescriptor[]): AbiFunction {
  return {
    type: 'function',
    name: func.name,
    stateMutability: func.stateMutability,
    inputs: inputs.map(toAbiParameter),
    outputs: [],
  };
}

// Nested tuple members may be unnamed (ParamComponent.name is optional);
// the encoder ignores names, so positional '' keeps the ABI entry valid.
function toAbiParameter(input: ParamComponent): AbiParameter {
  return input.components === undefined
    ? { name: input.name ?? '', type: input.type }
    : {
        name: input.name ?? '',
        type: input.type,
        components: input.components.map(toAbiParameter),
      };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
