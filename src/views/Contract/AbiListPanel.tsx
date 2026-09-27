import { useEffect, useMemo, useRef, useState } from 'react';
import { css, cx } from '@linaria/core';

import { SourceCodeViewer } from '@/components/SourceCodeViewer';
import { copyText } from '@/util/clipboard';
import {
  ABI_CATEGORY_ORDER,
  abiEntryKey,
  buildAbiCopy,
  categorize,
  categoryOf,
  formatAbiSignature,
  isAbiListEntry,
  type AbiCategory,
  type AbiListEntry,
} from './abiList';

const panelStyles = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-3);
`;

// Amber provenance chip (style moved verbatim from the Contract page's ABI
// card so the custom-ABI badge keeps its exact look).
const provenanceChipStyles = css`
  display: inline-block;
  margin-bottom: 12px;
  padding: 2px 10px;
  border-radius: 12px;
  background: #f0a500;
  border: 1px solid #d69200;
  color: white;
  font-size: 12px;
  font-weight: 600;
`;

const headerRowStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
`;

const chipRowStyles = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  flex-wrap: wrap;
`;

const categoryChipStyles = css`
  padding: var(--haze-space-1) var(--haze-space-3);
  font-size: var(--haze-text-xs);
  font-family: var(--haze-font-mono);
  color: var(--haze-color-text-secondary);
  background: var(--haze-color-bg-subtle);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-full);
  cursor: pointer;
  white-space: nowrap;

  &[aria-pressed='true'] {
    color: var(--haze-color-primary);
    border-color: var(--haze-color-primary);
    background: var(--haze-color-primary-subtle);
  }

  &:hover {
    background: var(--haze-color-bg-muted);
  }
`;

const toggleButtonStyles = css`
  padding: var(--haze-space-1) var(--haze-space-3);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
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

const toolbarStyles = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2) var(--haze-space-3);
  flex-wrap: wrap;
`;

const filterInputStyles = css`
  flex: 1;
  min-width: 150px;
  padding: var(--haze-space-1) var(--haze-space-3);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  background: var(--haze-color-bg-subtle);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-sm);

  &:focus {
    outline: none;
    border-color: var(--haze-color-primary);
  }
`;

const textButtonStyles = css`
  padding: var(--haze-space-1) var(--haze-space-3);
  font-size: var(--haze-text-sm);
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

const sectionStyles = css`
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  overflow: hidden;
`;

const sectionHeaderStyles = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  padding: var(--haze-space-2) var(--haze-space-3);
  background: var(--haze-color-bg-subtle);
  border-bottom: 1px solid var(--haze-color-border);
  font-size: var(--haze-text-xs);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const sectionSelectAllStyles = css`
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--haze-space-1);
  font-size: var(--haze-text-xs);
  font-weight: var(--haze-weight-normal);
  text-transform: none;
  letter-spacing: normal;
  color: var(--haze-color-text-secondary);
  cursor: pointer;
  white-space: nowrap;
`;

const rowStyles = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  padding: var(--haze-space-2) var(--haze-space-3);

  &:not(:last-child) {
    border-bottom: 1px solid var(--haze-color-border);
  }

  label {
    display: flex;
    align-items: center;
    gap: var(--haze-space-2);
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }
`;

// Long signatures (nested tuple args) truncate with an ellipsis at phone
// widths instead of pushing the card wide; the full text stays one hover
// away via the title attribute.
const signatureStyles = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const badgeStyles = css`
  flex-shrink: 0;
  padding: 0 var(--haze-space-2);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  border-radius: var(--haze-radius-full);
  background: var(--haze-color-bg-muted);
  color: var(--haze-color-text-secondary);
`;

const badgeReadStyles = css`
  background: var(--haze-color-success-subtle);
  color: var(--haze-color-success);
`;

const badgeWriteStyles = css`
  background: var(--haze-color-warning-subtle);
  color: var(--haze-color-warning);
`;

const badgeEventStyles = css`
  background: var(--haze-color-primary-subtle);
  color: var(--haze-color-primary);
`;

const badgeErrorStyles = css`
  background: var(--haze-color-danger-subtle);
  color: var(--haze-color-danger);
`;

const emptyStyles = css`
  padding: var(--haze-space-3);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-muted);
`;

const footerStyles = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
`;

const copyButtonStyles = css`
  padding: var(--haze-space-2) var(--haze-space-4);
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-medium);
  color: var(--haze-color-text-inverse);
  background: var(--haze-color-primary);
  border: none;
  border-radius: var(--haze-radius-sm);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--haze-color-primary-hover);
  }

  &:disabled {
    background: var(--haze-color-bg-muted);
    color: var(--haze-color-text-muted);
    cursor: not-allowed;
  }
`;

const errorNoteStyles = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-secondary);
`;

const rawTitleStyles = css`
  margin: 0 0 var(--haze-space-2);
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text-secondary);
`;

const CATEGORY_LABELS: Record<AbiCategory, string> = {
  read: 'Read',
  write: 'Write',
  event: 'Events',
  error: 'Errors',
  other: 'Other',
};

// Row badge text: functions show their mutability (Solidity's implicit
// default is nonpayable when the field is absent — old ABIs omit it);
// every other entry type names itself.
const badgeText = (entry: AbiListEntry): string =>
  entry.type === 'function' ? (entry.stateMutability ?? 'nonpayable') : (entry.type ?? 'entry');

const badgeClass = (category: AbiCategory): string => {
  switch (category) {
    case 'read':
      return badgeReadStyles;
    case 'write':
      return badgeWriteStyles;
    case 'event':
      return badgeEventStyles;
    case 'error':
      return badgeErrorStyles;
    default:
      return badgeStyles;
  }
};

// Name/type text filter: matches the entry name, entry type, mutability or
// any argument type (case-insensitive substring).
const matchesAbiFilter = (entry: AbiListEntry, query: string): boolean => {
  if (query === '') return true;
  const haystack = [
    entry.name ?? '',
    entry.type ?? '',
    entry.stateMutability ?? '',
    ...(entry.inputs ?? []).map(input => input.type ?? ''),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
};

// ABI tab body: a categorized, multi-select list over the parsed ABI with
// a merged copy (selection + every error definition — the pasted fragment
// must decode custom reverts), beside a Raw JSON view that renders the
// exact string the page used to show alone.
export function AbiListPanel({
  abi,
  rawJson,
  rawTitle,
  provenanceLabel,
}: {
  abi: readonly unknown[];
  rawJson: string;
  rawTitle?: string;
  provenanceLabel?: string;
}) {
  const [view, setView] = useState<'list' | 'raw'>('list');
  const [category, setCategory] = useState<AbiCategory | 'all'>('all');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set<string>());
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'failed'>('idle');
  const copyTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== undefined) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const entries = useMemo(() => {
    const rows: readonly unknown[] = Array.isArray(abi) ? abi : [];
    return rows.filter(isAbiListEntry);
  }, [abi]);

  // The route reuses this component across contracts (params change without
  // a remount); a different ABI must never inherit the previous selection.
  useEffect(() => {
    setSelected(new Set());
  }, [entries]);

  const buckets = useMemo(() => categorize(entries), [entries]);
  const errorCount = buckets.error.length;

  const normalizedFilter = filter.trim().toLowerCase();
  const visibleSections = useMemo(() => {
    const wanted = category === 'all' ? ABI_CATEGORY_ORDER : [category];
    return wanted
      .filter(cat => buckets[cat].length > 0)
      .map(cat => ({
        category: cat,
        rows: buckets[cat].filter(row => matchesAbiFilter(row, normalizedFilter)),
      }))
      .filter(section => section.rows.length > 0);
  }, [buckets, category, normalizedFilter]);

  const toggleRow = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Select-all (per section and global) operates on the rows currently
  // visible — the text filter is a scoping aid, so hidden rows are never
  // silently swept into the selection.
  const setRowsSelected = (rows: readonly AbiListEntry[], selectedNow: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      for (const row of rows) {
        if (selectedNow) {
          next.add(abiEntryKey(row));
        } else {
          next.delete(abiEntryKey(row));
        }
      }
      return next;
    });
  };

  const handleCopy = async () => {
    const ok = await copyText(buildAbiCopy(selected, entries));
    setCopyState(ok ? 'ok' : 'failed');
    if (copyTimerRef.current !== undefined) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyState('idle'), 2000);
  };

  const copyLabel =
    copyState === 'ok'
      ? 'Copied ✓'
      : copyState === 'failed'
        ? 'Copy failed'
        : `Copy selected (${selected.size})`;

  return (
    <div className={panelStyles}>
      {provenanceLabel ? <span className={provenanceChipStyles}>{provenanceLabel}</span> : null}
      <div className={headerRowStyles}>
        <div className={chipRowStyles}>
          <button
            type="button"
            className={categoryChipStyles}
            aria-pressed={category === 'all'}
            onClick={() => setCategory('all')}
          >
            All ({entries.length})
          </button>
          {ABI_CATEGORY_ORDER.filter(cat => buckets[cat].length > 0).map(cat => (
            <button
              key={cat}
              type="button"
              className={categoryChipStyles}
              aria-pressed={category === cat}
              onClick={() => setCategory(cat)}
            >
              {CATEGORY_LABELS[cat]} ({buckets[cat].length})
            </button>
          ))}
        </div>
        <div className={chipRowStyles}>
          <button
            type="button"
            className={toggleButtonStyles}
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            List
          </button>
          <button
            type="button"
            className={toggleButtonStyles}
            aria-pressed={view === 'raw'}
            onClick={() => setView('raw')}
          >
            Raw JSON
          </button>
        </div>
      </div>

      {view === 'raw' ? (
        <div>
          {rawTitle ? <h3 className={rawTitleStyles}>{rawTitle}</h3> : null}
          <SourceCodeViewer sourceCode={rawJson} />
        </div>
      ) : (
        <>
          <div className={toolbarStyles}>
            <input
              type="text"
              className={filterInputStyles}
              aria-label="Filter ABI entries by name or type"
              placeholder="Filter by name or type…"
              value={filter}
              onChange={event => setFilter(event.target.value)}
            />
            <button
              type="button"
              className={textButtonStyles}
              onClick={() =>
                setRowsSelected(visibleSections.flatMap(section => section.rows), true)}
            >
              Select all
            </button>
            <button type="button" className={textButtonStyles} onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>

          {visibleSections.length === 0 ? (
            <div className={emptyStyles}>No matching entries</div>
          ) : (
            visibleSections.map(section => {
              const sectionKeys = section.rows.map(abiEntryKey);
              const allSelected = sectionKeys.every(key => selected.has(key));
              return (
                <div key={section.category} className={sectionStyles}>
                  <div className={sectionHeaderStyles}>
                    <span>
                      {CATEGORY_LABELS[section.category]} ({section.rows.length})
                    </span>
                    <label className={sectionSelectAllStyles}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() => setRowsSelected(section.rows, !allSelected)}
                      />
                      Select all
                    </label>
                  </div>
                  {section.rows.map((row, index) => {
                    const key = abiEntryKey(row);
                    const signature = formatAbiSignature(row);
                    return (
                      <div key={`${key}#${index}`} className={rowStyles}>
                        <label>
                          <input
                            type="checkbox"
                            checked={selected.has(key)}
                            onChange={() => toggleRow(key)}
                          />
                          <span className={signatureStyles} title={signature}>
                            {signature}
                          </span>
                        </label>
                        <span className={cx(badgeStyles, badgeClass(categoryOf(row)))}>
                          {badgeText(row)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}

          <div className={footerStyles}>
            <button
              type="button"
              className={copyButtonStyles}
              disabled={selected.size === 0 || copyState !== 'idle'}
              onClick={() => void handleCopy()}
            >
              {copyLabel}
            </button>
            {errorCount > 0 ? (
              <span className={errorNoteStyles}>
                Always includes {errorCount} error definition{errorCount === 1 ? '' : 's'} so
                reverts decode
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
