import { css, cx } from '@linaria/core';
import type { ReactNode } from 'react';

const gridStyle = css`
  display: grid;
  gap: 0;
`;

const itemStyle = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--haze-space-3) 0;
  border-bottom: 1px solid var(--haze-color-bg-muted);
  gap: var(--haze-space-4);

  &:last-child {
    border-bottom: none;
  }
`;

const labelStyle = css`
  font-weight: var(--haze-weight-medium);
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
  white-space: nowrap;
  flex-shrink: 0;
`;

const valueStyle = css`
  font-family: var(--haze-font-mono);
  color: var(--haze-color-text);
  word-break: break-all;
  text-align: right;
  font-size: var(--haze-text-sm);
`;

type InfoGridProps = {
  className?: string;
  children: ReactNode;
};

export function InfoGrid({ className, children }: InfoGridProps) {
  return <div className={cx(gridStyle, className)}>{children}</div>;
}

type InfoItemProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

export function InfoItem({ label, children, className }: InfoItemProps) {
  return (
    <div className={cx(itemStyle, className)}>
      <span className={labelStyle}>{label}</span>
      <span className={valueStyle}>{children}</span>
    </div>
  );
}
