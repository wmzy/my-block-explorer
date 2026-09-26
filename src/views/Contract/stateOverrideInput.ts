// Client-side parser for the Interact state-override editor (foundry-style
// eth_call state overrides). The textarea holds the exact JSON map the
// backend accepts on the simulate endpoints (see @/utils/stateOverride for
// the wire contract), so structural validation delegates to that shared,
// pure validator — one rulebook on both ends, verdicts cannot drift. This
// module adds only the textarea-level concerns: JSON tokenization, the
// empty-input no-op, and the conversion into viem's StateOverride shape
// used by the client-side simulate transport.

import { parseStateOverride, type StateOverride } from '@/utils/stateOverride';
import type {
  Address,
  Hex,
  StateOverride as ViemStateOverride,
  StateMapping as ViemStateMapping,
} from 'viem';

export type StateOverrideInputResult =
  | { ok: true; value: StateOverride | undefined; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * Parse the state-override textarea. Never throws — empty/whitespace input
 * is `ok` with `undefined` value (the request stays byte-identical to the
 * pre-override wire format), a valid JSON object is validated by the
 * shared server-side rulebook, and every rejection comes back as
 * field-path'd sentences in the established style.
 */
export function parseStateOverrideInput(text: string): StateOverrideInputResult {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: true, value: undefined, warnings: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`stateOverride: not valid JSON (${reason})`] };
  }

  const result = parseStateOverride(parsed);
  if (!result.ok) {
    return { ok: false, errors: result.details };
  }

  // The shared rulebook allows state + stateDiff on one address, but the
  // viem transport refuses the pair (StateAssignmentConflictError) — a
  // full replacement and a patch are contradictory anyway. Reject it here
  // with a named field instead of letting the simulate die downstream.
  const errors: string[] = [];
  for (const [address, entry] of Object.entries(result.value)) {
    if (entry.state !== undefined && entry.stateDiff !== undefined) {
      errors.push(`${address}.state: cannot combine state and stateDiff on one address`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // An empty map is a no-op: drop it so the request stays byte-identical
  // to the pre-override behavior, and say so instead of staying silent.
  if (Object.keys(result.value).length === 0) {
    return {
      ok: true,
      value: undefined,
      warnings: ['stateOverride: empty object — no override will be sent'],
    };
  }

  return { ok: true, value: result.value, warnings: [] };
}

// viem's element type minus its OneOf union: the union demands state or
// stateDiff on EVERY entry, but its serializer (and the RPC) happily take
// balance/nonce/code-only overrides — a common foundry case. The local
// shape carries all-optional storage fields and crosses to viem's type
// with one assertion at the return boundary below.
type ViemStateOverrideElement = {
  address: Address;
  balance?: bigint;
  nonce?: number;
  code?: Hex;
  state?: ViemStateMapping;
  stateDiff?: ViemStateMapping;
};

const toStateMapping = (map: Record<`0x${string}`, `0x${string}`>): ViemStateMapping =>
  Object.entries(map).map(([slot, value]) => ({ slot: slot as Hex, value }));

/**
 * Convert a validated wire map into viem's StateOverride array (hex
 * quantities become JS numbers, storage maps become [{slot, value}]
 * lists). The input MUST come from a successful parse: the shared
 * regexes guarantee BigInt/Number convert cleanly and slots are exactly
 * 32 bytes, and the parser's extra rule guarantees state/stateDiff
 * exclusivity per address.
 */
export function toViemStateOverride(value: StateOverride): ViemStateOverride {
  const entries: ViemStateOverrideElement[] = Object.entries(value).map(([address, entry]) => ({
    address: address as Address,
    ...(entry.balance !== undefined ? { balance: BigInt(entry.balance) } : {}),
    ...(entry.nonce !== undefined ? { nonce: Number(BigInt(entry.nonce)) } : {}),
    ...(entry.code !== undefined ? { code: entry.code } : {}),
    ...(entry.state !== undefined ? { state: toStateMapping(entry.state) } : {}),
    ...(entry.stateDiff !== undefined ? { stateDiff: toStateMapping(entry.stateDiff) } : {}),
  }));
  return entries as ViemStateOverride;
}
