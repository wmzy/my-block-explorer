import { css, cx } from '@linaria/core';
import type { KeyboardEvent, ReactNode } from 'react';

// The shared clickable header row of the lazily-fetched cards (the tx
// page's Call Trace, the block page's Internal Transactions, Raw JSON):
// a full-width toggle with the Collapsible card's affordances (role
// button, keyboard, rotating chevron), built on Card primitives instead
// of the Collapsible component because those cards' fetches must fire on
// the FIRST expand only — semantics a plain Collapsible's internal state
// cannot signal outward (each card drives util/useLazyExpand and its own
// fetch latch). The rendered DOM (attribute order, chevron svg) is
// pinned by unit tests via data-testid — keep it byte-identical.
//
// Callers compose the title side themselves: cards with a settled
// summary wrap <CardTitle> and the meta <span> in a div carrying
// lazyHeaderTitleRowStyle / lazyHeaderMetaStyle; cards without meta pass
// the CardTitle alone.

// Title row: the heading with an optional settled-summary meta beside it.
export const lazyHeaderTitleRowStyle = css`
  display: flex;
  align-items: baseline;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
  min-width: 0;
`;

// Muted xs meta within the title row (a settled summary so the collapsed
// card still tells the reader what it holds).
export const lazyHeaderMetaStyle = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

const headerToggleStyle = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--haze-space-3);
  width: 100%;
  cursor: pointer;
  user-select: none;
`;

const chevronStyle = css`
  width: 20px;
  height: 20px;
  color: var(--haze-color-text-muted);
  transition: transform 200ms ease;
  flex-shrink: 0;
`;

const chevronExpandedStyle = css`
  transform: rotate(180deg);
`;

export type LazyCollapsibleHeaderProps = {
  /** Whether the card body is shown (drives aria-expanded + chevron). */
  expanded: boolean;
  /** Click toggle; typically util/useLazyExpand's `toggle`. */
  onToggle: () => void;
  /** Keyboard affordance (Enter/Space); typically its `handleKeyDown`. */
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** Test hook for the header row (e.g. "raw-json-header"). */
  testId?: string;
  /** Title side: a CardTitle, optionally inside a lazyHeaderTitleRowStyle div. */
  children: ReactNode;
};

export function LazyCollapsibleHeader({
  expanded,
  onToggle,
  onKeyDown,
  testId,
  children,
}: LazyCollapsibleHeaderProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={onKeyDown}
      className={headerToggleStyle}
      data-testid={testId}
    >
      {children}
      <svg
        className={cx(chevronStyle, expanded && chevronExpandedStyle)}
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
  );
}
