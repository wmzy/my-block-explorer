// Finder-style storage explorer: owns the drill-down path (Segment[]) as
// view state, mirrors it into the ?sv= URL param through onPathChange,
// and renders one StorageColumn per resolved column. Slot reads flow
// through a StorageValuesProvider created here (values toggle wires both
// the provider's enabled flag and the store's setEnabled via the
// provider's own layout effect).
import { css } from '@linaria/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Hex } from 'viem';
import {
  StorageValuesProvider,
  useRefreshStorageValues,
  useStorageValuesPending,
  type SlotReader,
} from '@/services/storageValues';
import { EmptyState } from '@/components/ui/ErrorState';
import type { StorageLayout, StorageType } from '@/types/storage';
import { arrayElementPlacement, slotAdd } from '@/utils/storageSlots';
import {
  DEFAULT_COLUMN_SPAN,
  decodeStoragePath,
  encodeStoragePath,
  resolveColumns,
  augmentLayoutTypes,
  type ResolvedColumn,
  type Segment,
} from './columnModel';
import { StorageColumn } from './StorageColumn';

const containerStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-4);
`;

const headerStyle = css`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
`;

const titleStyle = css`
  font-size: var(--haze-text-lg);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text);
  margin: 0;
`;

const footnoteStyle = css`
  margin: var(--haze-space-1) 0 0;
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-secondary);
  overflow-wrap: anywhere;
`;

const controlsStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
`;

const toggleStyle = css`
  padding: var(--haze-space-1) var(--haze-space-3);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  background: transparent;
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-sm);
  cursor: pointer;

  &[aria-pressed='true'] {
    color: var(--haze-color-primary);
    border-color: var(--haze-color-primary);
  }

  &:hover {
    background: var(--haze-color-bg-elevated);
  }
`;

const pendingStyle = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
`;

const refreshAllStyle = css`
  padding: var(--haze-space-1) var(--haze-space-3);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-primary);
  background: transparent;
  border: 1px solid var(--haze-color-primary);
  border-radius: var(--haze-radius-sm);
  cursor: pointer;

  &:hover {
    background: var(--haze-color-bg-elevated);
  }
`;

const columnsRowStyle = css`
  display: flex;
  gap: var(--haze-space-4);
  overflow-x: auto;
  align-items: flex-start;
  padding-bottom: var(--haze-space-2);

  /* Phone widths: columns stack vertically (the project's mobile row
     convention — same breakpoint the Address/Contract rows use). */
  @media (max-width: 768px) {
    flex-direction: column;
    overflow-x: visible;
  }
`;

export type StorageExplorerProps = {
  chainId: number;
  /** Address the layout was read from (implementation under the impl toggle). */
  layoutAddress: string;
  /** Address slot values are read from — the proxy for proxy contracts. */
  address: string;
  layout: StorageLayout;
  /** Raw ?sv= param; malformed values degrade to the root column. */
  initialPath?: string;
  /**
   * Emitted on every in-explorer path change with the encoded ?sv= value
   * (undefined = root — clear the param).
   */
  onPathChange?: (sv: string | undefined) => void;
  /** Flows into StorageValuesProvider (tests inject a fake reader). */
  reader?: SlotReader;
};

export function StorageExplorer(props: StorageExplorerProps) {
  const { chainId, address, layoutAddress, layout, initialPath, onPathChange, reader } = props;
  const [valuesEnabled, setValuesEnabled] = useState(true);
  // decodeStoragePath returns null for malformed input — both null and []
  // mean "root" for the UI.
  const [segments, setSegments] = useState<Segment[]>(() => decodeStoragePath(initialPath) ?? []);
  // The last ?sv value this instance wrote or adopted. External prop
  // changes are consumed exactly once (the Search view's lastConsumedRef
  // pattern) so our own writes never echo back into a state reset.
  const lastSyncedPathRef = useRef<string | undefined>(initialPath);

  const applySegments = (next: Segment[]) => {
    setSegments(next);
    const encoded = encodeStoragePath(next);
    lastSyncedPathRef.current = encoded;
    onPathChange?.(encoded);
  };

  // Adopt external ?sv changes (browser back/forward, deep links).
  useEffect(() => {
    if (initialPath === lastSyncedPathRef.current) return;
    lastSyncedPathRef.current = initialPath;
    setSegments(decodeStoragePath(initialPath) ?? []);
  }, [initialPath]);

  // A different contract or layout target is a different storage tree:
  // stale drill paths would only resolve to error columns. Reset to root
  // and clear the ?sv the old tree wrote.
  const identityRef = useRef(`${chainId}:${address}:${layoutAddress}`);
  useEffect(() => {
    const identity = `${chainId}:${address}:${layoutAddress}`;
    if (identityRef.current === identity) return;
    identityRef.current = identity;
    setSegments([]);
    lastSyncedPathRef.current = undefined;
    onPathChange?.(undefined);
  }, [chainId, address, layoutAddress, onPathChange]);

  // evmole layouts carry their real shapes only in type LABELS (every
  // entry is 'inplace'); one memoized pass canonicalizes them so the
  // resolver + rows treat verified and inferred layouts identically.
  const effectiveLayout = useMemo(() => augmentLayoutTypes(layout), [layout]);
  const columns = useMemo(
    () => resolveColumns(effectiveLayout, segments),
    [effectiveLayout, segments],
  );
  const typeLookup = useMemo(() => {
    const types = effectiveLayout.types;
    return (typeKey: string): StorageType | null => types?.[typeKey] ?? null;
  }, [effectiveLayout]);

  // Drilling from column i replaces everything to its right (Finder
  // semantics): the new segment lands directly after the column's own
  // prefix, not after the currently-open leaf.
  const drillFrom = (index: number, added: Segment[]) => {
    applySegments([...segments.slice(0, index), ...added]);
  };

  const closeColumn = (index: number) => {
    // Column i>0 is opened by segments[i-1]; closing it truncates the
    // path to i-1 entries (closing column 1 = back to root).
    applySegments(segments.slice(0, Math.max(0, index - 1)));
  };

  // Range change on the visible array column i: rewrite the 'a' segment
  // that GOVERNS this column — the one sitting immediately after the
  // segment that opened the array (index i) — so segments stay the same
  // length and every column to the right keeps resolving. When no 'a'
  // exists yet, insert one at that exact position (a range view is
  // appended, never a second array column).
  const changeRange = (index: number, from: number, to: number) => {
    if (index < 1) return;
    const next = segments.slice();
    const own = next[index - 1];
    const governing = next[index];
    if (own?.t === 'a') {
      next[index - 1] = { t: 'a', from, to };
    } else if (governing?.t === 'a') {
      next[index] = { t: 'a', from, to };
    } else {
      next.splice(index, 0, { t: 'a', from, to });
    }
    applySegments(next);
  };

  if (layout.storage.length === 0) {
    return (
      <div>
        <h2 className={titleStyle}>Storage Layout</h2>
        <EmptyState message="No storage members reported by this layout source" />
      </div>
    );
  }

  return (
    <StorageValuesProvider
      chainId={chainId}
      address={address}
      enabled={valuesEnabled}
      reader={reader}
    >
      <div className={containerStyle}>
        <div className={headerStyle}>
          <div>
            <h2 className={titleStyle}>Storage Layout</h2>
            {layoutAddress !== address && (
              <p className={footnoteStyle}>
                Values read from {address} (proxy) — layout from {layoutAddress}
              </p>
            )}
          </div>
          <HeaderControls
            valuesEnabled={valuesEnabled}
            onToggleValues={() => setValuesEnabled(v => !v)}
          />
        </div>
        <div className={columnsRowStyle}>
          {columns.flatMap((column, index) => {
            // An 'a' segment re-ranges the array column BEFORE it: the
            // column the 'a' itself produces is the same array again and
            // must not render as a duplicate (errored ones stay visible —
            // an honest error card beats a silent skip).
            const createdRangeView =
              index > 0 && segments[index - 1]?.t === 'a' && column.error === undefined;
            if (createdRangeView) return [];
            return [
              <StorageColumn
                key={column.segments.length === 0 ? 'root' : encodeStoragePath(column.segments)}
                column={column}
                chainId={chainId}
                address={address}
                lengthSlot={
                  column.error === undefined &&
                  column.node.kind === 'array' &&
                  column.node.fixedLength === null
                    ? lengthSlotForColumn(columns, index)
                    : null
                }
                range={rangeForColumn(columns, segments, index)}
                onClose={() => closeColumn(index)}
                onOpenMember={label => drillFrom(index, [{ t: 'm', label }])}
                onOpenMappingKey={(label, key) =>
                  // A mapping SHELL column (the single-mapping struct an
                  // 'm'/'k' produced) is already located — its key drill
                  // pushes ONLY 'k'. Ordinary struct columns push 'm'
                  // first so the resolver can pick the mapping row.
                  drillFrom(
                    index,
                    isMappingShell(column)
                      ? [{ t: 'k', key }]
                      : [
                          { t: 'm', label },
                          { t: 'k', key },
                        ],
                  )}
                onOpenIndex={elementIndex => drillFrom(index, [{ t: 'i', index: elementIndex }])}
                onOpenElementMappingKey={(elementIndex, key) =>
                  drillFrom(index, [
                    { t: 'i', index: elementIndex },
                    { t: 'k', key },
                  ])}
                onRangeChange={(from, to) => changeRange(index, from, to)}
                typeLookup={typeLookup}
              />,
            ];
          })}
        </div>
      </div>
    </StorageValuesProvider>
  );
}

function HeaderControls({
  valuesEnabled,
  onToggleValues,
}: {
  valuesEnabled: boolean;
  onToggleValues: () => void;
}) {
  const pending = useStorageValuesPending();
  const refresh = useRefreshStorageValues();
  return (
    <div className={controlsStyle}>
      <button
        type="button"
        className={toggleStyle}
        aria-pressed={valuesEnabled}
        title="Toggle live slot-value reads"
        onClick={onToggleValues}
      >
        Values: {valuesEnabled ? 'on' : 'off'}
      </button>
      {pending > 0 && <span className={pendingStyle}>Loading {pending} slots…</span>}
      <button
        type="button"
        className={refreshAllStyle}
        title="Re-read every slot this explorer has touched"
        onClick={() => refresh()}
      >
        ⟳ Refresh
      </button>
    </div>
  );
}

// A mapping shell: the single-row struct column an 'm' (mapping member)
// or 'k' (mapping-valued key) produces. Pushing 'm' from INSIDE it would
// re-locate the mapping and duplicate the path label. The ROOT column is
// never a shell — a single-mapping root drills m+k so the member label
// stays in the breadcrumb.
function isMappingShell(column: ResolvedColumn): boolean {
  return (
    column.segments.length > 0 &&
    column.node.kind === 'struct' &&
    column.node.rows.length === 1 &&
    column.node.rows[0].expand === 'mapping'
  );
}

// View window for an array column: its GOVERNING 'a' segment — the one
// sitting immediately after the opening segment (the 'a'-created column
// itself is skipped at render time, so the pre-'a' column carries the
// range) — or the default first page.
function rangeForColumn(
  columns: ResolvedColumn[],
  segments: Segment[],
  index: number,
): { from: number; to: number } {
  const own = index >= 1 ? segments[index - 1] : undefined;
  if (own?.t === 'a') return { from: own.from, to: own.to };
  const governing = segments[index];
  if (governing?.t === 'a' && columns[index + 1]?.error === undefined) {
    return { from: governing.from, to: governing.to };
  }
  return { from: 0, to: DEFAULT_COLUMN_SPAN };
}

// Dynamic arrays keep their live length in the MEMBER slot that declared
// them — the slot the opening segment resolved to BEFORE the column
// re-based onto the element data slot. resolveColumns only exposes the
// data slot, so derive the member slot from the opening column + segment
// (this works for URL-restored paths too, where no open handler ever
// ran):
//   m.<label> → the parent struct's row slot for that label
//   k.<key>   → the parent struct's single mapping row slot
//   i.<n>     → the element slot of the parent array (a nested dynamic
//               array keeps its length exactly there)
// 'a' columns repeat their parent array's node, so walk back past them.
function lengthSlotForColumn(columns: ResolvedColumn[], index: number): Hex | null {
  let origin = index;
  while (origin > 1 && columns[origin]?.segments[origin - 1]?.t === 'a') origin -= 1;
  const opening = columns[origin]?.segments[origin - 1];
  const parent = origin >= 1 ? columns[origin - 1] : undefined;
  if (opening === undefined || parent === undefined || parent.error !== undefined) return null;

  if (opening.t === 'm' && parent.node.kind === 'struct') {
    const row = parent.node.rows.find(candidate => candidate.label === opening.label);
    return row?.slot ?? null;
  }
  if (opening.t === 'k' && parent.node.kind === 'struct') {
    const row = parent.node.rows.find(candidate => candidate.expand === 'mapping');
    return row?.slot ?? null;
  }
  if (opening.t === 'i' && parent.node.kind === 'array') {
    const elementType = parent.node.elementType;
    if (elementType === null) return null;
    const bytes = Number(elementType.numberOfBytes);
    if (!Number.isInteger(bytes) || bytes < 1) return null;
    const placement = arrayElementPlacement(opening.index, bytes);
    return slotAdd(parent.node.dataSlot, BigInt(placement.slotDelta));
  }
  return null;
}
