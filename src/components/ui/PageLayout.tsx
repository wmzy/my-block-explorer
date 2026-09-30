import { css, cx } from '@linaria/core';
import type { ReactNode } from 'react';

const pageContainer = css`
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--haze-space-5);
  font-family: var(--haze-font-sans);
`;

const narrowContainer = css`
  max-width: 1000px;
`;

const pageHeaderStyle = css`
  margin-bottom: var(--haze-space-6);

  h1 {
    font-size: var(--haze-text-2xl);
    font-weight: var(--haze-weight-semibold);
    line-height: var(--haze-leading-tight);
    letter-spacing: -0.01em;
    margin: 0 0 var(--haze-space-2) 0;
    color: var(--haze-color-text);
  }
`;

const chainInfoStyle = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
`;

type PageContainerProps = {
  children: ReactNode;
  narrow?: boolean;
  className?: string;
};

export function PageContainer({ children, narrow, className }: PageContainerProps) {
  return (
    <div className={cx(pageContainer, narrow ? narrowContainer : undefined, className)}>
      {children}
    </div>
  );
}

type PageHeaderProps = {
  title: string;
  chainInfo?: string;
  className?: string;
};

export function PageHeader({ title, chainInfo, className }: PageHeaderProps) {
  return (
    <div className={cx(pageHeaderStyle, className)}>
      <h1>{title}</h1>
      {chainInfo && <div className={chainInfoStyle}>{chainInfo}</div>}
    </div>
  );
}
