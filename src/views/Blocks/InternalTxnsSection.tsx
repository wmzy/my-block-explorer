// "Internal Transactions (traced)" card on the Block Detail page
// (PM-review P2, Blockscout parity): an on-demand callTracer sweep over
// the block's transactions, flattened to the calls nested inside each
// tx's top-level frame and grouped per parent tx. Honesty rules (the
// address tab's and Call Trace card's convention — no second tracing
// convention):
// - lazy: nothing is fetched until the first expand; later toggles reuse
//   the settled sweep and Retry refetches explicitly.
// - traces are ephemeral node data, so every RPC call runs in the browser
//   against the chain's RPC (data-separation rule) — never proxied
//   through the backend.
// - the sweep is a bounded sample (first MAX_BLOCK_TRACED_TXS
//   transactions, a small parallel pool, per-tx walk bounds) and the
//   scope line says so — completeness is never implied, this is not
//   indexer data.
// - an endpoint without debug_traceTransaction is an INFO state ("not
//   supported by this RPC"), never an error card.
// - a block with zero transactions renders the empty state WITHOUT any
//   tracing (the detail page already knows the count).
import { useCallback, useState } from 'react';
import { css, cx } from '@linaria/core';
import { TypedLink } from '@native-router/react';
import { Alert } from 'haze-ui';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CallTypeBadge } from '@/components/CallTypeBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Collapsible } from '@/components/ui/Collapsible';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { DataTable, linkStyle } from '@/components/ui/DataTable';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { getChainSymbol } from '@/config/chains';
import { useLazyExpand } from '@/util/useLazyExpand';
import { fetchCallTraceTree, rpcRequest } from '@/utils/callTraceRpc';
import { cellText, formatHash, formatValue } from '@/utils/format';
import { runTracePool, shortTraceFailureMessage, TRACE_CONCURRENCY } from '@/utils/internalTxScan';
import { isTraceUnsupportedError } from '@/utils/traceFormat';
import {
  blockInternalTxnsSummary,
  blockTraceTruncationLabel,
  extractBlockTxHashes,
  flattenBlockInternalFrames,
  groupBlockInternalTxns,
  rowCarriesValue,
  selectBlockTraceScope,
  type BlockInternalTxnsAggregate,
  type BlockTraceTxOutcome,
} from './internalTxns';

// The clickable header row: full-width toggle with the Collapsible card's
// affordances (role=button, keyboard, rotating chevron). Built on Card
// primitives instead of the Collapsible component because the sweep must
// fire on the FIRST expand only — semantics Collapsible's internal state
// cannot signal outward (same reason as the tx page's Call Trace card).
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

// Settled summary in the header (frame count across traced txs) so the
// collapsed card still tells the reader what the sweep holds.
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

// Standing scope line: renders in every expanded phase so the data's
// provenance — on-demand traces from this node's debug API, not an
// indexer — is never hidden behind a loading state.
const scopeNote = css`
  margin: 0 0 var(--haze-space-3);
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

const summaryLine = css`
  margin: 0 0 var(--haze-space-2);
  font-size: var(--haze-text-xs);
`;

const muted = css`
  color: var(--haze-color-text-muted);
`;

const valueCell = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  white-space: nowrap;
`;

const selectorCell = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
`;

const depthCell = css`
  color: var(--haze-color-text-muted);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
`;

// A failed internal call's error text under its type badge: danger ink,
// kept inside the row so a deep revert reads immediately.
const rowErrorStyle = css`
  display: block;
  margin-top: var(--haze-space-1);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-danger);
  word-break: break-all;
`;

// One parent-tx table under its linked header.
const txGroup = css`
  margin: 0 0 var(--haze-space-4);
`;

const txGroupHeader = css`
  display: flex;
  align-items: baseline;
  gap: var(--haze-space-2);
  flex-wrap: wrap;
  margin: 0 0 var(--haze-space-2);
  font-size: var(--haze-text-sm);
  font-weight: 600;
`;

const txGroupMeta = css`
  font-weight: 400;
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

const failedTxsCard = css`
  margin-top: var(--haze-space-3);
`;

// One failed-trace row inside the collapsed card: tx link + raw message.
const failedTxRow = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  overflow-wrap: anywhere;
  margin-bottom: var(--haze-space-1);
`;

const retryRow = css`
  margin-top: var(--haze-space-3);
`;

// The block's transaction list: eth_getBlockByHash against the shared
// browser RPC client (utils/callTraceRpc's untyped-request seam) — the
// block detail's own data holds only the count, and full tx objects are
// ephemeral node data (data-separation rule). By HASH (not number) so
// the sweep always covers the block the page rendered, even across a
// reorg: the page hands the hash in as a plain string, and the payload
// is validated by the pure extractor either way.
const fetchBlockTxHashes = async (chainId: number, blockHash: string): Promise<string[]> => {
  const block = await rpcRequest(chainId, {
    method: 'eth_getBlockByHash',
    params: [blockHash, true],
  });
  const hashes = extractBlockTxHashes(block);
  if (hashes === null) {
    throw new Error('the block payload did not carry a usable transaction list');
  }
  return hashes;
};

// Trace one of the block's transactions through the family's shared
// fetch (utils/callTraceRpc — the address tab's and the Call Trace
// card's request shape and cast).
const traceOneTx = async (chainId: number, hash: string): Promise<BlockTraceTxOutcome> => {
  try {
    const root = await fetchCallTraceTree(chainId, hash);
    if (root === null) return { hash, status: 'traced', rows: [], truncated: false };
    return { hash, status: 'traced', ...flattenBlockInternalFrames(hash, root) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return isTraceUnsupportedError(err)
      ? { hash, status: 'unsupported', message }
      : { hash, status: 'failed', message };
  }
};

type SweepResult = {
  aggregate: BlockInternalTxnsAggregate;
  /** How many transactions the sweep traced (the cap applied). */
  scopedCount: number;
  /** How many transactions the block holds (the fetched list's length). */
  totalCount: number;
};

type SweepState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'tracing'; settled: number; total: number }
  | { phase: 'settled'; result: SweepResult }
  | { phase: 'unsupported' }
  | { phase: 'error' };

export type InternalTxnsSectionProps = {
  chainId: number;
  /** Hash of the rendered block — the sweep's tx list is fetched by hash so it always covers THIS block. */
  blockHash: string;
  /** The block's transaction count as the detail page already knows it: zero renders the empty state without any tracing. */
  transactionCount: number;
};

export function InternalTxnsSection({
  chainId,
  blockHash,
  transactionCount,
}: InternalTxnsSectionProps) {
  const [state, setState] = useState<SweepState>({ phase: 'idle' });

  // Lazy-expand machine (util/useLazyExpand): the sweep fires on the
  // first expand only, and the block-detail route's param change (the
  // section is reused without a remount) resets everything — expanded
  // flag, sweep-once latch, the phase state below, and any in-flight
  // settle — so the next block never renders the previous block's
  // internal transactions. Zero-tx blocks leave the latch armed (the
  // veto): the count the page already holds says there is nothing to
  // trace, so expanding only reads the empty state, and a count that
  // arrives later still sweeps.
  const {
    expanded,
    toggle: handleToggle,
    handleKeyDown,
    claim,
    isCurrent,
  } = useLazyExpand(`${chainId}:${blockHash}`, {
    onFirstExpand: () => {
      if (transactionCount <= 0) return false;
      void runSweep();
      return true;
    },
    onReset: () => {
      setState({ phase: 'idle' });
    },
  });

  const runSweep = useCallback(async () => {
    const seq = claim();
    setState({ phase: 'loading' });
    try {
      const allHashes = await fetchBlockTxHashes(chainId, blockHash);
      if (!isCurrent(seq)) return;
      const hashes = selectBlockTraceScope(allHashes.map(hash => ({ hash }))).txs.map(
        tx => tx.hash,
      );
      if (hashes.length === 0) {
        // The fetched list came back empty (a reorg race against the
        // page's count, or a node disagreeing with itself): honest empty.
        setState({
          phase: 'settled',
          result: {
            aggregate: groupBlockInternalTxns([]),
            scopedCount: 0,
            totalCount: allHashes.length,
          },
        });
        return;
      }
      setState({ phase: 'tracing', settled: 0, total: hashes.length });
      const outcomes = await runTracePool(
        hashes,
        TRACE_CONCURRENCY,
        hash => traceOneTx(chainId, hash),
        settled => {
          if (isCurrent(seq)) {
            setState({ phase: 'tracing', settled, total: hashes.length });
          }
        },
      );
      if (!isCurrent(seq)) return;
      const aggregate = groupBlockInternalTxns(outcomes);
      if (aggregate.unsupported) {
        setState({ phase: 'unsupported' });
        return;
      }
      setState({
        phase: 'settled',
        result: { aggregate, scopedCount: hashes.length, totalCount: allHashes.length },
      });
    } catch {
      if (!isCurrent(seq)) return;
      // The tx-list fetch is a plain eth_* call: any failure here is a
      // retryable request failure, not a debug-capability verdict.
      setState({ phase: 'error' });
    }
  }, [chainId, blockHash, claim, isCurrent]);

  // Retry re-runs the whole sweep (on-demand data — the address tab's
  // Retry semantics: a re-probe genuinely re-asks the node).
  const retry = () => {
    if (transactionCount === 0) return;
    void runSweep();
  };

  const symbol = getChainSymbol(chainId);
  const headerMeta =
    state.phase === 'settled' ? blockInternalTxnsSummary(state.result.aggregate) : null;

  const renderSettled = (result: SweepResult) => {
    const { aggregate, scopedCount, totalCount } = result;
    const capLabel = blockTraceTruncationLabel(scopedCount, totalCount);
    return (
      <>
        <p className={summaryLine} data-testid="block-internal-txns-summary">
          {blockInternalTxnsSummary(aggregate)}
        </p>
        {capLabel !== null && (
          <p className={summaryLine} data-testid="block-internal-txns-cap">
            {capLabel} — the rest of the block was not traced.
          </p>
        )}
        {aggregate.truncated && (
          <p className={summaryLine} data-testid="block-internal-txns-row-cap">
            Row or depth limits were hit — this list is truncated, not exhaustive.
          </p>
        )}
        {aggregate.groups.length === 0 ? (
          <div data-testid="block-internal-txns-empty">
            <Alert variant="info">
              No internal calls in the traced transactions — plain transfers leave no nested frames.
              This is the on-demand sweep's result over a bounded slice of the block, not an indexer
              claim that the block has none.
            </Alert>
          </div>
        ) : (
          aggregate.groups.map(group => (
            <section key={group.hash} className={txGroup} data-testid="block-internal-txns-group">
              <h4 className={txGroupHeader}>
                <TypedLink
                  to={`/chain/${chainId}/tx/${group.hash}`}
                  className={linkStyle}
                  title={group.hash}
                >
                  {formatHash(group.hash)}
                </TypedLink>
                <span className={txGroupMeta}>
                  {`${group.rows.length.toLocaleString()} internal ${
                    group.rows.length === 1 ? 'call' : 'calls'
                  }`}
                </span>
                {group.truncated && (
                  <Badge variant="warning" size="sm">
                    truncated
                  </Badge>
                )}
              </h4>
              <DataTable>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Value</th>
                    <th>Selector</th>
                    <th>Depth</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row, index) => (
                    <tr key={`${row.txHash}-${index}`}>
                      <td>
                        <CallTypeBadge type={row.type} />
                        {(row.error !== null || row.revertReason !== null) && (
                          <span className={rowErrorStyle}>
                            {row.error !== null && <div>{`error: ${row.error}`}</div>}
                            {row.revertReason !== null && (
                              <div>{`revert: ${row.revertReason}`}</div>
                            )}
                          </span>
                        )}
                      </td>
                      <td>
                        {row.from !== null ? (
                          <CopyableHash
                            value={row.from}
                            truncated={cellText(row.from, '')}
                            href={`/chain/${chainId}/address/${row.from}`}
                          />
                        ) : (
                          <span className={muted}>not reported</span>
                        )}
                      </td>
                      <td>
                        {row.to !== null ? (
                          <CopyableHash
                            value={row.to}
                            truncated={cellText(row.to, '')}
                            href={`/chain/${chainId}/address/${row.to}`}
                          />
                        ) : (
                          <span className={muted}>not reported</span>
                        )}
                      </td>
                      <td className={valueCell}>
                        {rowCarriesValue(row.value) ? formatValue(row.value, symbol) : '—'}
                      </td>
                      <td className={selectorCell}>{row.selector ?? '—'}</td>
                      <td className={depthCell}>{row.depth}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </section>
          ))
        )}
        {aggregate.failedTxs.length > 0 && (
          <>
            <Collapsible
              className={failedTxsCard}
              title={`${aggregate.failedTxs.length} trace ${
                aggregate.failedTxs.length === 1 ? 'failure' : 'failures'
              }`}
              badge={(
                <Badge variant="warning" size="sm">
                  failed
                </Badge>
              )}
            >
              {aggregate.failedTxs.map(failure => (
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
              <Button variant="secondary" size="sm" onClick={retry}>
                Retry failed traces
              </Button>
            </div>
          </>
        )}
      </>
    );
  };

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
          data-testid="block-internal-txns-header"
        >
          <div className={headerTitleRowStyle}>
            <CardTitle>Internal Transactions (traced)</CardTitle>
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
          <p className={scopeNote} data-testid="block-internal-txns-scope">
            traced on demand from this node's debug API — internal calls only, not indexer data
          </p>
          {transactionCount === 0 && (
            <div data-testid="block-internal-txns-zero">
              <Alert variant="info">
                This block contains no transactions — internal calls only exist inside transactions,
                so there is nothing to trace.
              </Alert>
            </div>
          )}
          {transactionCount > 0 && state.phase === 'loading' && (
            <LoadingState message="Fetching the block's transaction list..." />
          )}
          {transactionCount > 0 && state.phase === 'tracing' && (
            <LoadingState
              message={`Traced ${state.settled.toLocaleString()} of ${state.total.toLocaleString()} transactions…`}
            />
          )}
          {transactionCount > 0 && state.phase === 'error' && (
            <ErrorState
              message="Failed to fetch this block's transactions from the RPC."
              onRetry={retry}
            />
          )}
          {transactionCount > 0 && state.phase === 'unsupported' && (
            <div data-testid="block-internal-txns-unsupported">
              <Alert variant="info">
                Internal transaction tracing is not supported by this RPC — the endpoint does not
                implement <code>debug_traceTransaction</code>. Nothing was traced.
              </Alert>
              <div className={retryRow}>
                <Button variant="secondary" size="sm" onClick={retry}>
                  Retry
                </Button>
              </div>
            </div>
          )}
          {transactionCount > 0 && state.phase === 'settled' && renderSettled(state.result)}
        </CardContent>
      )}
    </Card>
  );
}

export default InternalTxnsSection;
