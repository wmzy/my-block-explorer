import React from 'react';
import { css, cx } from '@linaria/core';

const card = css`
  background-color: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
  overflow: hidden;
  
  @media (prefers-color-scheme: dark) {
    background-color: #1e293b;
    border-color: #334155;
  }
`;

const cardHeader = css`
  padding: 16px 24px;
  border-bottom: 1px solid #e2e8f0;
  
  @media (prefers-color-scheme: dark) {
    border-bottom-color: #334155;
  }
`;

const cardTitle = css`
  font-size: 18px;
  font-weight: 600;
  line-height: 1.5;
  margin: 0;
  color: #1e293b;
  
  @media (prefers-color-scheme: dark) {
    color: #e2e8f0;
  }
`;

const cardDescription = css`
  font-size: 14px;
  color: #64748b;
  margin: 4px 0 0 0;
  
  @media (prefers-color-scheme: dark) {
    color: #94a3b8;
  }
`;

const cardContent = css`
  padding: 24px;
`;

const cardFooter = css`
  padding: 16px 24px;
  border-top: 1px solid #e2e8f0;
  background-color: #f8fafc;
  
  @media (prefers-color-scheme: dark) {
    border-top-color: #334155;
    background-color: #0f172a;
  }
`;

export type CardProps = {
  children: React.ReactNode;
  className?: string;
};

export function Card({ children, className }: CardProps) {
  return (
    <div className={cx(card, className)}>
      {children}
    </div>
  );
}

export type CardHeaderProps = {
  children: React.ReactNode;
  className?: string;
};

export function CardHeader({ children, className }: CardHeaderProps) {
  return (
    <div className={cx(cardHeader, className)}>
      {children}
    </div>
  );
}

export type CardTitleProps = {
  children: React.ReactNode;
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
};

export function CardTitle({ children, className, as: Component = 'h3' }: CardTitleProps) {
  return (
    <Component className={cx(cardTitle, className)}>
      {children}
    </Component>
  );
}

export type CardDescriptionProps = {
  children: React.ReactNode;
  className?: string;
};

export function CardDescription({ children, className }: CardDescriptionProps) {
  return (
    <p className={cx(cardDescription, className)}>
      {children}
    </p>
  );
}

export type CardContentProps = {
  children: React.ReactNode;
  className?: string;
};

export function CardContent({ children, className }: CardContentProps) {
  return (
    <div className={cx(cardContent, className)}>
      {children}
    </div>
  );
}

export type CardFooterProps = {
  children: React.ReactNode;
  className?: string;
};

export function CardFooter({ children, className }: CardFooterProps) {
  return (
    <div className={cx(cardFooter, className)}>
      {children}
    </div>
  );
}
