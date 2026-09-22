// Method column for the transactions list: an honest per-row method
// display derived from the calldata's 4-byte selector, resolved through
// the shared openchain-backed signature service — the same source the tx
// detail page chips as "openchain", reusing its visual language (mono
// name, muted "+N more", provenance chip). Pure extraction and display
// mapping live here, exported for unit tests; the service batches every
// visible selector into ≤25-per-request lookups behind a session memo,
// so paging back over a seen page costs no requests.
import { css } from '@linaria/core';

import { monoStyle } from '@/components/ui/DataTable';
import type { SignatureOutcome } from '@/services/signatures';
import type { RpcTransaction } from '@/utils/blockRpcData';
import { selectorOf } from '@/utils/txDecode';

// Calldata that carries no method call: absent, empty, or the '0x'
// sentinel — a plain value transfer (same definition as the detail page
// FunctionCallCard's hasInput).
export const hasNoInputData = (inputData: string | undefined): boolean =>
  inputData === undefined || inputData === '' || inputData === '0x';

// What one row's Method cell shows. 'transfer' and 'unparsed' both render
// an em-dash but explain themselves differently in the title; 'selector'
// covers pending, notFound and unavailable outcomes alike — the truncated
// selector is both the loading placeholder and the honest unresolved
// display, so nothing shifts when resolution lands (or never does).
export type MethodDisplay =
  | { kind: 'transfer' }
  | { kind: 'creation' }
  | { kind: 'unparsed' }
  | { kind: 'selector'; selector: string }
  | { kind: 'resolved'; name: string; signature: string; moreCount: number };

// Pure display mapping for one transaction. A contract-creation tx (empty
// to-address) runs init code, not a method call — its first 4 bytes are
// not a selector and must never resolve to a fabricated name. Only an
// openchain-resolved candidate list with entries renders a name; every
// other outcome (pending, notFound, upstream unavailable) keeps the raw
// selector display.
export function methodDisplay(
  inputData: string | undefined,
  toAddress: string | null | undefined,
  outcome: SignatureOutcome | undefined,
): MethodDisplay {
  if (toAddress == null || toAddress === '') return { kind: 'creation' };
  if (hasNoInputData(inputData)) return { kind: 'transfer' };
  const selector = selectorOf(inputData);
  if (selector === null) return { kind: 'unparsed' };
  if (outcome === undefined || !('signatures' in outcome) || outcome.signatures.length === 0) {
    return { kind: 'selector', selector };
  }
  const [first, ...rest] = outcome.signatures;
  const parenIndex = first.indexOf('(');
  return {
    kind: 'resolved',
    // 'transfer(address,uint256)' → 'transfer'; a candidate without
    // parentheses renders verbatim.
    name: parenIndex > 0 ? first.slice(0, parenIndex) : first,
    signature: first,
    moreCount: rest.length,
  };
}

// Pure: the distinct function selectors a page of transactions should
// resolve. Plain transfers (no calldata) and contract creations (init
// code, not a selector) contribute nothing; calldata without a valid
// 4-byte hex prefix is skipped rather than risking a 400 on the batch.
export function pageMethodSelectors(
  transactions: readonly Pick<RpcTransaction, 'inputData' | 'toAddress'>[],
): string[] {
  const selectors = new Set<string>();
  for (const tx of transactions) {
    if (tx.toAddress == null || tx.toAddress === '') continue;
    const selector = selectorOf(tx.inputData);
    if (selector !== null) selectors.add(selector);
  }
  return [...selectors];
}

// Muted em-dash for the no-method rows (transfer / unparsed): visually
// quiet; the title carries the explanation.
const noMethodStyle = css`
  color: var(--haze-color-text-muted);
`;

// Muted "+N more" suffix — the detail page's multi-candidate collapse.
const moreCandidatesStyle = css`
  color: var(--haze-color-text-muted);
  margin-left: var(--haze-space-1);
`;

// Compact provenance chip (the detail page's sourceChipStyle): marks an
// openchain-derived name so it is never mistaken for ABI-decoded truth.
const openchainChipStyle = css`
  display: inline-block;
  margin-left: var(--haze-space-1);
  padding: 0 var(--haze-space-1);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-sm);
  font-size: 10px;
  line-height: 16px;
  color: var(--haze-color-text-muted);
  vertical-align: middle;
  white-space: nowrap;
`;

// Mobile degradation for the Method column at the established 768px
// breakpoint: the eight-column table drops its least-essential column
// instead of widening the card's horizontal scroller. Applied to both the
// header cell and every row cell.
export const methodColumnStyle = css`
  @media (max-width: 768px) {
    display: none;
  }
`;

const truncateSelector = (selector: string): string => `${selector.slice(0, 8)}…`;

// One row's Method cell, rendered from the pure display mapping: em-dash
// with an explanatory title for the no-method rows, the truncated
// selector (full value in the title) while pending or unresolved, and the
// resolved function's base name plus the muted "+N more" and openchain
// chip once a candidate list lands (full signature in the title).
export function MethodCell({
  inputData,
  toAddress,
  outcome,
}: {
  inputData: string | undefined;
  toAddress: string | null | undefined;
  outcome: SignatureOutcome | undefined;
}) {
  const display = methodDisplay(inputData, toAddress, outcome);
  switch (display.kind) {
    case 'transfer':
      return (
        <span className={noMethodStyle} title="No input data">
          —
        </span>
      );
    case 'unparsed':
      return (
        <span className={noMethodStyle} title="Input data has no valid 4-byte selector">
          —
        </span>
      );
    case 'creation':
      return (
        <span title="Contract creation — input is deployment code, not a method call">
          Contract Creation
        </span>
      );
    case 'selector':
      return (
        <span className={monoStyle} title={display.selector}>
          {truncateSelector(display.selector)}
        </span>
      );
    case 'resolved':
      return (
        <span title={display.signature}>
          <span className={monoStyle}>{display.name}</span>
          {display.moreCount > 0 && (
            <span className={moreCandidatesStyle}>{`(+${display.moreCount} more)`}</span>
          )}
          <span className={openchainChipStyle}>openchain</span>
        </span>
      );
  }
}

// Row-level wrapper: computes the row's selector once and indexes the
// page's resolved outcomes (undefined while pending, or when the selector
// was not requested — creation rows and plain transfers have none).
export function TxMethodCell({
  tx,
  outcomes,
}: {
  tx: Pick<RpcTransaction, 'inputData' | 'toAddress'>;
  outcomes: Record<string, SignatureOutcome>;
}) {
  const selector = selectorOf(tx.inputData);
  return (
    <MethodCell
      inputData={tx.inputData}
      toAddress={tx.toAddress}
      outcome={selector !== null ? outcomes[selector] : undefined}
    />
  );
}
