// Shared chrome for the two operator consoles (Ops dashboard, SQL console):
// the admin-gate setup card and the page-level error notice (backend
// offline / rate limited / anything else verbatim). The gate copy differs
// by tier (opt-in vs strict) and stays at each view; the scaffold, the
// css and the notice's three-way classification live here so the two
// consoles cannot drift apart.
import { css } from '@linaria/core';
import type { ReactNode } from 'react';
import { Alert } from 'haze-ui';

import { Card } from '@/components/ui/Card';
import { BackendOfflineState } from '@/components/ui/ErrorState';
import { rateLimitWaitSeconds } from '@/util/adminGate';
import { ApiError } from '@/util/apiError';
import { isBackendUnreachable } from '@/util/http';
import { errorMessage } from '@/utils/errorHandler';

export const gateCard = css`
  max-width: 640px;
`;

export const gateBody = css`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--haze-space-2);
`;

export const gateText = css`
  margin: 0;
  line-height: var(--haze-leading-relaxed);
`;

// The setup card both gate faces render into: title plus copy slots. The
// views own the wording (which tier, which fix); this owns the layout.
export function AdminGateCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className={gateCard}>
      <Alert variant="warning">
        <div className={gateBody}>
          <strong>{title}</strong>
          {children}
        </div>
      </Alert>
    </Card>
  );
}

// Page-level failure of a console's request: attribution for a missing
// backend (the established self-help card — re-runs service discovery, not
// a plain refetch that would fast-fail), the limiter's wait made explicit,
// anything else verbatim.
export function AdminErrorNotice({
  error,
  onRetryConnection,
  retryConnectionPending,
  rateCopy,
  fallbackCopy,
}: {
  error: unknown;
  onRetryConnection: () => void;
  retryConnectionPending: boolean;
  /** e.g. 'the ops summary allows 6 requests per minute.' */
  rateCopy: string;
  fallbackCopy: string;
}) {
  if (isBackendUnreachable(error)) {
    return (
      <BackendOfflineState
        onRetryConnection={onRetryConnection}
        retryConnectionPending={retryConnectionPending}
      />
    );
  }
  if (error instanceof ApiError && error.status === 429) {
    const wait = rateLimitWaitSeconds(error);
    return (
      <Alert variant="warning">
        Rate limited — {rateCopy} {wait !== null ? `Retry in ${wait}s.` : error.message}
      </Alert>
    );
  }
  return <Alert variant="danger">{errorMessage(error, fallbackCopy)}</Alert>;
}
