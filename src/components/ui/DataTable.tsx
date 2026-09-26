import { css, cx } from '@linaria/core';
import { Button } from './Button';
import { cloneElement, isValidElement } from 'react';
import type { ReactNode } from 'react';

const tableContainer = css`
  background: var(--haze-color-bg);
  border-radius: var(--haze-radius-lg);
  border: 1px solid var(--haze-color-border);
  /* Wide tables scroll inside the card instead of being clipped (the old
     overflow:hidden cropped the right-hand columns on phones) or squeezing
     the page into horizontal body scroll. */
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
`;

const tableStyle = css`
  width: 100%;
  /* Content defines the floor: below it the table keeps its natural width
     and scrolls in the container above, rather than compressing columns. */
  min-width: max-content;
  border-collapse: collapse;
  font-family: var(--haze-font-sans);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);

  th {
    background: var(--haze-color-bg-subtle);
    padding: var(--haze-space-3) var(--haze-space-4);
    text-align: left;
    font-weight: var(--haze-weight-semibold);
    font-size: var(--haze-text-xs);
    color: var(--haze-color-text-muted);
    border-bottom: 1px solid var(--haze-color-border);
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  td {
    padding: var(--haze-space-3) var(--haze-space-4);
    border-bottom: 1px solid var(--haze-color-bg-muted);
    font-size: var(--haze-text-sm);
    color: var(--haze-color-text);
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr:hover td {
    background: var(--haze-color-bg-subtle);
  }
`;

const paginationStyle = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--haze-space-4);
  border-top: 1px solid var(--haze-color-border);
  background: var(--haze-color-bg-subtle);

  /* Narrow screens: the long page-info sentence ("Page 1 of 40 • At
     least 1,000 transactions discovered") and the Prev/Next pair never
     share one ~340px row — wrap (info line first, buttons beneath)
     instead of overflowing the card. */
  @media (max-width: 768px) {
    flex-wrap: wrap;
    gap: var(--haze-space-2);
  }
`;

const pageInfoStyle = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
`;

const pageButtonsStyle = css`
  display: flex;
  gap: var(--haze-space-2);
`;

export const linkStyle = css`
  color: var(--haze-color-primary);
  text-decoration: none;
  font-family: var(--haze-font-mono);

  &:hover {
    text-decoration: underline;
  }
`;

export const monoStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
`;

// --- Screen-reader table structure (additive a11y pass) ---
//
// Column-header cells gain scope="col" unconditionally: every current
// DataTable consumer renders thead>tr>th, and scope is universally
// correct for that shape with zero visual impact. The rewrite walks ONLY
// the thead subtree — a th inside tbody would be a ROW header, and
// scope="col" there would be wrong, so tbody passes through untouched
// (element identity preserved, no cloning). Clones keep keys, classNames
// and children; only the scope attribute is added.
type ScopedElement = { children?: ReactNode; scope?: string };

const tagColumnCells = (node: ReactNode): ReactNode => {
  if (Array.isArray(node)) return node.map(tagColumnCells);
  if (!isValidElement<ScopedElement>(node)) return node;
  if (node.type === 'th') {
    return cloneElement(node, { scope: 'col' });
  }
  // Structural descent stops at <tr> — anything deeper inside a thead is
  // not a column header, so it keeps its own attributes.
  if (node.type === 'tr') {
    return cloneElement(node, undefined, tagColumnCells(node.props.children));
  }
  return node;
};

const withColumnScopes = (node: ReactNode): ReactNode => {
  if (Array.isArray(node)) return node.map(withColumnScopes);
  if (!isValidElement<ScopedElement>(node)) return node;
  if (node.type === 'thead') {
    return cloneElement(node, undefined, tagColumnCells(node.props.children));
  }
  return node;
};

type DataTableProps = {
  children: ReactNode;
  className?: string;
  /**
   * Accessible table name (aria-label). Omitted from the DOM entirely
   * when absent — callers that pass nothing render markup identical to
   * the pre-a11y table in every other respect.
   */
  ariaLabel?: string;
  /**
   * Screen-reader-only <caption> naming the table's context, rendered as
   * the table's first child (its required position). Absent → no caption
   * element at all. Uses the global .sr-only utility from theme.css.
   */
  caption?: string;
};

export function DataTable({ children, className, ariaLabel, caption }: DataTableProps) {
  return (
    <div className={cx(tableContainer, className)}>
      <table className={tableStyle} aria-label={ariaLabel}>
        {caption !== undefined && <caption className="sr-only">{caption}</caption>}
        {withColumnScopes(children)}
      </table>
    </div>
  );
}

type PaginationProps = {
  page: number;
  pageInfo?: string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  prevLabel?: string;
  nextLabel?: string;
};

export function Pagination({
  page,
  pageInfo,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  prevLabel = 'Prev',
  nextLabel = 'Next',
}: PaginationProps) {
  // A11y audit (this pass): both pager buttons carry VISIBLE text labels
  // (defaults 'Prev'/'Next'; call sites use 'Newer'/'Older') and no
  // icon-only variant exists, so no aria-labels are needed — the visible
  // text is the accessible name. There are no sort controls here to
  // audit; if one is ever added icon-only it must ship an aria-label.
  return (
    <div className={paginationStyle}>
      <span className={pageInfoStyle}>{pageInfo ?? `Page ${page}`}</span>
      <div className={pageButtonsStyle}>
        <Button variant="secondary" size="sm" disabled={!hasPrev} onClick={onPrev}>
          {prevLabel}
        </Button>
        <Button variant="secondary" size="sm" disabled={!hasNext} onClick={onNext}>
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
