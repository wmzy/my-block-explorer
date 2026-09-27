// Pure helpers behind the ABI tab's list view: category bucketing,
// canonical dedup keys, human-readable signatures, and the merged-copy
// builder. Free of React so the semantics stay unit-testable; the key
// logic intentionally mirrors the local abiEntryKey in ContractInteract
// (facet merge) without either module importing the other.

// Minimal structural shape of one parsed ABI entry — deliberately loose
// (the same contract as ContractInteract's AbiEntry) so raw JSON.parse
// output feeds these helpers directly; extra fields such as `indexed` or
// `internalType` simply ride along into the copied output.
export type AbiListEntry = {
  type?: string;
  name?: string;
  inputs?: Array<{ type?: string }>;
  outputs?: Array<{ type?: string }>;
  stateMutability?: string;
};

// Type guard narrowing parsed JSON to entry-shaped objects: an array with
// junk members (server payloads are not validated) drops the junk rows
// instead of crashing the list.
export const isAbiListEntry = (value: unknown): value is AbiListEntry =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// read = state-inspecting function (view/pure), write = mutating function
// (nonpayable/payable); events and errors get their own buckets, and the
// ABI's singleton entries (constructor/receive/fallback, plus anything
// untyped) land in `other`.
export type AbiCategory = 'read' | 'write' | 'event' | 'error' | 'other';

export const ABI_CATEGORY_ORDER: readonly AbiCategory[] = [
  'read',
  'write',
  'event',
  'error',
  'other',
];

export const categoryOf = (entry: AbiListEntry): AbiCategory => {
  switch (entry.type) {
    case 'function':
      return entry.stateMutability === 'view' || entry.stateMutability === 'pure'
        ? 'read'
        : 'write';
    case 'event':
      return 'event';
    case 'error':
      return 'error';
    default:
      return 'other';
  }
};

// Canonical dedup key for one ABI entry: functions/events/errors key on
// name + input types (same signature = same selector) while the singleton
// entry types (constructor/receive/fallback) key on their type alone.
export const abiEntryKey = (entry: AbiListEntry): string => {
  const types = (entry.inputs ?? []).map(input => input.type ?? '').join(',');
  return `${entry.type ?? ''}:${entry.name ?? ''}(${types})`;
};

// Human-readable signature for the list rows: name(type, type), ` returns
// (…)` appended for functions with outputs, and event/error/constructor
// prefixes where they read naturally.
export const formatAbiSignature = (entry: AbiListEntry): string => {
  const name = entry.name ?? '';
  const inputs = (entry.inputs ?? []).map(input => input.type ?? '').join(', ');
  const base = `${name}(${inputs})`;
  switch (entry.type) {
    case 'function': {
      const outputs = (entry.outputs ?? []).map(output => output.type ?? '').join(', ');
      return outputs === '' ? base : `${base} returns (${outputs})`;
    }
    case 'event':
      return `event ${base}`;
    case 'error':
      return `error ${base}`;
    case 'constructor':
      return `constructor(${inputs})`;
    case 'receive':
      return 'receive()';
    case 'fallback':
      return inputs === '' ? 'fallback()' : `fallback(${inputs})`;
    default:
      return base;
  }
};

// Buckets entries into every category (empty buckets included), keeping
// the original ABI order inside each bucket.
export const categorize = (
  entries: readonly AbiListEntry[],
): Record<AbiCategory, AbiListEntry[]> => {
  const buckets: Record<AbiCategory, AbiListEntry[]> = {
    read: [],
    write: [],
    event: [],
    error: [],
    other: [],
  };
  for (const entry of entries) {
    buckets[categoryOf(entry)].push(entry);
  }
  return buckets;
};

// Per-category counts for the chip row.
export const categoryCounts = (
  entries: readonly AbiListEntry[],
): Record<AbiCategory, number> => {
  const buckets = categorize(entries);
  return {
    read: buckets.read.length,
    write: buckets.write.length,
    event: buckets.event.length,
    error: buckets.error.length,
    other: buckets.other.length,
  };
};

// Merged copy payload: the selected entries — in original ABI order —
// plus EVERY error definition, even unselected ones. Errors always ride
// along (hard product requirement): without the custom error types a
// pasted fragment cannot decode revert data, silently losing the most
// diagnostic part of the ABI. Deduped by canonical key; the emitted
// entries are the original objects with all their fields intact.
export const buildAbiCopy = (
  selectedKeys: ReadonlySet<string>,
  entries: readonly AbiListEntry[],
): string => {
  const seen = new Set<string>();
  const merged: AbiListEntry[] = [];
  for (const entry of entries) {
    const key = abiEntryKey(entry);
    if (seen.has(key)) continue;
    if (selectedKeys.has(key) || categoryOf(entry) === 'error') {
      seen.add(key);
      merged.push(entry);
    }
  }
  return JSON.stringify(merged, null, 2);
};

// Tolerant parse for feeding the list from a raw ABI string: malformed
// JSON or a non-array body resolves to an empty entry list (a corrupt
// stored paste must degrade to an empty list view, never crash the tab —
// the raw string still renders verbatim in the Raw JSON view).
export const parseAbiEntries = (raw: string): readonly AbiListEntry[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAbiListEntry);
  } catch {
    return [];
  }
};
