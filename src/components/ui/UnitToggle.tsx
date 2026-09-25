// Three-state segmented control (chain symbol / Gwei / Wei) for the
// value-unit preference. Styling and a11y mirror the Address page's
// segmented tabs: one role="group" strip of native buttons whose active
// state rides on aria-pressed — exposed and styled from one source of
// truth. The preference itself lives in util/units (storage + change
// subscription), so clicking here re-renders every mounted consumer (the
// Value and Transaction Fee rows) without a reload.
import { css, cx } from '@linaria/core';
import { useSyncExternalStore } from 'react';

import { getValueUnit, setValueUnit, subscribeValueUnit } from '@/util/units';

const toggleGroupStyle = css`
  display: inline-flex;
  gap: var(--haze-space-1);
  padding: var(--haze-space-1);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  background: var(--haze-color-bg-subtle);
`;

// Compact variant of the Address page's tab button: the strip sits inside
// an InfoGrid row beside mono figures, so it keeps the small text size.
const segmentStyle = css`
  border: none;
  background: transparent;
  padding: var(--haze-space-1) var(--haze-space-2);
  border-radius: var(--haze-radius-md);
  font-size: var(--haze-text-xs);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text-muted);
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    color: var(--haze-color-text);
  }

  &[aria-pressed='true'] {
    background: var(--haze-color-bg);
    color: var(--haze-color-text);
    box-shadow: inset 0 0 0 1px var(--haze-color-border);
  }
`;

export function UnitToggle({ symbol, className }: { symbol: string; className?: string }) {
  const unit = useSyncExternalStore(subscribeValueUnit, getValueUnit);
  const options = [
    { unit: 'native', label: symbol },
    { unit: 'gwei', label: 'Gwei' },
    { unit: 'wei', label: 'Wei' },
  ] as const;

  return (
    <span className={cx(toggleGroupStyle, className)} role="group" aria-label="Value unit">
      {options.map(({ unit: optionUnit, label }) => (
        <button
          key={optionUnit}
          type="button"
          className={segmentStyle}
          aria-pressed={unit === optionUnit}
          onClick={() => setValueUnit(optionUnit)}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

export default UnitToggle;
