import { css, cx } from "@linaria/core";
import { Button } from "./Button";
import type { ReactNode } from "react";

const tableContainer = css`
  background: var(--haze-color-bg);
  border-radius: var(--haze-radius-lg);
  border: 1px solid var(--haze-color-border);
  overflow: hidden;
`;

const tableStyle = css`
  width: 100%;
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

type DataTableProps = {
  children: ReactNode;
  className?: string;
};

export function DataTable({ children, className }: DataTableProps) {
  return (
    <div className={cx(tableContainer, className)}>
      <table className={tableStyle}>{children}</table>
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
  prevLabel = "Prev",
  nextLabel = "Next",
}: PaginationProps) {
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
