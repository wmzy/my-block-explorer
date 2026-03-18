import { css, cx } from "@linaria/core";
import { Card as HazeCard } from "haze-ui";
import type { ReactNode } from "react";

export type CardProps = {
  children: ReactNode;
  className?: string;
  variant?: "elevated" | "outlined" | "filled";
};

export function Card({ children, className, variant = "outlined" }: CardProps) {
  return (
    <HazeCard variant={variant} className={className}>
      {children}
    </HazeCard>
  );
}

const cardHeaderStyle = css`
  padding: var(--haze-space-4) var(--haze-space-6);
  border-bottom: 1px solid var(--haze-color-border);
`;

export type CardHeaderProps = {
  children: ReactNode;
  className?: string;
};

export function CardHeader({ children, className }: CardHeaderProps) {
  return <div className={cx(cardHeaderStyle, className)}>{children}</div>;
}

const cardTitleStyle = css`
  font-size: var(--haze-text-lg);
  font-weight: var(--haze-weight-semibold);
  line-height: var(--haze-leading-normal);
  margin: 0;
  color: var(--haze-color-text);
`;

export type CardTitleProps = {
  children: ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
};

export function CardTitle({
  children,
  className,
  as: Component = "h3",
}: CardTitleProps) {
  return (
    <Component className={cx(cardTitleStyle, className)}>{children}</Component>
  );
}

const cardDescriptionStyle = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
  margin: var(--haze-space-1) 0 0 0;
`;

export type CardDescriptionProps = {
  children: ReactNode;
  className?: string;
};

export function CardDescription({ children, className }: CardDescriptionProps) {
  return <p className={cx(cardDescriptionStyle, className)}>{children}</p>;
}

const cardContentStyle = css`
  padding: var(--haze-space-6);
`;

export type CardContentProps = {
  children: ReactNode;
  className?: string;
};

export function CardContent({ children, className }: CardContentProps) {
  return <div className={cx(cardContentStyle, className)}>{children}</div>;
}

const cardFooterStyle = css`
  padding: var(--haze-space-4) var(--haze-space-6);
  border-top: 1px solid var(--haze-color-border);
  background-color: var(--haze-color-bg-subtle);
`;

export type CardFooterProps = {
  children: ReactNode;
  className?: string;
};

export function CardFooter({ children, className }: CardFooterProps) {
  return <div className={cx(cardFooterStyle, className)}>{children}</div>;
}
