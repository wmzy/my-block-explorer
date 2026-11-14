// Toolbar family shared by the directory-style list pages (Contracts and
// Tokens): title on the left, the filter input + Refresh cluster on the
// right, and the honesty line under the toolbar. Hoisted verbatim from
// the two views, which carried byte-identical css bodies (only their
// trailing comments differed — each view's copy semantics live at its own
// usage site). Transactions/List and Blocks/List deliberately keep their
// own close variants (tighter gap, column-stacking at 768px instead of
// wrapping); those were left in place to avoid visual churn.
import { css } from '@linaria/core';

// Header row: title on the left, the filter input and Refresh on the
// right.
export const listToolbar = css`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--haze-space-4);
  margin-bottom: var(--haze-space-4);
  flex-wrap: wrap;
`;

// The filter input + Refresh cluster on the toolbar's right side.
export const toolbarActions = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);

  @media (max-width: 768px) {
    flex-wrap: wrap;
  }
`;

// The filter input keeps its own width; the Refresh button follows it.
// On narrow screens the input owns a full-width row and Refresh wraps
// below it — a full-width input is a better tap target than a ~240px
// squeeze next to the button.
export const filterBox = css`
  width: 280px;
  max-width: 100%;

  @media (max-width: 768px) {
    width: 100%;
  }
`;

// Honesty line under the toolbar; each view's copy states what its own
// list is (the explorer's cache, a curated token set, …).
export const sourceNote = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
  margin-bottom: var(--haze-space-3);
`;
