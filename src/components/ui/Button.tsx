import React from 'react';
import { css, cx } from '@linaria/core';

const baseButton = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  &:focus {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
  }
`;

const variants = {
  primary: css`
    background-color: #3b82f6;
    color: white;
    
    &:hover:not(:disabled) {
      background-color: #2563eb;
    }
    
    &:active {
      background-color: #1d4ed8;
    }
  `,
  
  secondary: css`
    background-color: #f1f5f9;
    color: #475569;
    border: 1px solid #e2e8f0;
    
    &:hover:not(:disabled) {
      background-color: #e2e8f0;
    }
    
    &:active {
      background-color: #cbd5e1;
    }
  `,
  
  outline: css`
    background-color: transparent;
    color: #3b82f6;
    border: 1px solid #3b82f6;
    
    &:hover:not(:disabled) {
      background-color: #3b82f6;
      color: white;
    }
  `,
  
  ghost: css`
    background-color: transparent;
    color: #475569;
    
    &:hover:not(:disabled) {
      background-color: #f1f5f9;
    }
  `,
  
  danger: css`
    background-color: #ef4444;
    color: white;
    
    &:hover:not(:disabled) {
      background-color: #dc2626;
    }
    
    &:active {
      background-color: #b91c1c;
    }
  `,
};

const sizes = {
  sm: css`
    padding: 6px 12px;
    font-size: 12px;
  `,
  
  md: css`
    padding: 8px 16px;
    font-size: 14px;
  `,
  
  lg: css`
    padding: 12px 24px;
    font-size: 16px;
  `,
};

export type ButtonProps = {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  children: React.ReactNode;
} & (
  | (React.ButtonHTMLAttributes<HTMLButtonElement> & { as?: 'button' })
  | (React.AnchorHTMLAttributes<HTMLAnchorElement> & { as: 'a' })
);

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  children,
  className,
  disabled,
  as = 'button',
  ...props
}: ButtonProps) {
  const buttonClassName = cx(
    baseButton,
    variants[variant],
    sizes[size],
    className
  );

  const content = (
    <>
      {loading && (
        <span className={css`
          width: 16px;
          height: 16px;
          border: 2px solid transparent;
          border-top: 2px solid currentColor;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          
          @keyframes spin {
            to {
              transform: rotate(360deg);
            }
          }
        `} />
      )}
      {children}
    </>
  );

  if (as === 'a') {
    const { href, target, rel, ...anchorProps } = props as React.AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <a
        href={href}
        target={target}
        rel={rel}
        className={buttonClassName}
        {...anchorProps}
      >
        {content}
      </a>
    );
  }

  const { type = 'button', ...buttonProps } = props as React.ButtonHTMLAttributes<HTMLButtonElement>;
  
  return (
    <button
      type={type}
      className={buttonClassName}
      disabled={disabled || loading}
      {...buttonProps}
    >
      {content}
    </button>
  );
}
