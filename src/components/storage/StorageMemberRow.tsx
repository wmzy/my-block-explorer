// One row inside a struct/array column: slot chip + member label + type
// chip, then the affordance the row's expand class dictates — inline leaf
// value, Open ▸ drill button, or a mapping key input group. Mapping rows
// with LEAF value types resolve their value INLINE (slot computed here
// via encodeMappingKey + mappingValueSlot) instead of opening a column.
import { css } from '@linaria/core';
import { useEffect, useRef, useState } from 'react';
import type { Hex } from 'viem';
import type { StorageMapping, StorageType } from '@/types/storage';
import type { StructRow } from './columnModel';
import {
  encodeMappingKey,
  formatSlotDecimal,
  mappingValueSlot,
  validateMappingKey,
} from '@/utils/storageSlots';
import { StorageLeafValue } from './StorageLeafValue';

const rowStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
  padding: var(--haze-space-2) var(--haze-space-3);
  border-bottom: 1px solid var(--haze-color-border);

  &:last-child {
    border-bottom: none;
  }
`;

const rowTopStyle = css`
  display: flex;
  align-items: baseline;
  gap: var(--haze-space-2);
  flex-wrap: wrap;
  min-width: 0;
`;

const labelStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  font-weight: var(--haze-weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
`;

const typeChipStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-secondary);
  background: var(--haze-color-bg-muted);
  border-radius: var(--haze-radius-full);
  padding: 0 var(--haze-space-2);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const valueSlotStyle = css`
  flex: 1;
  min-width: 120px;
  overflow-wrap: anywhere;
`;

const openButtonStyle = css`
  padding: var(--haze-space-1) var(--haze-space-2);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-primary);
  background: transparent;
  border: 1px solid var(--haze-color-primary);
  border-radius: var(--haze-radius-sm);
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    background: var(--haze-color-bg-elevated);
  }

  &:disabled {
    color: var(--haze-color-text-muted);
    border-color: var(--haze-color-border);
    cursor: not-allowed;
  }
`;

const copyButtonStyle = css`
  padding: 0 var(--haze-space-1);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-secondary);
  background: transparent;
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-sm);
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    color: var(--haze-color-text);
    background: var(--haze-color-bg-muted);
  }
`;

const keyGroupStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
  padding-left: var(--haze-space-2);
`;

const keyInputRowStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  flex-wrap: wrap;
`;

const keyInputStyle = css`
  flex: 1;
  min-width: 140px;
  padding: var(--haze-space-1) var(--haze-space-2);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-sm);

  &:focus {
    outline: none;
    border-color: var(--haze-color-primary);
  }
`;

const errorTextStyle = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-danger);
`;

const mutedTextStyle = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-secondary);
`;

// Honest-clipboard copy button using the label-swap feedback idiom
// (EventTable's CopyButton): the label itself reports the real outcome of
// the clipboard call, never a guess. Kept local to the storage family.
export function CopyButton({
  text,
  label,
  title,
}: {
  text: string;
  label: string;
  title?: string;
}) {
  const [result, setResult] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setResult('ok');
    } catch {
      setResult('fail');
    }
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setResult('idle'), 2000);
  };

  return (
    <button
      type="button"
      className={copyButtonStyle}
      title={title}
      onClick={() => void handleCopy()}
    >
      {result === 'ok' ? 'Copied ✓' : result === 'fail' ? 'Copy failed' : label}
    </button>
  );
}

// Row affordance classification for a VALUE type (array elements and
// mapping values arrive as raw StorageTypes, not StructRows). Mirrors
// columnModel's private expandOf: the fixed-array length suffix must be
// tested before the struct prefix ('struct Account[3]' is an array, not a
// struct). The column a drill actually opens is produced by the same
// rules inside the resolver, so this must not drift.
function typeExpandOf(type: StorageType | null): StructRow['expand'] {
  if (type === null) return 'unknown';
  switch (type.encoding) {
    case 'mapping':
      return 'mapping';
    case 'dynamic_array':
      return 'array';
    case 'bytes':
      return 'leaf';
    case 'inplace':
      if (/\[\d+\]$/.test(type.label)) return 'array';
      if (type.label.startsWith('struct ')) {
        // Memberless struct labels (evmole) have nothing to drill into.
        return 'members' in type && Array.isArray(type.members) && type.members.length > 0 ? 'struct' : 'unknown';
      }
      return 'leaf';
  }
}

export type StorageMemberRowProps = {
  label: string;
  slot: Hex;
  // Struct rows show the `slot <decimal>` copy chip; array element rows
  // show their `[i]` index instead (spec) — except unknown-type elements,
  // which fall back to a raw hex slot chip.
  slotChip: 'decimal' | 'hex' | 'none';
  offset: number;
  type: StorageType | null;
  // Omitted for rows built from a raw value type (array elements): the
  // row then classifies its affordance through the same label rules the
  // resolver applies (typeExpandOf).
  expand?: StructRow['expand'];
  // layout.types lookup — mapping rows need their key/value types.
  typeLookup: (typeKey: string) => StorageType | null;
  onOpen: () => void;
  onOpenKey: (key: string) => void;
};

export function StorageMemberRow(props: StorageMemberRowProps) {
  const { label, slot, slotChip, type } = props;
  const expand = props.expand ?? typeExpandOf(type);
  return (
    <div className={rowStyle}>
      <div className={rowTopStyle}>
        {slotChip === 'decimal' && (
          <CopyButton text={slot} label={`slot ${formatSlotDecimal(slot)}`} title={slot} />
        )}
        {slotChip === 'hex' && (
          <CopyButton text={slot} label={`slot: ${shortHex(slot)}`} title={slot} />
        )}
        <span className={labelStyle} title={label}>
          {label}
        </span>
        <span className={typeChipStyle} title={type?.label ?? 'unknown type'}>
          {type?.label ?? 'unknown type'}
        </span>
        {expand === 'leaf' && (
          <span className={valueSlotStyle}>
            <StorageLeafValue slot={slot} offset={props.offset} type={type} />
          </span>
        )}
        {(expand === 'struct' || expand === 'array') && (
          <button type="button" className={openButtonStyle} onClick={props.onOpen}>
            Open ▸
          </button>
        )}
      </div>
      {expand === 'mapping' && type?.encoding === 'mapping' && (
        <MappingKeyGroup
          mappingType={type}
          slot={slot}
          typeLookup={props.typeLookup}
          onOpenKey={props.onOpenKey}
        />
      )}
    </div>
  );
}

function shortHex(slot: Hex): string {
  return slot.length <= 14 ? slot : `${slot.slice(0, 8)}…${slot.slice(-4)}`;
}

function MappingKeyGroup({
  mappingType,
  slot,
  typeLookup,
  onOpenKey,
}: {
  mappingType: StorageMapping;
  slot: Hex;
  typeLookup: (typeKey: string) => StorageType | null;
  onOpenKey: (key: string) => void;
}) {
  const valueType = typeLookup(mappingType.value);
  const valueExpand = typeExpandOf(valueType);
  // Key label for the placeholder and local validation: the types map is
  // authoritative; the `mapping(k => v)` label is the fallback (and the
  // source when the map lacks the key entry).
  const keyLabel = typeLookup(mappingType.key)?.label ?? extractKeyLabel(mappingType.label);

  const [keyText, setKeyText] = useState('');
  const validationError = validateMappingKey(keyText, keyLabel);
  const hasInput = keyText !== '';
  const keyValid = hasInput && validationError === null;
  // Composite values open a column; leaf values resolve inline below.
  const composite =
    valueType !== null &&
    (valueExpand === 'struct' || valueExpand === 'array' || valueExpand === 'mapping');

  const encoded =
    keyValid && valueType !== null && valueExpand === 'leaf'
      ? encodeMappingKey(keyText, keyLabel)
      : null;
  const inlineSlot =
    encoded !== null && !('error' in encoded) ? mappingValueSlot(encoded.encoded, slot) : null;

  const open = () => {
    if (keyValid && composite) onOpenKey(keyText);
  };

  return (
    <div className={keyGroupStyle}>
      <div className={keyInputRowStyle}>
        <input
          className={keyInputStyle}
          type="text"
          value={keyText}
          placeholder={`${keyLabel} key`}
          aria-label={`Mapping key for ${mappingType.label}`}
          onChange={e => setKeyText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              open();
            }
          }}
        />
        {composite && (
          <button type="button" className={openButtonStyle} disabled={!keyValid} onClick={open}>
            Open ▸
          </button>
        )}
      </div>
      {hasInput && validationError !== null && (
        <span className={errorTextStyle} role="alert">
          {validationError}
        </span>
      )}
      {keyValid && valueType === null && <span className={mutedTextStyle}>unknown value type</span>}
      {inlineSlot !== null && valueType !== null && (
        <StorageLeafValue slot={inlineSlot} offset={0} type={valueType} />
      )}
    </div>
  );
}

// 'mapping(address => struct Account)' → 'address' (the text before the
// first '=>'), used when the types map cannot resolve the key entry.
function extractKeyLabel(label: string): string {
  const match = /^mapping\(([^=]+)=>/.exec(label);
  return match === null ? label : match[1].trim();
}
