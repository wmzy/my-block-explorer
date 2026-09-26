// Pure validator for eth_call-style state overrides (foundry/cast
// parity) as they arrive on the JSON wire: a map keyed by address, each
// entry overriding that account for the duration of one simulated call.
//
// The validator never throws; every rejection comes back as a
// field-path'd sentence so the API can answer 400 with actionable
// details. Values are kept exactly as given (hex strings, no numeric
// coercion) — the RPC layer owns bigint conversion.

/** One account's override; at least one field is required per entry. */
export type StateOverrideEntry = {
  /** Wei balance as a canonical hex quantity (e.g. '0x1'). */
  balance?: `0x${string}`;
  /** Account nonce as a canonical hex quantity (e.g. '0x1'). */
  nonce?: `0x${string}`;
  /** Deployed bytecode as even-length hex bytes, at least one byte. */
  code?: `0x${string}`;
  /** Full storage replacement: 32-byte slot hex → 32-byte value hex. */
  state?: Record<`0x${string}`, `0x${string}`>;
  /** Per-slot storage patch: 32-byte slot hex → 32-byte value hex. */
  stateDiff?: Record<`0x${string}`, `0x${string}`>;
};

/** Address hex (any casing, exactly as given) → that account's override. */
export type StateOverride = Record<string, StateOverrideEntry>;

export type StateOverrideParseResult =
  | { ok: true; value: StateOverride }
  | { ok: false; details: string[] };

// Hex quantity: 0x-prefixed, canonical — zero or no leading zeros.
const HEX_QUANTITY_RE = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
// Bytecode: 0x-prefixed whole bytes, at least one byte (≥ 2 hex chars).
const HEX_BYTES_RE = /^0x(?:[0-9a-fA-F]{2})+$/;
// Storage slot or value: exactly 32 bytes.
const HEX_32_BYTE_RE = /^0x[0-9a-fA-F]{64}$/;
// Address key: 0x-prefixed, 40 hex characters, any casing.
const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// Caps mirror what one eth_call override can usefully express without
// becoming a state upload; they also bound request size.
const MAX_ADDRESSES = 10;
const MAX_SLOTS_PER_MAP = 32;

// Keeps echoed raw values in error sentences bounded.
const preview = (raw: unknown): string => {
  const text = typeof raw === 'string' ? raw : (JSON.stringify(raw) ?? String(raw));
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
};

const isObject = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);

// Validates one state/stateDiff map: every key and value must be a
// 32-byte hex string. Returns null (after appending details) if invalid.
const parseStorageMap = (
  address: string,
  field: 'state' | 'stateDiff',
  raw: unknown,
  details: string[],
): Record<`0x${string}`, `0x${string}`> | null => {
  if (!isObject(raw)) {
    details.push(
      `${address}.${field}: must be an object mapping 32-byte slot hex to 32-byte value hex`,
    );
    return null;
  }

  const entries = Object.entries(raw);
  if (entries.length > MAX_SLOTS_PER_MAP) {
    details.push(`${address}.${field}: too many slots (max ${MAX_SLOTS_PER_MAP})`);
    return null;
  }

  const map: Record<`0x${string}`, `0x${string}`> = {};
  let valid = true;
  for (const [slot, slotValue] of entries) {
    if (!HEX_32_BYTE_RE.test(slot)) {
      details.push(`${address}.${field}: slot key ${preview(slot)} is not a 32-byte hex value`);
      valid = false;
      continue;
    }
    if (typeof slotValue !== 'string' || !HEX_32_BYTE_RE.test(slotValue)) {
      details.push(`${address}.${field}[${slot}]: value must be a 32-byte hex value`);
      valid = false;
      continue;
    }
    map[slot as `0x${string}`] = slotValue as `0x${string}`;
  }
  return valid ? map : null;
};

/**
 * Validate a wire-format state override. Never throws — all rejections
 * come back as `{ ok: false, details }` with one field-path'd sentence
 * per problem ('<address>.<field>: …' or 'stateOverride: …').
 */
export function parseStateOverride(raw: unknown): StateOverrideParseResult {
  if (!isObject(raw)) {
    return { ok: false, details: ['stateOverride: must be an object keyed by address'] };
  }

  const entries = Object.entries(raw);
  if (entries.length > MAX_ADDRESSES) {
    return { ok: false, details: [`stateOverride: too many addresses (max ${MAX_ADDRESSES})`] };
  }

  const details: string[] = [];
  const value: StateOverride = {};

  for (const [address, entryRaw] of entries) {
    if (!HEX_ADDRESS_RE.test(address)) {
      details.push(`stateOverride: address key ${preview(address)} is not a valid hex address`);
      continue;
    }

    if (!isObject(entryRaw)) {
      details.push(`${address}: must be an object`);
      continue;
    }

    const entry: StateOverrideEntry = {};
    const fields = Object.entries(entryRaw);

    for (const [field, fieldValue] of fields) {
      switch (field) {
        case 'balance':
        case 'nonce':
          if (typeof fieldValue !== 'string' || !HEX_QUANTITY_RE.test(fieldValue)) {
            details.push(`${address}.${field}: must be a hex quantity like 0x1 (no leading zeros)`);
          } else {
            entry[field] = fieldValue as `0x${string}`;
          }
          break;
        case 'code':
          if (typeof fieldValue !== 'string' || !HEX_BYTES_RE.test(fieldValue)) {
            details.push(
              `${address}.code: must be even-length hex bytecode of at least one byte`,
            );
          } else {
            entry.code = fieldValue as `0x${string}`;
          }
          break;
        case 'state':
        case 'stateDiff': {
          const map = parseStorageMap(address, field, fieldValue, details);
          if (map) {
            entry[field] = map;
          }
          break;
        }
        default:
          details.push(
            `${address}.${field}: unknown field (expected balance, nonce, code, state, or stateDiff)`,
          );
      }
    }

    if (fields.length === 0) {
      details.push(`${address}: at least one override field is required`);
    } else {
      value[address] = entry;
    }
  }

  if (details.length > 0) {
    return { ok: false, details };
  }
  return { ok: true, value };
}
