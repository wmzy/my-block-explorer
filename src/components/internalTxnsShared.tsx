// Shared pieces for the two internal-transactions surfaces (the address
// page's Internal Txns tab and the block detail page's traced Internal
// Transactions card): the summary, muted-note, failed-trace, retry and
// depth-cell styles, plus the FailedTracesCollapsible card both surfaces
// render for trace requests that came back failed. One source keeps the
// two surfaces visually identical by construction — a styling or markup
// change must land here, never as a forked copy in one view. (The
// traced-progress loading component the two surfaces also share lives in
// components/TracedProgress.)
import { css, cx } from '@linaria/core';
import { TypedLink } from '@native-router/react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Collapsible } from '@/components/ui/Collapsible';
import { linkStyle, monoStyle } from '@/components/ui/DataTable';
import { formatHash } from '@/utils/format';
import { shortTraceFailureMessage, type FailedTraceTx } from '@/utils/internalTxScan';

// Aggregate header: counts + the honest bounds label, one line each.
export const summaryLine = css`
  margin: 0 0 var(--haze-space-2);
  font-size: var(--haze-text-xs);
`;

export const muted = css`
  color: var(--haze-color-text-muted);
`;

export const failedTxsCard = css`
  margin-top: var(--haze-space-3);
`;

// One failed-trace row inside the collapsed card: tx link + raw message.
export const failedTxRow = cx(
  monoStyle,
  css`
    overflow-wrap: anywhere;
    margin-bottom: var(--haze-space-1);
  `,
);

export const retryRow = css`
  margin-top: var(--haze-space-3);
`;

export const depthCell = cx(
  muted,
  monoStyle,
);

// The failed-trace report both surfaces render under their table: a
// collapsed card listing every trace request that failed (tx link + raw
// message) with the Retry button that re-runs the whole sweep. The
// caller keeps the "any failures at all" gate — this component always
// paints what it is given.
type FailedTracesCollapsibleProps = {
  failures: FailedTraceTx[];
  chainId: number;
  onRetry: () => void;
};

export function FailedTracesCollapsible({ failures, chainId, onRetry }: FailedTracesCollapsibleProps) {
  return (
    <>
      <Collapsible
        className={failedTxsCard}
        title={`${failures.length} trace ${failures.length === 1 ? 'failure' : 'failures'}`}
        badge={(
          <Badge variant="warning" size="sm">
            failed
          </Badge>
        )}
      >
        {failures.map(failure => (
          <div key={failure.hash} className={failedTxRow}>
            <TypedLink
              to={`/chain/${chainId}/tx/${failure.hash}`}
              className={linkStyle}
              title={failure.hash}
            >
              {formatHash(failure.hash)}
            </TypedLink>{' '}
            — {shortTraceFailureMessage(failure.message)}
          </div>
        ))}
      </Collapsible>
      <div className={retryRow}>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry failed traces
        </Button>
      </div>
    </>
  );
}
