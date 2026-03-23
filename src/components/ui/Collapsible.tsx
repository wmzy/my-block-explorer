import { css, cx } from '@linaria/core';
import type { ReactNode } from 'react';
import { useState } from 'react';

const containerStyle = css`
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  overflow: hidden;
`;

const headerStyle = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--haze-space-4) var(--haze-space-4);
  background: var(--haze-color-bg-subtle);
  cursor: pointer;
  user-select: none;
  transition: background-color 150ms ease;

  &:hover {
    background: var(--haze-color-bg-muted);
  }
`;

const headerContentStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  flex: 1;
`;

const titleStyle = css`
  font-size: var(--haze-text-base);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text);
  margin: 0;
`;

const badgeStyle = css`
  display: inline-flex;
  align-items: center;
  gap: var(--haze-space-1);
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

const contentStyle = css`
  padding: var(--haze-space-4);
  border-top: 1px solid var(--haze-color-border);
`;

const contentCollapsedStyle = css`
  display: none;
`;

export type CollapsibleProps = {
  title: ReactNode;
  defaultExpanded?: boolean;
  children: ReactNode;
  className?: string;
  badge?: ReactNode;
};

export function Collapsible({
  title,
  defaultExpanded = false,
  children,
  className,
  badge,
}: CollapsibleProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const handleToggle = () => {
    setIsExpanded(prev => !prev);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggle();
    }
  };

  return (
    <div className={cx(containerStyle, className)}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        className={headerStyle}
      >
        <div className={headerContentStyle}>
          <h3 className={titleStyle}>{title}</h3>
          {badge && <span className={badgeStyle}>{badge}</span>}
        </div>
        <svg
          className={cx(chevronStyle, isExpanded && chevronExpandedStyle)}
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
      <div
        className={cx(contentStyle, !isExpanded && contentCollapsedStyle)}
        aria-hidden={!isExpanded}
      >
        {children}
      </div>
    </div>
  );
}
