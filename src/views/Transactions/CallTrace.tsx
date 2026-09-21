import { css, cx } from '@linaria/core';
import { useCallback, useRef, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { ErrorState } from '@/components/ui/ErrorState';
import { getChainSymbol } from '@/config/chains';
import { formatNumber, formatValue } from '@/utils/format';
import { createRpcClient } from '@/utils/realTimeData';
import {
  countFailedCalls,
  countNodes,
  isTraceUnsupportedError,
  maxDepth,
  normalizeCallTrace,
  type CallTraceNode,
} from '@/utils/traceFormat';

// Call-type badge color: read-only frames blue, code-executing frames in
// place purple, creations green, selfdestructs amber, everything else
// (CALL and future types) neutral — the badge still names unknown types.
const badgeVariantForType = (
  type: string,
): 'default' | 'success' | 'warning' | 'info' | 'purple' => {
  switch (type) {
    case 'STATICCALL':
      return 'info';
    case 'DELEGATECALL':
      return 'purple';
    case 'CREATE':
    case 'CREATE2':
      return 'success';
    case 'SELFDESTRUCT':
      return 'warning';
    default:
      return 'default';
  }
};

// Init code's first 4 bytes are NOT a function selector — CREATE-family
// frames skip the selector chip even though normalization kept one.
const CREATE_FAMILY = new Set(['CREATE', 'CREATE2', 'SELFDESTRUCT']);

const TRUNCATED_ADDRESS = (address: string): string =>
  `${address.slice(0, 8)}…${address.slice(-6)}`;

// The clickable header row: full-width toggle with the Collapsible card's
// affordances (role=button, keyboard, rotating chevron). Built on Card
// primitives instead of the Collapsible component because the trace fetch
// must fire on the FIRST expand only — semantics Collapsible's internal
// state cannot signal outward.
const headerToggleStyle = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--haze-space-3);
  width: 100%;
  cursor: pointer;
  user-select: none;
`;

const headerTitleRowStyle = css`
  display: flex;
  align-items: baseline;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
  min-width: 0;
`;

// Settled summary in the header: frame count and nesting depth (plus
// failures, when any frame reverted) so the collapsed card still tells
// the reader what the trace holds.
const headerMetaStyle = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

const chevronStyle = css`
  width: 20px;
  height: 20px;
  color: var(--haze-color-text-muted);
  transition: transform 200ms ease;
  flex-shrink: 0;
`;

const chevronExpandedStyle = css`
  transform: rotate(180deg);
`;

const statusTextStyle = css`
  margin: 0;
  color: var(--haze-color-text-muted);
`;

// Deep call trees stay readable by indenting instead of clipping: the
// whole tree scrolls horizontally inside the card.
const traceTreeStyle = css`
  overflow-x: auto;
  font-size: var(--haze-text-xs);
`;

const traceRowStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  flex-wrap: wrap;
  font-family: var(--haze-font-mono);
`;

const traceMutedStyle = css`
  color: var(--haze-color-text-muted);
`;

// Indent guide: one border-left per nesting level, execution-order children.
const traceChildrenStyle = css`
  margin-left: var(--haze-space-2);
  padding-left: var(--haze-space-4);
  border-left: 1px solid var(--haze-color-border);
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
`;

const traceNodeStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
`;

// Failure row for a frame that reported an error/revert: danger ink on the
// mono baseline, kept on its own line so a deep revert reads immediately.
const traceErrorStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-danger);
  word-break: break-all;
`;

// Gas share of the tx's total gasUsed; the tx's own figure, so the root
// frame of a fully-consumed tx reads 100% — not a bug, a ratio.
const gasShareLabel = (nodeGasUsed: bigint, txGasUsed: bigint): string => {
  if (txGasUsed === 0n) return '';
  const percent = (Number(nodeGasUsed) / Number(txGasUsed)) * 100;
  return `${percent.toFixed(1)}%`;
};

function TraceNodeRow({
  node,
  chainId,
  symbol,
  txGasUsed,
}: {
  node: CallTraceNode;
  chainId: number;
  symbol: string;
  /** Decimal gasUsed of the whole tx; null while unknown (percentages hide). */
  txGasUsed: bigint | null;
}) {
  // The tx's own frame is the only place `from` adds information (every
  // other frame's sender is some ancestor's `to`).
  const showSelector = node.selector !== null && !CREATE_FAMILY.has(node.type);
  const gasShare =
    node.gasUsed !== null && txGasUsed !== null ? gasShareLabel(node.gasUsed, txGasUsed) : '';

  return (
    <div className={traceNodeStyle}>
      <div className={traceRowStyle}>
        <Badge variant={badgeVariantForType(node.type)} size="sm">
          {node.type}
        </Badge>
        {node.depth === 0 && node.from !== null && (
          <CopyableHash
            value={node.from}
            truncated={TRUNCATED_ADDRESS(node.from)}
            href={`/chain/${chainId}/address/${node.from}`}
          />
        )}
        <span className={traceMutedStyle} aria-hidden="true">
          →
        </span>
        {node.to !== null ? (
          <CopyableHash
            value={node.to}
            truncated={TRUNCATED_ADDRESS(node.to)}
            href={`/chain/${chainId}/address/${node.to}`}
          />
        ) : (
          // CREATE frames on nodes that omit `to`: the honest absence, not
          // a guessed address.
          <span className={traceMutedStyle}>target not reported</span>
        )}
        {node.value !== null && node.value > 0n && (
          <span className={traceMutedStyle} title={`${node.value.toString()} wei`}>
            {formatValue(node.value, symbol)}
          </span>
        )}
        {node.gasUsed !== null && (
          <span className={traceMutedStyle}>
            {`gas ${formatNumber(node.gasUsed)}${gasShare !== '' ? ` · ${gasShare}` : ''}`}
          </span>
        )}
        {showSelector && <span>{node.selector}</span>}
      </div>
      {(node.error !== null || node.revertReason !== null) && (
        <div className={traceErrorStyle}>
          {node.error !== null && <div>{`error: ${node.error}`}</div>}
          {node.revertReason !== null && <div>{`revert: ${node.revertReason}`}</div>}
        </div>
      )}
      {node.calls.length > 0 && (
        <div className={traceChildrenStyle}>
          {node.calls.map((child, index) => (
            <TraceNodeRow
              key={index}
              node={child}
              chainId={chainId}
              symbol={symbol}
              txGasUsed={txGasUsed}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type TraceState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'loaded'; root: CallTraceNode }
  | { phase: 'empty' }
  | { phase: 'unsupported' }
  | { phase: 'error' };

export type CallTraceCardProps = {
  chainId: number;
  txHash: string;
  /** Decimal gasUsed of the whole tx, for per-frame gas shares; null/undefined hides them. */
  txGasUsed?: string | null;
};

// "Call Trace" card on the tx detail page: the Geth callTracer tree of a
// MINED transaction, fetched lazily from the chain's RPC in the browser
// (traces are ephemeral node data — data-separation rule). Honesty rules:
// - lazy: the trace request fires on the first expand only; toggles later
//   reuse the settled result and Retry refetches explicitly.
// - an endpoint without debug_traceTransaction is an INFO state ("not
//   supported by this RPC"), never an error card — the rest of the page
//   is unaffected.
// - a frameless result reads "No calls recorded"; every displayed number
//   comes from the trace itself (null stays absent, never 0).
export function CallTraceCard({ chainId, txHash, txGasUsed }: CallTraceCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<TraceState>({ phase: 'idle' });
  // Guards the fetch-once-on-expand and drops stale settles when Retry
  // supersedes an in-flight request.
  const fetchedOnce = useRef(false);
  const fetchSeq = useRef(0);

  const runFetch = useCallback(async () => {
    const seq = fetchSeq.current + 1;
    fetchSeq.current = seq;
    setState({ phase: 'loading' });
    try {
      // viem's client.request is typed to the standard RPC schema; the
      // debug namespace is not in it, so the request goes through the
      // same narrow cast the contract-creation trace uses.
      const client = await createRpcClient(chainId);
      const raw = await (
        client as unknown as {
          request: (args: { method: string; params: unknown[] }) => Promise<unknown>;
        }
      ).request({
        method: 'debug_traceTransaction',
        params: [txHash, { tracer: 'callTracer' }],
      });
      if (fetchSeq.current !== seq) return;
      const root = normalizeCallTrace(raw);
      setState(root === null ? { phase: 'empty' } : { phase: 'loaded', root });
    } catch (err) {
      if (fetchSeq.current !== seq) return;
      setState(isTraceUnsupportedError(err) ? { phase: 'unsupported' } : { phase: 'error' });
    }
  }, [chainId, txHash]);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !fetchedOnce.current) {
      fetchedOnce.current = true;
      void runFetch();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleToggle();
    }
  };

  const headerMeta =
    state.phase === 'loaded'
      ? `${countNodes(state.root)} calls · depth ${maxDepth(state.root)}${
        countFailedCalls(state.root) > 0 ? ` · ${countFailedCalls(state.root)} failed` : ''
      }`
      : null;

  let txGasUsedBigint: bigint | null = null;
  if (txGasUsed !== undefined && txGasUsed !== null && txGasUsed !== '') {
    try {
      txGasUsedBigint = BigInt(txGasUsed);
    } catch {
      txGasUsedBigint = null;
    }
  }

  return (
    <Card>
      <CardHeader>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={handleToggle}
          onKeyDown={handleKeyDown}
          className={headerToggleStyle}
          data-testid="call-trace-header"
        >
          <div className={headerTitleRowStyle}>
            <CardTitle>Call Trace</CardTitle>
            {headerMeta !== null && <span className={headerMetaStyle}>{headerMeta}</span>}
          </div>
          <svg
            className={cx(chevronStyle, expanded && chevronExpandedStyle)}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent>
          {state.phase === 'loading' && <p className={statusTextStyle}>Fetching call trace…</p>}
          {state.phase === 'unsupported' && (
            <p className={statusTextStyle} data-testid="call-trace-unsupported">
              Call trace not supported by this RPC — the endpoint does not implement
              debug_traceTransaction. Everything else on this page is unaffected.
            </p>
          )}
          {state.phase === 'empty' && (
            <p className={statusTextStyle} data-testid="call-trace-empty">
              No calls recorded.
            </p>
          )}
          {state.phase === 'error' && (
            <ErrorState
              message="Failed to fetch the call trace from this RPC."
              onRetry={() => void runFetch()}
            />
          )}
          {state.phase === 'loaded' && (
            <div className={traceTreeStyle}>
              <TraceNodeRow
                node={state.root}
                chainId={chainId}
                symbol={getChainSymbol(chainId)}
                txGasUsed={txGasUsedBigint}
              />
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default CallTraceCard;
