import { css, cx } from '@linaria/core';
import { Skeleton } from 'haze-ui';

const loadingContainer = css`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: 200px;
  gap: var(--haze-space-3);
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
`;

const skeletonTable = css`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-3);
  padding: var(--haze-space-4);
`;

const skeletonRow = css`
  display: flex;
  gap: var(--haze-space-4);
`;

type LoadingStateProps = {
  message?: string;
  className?: string;
};

export function LoadingState({ message = 'Loading...', className }: LoadingStateProps) {
  return (
    <div className={cx(loadingContainer, className)}>
      <Skeleton width="32px" height="32px" variant="circular" />
      <span>{message}</span>
    </div>
  );
}

type TableSkeletonProps = {
  rows?: number;
  cols?: number;
};

export function TableSkeleton({ rows = 5, cols = 5 }: TableSkeletonProps) {
  return (
    <div className={skeletonTable}>
      <div className={skeletonRow}>
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} width={`${100 / cols}%`} height="16px" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className={skeletonRow}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} width={`${100 / cols}%`} height="14px" />
          ))}
        </div>
      ))}
    </div>
  );
}
