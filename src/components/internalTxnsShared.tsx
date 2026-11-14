// Shared pieces for the two internal-transactions surfaces (the address
// page's Internal Txns tab and the block detail page's traced Internal
// Transactions card): the summary, muted-note, failed-trace, retry and
// depth-cell styles, the FailedTracesCollapsible card both surfaces
// render for trace requests that came back failed, and the per-tx trace
// skeleton (traceOneTxOutcome) both surfaces run their requests through.
// One source keeps the two surfaces visually and behaviorally identical
// by construction — a styling, markup or catch-shaping change must land
// here, never as a forked copy in one view. (The traced-progress loading
// component the two surfaces also share lives in
// components/TracedProgress.)
import { css, cx } from '@linaria/core';
import { TypedLink } from '@native-router/react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Collapsible } from '@/components/ui/Collapsible';
import { linkStyle, monoStyle } from '@/components/ui/DataTable';
import { fetchCallTraceTree } from '@/utils/callTraceRpc';
import { errorMessage } from '@/utils/errorHandler';
import { formatHash } from '@/utils/format';
import {
  shortTraceFailureMessage,
  type FailedTraceTx,
  type TraceTxOutcome,
} from '@/utils/internalTxScan';
import { isTraceUnsupportedError, type CallTraceNode } from '@/utils/traceFormat';

/**
 * The per-tx trace skeleton both surfaces share verbatim: the family's
 * shared fetch (utils/callTraceRpc), the honest null short-circuit (a
 * payload that is not a call frame is a traced-empty outcome, never a
 * fabricated tree), and the catch shaping (the family's unsupported
 * classifier picks the info state; everything else is a failed row with
 * the rendered message). Generic over the traced arm's row shape — the
 * flatten step is injected, so the address tab flattens for its viewed
 * address while the block sweep flattens every frame below the tx's
 * top-level call.
 */
export async function traceOneTxOutcome<Row>(
  chainId: number,
  hash: string,
  flattenTraced: (root: CallTraceNode) => { rows: Row[]; truncated: boolean },
): Promise<TraceTxOutcome<Row>> {
  try {
    const root = await fetchCallTraceTree(chainId, hash);
    if (root === null) return { hash, status: 'traced', rows: [], truncated: false };
    const { rows, truncated } = flattenTraced(root);
    return { hash, status: 'traced', rows, truncated };
  } catch (err) {
    const message = errorMessage(err);
    return isTraceUnsupportedError(err)
      ? { hash, status: 'unsupported', message }
      : { hash, status: 'failed', message };
  }
}

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
