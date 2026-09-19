import { css, cx } from '@linaria/core';
import { Alert } from 'haze-ui';
import { Button } from './Button';
import type { ReactNode } from 'react';

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
  retryLabel = 'Retry',
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
  message = 'No data found',
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

const offlineBodyStyles = css`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--haze-space-2);
  min-width: 0;
`;

const offlineTextStyles = css`
  margin: 0;
  line-height: var(--haze-leading-relaxed);
`;

const offlineCodeStyles = css`
  align-self: flex-start;
  padding: var(--haze-space-1) var(--haze-space-3);
  border-radius: var(--haze-radius-sm);
  background: color-mix(in srgb, var(--haze-color-warning) 12%, transparent);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  word-break: break-all;
`;

type BackendOfflineStateProps = {
  className?: string;
  /**
   * Wired by the hosting surface: re-runs service discovery (the same
   * reconnect the connection badge uses). Without it the state is purely
   * informational — a plain Retry would just fast-fail again while the
   * API base is unset, so no dead retry button is rendered.
   */
  onRetryConnection?: () => void;
  /** Disables the retry action while a discovery attempt is in flight. */
  retryConnectionPending?: boolean;
};

// Attribution variant for backend-unreachable failures (ApiError status 0
// — no API base discovered, or the network path to it died). Renders the
// self-help path instead of the raw error message so users stop reading a
// missing backend as a chain problem. Warning palette matches the
// degraded-mode banner: an environment state with a recovery path, not a
// fetch failure.
export function BackendOfflineState({
  className,
  onRetryConnection,
  retryConnectionPending = false,
}: BackendOfflineStateProps) {
  return (
    <div className={cx(errorContainer, className)} role="alert">
      <Alert variant="warning">
        <div className={offlineBodyStyles}>
          <strong>Backend offline — indexed data unavailable.</strong>
          <p className={offlineTextStyles}>
            Contract source, ABI and event data come from this explorer&apos;s
            indexing backend, not from the chain RPC — blocks and transactions
            pages keep working without it. Start the backend in a terminal:
          </p>
          <code className={offlineCodeStyles}>npx my-block-explorer --port 8201</code>
          <p className={offlineTextStyles}>
            To point the app at a running backend, open the setup panel from the
            banner at the top of the page (reload the page if you dismissed it)
            or the connection badge in the bottom-left corner.
          </p>
          {onRetryConnection && (
            <div className={errorActions}>
              <Button
                variant="outline"
                size="sm"
                onClick={onRetryConnection}
                disabled={retryConnectionPending}
              >
                {retryConnectionPending ? 'Retrying…' : 'Retry connection'}
              </Button>
            </div>
          )}
        </div>
      </Alert>
    </div>
  );
}
