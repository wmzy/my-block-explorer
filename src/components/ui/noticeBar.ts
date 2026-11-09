// Shared notice-bar strip: a bordered, primary-subtle flex row for
// page-level explanatory notes (staleness hints, anchor notices, pending
// counts). One source keeps the family visually identical by construction;
// new notice bars must consume this export instead of forking a copy —
// per-site layout deltas (roomier gap, wrapping, stacking) compose on
// top via cx.
import { css } from '@linaria/core';

export const noticeBarStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  padding: var(--haze-space-2) var(--haze-space-3);
  margin-bottom: var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  background: var(--haze-color-primary-subtle);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
`;
