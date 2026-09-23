// Internal Txns tab of the address page: on-demand callTracer tracing over
// the tx tab's OWN discovered window (the rows are passed in — this tab
// never refetches the heuristic history). Traces are ephemeral node data,
// so the debug_traceTransaction calls run in the browser against the
// chain's RPC (same client factory and honesty pattern as the tx detail
// page's Call Trace card). Bounds are part of the surface: only the first
// traceDepth discovered transactions are traced (?itDepth=, default 25,
// clamped 10..200), with a small parallel pool, and the scope line says
// so — completeness is never implied (discovery itself is heuristic).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@linaria/core';
import { TypedLink, useSearch, useSetSearch } from '@native-router/react';
import { formatUnits } from 'viem';
import { Alert } from 'haze-ui';
import { getChainInfo, getChainSymbol } from '@/config/chains';
import { createRpcClient } from '@/utils/realTimeData';
import { normalizeCallTrace, isTraceUnsupportedError } from '@/utils/traceFormat';
import {
  aggregateInternalTxns,
  flattenInternalTxTree,
  internalTxSummary,
  tracedScopeLabel,
  selectTraceScope,
  DEFAULT_INTERNAL_TX_DEPTH,
  MAX_INTERNAL_TX_DEPTH,
  type InternalTxAggregate,
  type TraceTxOutcome,
} from '@/utils/internalTxScan';
import { addressSearchSchema, effectiveInternalTxDepth } from '@/views/Address/search';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Collapsible } from '@/components/ui/Collapsible';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { DataTable, linkStyle } from '@/components/ui/DataTable';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';

// Trace-depth presets offered by the compact control: the scan default,
// two widenings, and the clamp ceiling. A deep-linked depth between
// presets is not coerced — the control offers the actual (clamped)
// value as an extra option so it never lies about the current setting.
const DEPTH_PRESETS = [DEFAULT_INTERNAL_TX_DEPTH, 50, 100, MAX_INTERNAL_TX_DEPTH];

// Bounded concurrency: ~4 parallel debug_traceTransaction calls keeps the
// pool polite against public RPCs while making the scan finish in batches.
const TRACE_CONCURRENCY = 4;

// Header row at the head of the tab: the standing scope line (renders in
// every phase so the data's provenance — on-demand traces over a
// heuristic window with a depth cap, not an indexer — is never hidden
// behind a loading state or a collapsed section) beside the compact
// depth control that widens the sweep.
const tabHeader = css`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--haze-space-2) var(--haze-space-3);
  margin: 0 0 var(--haze-space-3);
`;

const scopeNote = css`
  margin: 0;
  flex: 1 1 32rem;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

// Compact depth control: a labeled native select over the presets.
const depthControl = css`
  margin: 0;
  display: inline-flex;
  align-items: baseline;
  gap: var(--haze-space-2);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  white-space: nowrap;
`;

const depthSelect = css`
  padding: var(--haze-space-1) var(--haze-space-2);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  background: var(--haze-color-bg);
  color: var(--haze-color-text);
  font-size: var(--haze-text-xs);
`;

// Aggregate header: counts + the honest bounds label, one line each.
const summaryLine = css`
  margin: 0 0 var(--haze-space-2);
  font-size: var(--haze-text-xs);
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

const muted = css`
  color: var(--haze-color-text-muted);
`;

const valueCell = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
`;

const depthCell = css`
  color: var(--haze-color-text-muted);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
`;

const retryRow = css`
  margin-top: var(--haze-space-3);
`;

const formatAddr = (a: string) => `${a.slice(0, 8)}...${a.slice(-6)}`;
const formatHash = (h: string) => `${h.slice(0, 10)}...${h.slice(-8)}`;

// Same call-type palette as the Call Trace card: creations green,
// selfdestructs amber, read-only blue, code-in-place purple, rest neutral.
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

// Exact wei → display string honoring the chain's native-currency
// decimals (the page's own formatTxValue semantics; bigint input here).
const formatInternalValue = (wei: bigint, chainId: number): string => {
  const symbol = getChainSymbol(chainId);
  const decimals = getChainInfo(chainId)?.nativeCurrency.decimals ?? 18;
  const value = Number(formatUnits(wei, decimals));
  if (value === 0) return `0 ${symbol}`;
  if (value < 0.0001) return `<0.0001 ${symbol}`;
  return `${value.toFixed(4)} ${symbol}`;
};

// Provider error text can embed the whole JSON-RPC request body; keep the
// row readable with the head of the message instead.
const shortMessage = (message: string): string =>
  message.length > 160 ? `${message.slice(0, 160)}…` : message;

// Trace one transaction through the browser RPC client. Mirrors the Call
// Trace card's request shape (callTracer) and its narrow cast around
// viem's typed client.request, which has no debug namespace.
const traceOneTx = async (
  chainId: number,
  viewedAddress: string,
  hash: string,
): Promise<TraceTxOutcome> => {
  try {
    const client = await createRpcClient(chainId);
    const raw = await (
      client as unknown as {
        request: (args: { method: string; params: unknown[] }) => Promise<unknown>;
      }
    ).request({
      method: 'debug_traceTransaction',
      params: [hash, { tracer: 'callTracer' }],
    });
    const root = normalizeCallTrace(raw);
    if (root === null) return { hash, status: 'traced', rows: [], truncated: false };
    const { rows, truncated } = flattenInternalTxTree(hash, root, viewedAddress);
    return { hash, status: 'traced', rows, truncated };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return isTraceUnsupportedError(err)
      ? { hash, status: 'unsupported', message }
      : { hash, status: 'failed', message };
  }
};

// Bounded-concurrency pool over the tx list. Outcomes land at their input
// index, so the aggregate order is the discovered order, not completion
// order — the deterministic half of the tab.
const traceTxBatch = async (
  chainId: number,
  viewedAddress: string,
  hashes: readonly string[],
  onSettled: (settled: number) => void,
): Promise<TraceTxOutcome[]> => {
  const outcomes: TraceTxOutcome[] = new Array(hashes.length);
  let next = 0;
  let settled = 0;
  const workers = Array.from(
    { length: Math.min(TRACE_CONCURRENCY, hashes.length) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= hashes.length) return;
        outcomes[index] = await traceOneTx(chainId, viewedAddress, hashes[index]);
        settled += 1;
        onSettled(settled);
      }
    },
  );
  await Promise.all(workers);
  return outcomes;
};

export type InternalTxnsProps = {
  chainId: number;
  address: string;
  /** The tx tab's current discovered window (its own query's rows — passed through, never refetched). */
  transactions: ReadonlyArray<{ hash: string }>;
  /** Source-list states: the tab explains them instead of tracing half a window. */
  txLoading: boolean;
  txError: string | undefined;
  /** Current tx-list page — keeps the bounds label honest on deep pages. */
  txPage: number;
  /** Bumped by the parent's Refresh button; each bump re-traces. */
  refreshSignal?: number;
  /** Reports a refreshSignal-triggered re-trace settling (spinner control). */
  onRefreshed?: () => void;
};

export default function InternalTxns({
  chainId,
  address,
  transactions,
  txLoading,
  txError,
  txPage,
  refreshSignal = 0,
  onRefreshed,
}: InternalTxnsProps) {
  // Trace depth rides ?itDepth= through the shared address-page schema:
  // deep-linkable, refresh/share-stable, and never carried across to a
  // different address's URL. An explicit valid value wins (clamped into
  // 10..200); absent/malformed is the scan default. URL-driven, never
  // local state — same contract as the transfers tab's ?ttWindow=.
  const setSearch = useSetSearch(addressSearchSchema);
  const { itDepth: itDepthParam } = useSearch(addressSearchSchema);
  const traceDepth = effectiveInternalTxDepth(itDepthParam);
  const setTraceDepth = (next: number) => {
    // Pins ?tab=internal (this component only renders there, so its URL
    // writes must keep the deep link landing on this tab) and pushes a
    // history entry, so back/forward steps between depths.
    void setSearch(prev => ({
      ...prev,
      tab: 'internal',
      itDepth: String(next),
    }));
  };

  // The depth bound applies before anything else: the first traceDepth
  // transactions of the window are the scan's whole universe (pure
  // selection in internalTxScan — truncation is knowable without RPC).
  const { txs: tracedTxs, truncated: windowDeeperThanTrace } = useMemo(
    () => selectTraceScope(transactions, traceDepth),
    [transactions, traceDepth],
  );
  const traceKey = useMemo(() => tracedTxs.map(tx => tx.hash).join('|'), [tracedTxs]);

  const [progress, setProgress] = useState<{ settled: number; total: number } | null>(
    null,
  );
  const [aggregate, setAggregate] = useState<InternalTxAggregate | null>(null);
  // Guards run-once semantics: a scan is keyed by the traced-set identity
  // plus the refresh signal, and the key is compared at EFFECT time (a
  // render-time key would flip twice per signal bump and double-run).
  const runSeq = useRef(0);
  const lastRunKey = useRef<string | null>(null);

  const sourceReady = !txLoading && txError === undefined && tracedTxs.length > 0;

  const runScan = useCallback(async () => {
    const seq = runSeq.current + 1;
    runSeq.current = seq;
    const hashes = tracedTxs.map(tx => tx.hash);
    setProgress({ settled: 0, total: hashes.length });
    setAggregate(null);
    const outcomes = await traceTxBatch(chainId, address, hashes, settled => {
      if (runSeq.current === seq) setProgress({ settled, total: hashes.length });
    });
    if (runSeq.current !== seq) return;
    setProgress(null);
    setAggregate(aggregateInternalTxns(outcomes));
  }, [chainId, address, tracedTxs]);

  // Auto-start on mount and re-run when the traced set or refresh signal
  // changes — but only against a settled source list. A source still
  // loading or errored renders its own state below and arms nothing. The
  // key dedupe keeps one signal bump (or one identity-only rerender of
  // the same hashes) from running the pool twice.
  useEffect(() => {
    if (!sourceReady) return;
    const key = `${chainId}:${address}:${traceKey}#${refreshSignal}`;
    if (lastRunKey.current === key) return;
    lastRunKey.current = key;
    void runScan();
    // runScan stays a dep so a chain/address swap with coincidentally
    // identical hashes still re-arms through the closure.
  }, [sourceReady, traceKey, refreshSignal, runScan, chainId, address]);

  // Refresh-settle reporting: once a signal-triggered scan has settled
  // (progress back to null), let the parent drop its spinner.
  const reportedSignal = useRef(0);
  useEffect(() => {
    if (refreshSignal === 0 || progress !== null || reportedSignal.current === refreshSignal)
      return;
    reportedSignal.current = refreshSignal;
    onRefreshed?.();
  }, [refreshSignal, progress, onRefreshed]);

  const retry = () => {
    if (!sourceReady) return;
    void runScan();
  };

  // Presets, plus the actual (clamped) depth when a shared deep link sits
  // between them — the select always shows the truth.
  const depthOptions = DEPTH_PRESETS.includes(traceDepth)
    ? DEPTH_PRESETS
    : [...DEPTH_PRESETS, traceDepth].sort((a, b) => a - b);

  return (
    <div data-testid="internal-txns">
      <div className={tabHeader}>
        <p className={scopeNote} data-testid="internal-txns-scope-note">
          Internal transfers are traced on demand with{' '}
          <code>debug_traceTransaction</code> over the first{' '}
          {traceDepth.toLocaleString()} discovered transactions of the
          selected window{windowDeeperThanTrace
            ? ` (the window holds ${transactions.length.toLocaleString()} — more than the depth covers)`
            : ''}{' '}
          — not full indexing, and discovery itself is heuristic.
        </p>
        <label className={depthControl}>
          Trace depth
          <select
            data-testid="internal-tx-depth"
            className={depthSelect}
            value={String(traceDepth)}
            onChange={e => setTraceDepth(Number(e.target.value))}
          >
            {depthOptions.map(option => (
              <option key={option} value={String(option)}>
                {option.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      </div>

      {txLoading && <LoadingState message="Scanning recent chain history..." />}

      {!txLoading && txError !== undefined && (
        <ErrorState
          message={`The discovered transaction list failed (${txError}) — internal tracing follows that list.`}
        />
      )}

      {!txLoading && txError === undefined && tracedTxs.length === 0 && (
        <Alert variant="info">
          No discovered transactions in the current window — there is nothing
          to trace. Internal transfers live inside transactions, so an empty
          discovered set cannot say anything about them.
        </Alert>
      )}

      {sourceReady && progress !== null && aggregate === null && (
        <LoadingState
          message={`Traced ${progress.settled.toLocaleString()} of ${progress.total.toLocaleString()} transactions…`}
        />
      )}

      {sourceReady && aggregate !== null && (
        <>
          {aggregate.unsupported ? (
            <div data-testid="internal-txns-unsupported">
              <Alert variant="info">
                Internal transaction tracing is not supported by this RPC —
                the endpoint does not implement <code>debug_traceTransaction</code>.
                Nothing was traced.
              </Alert>
              <div className={retryRow}>
                <Button variant="secondary" size="sm" onClick={retry}>
                  Retry
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className={summaryLine} data-testid="internal-txns-summary">
                {internalTxSummary(aggregate)} ·{' '}
                {tracedScopeLabel(tracedTxs.length, txPage)}
              </p>
              {aggregate.truncated && (
                <p className={summaryLine}>
                  Row or depth limits were hit — this list is truncated, not
                  exhaustive.
                </p>
              )}
              {aggregate.rows.length === 0 ? (
                <Alert variant="info">
                  No internal transfers found in the traced transactions. Only
                  transactions the heuristic discovered were traced — this is
                  not a claim that the address has none.
                </Alert>
              ) : (
                <DataTable>
                  <thead>
                    <tr>
                      <th>Parent Tx</th>
                      <th>Type</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Value</th>
                      <th>Depth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregate.rows.map((row, index) => (
                      <tr key={`${row.txHash}-${index}`}>
                        <td>
                          <TypedLink
                            to={`/chain/${chainId}/tx/${row.txHash}`}
                            className={linkStyle}
                            title={row.txHash}
                          >
                            {formatHash(row.txHash)}
                          </TypedLink>
                        </td>
                        <td>
                          <Badge variant={badgeVariantForType(row.type)} size="sm">
                            {row.type}
                          </Badge>
                        </td>
                        <td>
                          {row.from !== null ? (
                            <CopyableHash
                              value={row.from}
                              truncated={formatAddr(row.from)}
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
                              truncated={formatAddr(row.to)}
                              href={`/chain/${chainId}/address/${row.to}`}
                            />
                          ) : (
                            <span className={muted}>not reported</span>
                          )}
                        </td>
                        <td className={valueCell}>
                          {row.value !== null && row.value > 0n
                            ? formatInternalValue(row.value, chainId)
                            : '—'}
                        </td>
                        <td className={depthCell}>{row.depth}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
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
                        — {shortMessage(failure.message)}
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
          )}
        </>
      )}
    </div>
  );
}
