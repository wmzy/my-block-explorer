// Shared styles for the two internal-transactions surfaces (the address
// page's Internal Txns tab and the block detail page's traced Internal
// Transactions card): the summary, muted-note, failed-trace, retry and
// depth-cell styles. One source keeps the two surfaces visually identical
// by construction — a styling change must land here, never as a forked
// copy in one view. (The traced-progress loading component the two
// surfaces also share lives in components/TracedProgress.)
import { css, cx } from '@linaria/core';
import { monoStyle } from '@/components/ui/DataTable';

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
