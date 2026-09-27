// Pure view-model for the Contract page's Finder-style storage columns.
// No React, no network — resolveColumns turns a storage layout plus a
// drill-down path into one ResolvedColumn per browser column, computing
// concrete slots and symbolic slot expressions as it goes.
//
// Navigation model:
//   'm' drills a struct member by label; a mapping member resolves to a
//      single-row struct node (the mapping shell) that 'k' then consumes
//   'k' types a mapping key (encoded via @/utils/storageSlots) and
//      resolves the VALUE's node (struct/array/leaf/mapping shell)
//   'i' picks an array element (packed placement via arrayElementPlacement)
//   'a' re-ranges the current array column view (same node data)
//
// A segment that cannot resolve produces a column with `error` set;
// resolution stops there — later segments are ignored.

import type {
  StorageLayout,
  StorageMember,
  StorageStruct,
  StorageType,
  TypesMap,
} from '@/types/storage';
import {
  arrayElementPlacement,
  dynamicArrayDataSlot,
  encodeMappingKey,
  keyTypeFamily,
  mappingValueSlot,
  normalizeSlot,
  parseSlotNumber,
  slotAdd,
} from '@/utils/storageSlots';
import { exprAdd, exprKeccakConcat, exprPad, type SlotExpr } from '@/utils/storageSlotCode';
import type { Hex } from 'viem';

export type Segment =
  | { t: 'm'; label: string } // member within the current struct node
  | { t: 'k'; key: string } // mapping key (as typed by the user)
  | { t: 'i'; index: number } // array element
  | { t: 'a'; from: number; to: number }; // array column view (from inclusive, to exclusive)

export const MAX_COLUMN_SPAN = 64;
export const DEFAULT_COLUMN_SPAN = 8;

const ROOT_LABEL = 'Storage';
// Inplace labels that carry a compile-time length suffix.
const FIXED_ARRAY_LABEL_PATTERN = /\[(\d+)\]$/;

/**
 * Clamp an [from, to) element window into a live array: in-bounds, span
 * of at least 1 and at most MAX_COLUMN_SPAN, to > from. A non-positive
 * length collapses to the empty window { 0, 0 }.
 */
export function clampRange(from: number, to: number, length: number): { from: number; to: number } {
  const len = Number.isFinite(length) ? Math.floor(length) : 0;
  if (len <= 0) return { from: 0, to: 0 };
  const start = Math.max(0, Math.min(Math.floor(from), len - 1));
  const end = Math.min(Math.max(start + 1, Math.min(Math.floor(to), len)), start + MAX_COLUMN_SPAN);
  return { from: start, to: end };
}

export type StructRow = {
  label: string;
  slot: Hex;
  expr: SlotExpr | null;
  offset: number;
  // null → 'unknown type' row (layout.types may be null — evmole layouts)
  type: StorageType | null;
  expand: 'struct' | 'array' | 'mapping' | 'leaf' | 'unknown';
};

export type ColumnNode =
  | { kind: 'struct'; typeLabel: string; rows: StructRow[] }
  | {
    kind: 'array';
    elementType: StorageType | null;
    dataSlot: Hex;
    dataExpr: SlotExpr;
    fixedLength: number | null;
    baseLabel: string;
  }
  | { kind: 'leaf'; type: StorageType; slot: Hex; expr: SlotExpr };

export type ResolvedColumn = {
  // FULL prefix from root to this column
  segments: Segment[];
  // 'Storage' for root; else m→label, k/i→[seg], a→skipped, concatenated
  pathLabel: string;
  // base slot of the node (struct base / array data slot); root: null
  slot: Hex | null;
  expr: SlotExpr | null;
  node: ColumnNode;
  // column renders an error card; resolution stops after it
  error?: string;
};

// Root rows carry their absolute compiler slot as a bare bigint literal
// with the marker idiom (matching the upstream reference's root form).
function slotLiteralExpr(slot: string, label: string): SlotExpr {
  return `/* ${label}< */${parseSlotNumber(slot)}n/* >*/`;
}

function expandOf(type: StorageType | null): StructRow['expand'] {
  if (type === null) return 'unknown';
  switch (type.encoding) {
    case 'mapping':
      return 'mapping';
    case 'dynamic_array':
      return 'array';
    case 'bytes':
      return 'leaf';
    case 'inplace':
      // Order matters: solc labels fixed arrays of structs
      // 'struct Account[3]' — the length suffix wins over the prefix.
      if (FIXED_ARRAY_LABEL_PATTERN.test(type.label)) return 'array';
      // Memberless struct labels (evmole) have nothing to drill into.
      if (type.label.startsWith('struct ')) {
        return 'members' in type && Array.isArray(type.members) && type.members.length > 0 ? 'struct' : 'unknown';
      }
      return 'leaf';
  }
}

// Struct member slots are RELATIVE to the struct's base slot (solc
// storage-layout convention), so each row adds its member slot to the
// struct's absolute slot/expr. Root rows (base null) use absolute slots.
function structRows(
  members: StorageMember[],
  types: TypesMap | null,
  baseSlot: Hex | null,
  baseExpr: SlotExpr | null,
): StructRow[] {
  return members.map(member => {
    const type = types?.[member.type] ?? null;
    return {
      label: member.label,
      slot: baseSlot === null ? normalizeSlot(member.slot) : slotAdd(baseSlot, parseSlotNumber(member.slot)),
      expr:
        baseExpr === null
          ? slotLiteralExpr(member.slot, member.label)
          : exprAdd(baseExpr, parseSlotNumber(member.slot), member.label),
      offset: member.offset,
      type,
      expand: expandOf(type),
    };
  });
}

function fixedArrayLength(label: string): number | null {
  const match = FIXED_ARRAY_LABEL_PATTERN.exec(label);
  return match === null ? null : Number(match[1]);
}

function isStructType(type: StorageType): type is StorageStruct {
  // 'struct Account[3]' is a fixed ARRAY of structs, not a struct —
  // exclude length-suffixed labels before matching the struct prefix.
  // Memberless 'struct X' entries (evmole) are NOT drillable structs —
  // without members there is nothing a struct column could show.
  return (
    type.encoding === 'inplace' &&
    !FIXED_ARRAY_LABEL_PATTERN.test(type.label) &&
    type.label.startsWith('struct ') &&
    'members' in type &&
    Array.isArray(type.members) &&
    type.members.length > 0
  );
}

function isFixedArrayType(type: StorageType): boolean {
  return type.encoding === 'inplace' && FIXED_ARRAY_LABEL_PATTERN.test(type.label);
}

// Array column node for a fixed or dynamic array at slot/expr. Fixed
// arrays place elements at their own base; dynamic arrays at
// keccak256(pad(base)).
function arrayNode(
  type: StorageType,
  slot: Hex,
  expr: SlotExpr,
  types: TypesMap | null,
): ColumnNode {
  const dynamic = type.encoding === 'dynamic_array';
  const base = dynamic ? type.base : (type as { base: string }).base;
  const elementType = types?.[base] ?? null;
  return {
    kind: 'array',
    elementType,
    dataSlot: dynamic ? dynamicArrayDataSlot(slot) : slot,
    dataExpr: dynamic ? `keccak256(${exprPad(expr)})` : expr,
    fixedLength: dynamic ? null : fixedArrayLength(type.label),
    baseLabel: elementType?.label ?? base,
  };
}

// The node a VALUE type resolves to at a concrete slot/expr: used for
// mapping values, array elements and member drills alike.
function valueNodeFor(
  type: StorageType,
  slot: Hex,
  expr: SlotExpr,
  types: TypesMap | null,
): ColumnNode {
  if (isStructType(type)) {
    return {
      kind: 'struct',
      typeLabel: type.label,
      rows: structRows(type.members, types, slot, expr),
    };
  }
  if (isFixedArrayType(type) || type.encoding === 'dynamic_array') {
    return arrayNode(type, slot, expr, types);
  }
  if (type.encoding === 'mapping') {
    // A mapping whose value is another mapping: expose it as its own
    // single-row shell so a following 'k' can drill again.
    return {
      kind: 'struct',
      typeLabel: type.label,
      rows: [{ label: type.label, slot, expr, offset: 0, type, expand: 'mapping' }],
    };
  }
  return { kind: 'leaf', type, slot, expr };
}

// Symbolic h(key) expression mirroring encodeMappingKey's byte math.
// Called only after encodeMappingKey has validated the key.
function keyExprFor(key: string, keyTypeLabel: string): SlotExpr {
  const trimmed = key.trim();
  switch (keyTypeFamily(keyTypeLabel)) {
    case 'uint':
      // The key stays quoted: a leading-zero decimal ('007') would parse
      // as a forbidden octal literal inside the snippet.
      return `pad(toHex(BigInt(/* key< */'${trimmed}'/* >*/)), { size: 32 })`;
    case 'int':
      return `pad(toHex(BigInt.asUintN(256n, BigInt(/* key< */'${trimmed}'/* >*/))), { size: 32 })`;
    case 'bool':
      return `pad(toHex(/* key< */${trimmed.toLowerCase() === 'true'}/* >*/), { size: 32 })`;
    case 'address':
      return `pad(/* key< */'${trimmed.toLowerCase()}'/* >*/ as \`0x\${string}\`, { size: 32 })`;
    case 'string':
      return `keccak256(toHex(/* key< */'${escapeJsString(key)}'/* >*/))`;
    case 'bytes': {
      const normalized = trimmed.toLowerCase();
      if (keyTypeLabel.trim() === 'bytes') {
        return `keccak256(/* key< */'${normalized}'/* >*/ as \`0x\${string}\`)`;
      }
      return `pad(/* key< */'${normalized}'/* >*/ as \`0x\${string}\`, { size: 32, dir: 'right' })`;
    }
    default:
      throw new Error(`unsupported key type for expression: ${keyTypeLabel}`);
  }
}

// Single-quote a key for embedding inside a snippet string literal.
function escapeJsString(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('\'', '\\\'')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r');
}

function appendPathLabel(base: string, seg: Segment): string {
  switch (seg.t) {
    case 'm':
      return `${base}.${seg.label}`;
    case 'k':
      return `${base}[${seg.key}]`;
    case 'i':
      return `${base}[${seg.index}]`;
    case 'a':
      return base; // array range view — same node, no label fragment
  }
}

// Error columns still need a node (the contract's ResolvedColumn shape);
// the UI renders the error card instead of it.
function errorColumn(prev: ResolvedColumn, seg: Segment, message: string): ResolvedColumn {
  return {
    segments: [...prev.segments, seg],
    pathLabel: appendPathLabel(prev.pathLabel, seg),
    slot: null,
    expr: null,
    node: { kind: 'struct', typeLabel: '', rows: [] },
    error: message,
  };
}

function resolveSegment(prev: ResolvedColumn, seg: Segment, layout: StorageLayout): ResolvedColumn {
  if (seg.t === 'm') {
    if (prev.node.kind !== 'struct') {
      return errorColumn(prev, seg, 'Member segment requires a struct column');
    }
    const row = prev.node.rows.find(candidate => candidate.label === seg.label);
    if (row === undefined) {
      return errorColumn(prev, seg, `Unknown member: ${seg.label}`);
    }
    if (row.type === null) {
      return errorColumn(
        prev,
        seg,
        `Unknown type for ${seg.label} — the layout carries no type information`,
      );
    }
    if (row.expr === null) {
      return errorColumn(prev, seg, `No slot expression for ${seg.label}`);
    }
    if (row.expand === 'mapping') {
      // Single-row mapping shell: the next 'k' segment consumes it.
      return {
        segments: [...prev.segments, seg],
        pathLabel: appendPathLabel(prev.pathLabel, seg),
        slot: row.slot,
        expr: row.expr,
        node: { kind: 'struct', typeLabel: row.type.label, rows: [row] },
      };
    }
    if (row.expand === 'leaf' || row.expand === 'unknown') {
      return errorColumn(
        prev,
        seg,
        `Cannot drill into ${seg.label}: ${row.type.label} is a value, not a container`,
      );
    }
    const node = valueNodeFor(row.type, row.slot, row.expr, layout.types);
    // Column slot is the node's base: struct base (and the mapping
    // shell's own slot) or, for arrays, the element data slot.
    const isArray = node.kind === 'array';
    return {
      segments: [...prev.segments, seg],
      pathLabel: appendPathLabel(prev.pathLabel, seg),
      slot: isArray ? node.dataSlot : row.slot,
      expr: isArray ? node.dataExpr : row.expr,
      node,
    };
  }

  if (seg.t === 'k') {
    if (prev.node.kind !== 'struct') {
      return errorColumn(prev, seg, 'This key does not apply to this column');
    }
    const mappingRows = prev.node.rows.filter(candidate => candidate.expand === 'mapping');
    if (mappingRows.length === 0) {
      return errorColumn(prev, seg, 'No mapping in this column to unlock with a key');
    }
    if (mappingRows.length > 1) {
      return errorColumn(
        prev,
        seg,
        'This key could unlock several mappings here — open one mapping row first',
      );
    }
    const row = mappingRows[0];
    if (row.type?.encoding !== 'mapping') {
      return errorColumn(prev, seg, 'This column holds no openable mapping');
    }
    const keyTypeLabel = layout.types?.[row.type.key]?.label ?? row.type.key;
    const encoded = encodeMappingKey(seg.key, keyTypeLabel);
    if ('error' in encoded) {
      return errorColumn(prev, seg, encoded.error);
    }
    const valueType = layout.types?.[row.type.value] ?? null;
    if (valueType === null) {
      return errorColumn(prev, seg, `Unknown value type for mapping ${row.type.label}`);
    }
    if (row.expr === null) {
      return errorColumn(prev, seg, `No slot expression for mapping ${row.type.label}`);
    }
    const valueSlot = mappingValueSlot(encoded.encoded, row.slot);
    const valueExpr = exprKeccakConcat(keyExprFor(seg.key, keyTypeLabel), exprPad(row.expr));
    const node = valueNodeFor(valueType, valueSlot, valueExpr, layout.types);
    const isArray = node.kind === 'array';
    return {
      segments: [...prev.segments, seg],
      pathLabel: appendPathLabel(prev.pathLabel, seg),
      slot: isArray ? node.dataSlot : valueSlot,
      expr: isArray ? node.dataExpr : valueExpr,
      node,
    };
  }

  if (seg.t === 'i') {
    if (prev.node.kind !== 'array') {
      return errorColumn(prev, seg, 'Index segment requires an array column');
    }
    if (!Number.isInteger(seg.index) || seg.index < 0) {
      return errorColumn(prev, seg, `Invalid array index: ${String(seg.index)}`);
    }
    const elementType = prev.node.elementType;
    if (elementType === null) {
      return errorColumn(
        prev,
        seg,
        'Unknown element type — the layout carries no type information',
      );
    }
    const elementBytes = Number(elementType.numberOfBytes);
    if (!Number.isInteger(elementBytes) || elementBytes < 1) {
      return errorColumn(prev, seg, `Invalid element byte size: ${elementType.numberOfBytes}`);
    }
    const { slotDelta } = arrayElementPlacement(seg.index, elementBytes);
    const slot = slotAdd(prev.node.dataSlot, BigInt(slotDelta));
    const expr = exprAdd(prev.node.dataExpr, slotDelta, `index ${seg.index}`);
    const node = valueNodeFor(elementType, slot, expr, layout.types);
    // A nested array element re-bases onto the nested array's data slot.
    const isArray = node.kind === 'array';
    return {
      segments: [...prev.segments, seg],
      pathLabel: appendPathLabel(prev.pathLabel, seg),
      slot: isArray ? node.dataSlot : slot,
      expr: isArray ? node.dataExpr : expr,
      node,
    };
  }

  // 'a' — re-range the current array view, keeping the resolved context.
  if (prev.node.kind !== 'array') {
    return errorColumn(prev, seg, 'Range segment requires an array column');
  }
  if (seg.from < 0 || seg.to <= seg.from || seg.to - seg.from > MAX_COLUMN_SPAN) {
    return errorColumn(prev, seg, `Invalid range ${seg.from}-${seg.to}`);
  }
  return {
    segments: [...prev.segments, seg],
    pathLabel: prev.pathLabel,
    slot: prev.slot,
    expr: prev.expr,
    node: { ...prev.node },
  };
}

/**
 * Resolve one column per path prefix: column 0 is the root struct
 * (layout.storage rows); column i>0 is segments.slice(0, i+1) resolved
 * against the previous column. The first segment that fails produces an
 * error column and stops resolution.
 */
export function resolveColumns(layout: StorageLayout, segments: Segment[]): ResolvedColumn[] {
  const columns: ResolvedColumn[] = [
    {
      segments: [],
      pathLabel: ROOT_LABEL,
      slot: null,
      expr: null,
      node: {
        kind: 'struct',
        typeLabel: ROOT_LABEL,
        rows: structRows(layout.storage, layout.types, null, null),
      },
    },
  ];
  for (const seg of segments) {
    const prev = columns[columns.length - 1];
    if (prev === undefined || prev.error !== undefined) break;
    columns.push(resolveSegment(prev, seg, layout));
  }
  return columns;
}

/**
 * Storage path → URL param: segments joined by '/', each
 * `m.<label>` | `k.<encodeURIComponent(key)>` | `i.<n>` | `a.<from>-<to>`.
 * Undefined for an empty path (omit the param entirely).
 */
export function encodeStoragePath(segments: Segment[]): string | undefined {
  if (segments.length === 0) return undefined;
  return segments
    .map(seg => {
      switch (seg.t) {
        case 'm':
          return `m.${seg.label}`;
        case 'k':
          return `k.${encodeURIComponent(seg.key)}`;
        case 'i':
          return `i.${seg.index}`;
        case 'a':
          return `a.${seg.from}-${seg.to}`;
      }
    })
    .join('/');
}

/**
 * URL param → segments. Returns [] for undefined (param absent = root).
 * ANY malformed input — empty string, junk prefix, negative index,
 * non-numeric range, truncated segment, oversized or inverted range,
 * broken percent-escapes — returns null; never throws.
 */
export function decodeStoragePath(raw: string | undefined): Segment[] | null {
  if (raw === undefined) return [];
  const segments: Segment[] = [];
  for (const part of raw.split('/')) {
    const dot = part.indexOf('.');
    if (dot < 1) return null;
    const kind = part.slice(0, dot);
    const rest = part.slice(dot + 1);
    if (kind === 'm') {
      if (rest === '') return null;
      segments.push({ t: 'm', label: rest });
    } else if (kind === 'k') {
      if (rest === '') return null;
      try {
        segments.push({ t: 'k', key: decodeURIComponent(rest) });
      } catch {
        return null;
      }
    } else if (kind === 'i') {
      if (!/^\d+$/.test(rest)) return null;
      segments.push({ t: 'i', index: Number(rest) });
    } else if (kind === 'a') {
      const match = /^(\d+)-(\d+)$/.exec(rest);
      if (match === null) return null;
      const from = Number(match[1]);
      const to = Number(match[2]);
      if (to <= from || to - from > MAX_COLUMN_SPAN) return null;
      segments.push({ t: 'a', from, to });
    } else {
      return null;
    }
  }
  return segments;
}

// ---- evmole label-first type augmentation ---------------------------------
//
// evmole (bytecode-inferred layouts) marks EVERY type entry `inplace` and
// carries the real shape only in the label ('string',
// 'mapping(address => bool)', 'address[]'). One deterministic pass
// rewrites such entries into canonical solc shapes — synthesizing missing
// nested entries keyed by their own labels — so classification, mapping
// drills, array pagination and bytes decoding behave identically for
// verified and inferred layouts.

function labelByteSize(label: string): number {
  const t = label.trim();
  if (t === 'address' || t.startsWith('contract ')) return 20;
  if (t === 'bool' || t.startsWith('enum ')) return 1;
  const width = /^(?:u?int)(\d+)$/.exec(t);
  if (width !== null) return Math.max(1, Math.ceil(Number(width[1]) / 8));
  const bytesN = /^bytes(\d+)$/.exec(t);
  if (bytesN !== null) return Number(bytesN[1]);
  return 32;
}

// Split 'K => V' on the TOP-LEVEL '=>' — the value may itself be a nested
// 'mapping(...)' containing deeper arrows inside its parentheses.
function splitTopLevelArrow(s: string): [string, string] | null {
  let depth = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && c === '=' && s[i + 1] === '>') {
      const left = s.slice(0, i).trim();
      const right = s.slice(i + 2).trim();
      if (left === '' || right === '') return null;
      return [left, right];
    }
  }
  return null;
}

const MAPPING_LABEL_PATTERN = /^mapping\((.+)\)$/;
const DYNAMIC_ARRAY_LABEL_PATTERN = /^(.+)\[\]$/;
const FIXED_ARRAY_LABEL_WITH_BASE_PATTERN = /^(.+)\[(\d+)\]$/;

// Canonicalize one type label; returns the entry shape or null when the
// label already matches its entry (plain inplace value type).
function entryFromLabel(
  label: string,
  keyFor: (label: string) => string,
): Partial<StorageType> & { encoding: StorageType['encoding'] } | null {
  const t = label.trim();
  if (t === 'string' || t === 'bytes') {
    return { encoding: 'bytes', label: t, numberOfBytes: '32' };
  }
  const mapping = MAPPING_LABEL_PATTERN.exec(t);
  if (mapping !== null) {
    const split = splitTopLevelArrow(mapping[1]);
    if (split === null) return null;
    return {
      encoding: 'mapping',
      label: t,
      numberOfBytes: '32',
      key: keyFor(split[0]),
      value: keyFor(split[1]),
    };
  }
  const dynamic = DYNAMIC_ARRAY_LABEL_PATTERN.exec(t);
  if (dynamic !== null && !dynamic[1].includes('[')) {
    return {
      encoding: 'dynamic_array',
      label: t,
      numberOfBytes: '32',
      base: keyFor(dynamic[1]),
    } as Partial<StorageType> & { encoding: StorageType['encoding'] };
  }
  const fixed = FIXED_ARRAY_LABEL_WITH_BASE_PATTERN.exec(t);
  if (fixed !== null && !fixed[1].endsWith(']')) {
    return {
      encoding: 'inplace',
      label: t,
      numberOfBytes: String(Number(fixed[2]) * labelByteSize(fixed[1])),
      base: keyFor(fixed[1]),
    } as Partial<StorageType> & { encoding: StorageType['encoding'] };
  }
  return null;
}

/**
 * Rewrite an evmole-style layout's types into canonical solc shapes.
 * Entries whose label already matches their encoding pass through
 * untouched; verified-layout inputs are byte-identical after the pass.
 */
export function augmentLayoutTypes(layout: StorageLayout): StorageLayout {
  if (layout.types === null) return layout;
  const types: TypesMap = { ...layout.types };
  // Resolve (or synthesize) the types-map key for a label, recursively.
  const keyFor = (label: string): string => {
    const existing = Object.keys(types).find(k => types[k].label === label);
    if (existing !== undefined) return existing;
    const synthesized = entryFromLabel(label, keyFor);
    types[label] = (synthesized ?? {
      encoding: 'inplace',
      label,
      numberOfBytes: String(labelByteSize(label)),
    }) as StorageType;
    return label;
  };
  for (const [key, entry] of Object.entries(layout.types)) {
    if (entry.encoding !== 'inplace') continue;
    const canonical = entryFromLabel(entry.label, keyFor);
    if (canonical !== null) types[key] = canonical as StorageType;
  }
  // Storage members may reference type keys the map never lists (evmole
  // uses the LABEL itself as the member's type key) — synthesize those
  // too, or the rows would classify from a missing entry. Struct entries
  // carry nested member refs for the same reason.
  const ensureMemberType = (typeKey: string): void => {
    if (!(typeKey in types)) keyFor(typeKey);
  };
  for (const m of layout.storage) ensureMemberType(m.type);
  for (const entry of Object.values(types)) {
    if (entry.encoding === 'inplace' && 'members' in entry && Array.isArray(entry.members)) {
      for (const m of entry.members) ensureMemberType(m.type);
    }
  }
  return { storage: layout.storage, types };
}
