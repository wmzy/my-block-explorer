import React from 'react';
import { css, cx } from '@linaria/core';

const badge = css`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
`;

const variants = {
  default: css`
    background-color: #f1f5f9;
    color: #475569;
    
    @media (prefers-color-scheme: dark) {
      background-color: #334155;
      color: #cbd5e1;
    }
  `,
  
  success: css`
    background-color: #dcfce7;
    color: #166534;
    
    @media (prefers-color-scheme: dark) {
      background-color: #14532d;
      color: #bbf7d0;
    }
  `,
  
  warning: css`
    background-color: #fef3c7;
    color: #92400e;
    
    @media (prefers-color-scheme: dark) {
      background-color: #78350f;
      color: #fde68a;
    }
  `,
  
  error: css`
    background-color: #fee2e2;
    color: #991b1b;
    
    @media (prefers-color-scheme: dark) {
      background-color: #7f1d1d;
      color: #fecaca;
    }
  `,
  
  info: css`
    background-color: #dbeafe;
    color: #1e40af;
    
    @media (prefers-color-scheme: dark) {
      background-color: #1e3a8a;
      color: #bfdbfe;
    }
  `,
  
  purple: css`
    background-color: #e9d5ff;
    color: #7c3aed;
    
    @media (prefers-color-scheme: dark) {
      background-color: #6b21a8;
      color: #d8b4fe;
    }
  `,
};

const sizes = {
  sm: css`
    padding: 2px 6px;
    font-size: 11px;
  `,
  
  md: css`
    padding: 4px 8px;
    font-size: 12px;
  `,
  
  lg: css`
    padding: 6px 12px;
    font-size: 14px;
  `,
};

export type BadgeProps = {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  children: React.ReactNode;
  className?: string;
};

export function Badge({ 
  variant = 'default', 
  size = 'md',
  children, 
  className 
}: BadgeProps) {
  return (
    <span className={cx(badge, variants[variant], sizes[size], className)}>
      {children}
    </span>
  );
}

// 状态指示器组件
const statusIndicator = css`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

const statusDot = css`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
`;

const statusColors = {
  online: css`
    background-color: #10b981;
  `,
  
  offline: css`
    background-color: #ef4444;
  `,
  
  pending: css`
    background-color: #f59e0b;
  `,
  
  unknown: css`
    background-color: #6b7280;
  `,
};

export type StatusBadgeProps = {
  status: keyof typeof statusColors;
  children: React.ReactNode;
  className?: string;
};

export function StatusBadge({ status, children, className }: StatusBadgeProps) {
  const variant = {
    online: 'success',
    offline: 'error',
    pending: 'warning',
    unknown: 'default',
  }[status] as keyof typeof variants;

  return (
    <Badge variant={variant} className={cx(statusIndicator, className)}>
      <span className={cx(statusDot, statusColors[status])} />
      {children}
    </Badge>
  );
}
