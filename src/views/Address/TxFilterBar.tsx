// Collapsible advanced-filter bar for the address Transactions tab
// (PM gap wave 2026-09-25; method filter added 2026-09-26). Five
// filters — From / To (addresses), Min / Max value (wei), and Method
// (4-byte selector) — that ride the URL (?tfFrom= / ?tfTo= / ?tfMin= /
// ?tfMax= / ?tfMethod=) so filtered views are shareable. Honesty
// contract: the filters narrow the DISCOVERED set of the selected window
// on the server (same cached scan, never a new one), so the standing
// scope line stays visible while the bar is open and invalid input never
// leaves the browser (field errors gate Apply — no request can be fired
// with a malformed filter).
import { css, cx } from '@linaria/core';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useSignaturesBatched } from '@/services/signatures';
import type { SignatureOutcome } from '@/services/signatures';
import { checkAddressValidity } from './addressValidity';

// Raw filter field values ('' = field empty = filter absent). The URL is
// the source of truth; the bar holds a local draft while the user types.
export type TxFilterValues = {
  from: string;
  to: string;
  min: string;
  max: string;
  method: string;
};

export type TxFilterFieldErrors = Partial<
  Record<'from' | 'to' | 'min' | 'max' | 'method', string>
>;

// Field validation, mirroring the server's param rules exactly (the
// frontend twin of the route's getValidatedAddress / wei parsing / method
// regex): an address passes the same two-tier shape/checksum verdict, a
// wei amount must be a non-negative integer decimal (BigInt-exact — no
// fractions, no signs, no scientific notation), and a method selector is
// '0x' + 8 hex chars (case-insensitive). Empty fields are always valid
// (absent, not invalid). Pure so the gate is testable.
const WEI_AMOUNT_RE = /^\d+$/;
const SELECTOR_RE = /^0x[0-9a-fA-F]{8}$/;

const addressFieldError = (raw: string): string | undefined => {
  const verdict = checkAddressValidity(raw);
  if (verdict.valid) return undefined;
  return verdict.tier === 'format'
    ? 'Invalid address format — expected 0x followed by 40 hex characters'
    : 'Invalid address checksum — paste it in all lowercase to retry';
};

export const validateTxFilterValues = (values: TxFilterValues): TxFilterFieldErrors => {
  const errors: TxFilterFieldErrors = {};
  if (values.from !== '') {
    const error = addressFieldError(values.from);
    if (error !== undefined) errors.from = error;
  }
  if (values.to !== '') {
    const error = addressFieldError(values.to);
    if (error !== undefined) errors.to = error;
  }
  if (values.min !== '' && !WEI_AMOUNT_RE.test(values.min)) {
    errors.min = 'Invalid amount — wei must be a non-negative whole number';
  }
  if (values.max !== '' && !WEI_AMOUNT_RE.test(values.max)) {
    errors.max = 'Invalid amount — wei must be a non-negative whole number';
  }
  if (values.method !== '' && !SELECTOR_RE.test(values.method)) {
    errors.method = 'Invalid selector — expected 0x followed by 8 hex characters';
  }
  return errors;
};

// Pure: the DISTINCT method selectors present on the currently loaded tx
// rows (the tx tab's page data), in first-seen row order. Rows without a
// selector (plain transfers, creations, legacy selector-less payloads)
// contribute nothing — a chip is only offered for a method the page can
// actually prove. Exported for unit tests.
export const distinctRowSelectors = (
  rows: readonly { selector?: string | null }[],
): string[] => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const row of rows) {
    if (typeof row.selector !== 'string' || row.selector === '') continue;
    const selector = row.selector.toLowerCase();
    if (!seen.has(selector)) {
      seen.add(selector);
      ordered.push(selector);
    }
  }
  return ordered;
};

// Pure: one chip's label. A resolved openchain outcome renders the
// candidate's base name ('transfer(address,uint256)' → 'transfer'); every
// other outcome (pending, notFound, upstream unavailable) keeps the raw
// selector — the honest unresolved display, never a fabricated name.
export const selectorChipLabel = (
  selector: string,
  outcome: SignatureOutcome | undefined,
): string => {
  if (outcome !== undefined && 'signatures' in outcome && outcome.signatures.length > 0) {
    const first = outcome.signatures[0];
    const parenIndex = first.indexOf('(');
    return parenIndex > 0 ? first.slice(0, parenIndex) : first;
  }
  return selector;
};

export type TxFilterBarProps = {
  // Controlled open state: the view opens the bar whenever any tf param
  // is present in the URL (deep links land open); closing is the user's
  // call and survives until the URL changes again.
  open: boolean;
  onToggle: () => void;
  // Current URL filter values ('' when a param is absent) — the draft
  // re-seeds from these when the URL changes (back/forward between
  // filter sets, or the Apply echo).
  values: TxFilterValues;
  // Count of filters the URL actually carries (raw presence, incl.
  // values too malformed to send) — header badge only.
  urlParamCount: number;
  // Apply: fires ONLY with fully valid field values (the gate lives
  // here — an invalid draft never reaches the URL, so no request can
  // be fired with a malformed filter).
  onApply: (next: TxFilterValues) => void;
  // Clear: drop every tf param from the URL and reset the draft.
  onClear: () => void;
  // Distinct method selectors present on the currently loaded tx rows
  // (the tx tab's page data), offered as one-click chips beneath the
  // Method field. Absent/empty → no chips (nothing loaded to offer).
  selectorOptions?: readonly string[];
};

const containerStyle = css`
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  margin-bottom: var(--haze-space-4);
  overflow: hidden;
`;

const headerStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  width: 100%;
  padding: var(--haze-space-3) var(--haze-space-4);
  background: none;
  border: none;
  cursor: pointer;
  user-select: none;
  color: var(--haze-color-text);
  font-size: var(--haze-text-sm);
  font-weight: 600;
  transition: background-color 150ms ease;

  &:hover {
    background: var(--haze-color-bg-subtle);
  }
`;

const chevronStyle = css`
  width: 16px;
  height: 16px;
  margin-left: auto;
  color: var(--haze-color-text-muted);
  transition: transform 200ms ease;
  flex-shrink: 0;
`;

const chevronExpandedStyle = css`
  transform: rotate(180deg);
`;

const bodyStyle = css`
  padding: var(--haze-space-4);
  border-top: 1px solid var(--haze-color-border);
`;

const fieldsGridStyle = css`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--haze-space-3);
`;

const fieldGroupStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
  min-width: 0;
`;

const labelStyle = css`
  font-size: var(--haze-text-xs);
  font-weight: 600;
  color: var(--haze-color-text-secondary);
`;

const inputStyle = css`
  padding: var(--haze-space-2) var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  font-size: var(--haze-text-sm);
  font-family: var(--haze-font-mono);
  background: var(--haze-color-bg-subtle);
  color: var(--haze-color-text);
  width: 100%;
  transition: border-color 150ms ease;

  &:focus {
    outline: none;
    border-color: var(--haze-color-primary);
  }
`;

const inputErrorStyle = css`
  border-color: var(--haze-color-danger);

  &:focus {
    border-color: var(--haze-color-danger);
  }
`;

const fieldErrorStyle = css`
  margin: 0;
  font-size: var(--haze-text-xs);
  color: var(--haze-color-danger);
`;

const fieldHintStyle = css`
  margin: 0;
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

// One-click selector chips beneath the Method field: mono text (the
// decoded name or raw selector), compact geometry like the Method
// column's chips, honest about being a shortcut into the field.
const chipRowStyle = css`
  display: flex;
  flex-wrap: wrap;
  gap: var(--haze-space-1);
`;

const chipStyle = css`
  padding: 0 var(--haze-space-2);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-sm);
  background: var(--haze-color-bg-subtle);
  font-size: var(--haze-text-xs);
  line-height: 20px;
  font-family: var(--haze-font-mono);
  color: var(--haze-color-text);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 150ms ease, background-color 150ms ease;

  &:hover {
    border-color: var(--haze-color-primary);
    background: var(--haze-color-primary-subtle);
  }
`;

const scopeLineStyle = css`
  margin: var(--haze-space-3) 0 0;
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

const actionsRowStyle = css`
  display: flex;
  gap: var(--haze-space-2);
  margin-top: var(--haze-space-3);
`;

export function TxFilterBar({
  open,
  onToggle,
  values,
  urlParamCount,
  onApply,
  onClear,
  selectorOptions,
}: TxFilterBarProps) {
  // Local draft while typing; re-seeded whenever the URL values change
  // (back/forward navigation between filter sets, or the Apply echo).
  const [draft, setDraft] = useState<TxFilterValues>(values);
  const { from, to, min, max, method } = values;
  useEffect(() => {
    setDraft({ from, to, min, max, method });
  }, [from, to, min, max, method]);

  // Chip labels: the same batched openchain decode the tx-list Method
  // column uses (session-memoized — paging back over a seen page costs
  // no requests). While pending/unresolved the raw selector IS the
  // label, so chips render immediately and never block.
  const chips = selectorOptions ?? [];
  const signatureOutcomes = useSignaturesBatched(chips);

  // Live validation: field errors render as the user types, so Apply's
  // gate is never a surprise.
  const errors = validateTxFilterValues(draft);
  const hasErrors = Object.keys(errors).length > 0;

  const setField = (field: keyof TxFilterValues) => (value: string) => {
    setDraft(prev => ({ ...prev, [field]: value }));
  };

  const handleApply = () => {
    // The gate: an invalid draft never reaches the URL, so the query
    // behind it can never fire a doomed request.
    if (hasErrors) return;
    onApply(draft);
  };

  const handleClear = () => {
    setDraft({ from: '', to: '', min: '', max: '', method: '' });
    onClear();
  };

  const handleToggleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };

  const addressInput = (
    field: 'from' | 'to',
    label: string,
    testId: string,
  ) => (
    <div className={fieldGroupStyle}>
      <label htmlFor={`tx-filter-${field}`} className={labelStyle}>
        {label}
      </label>
      <input
        id={`tx-filter-${field}`}
        type="text"
        className={cx(inputStyle, errors[field] !== undefined && inputErrorStyle)}
        value={draft[field]}
        onChange={e => setField(field)(e.target.value)}
        placeholder="0x…"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={errors[field] !== undefined ? true : undefined}
        data-testid={testId}
      />
      {errors[field] !== undefined && (
        <p className={fieldErrorStyle} data-testid={`${testId}-error`}>
          {errors[field]}
        </p>
      )}
    </div>
  );

  const valueInput = (
    field: 'min' | 'max',
    label: string,
    testId: string,
  ) => (
    <div className={fieldGroupStyle}>
      <label htmlFor={`tx-filter-${field}`} className={labelStyle}>
        {label}
      </label>
      <input
        id={`tx-filter-${field}`}
        // text (not number): wei amounts exceed 2^53 and must stay exact
        // decimal strings end-to-end.
        type="text"
        inputMode="numeric"
        className={cx(inputStyle, errors[field] !== undefined && inputErrorStyle)}
        value={draft[field]}
        onChange={e => setField(field)(e.target.value)}
        placeholder="wei, e.g. 1000000000000000000"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={errors[field] !== undefined ? true : undefined}
        data-testid={testId}
      />
      {errors[field] !== undefined ? (
        <p className={fieldErrorStyle} data-testid={`${testId}-error`}>
          {errors[field]}
        </p>
      ) : (
        <p className={fieldHintStyle}>Amounts are in wei — 1 native unit = 10^18 wei.</p>
      )}
    </div>
  );

  const methodField = (
    <div className={fieldGroupStyle}>
      <label htmlFor="tx-filter-method" className={labelStyle}>
        Method (selector)
      </label>
      <input
        id="tx-filter-method"
        type="text"
        className={cx(inputStyle, errors.method !== undefined && inputErrorStyle)}
        value={draft.method}
        onChange={e => setField('method')(e.target.value)}
        placeholder="0x…"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={errors.method !== undefined ? true : undefined}
        data-testid="tx-filter-method"
      />
      {errors.method !== undefined ? (
        <p className={fieldErrorStyle} data-testid="tx-filter-method-error">
          {errors.method}
        </p>
      ) : (
        <p className={fieldHintStyle}>4-byte selector, e.g. 0xa9059cbb</p>
      )}
      {/* One-click shortcuts from the LOADED page's own rows: each chip
          is a selector this window's discovered set actually carries
          (decoded via the shared openchain batch — the tx-list Method
          column's source), so the offer can never exceed the evidence. */}
      {chips.length > 0 && (
        <div className={chipRowStyle} data-testid="tx-filter-method-chips">
          {chips.map(selector => (
            <button
              type="button"
              key={selector}
              className={chipStyle}
              title={selector}
              onClick={() => setField('method')(selector)}
              data-testid={`tx-filter-method-chip-${selector}`}
            >
              {selectorChipLabel(selector, signatureOutcomes[selector])}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className={containerStyle} data-testid="tx-filter-bar">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={handleToggleKeyDown}
        className={headerStyle}
        data-testid="tx-filter-toggle"
      >
        Filters
        {urlParamCount > 0 && (
          <span data-testid="tx-filter-count">
            <Badge variant="info" size="sm">{urlParamCount}</Badge>
          </span>
        )}
        <svg
          className={cx(chevronStyle, open && chevronExpandedStyle)}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      {open && (
        <div className={bodyStyle}>
          <div className={fieldsGridStyle}>
            {addressInput('from', 'From', 'tx-filter-from')}
            {addressInput('to', 'To', 'tx-filter-to')}
            {valueInput('min', 'Min value', 'tx-filter-min')}
            {valueInput('max', 'Max value', 'tx-filter-max')}
            {methodField}
          </div>
          {/* Standing honesty line: a filter narrows the discovered set
              of the current window — it is never a fresh scan and never
              widens coverage. */}
          <p className={scopeLineStyle} data-testid="tx-filter-scope">
            Filters apply within the discovered transactions of the selected
            window — not a new scan.
          </p>
          <div className={actionsRowStyle}>
            <Button
              size="sm"
              onClick={handleApply}
              disabled={hasErrors}
              title={hasErrors ? 'Fix the invalid fields first' : undefined}
              data-testid="tx-filter-apply"
            >
              Apply
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleClear}
              data-testid="tx-filter-clear"
            >
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default TxFilterBar;
