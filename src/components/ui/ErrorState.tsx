import { css, cx } from "@linaria/core";
import { Alert } from "haze-ui";
import { Button } from "./Button";
import type { ReactNode } from "react";

const errorContainer = css`
  margin: var(--haze-space-5) 0;
`;

const errorActions = css`
  margin-top: var(--haze-space-3);
`;

type ErrorStateProps = {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
};

export function ErrorState({
  message,
  onRetry,
  retryLabel = "Retry",
  className,
}: ErrorStateProps) {
  return (
    <div className={cx(errorContainer, className)}>
      <Alert variant="danger">
        {message}
        {onRetry && (
          <div className={errorActions}>
            <Button variant="outline" size="sm" onClick={onRetry}>
              {retryLabel}
            </Button>
          </div>
        )}
      </Alert>
    </div>
  );
}

type EmptyStateProps = {
  message?: string;
  className?: string;
  children?: ReactNode;
};

export function EmptyState({
  message = "No data found",
  className,
  children,
}: EmptyStateProps) {
  return (
    <div className={cx(errorContainer, className)}>
      <Alert variant="info">
        {message}
        {children}
      </Alert>
    </div>
  );
}
