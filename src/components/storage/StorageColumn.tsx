// One Finder column card: header (path label, slot chip, viem/cast copy
// buttons, per-column refresh, close) plus the body the resolved node
// dictates — struct member rows, an array length/range/element view, an
// inline leaf value, or a muted error card. All navigation intents are
// delegated upward; this component only renders and reports.
import { css } from '@linaria/core';
import { useEffect, useState, type ReactNode } from 'react';
import { hexToBigInt, pad, type Hex } from 'viem';
import { clampRange, type ResolvedColumn } from './columnModel';
import type { StorageType } from '@/types/storage';
import { arrayElementPlacement, slotAdd } from '@/utils/storageSlots';
import { buildCastStorageCommand, buildViemReadSnippet, exprAdd } from '@/utils/storageSlotCode';
import { useRefreshStorageValues, useSlotValue } from '@/services/storageValues';
import { EmptyState } from '@/components/ui/ErrorState';
import { CopyButton, StorageMemberRow } from './StorageMemberRow';
import { StorageLeafValue } from './StorageLeafValue';

// Beyond this length an array is "huge": the addressable window for the
// range controls is capped at the first 100k elements and the length line
// says so.
const HUGE_ARRAY = 100_000;

const columnStyle = css`
  flex: none;
  width: min(360px, 85vw);
  display: flex;
  flex-direction: column;
  background: var(--haze-color-bg-subtle);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  overflow: hidden;
`;

const headerStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
  padding: var(--haze-space-2) var(--haze-space-3);
  background: var(--haze-color-bg-muted);
  border-bottom: 1px solid var(--haze-color-border);
`;

const headerTitleStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text);
  overflow-wrap: anywhere;
`;

const headerControlsStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  flex-wrap: wrap;
`;

const iconButtonStyle = css`
  padding: 0 var(--haze-space-2);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
  background: transparent;
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-sm);
  cursor: pointer;
  line-height: 1.4;

  &:hover {
    color: var(--haze-color-text);
    background: var(--haze-color-bg-elevated);
  }
`;

const bodyStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
  padding: var(--haze-space-2) var(--haze-space-3);
  min-height: 0;
`;

const errorCardStyle = css`
  padding: var(--haze-space-3);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
  overflow-wrap: anywhere;
`;

const lengthLineStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
`;

const lengthErrorStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-danger);
`;

const rangeStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  flex-wrap: wrap;
`;

const rangeInputStyle = css`
  width: 72px;
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

const rangeButtonStyle = css`
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

const mutedNoteStyle = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
`;

export type StorageColumnProps = {
  column: ResolvedColumn;
  chainId: number;
  // Values (and the viem/cast snippets) target the address users interact
  // with — the proxy under the impl toggle.
  address: string;
  // Dynamic array columns: the member slot holding the live length word
  // (the element data slot the column itself exposes is keccak-derived).
  lengthSlot: Hex | null;
  // Current view window from the path's 'a' segment (or the default).
  range: { from: number; to: number };
  onClose: () => void;
  onOpenMember: (label: string) => void;
  // A mapping row's key drill carries BOTH segments: 'm' locates the
  // mapping shell, 'k' then consumes it (resolver contract — a bare 'k'
  // cannot pick a mapping out of a multi-member column).
  onOpenMappingKey: (label: string, key: string) => void;
  onOpenIndex: (index: number) => void;
  // Element of a mapping-typed array: the key drill needs the element's
  // mapping-shell column, so index + key travel together.
  onOpenElementMappingKey: (index: number, key: string) => void;
  onRangeChange: (from: number, to: number) => void;
  typeLookup: (typeKey: string) => StorageType | null;
};

export function StorageColumn(props: StorageColumnProps) {
  const { column } = props;
  const isRoot = column.segments.length === 0;

  if (column.error !== undefined) {
    return (
      <section className={columnStyle} aria-label={column.pathLabel}>
        <ColumnHeader
          column={column}
          chainId={props.chainId}
          address={props.address}
          isRoot={isRoot}
          onClose={props.onClose}
          onRefresh={() => undefined}
        />
        <div className={errorCardStyle}>{column.error}</div>
      </section>
    );
  }

  if (column.node.kind === 'struct') {
    return <StructColumn {...props} isRoot={isRoot} />;
  }
  if (column.node.kind === 'array') {
    // Fixed arrays know their length statically; dynamic arrays read it
    // from the member slot (split into sub-components so the live read
    // hook mounts only when there is a length slot to read).
    return column.node.fixedLength !== null ? (
      <ArrayColumn {...props} isRoot={isRoot} length={column.node.fixedLength} lengthLine={null} />
    ) : props.lengthSlot !== null ? (
      <LiveArrayColumn {...props} isRoot={isRoot} lengthSlot={props.lengthSlot} />
    ) : (
      <ArrayColumn
        {...props}
        isRoot={isRoot}
        length={undefined}
        lengthLine={<span className={mutedNoteStyle}>length unknown</span>}
      />
    );
  }
  return <LeafColumn {...props} isRoot={isRoot} />;
}

function ColumnHeader({
  column,
  chainId,
  address,
  isRoot,
  onClose,
  onRefresh,
}: {
  column: ResolvedColumn;
  chainId: number;
  address: string;
  isRoot: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className={headerStyle}>
      <div className={headerTitleStyle} title={column.pathLabel}>
        {column.pathLabel}
      </div>
      <div className={headerControlsStyle}>
        {column.slot !== null && (
          <CopyButton
            text={column.slot}
            label={`slot: ${shortHex(column.slot)}`}
            title={column.slot}
          />
        )}
        {column.expr !== null && (
          <CopyButton
            text={buildViemReadSnippet({ chainId, address, slotExpr: column.expr })}
            label="viem"
            title="Copy a runnable viem snippet reading this column's base slot"
          />
        )}
        {column.slot !== null && (
          <CopyButton
            text={buildCastStorageCommand({ address, slot: column.slot, chainId })}
            label="cast"
            title="Copy the foundry-cast command reading this column's base slot"
          />
        )}
        <button
          type="button"
          className={iconButtonStyle}
          aria-label={`Refresh ${column.pathLabel} values`}
          title="Re-read this column's displayed slots"
          onClick={onRefresh}
        >
          ⟳
        </button>
        {!isRoot && (
          <button
            type="button"
            className={iconButtonStyle}
            aria-label={`Close ${column.pathLabel} column`}
            title="Close this column and everything to its right"
            onClick={onClose}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function StructColumn(props: StorageColumnProps & { isRoot: boolean }) {
  const { column, typeLookup, onOpenMember, onOpenMappingKey } = props;
  const refresh = useRefreshStorageValues();
  // Dispatch guarantees kind === 'struct' here; the runtime guard keeps
  // the narrowing honest without a cast.
  const node = column.node.kind === 'struct' ? column.node : null;
  if (!node) return null;
  // Per-column refresh covers exactly the words this column displays:
  // leaf member values. Mapping inline values and long-bytes data slots
  // register in the shared store — the explorer-wide ⟳ Refresh re-reads
  // those (refresh() with no args re-reads every entry).
  const slots = node.rows
    .filter(row => row.expand === 'leaf')
    .map(row => row.slot)
    .filter((slot, index, all) => all.indexOf(slot) === index);

  return (
    <section className={columnStyle} aria-label={column.pathLabel}>
      <ColumnHeader
        column={column}
        chainId={props.chainId}
        address={props.address}
        isRoot={props.isRoot}
        onClose={props.onClose}
        onRefresh={() => refresh(slots)}
      />
      <div className={bodyStyle}>
        {node.rows.map(row => (
          <StorageMemberRow
            key={`${row.label}:${row.slot}:${row.offset}`}
            label={row.label}
            slot={row.slot}
            expr={row.expr}
            chainId={props.chainId}
            address={props.address}
            slotChip="decimal"
            offset={row.offset}
            type={row.type}
            expand={row.expand}
            typeLookup={typeLookup}
            onOpen={() => onOpenMember(row.label)}
            onOpenKey={key => onOpenMappingKey(row.label, key)}
          />
        ))}
      </div>
    </section>
  );
}

function LeafColumn(props: StorageColumnProps & { isRoot: boolean }) {
  const { column } = props;
  const refresh = useRefreshStorageValues();
  const node = column.node.kind === 'leaf' ? column.node : null;
  if (!node) return null;
  return (
    <section className={columnStyle} aria-label={column.pathLabel}>
      <ColumnHeader
        column={column}
        chainId={props.chainId}
        address={props.address}
        isRoot={props.isRoot}
        onClose={props.onClose}
        onRefresh={() => refresh([node.slot])}
      />
      <div className={bodyStyle}>
        <StorageLeafValue slot={node.slot} offset={0} type={node.type} />
      </div>
    </section>
  );
}

// Dynamic array column: reads the live length word from the member slot.
function LiveArrayColumn(props: StorageColumnProps & { isRoot: boolean; lengthSlot: Hex }) {
  const state = useSlotValue(props.lengthSlot);
  if (state.status === 'ok' && state.value !== null) {
    const length = Number(hexToBigInt(pad(state.value, { size: 32 })));
    const effective = length > HUGE_ARRAY ? HUGE_ARRAY : length;
    return (
      <ArrayColumn
        {...props}
        length={effective}
        lengthLine={(
          <span className={lengthLineStyle}>
            length: {length}
            {length > HUGE_ARRAY
              ? ` (huge — first ${HUGE_ARRAY.toLocaleString('en-US')} addressable)`
              : ''}
          </span>
        )}
      />
    );
  }
  if (state.status === 'error') {
    return (
      <ArrayColumn
        {...props}
        length={undefined}
        lengthLine={(
          <span className={lengthErrorStyle} title={state.error ?? undefined}>
            length read failed
          </span>
        )}
      />
    );
  }
  return (
    <ArrayColumn
      {...props}
      length={undefined}
      lengthLine={<span className={lengthLineStyle}>length: …</span>}
    />
  );
}

function ArrayColumn(
  props: StorageColumnProps & {
    isRoot: boolean;
    length: number | undefined;
    lengthLine: ReactNode;
  },
) {
  const { column, range, length, lengthLine, typeLookup } = props;
  const refresh = useRefreshStorageValues();
  const node = column.node;
  if (node.kind !== 'array') return null; // narrowed by the caller
  // The window actually rendered: clamped by the live/fixed length so a
  // stale range (or the 0..8 default) never shows out-of-bounds elements.
  const renderRange = clampRange(range.from, range.to, length ?? Number.MAX_SAFE_INTEGER);

  const elementType = node.elementType;
  const elementBytes = elementType === null ? 0 : Number(elementType.numberOfBytes);
  const placementOk = elementType !== null && Number.isInteger(elementBytes) && elementBytes >= 1;

  // Per-column refresh: the length word (dynamic) plus the displayed
  // element slots.
  const refreshSlots: Hex[] = [];
  if (node.fixedLength === null && props.lengthSlot !== null) refreshSlots.push(props.lengthSlot);
  if (placementOk && elementType !== null) {
    for (let idx = renderRange.from; idx < renderRange.to; idx += 1) {
      const placement = arrayElementPlacement(idx, elementBytes);
      const slot = slotAdd(node.dataSlot, BigInt(placement.slotDelta));
      if (!refreshSlots.includes(slot)) refreshSlots.push(slot);
    }
  }

  return (
    <section className={columnStyle} aria-label={column.pathLabel}>
      <ColumnHeader
        column={column}
        chainId={props.chainId}
        address={props.address}
        isRoot={props.isRoot}
        onClose={props.onClose}
        onRefresh={() => refresh(refreshSlots)}
      />
      <div className={bodyStyle}>
        {lengthLine}
        {elementType === null ? (
          <span className={mutedNoteStyle}>unknown element type</span>
        ) : (
          <>
            <RangeControls
              range={renderRange}
              length={length}
              onRangeChange={props.onRangeChange}
            />
            {renderRange.to === 0 ? (
              <EmptyState message="Empty array" />
            ) : (
              Array.from({ length: renderRange.to - renderRange.from }, (_, i) => {
                const idx = renderRange.from + i;
                // Unknown placement cannot happen here (placementOk
                // above narrows numberOfBytes) — falling back to the raw
                // data slot stays honest just in case.
                const placement = placementOk
                  ? arrayElementPlacement(idx, elementBytes)
                  : { slotDelta: 0, offset: 0 };
                return (
                  <StorageMemberRow
                    key={idx}
                    label={`[${idx}]`}
                    slot={slotAdd(node.dataSlot, BigInt(placement.slotDelta))}
                    // Symbolic element expr = data base + the same delta
                    // the slot carries, so array rows copy runnable
                    // snippets too.
                    expr={exprAdd(node.dataExpr, BigInt(placement.slotDelta))}
                    chainId={props.chainId}
                    address={props.address}
                    slotChip={placementOk ? 'none' : 'hex'}
                    offset={placement.offset}
                    type={elementType}
                    typeLookup={typeLookup}
                    onOpen={() => props.onOpenIndex(idx)}
                    onOpenKey={key => props.onOpenElementMappingKey(idx, key)}
                  />
                );
              })
            )}
          </>
        )}
      </div>
    </section>
  );
}

function RangeControls({
  range,
  length,
  onRangeChange,
}: {
  range: { from: number; to: number };
  length: number | undefined;
  onRangeChange: (from: number, to: number) => void;
}) {
  const [fromText, setFromText] = useState(String(range.from));
  const [toText, setToText] = useState(String(range.to));

  // External range changes (Prev/Next, clamps, browser back) resync the
  // text inputs; typing keeps local edits until commit.
  useEffect(() => {
    setFromText(String(range.from));
    setToText(String(range.to));
  }, [range.from, range.to]);

  const span = range.to - range.from;

  const commit = (nextFrom: string, nextTo: string) => {
    const from = Number(nextFrom);
    const to = Number(nextTo);
    if (nextFrom === '' || nextTo === '' || !Number.isInteger(from) || !Number.isInteger(to)) {
      setFromText(String(range.from));
      setToText(String(range.to));
      return;
    }
    const clamped = clampRange(from, to, length ?? Number.MAX_SAFE_INTEGER);
    onRangeChange(clamped.from, clamped.to);
  };

  return (
    <div className={rangeStyle}>
      <button
        type="button"
        className={rangeButtonStyle}
        disabled={range.from <= 0}
        onClick={() => commit(String(range.from - span), String(range.to - span))}
      >
        ◂ Prev
      </button>
      <input
        className={rangeInputStyle}
        type="number"
        min={0}
        aria-label="Range start index"
        value={fromText}
        onChange={e => setFromText(e.target.value)}
        onBlur={() => commit(fromText, toText)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(fromText, toText);
          }
        }}
      />
      <input
        className={rangeInputStyle}
        type="number"
        min={1}
        aria-label="Range end index (exclusive)"
        value={toText}
        onChange={e => setToText(e.target.value)}
        onBlur={() => commit(fromText, toText)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(fromText, toText);
          }
        }}
      />
      <button
        type="button"
        className={rangeButtonStyle}
        disabled={length !== undefined && range.from + span >= length}
        onClick={() => commit(String(range.from + span), String(range.to + span))}
      >
        Next ▸
      </button>
    </div>
  );
}

function shortHex(slot: Hex): string {
  return slot.length <= 14 ? slot : `${slot.slice(0, 8)}…${slot.slice(-4)}`;
}
