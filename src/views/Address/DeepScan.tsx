// Deep Scan panel (PM review Wave 3, P0): start/pause/resume/delete the
// address's persistent transaction-discovery job, live progress with an
// honest ETA, catch a settled walk up to the current chain head, and the
// coverage lift — the first place the product may say
// "complete". Mounted inside the transactions tab's card, above the tx
// list; unmounting (tab switch / navigation) also stops the hook's poll
// cadence (see services/addressScan.ts useScanJob).
//
// Honesty rules this panel follows:
// - coverage 'complete' renders ONLY for a finished genesis-anchored walk
//   (the backend pins that invariant; the panel just spells it out).
// - the ETA is the range manager's own sampler (≥2 samples ≥6s apart,
//   voided on pause/regression) — no slope, no promised date.
// - the intro states the archive-RPC and backend-liveness requirements;
//   a job that cannot honestly finish never pretends it did.
import { css } from '@linaria/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Input } from 'haze-ui';

import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/LoadingState';
import { SegmentedProgressBar, type SegmentStatus } from '@/components/ui/SegmentedProgressBar';
import {
  estimateRangeEta,
  formatEtaDuration,
  recordEtaSample,
  type EtaSample,
  type EtaTracker,
} from '@/components/events/IndexingRangeManager';
import { ApiError } from '@/util/apiError';
import {
  catchupScanJob,
  deleteScanJob,
  pauseScanJob,
  resumeScanJob,
  scanJobFromTxPayload,
  startScanJob,
  useScanJob,
  type ScanJob,
  type ScanJobStatus,
} from '@/services/addressScan';

// Mutating scan actions answer a missing browser token with a raw 403
// body that offers no path forward; this suffix points at where the
// token lives (same copy family as the range manager / watchlist).
const ADMIN_TOKEN_GUIDANCE = 'Set it via ⚙️ RPC → Admin token (stored in this browser)';

// Inline sibling of the range manager's describeMutationError: 403s
// carry the admin-token guidance, other API errors surface verbatim,
// non-API errors fall back to the action-specific message.
const describeMutationError = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) {
    return error.status === 403 ? `${error.message} — ${ADMIN_TOKEN_GUIDANCE}` : error.message;
  }
  return fallback;
};

// The pinned contract discriminates the start-400s via the body's `error`
// field; services/addressScan.ts surfaces it as ApiError.code.
const isScanConflict = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.status === 400 && error.code === 'scan_conflict';

// The catch-up 400 discriminates the same way: already_caught_up is good
// news (a friendly notice, not an error) while invalid_state keeps its
// message verbatim through the generic action-error path.
const isAlreadyCaughtUp = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.status === 400 && error.code === 'already_caught_up';

const STATUS_LINE: Record<ScanJobStatus, string> = {
  pending: 'Pending — the backend has the job; the walk starts shortly',
  running: 'Running — walking forward, verifying balance checkpoints',
  paused: 'Paused — progress is kept on the server; resume to continue',
  error: 'Errored — the walk stopped; see the message below',
  complete: 'Complete — the walk reached its end bound',
};

// Scan statuses onto the progress bar's own vocabulary (its visual
// language: pending grey / indexing blue / paused yellow / error red /
// completed green).
const SEGMENT_STATUS: Record<ScanJobStatus, SegmentStatus> = {
  pending: 'pending',
  running: 'indexing',
  paused: 'paused',
  error: 'error',
  complete: 'completed',
};

// ETA sampling reuses the range manager's pure sampler verbatim; the only
// scan-specific logic is the shape mapping below (running → indexing,
// forward walk, cursor as current block).
const toRangeStatus = (status: ScanJobStatus): EtaTracker['status'] => {
  if (status === 'running') return 'indexing';
  if (status === 'complete') return 'completed';
  return status;
};

/** Fold one settled read of the job into the ETA tracker (pure wrapper over recordEtaSample). */
export const recordScanEtaSample = (
  tracker: EtaTracker | undefined,
  job: ScanJob | undefined,
  now: number,
): EtaTracker =>
  recordEtaSample(
    tracker,
    {
      // No job yet = nothing walking; any non-indexing status voids the
      // window, and the flip back to running restarts it fresh.
      status: job === undefined ? 'paused' : toRangeStatus(job.status),
      direction: 'forward',
      currentBlock: job === undefined ? null : BigInt(job.cursorBlock),
    },
    now,
  );

/** Extrapolate the remaining walk time from the sampled rate (pure wrapper over estimateRangeEta). */
export const estimateScanEta = (
  samples: readonly EtaSample[],
  job: ScanJob,
): { blocksPerSec: number; remainingMs: number } | null =>
  estimateRangeEta(samples, {
    fromBlock: BigInt(job.fromBlock),
    toBlock: BigInt(job.toBlock),
    direction: 'forward',
    currentBlock: BigInt(job.cursorBlock),
  });

type ScanAction = 'start' | 'force-start' | 'pause' | 'resume' | 'catchup' | 'delete';

const panelStyle = css`
  border: 1px solid var(--haze-border, #e5e7eb);
  border-radius: 8px;
  background: var(--haze-surface, #fafafa);
  padding: var(--haze-space-4);
  margin-bottom: var(--haze-space-4);
`;

const titleRowStyle = css`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--haze-space-2);

  /* Narrow screens: title + status wrap instead of overflowing. */
  @media (max-width: 768px) {
    flex-wrap: wrap;
  }
`;

const titleStyle = css`
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
`;

const mutedStyle = css`
  margin: var(--haze-space-2) 0 0;
  font-size: var(--haze-text-xs, 12px);
  color: var(--haze-color-text-muted, #6b7280);
`;

const startRowStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  margin-top: var(--haze-space-3);

  @media (max-width: 640px) {
    flex-wrap: wrap;
  }
`;

const fromBlockInputStyle = css`
  input {
    width: 220px;
    font-family: var(--haze-font-mono, monospace);
  }
`;

// Include-traces toggle beside the start controls: a native checkbox —
// the walk-level opt-in must read as a plain binary, not a button.
const tracesToggleStyle = css`
  display: inline-flex;
  align-items: center;
  gap: var(--haze-space-1, 4px);
  font-size: var(--haze-text-xs, 12px);
  color: var(--haze-color-text-muted, #6b7280);
  cursor: pointer;
  user-select: none;
`;

const actionsRowStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  margin-top: var(--haze-space-3);
  flex-wrap: wrap;
`;

const statusLineStyle = css`
  margin: var(--haze-space-2) 0 0;
  font-size: var(--haze-text-sm, 14px);
`;

const metaLineStyle = css`
  margin: var(--haze-space-1, 4px) 0 0;
  font-size: var(--haze-text-sm, 14px);
  color: var(--haze-color-text-muted, #6b7280);
`;

const completeLineStyle = css`
  margin: var(--haze-space-2) 0 0;
  padding: var(--haze-space-2) var(--haze-space-3);
  border-radius: 6px;
  border: 1px solid #22c55e;
  background: color-mix(in srgb, #22c55e 10%, transparent);
  font-size: var(--haze-text-sm, 14px);
`;

const hintListStyle = css`
  margin: var(--haze-space-2) 0 0;
  padding-left: 18px;
  font-size: var(--haze-text-xs, 12px);
  color: var(--haze-color-text-muted, #6b7280);

  li + li {
    margin-top: 4px;
  }
`;

const progressBarWrapStyle = css`
  margin-top: var(--haze-space-3);
`;

const blockStyle = css`
  margin-top: var(--haze-space-2);
`;

export type DeepScanProps = {
  chainId: number;
  address: string;
  /**
   * The transactions-tab payload. Its additive `deepScan` field (when
   * present) seeds the panel before the live GET settles; opaque by
   * design — parsed defensively via scanJobFromTxPayload so legacy
   * payloads without the field render identically to today.
   */
  txPayload: unknown;
};

export function DeepScan({ chainId, address, txPayload }: DeepScanProps) {
  const scan = useScanJob(chainId, address);
  const payloadJob = useMemo(() => scanJobFromTxPayload(txPayload), [txPayload]);

  // The live GET owns the truth once it settles (including its null —
  // a deleted job must not linger from a stale payload); until then the
  // payload's inline job stands in so the card renders instantly.
  const job: ScanJob | null | undefined = scan.data !== undefined ? scan.data : payloadJob;

  // ETA window rides every settled read (initial fetch, 3s tick,
  // post-mutation refetch): dataUpdatedAt moves on each settle even when
  // the job object is deep-equal, which is exactly when a sample belongs.
  const etaTrackerRef = useRef<EtaTracker | undefined>(undefined);
  const [eta, setEta] = useState<{ blocksPerSec: number; remainingMs: number } | null>(null);
  const jobForSampling = job ?? undefined;
  useEffect(() => {
    // No job (deleted, or still resolving): void the window outright so a
    // later job created from scratch can never inherit the old rate.
    if (jobForSampling === undefined) {
      etaTrackerRef.current = undefined;
      setEta(null);
      return;
    }
    etaTrackerRef.current = recordScanEtaSample(etaTrackerRef.current, jobForSampling, Date.now());
    setEta(estimateScanEta(etaTrackerRef.current.samples, jobForSampling));
  }, [jobForSampling, scan.dataUpdatedAt]);

  // Mutation plumbing: one in-flight action at a time, honest inline
  // errors, and a dedicated conflict affordance for the start 400.
  const [action, setAction] = useState<ScanAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  // Catch-up's friendly inline line ('Catching up…' after a 202, 'Already
  // at the chain head' after that 400) — informational, never an error.
  const [catchupNotice, setCatchupNotice] = useState<string | null>(null);
  const [fromBlockInput, setFromBlockInput] = useState('');
  // Traces opt-in (default unchecked): an unchecked box keeps the POST
  // body byte-identical to the pre-traces contract.
  const [includeTraces, setIncludeTraces] = useState(false);

  // The catch-up notices are transitional: once the live read observes
  // the walk active again, the pending/running status line takes over
  // the story — and a cleared notice must never resurface when a later
  // walk re-settles.
  const liveStatus = scan.data?.status;
  useEffect(() => {
    if (liveStatus === 'pending' || liveStatus === 'running') setCatchupNotice(null);
  }, [liveStatus]);

  const trimmedFrom = fromBlockInput.trim();
  const parsedFrom: number | 'earliest' = trimmedFrom === '' ? 'earliest' : Number(trimmedFrom);
  const fromBlockValid =
    trimmedFrom === '' || (Number.isInteger(parsedFrom) && (parsedFrom as number) >= 0);

  const runAction = (
    kind: ScanAction,
    invoke: () => Promise<unknown>,
    fallback: string,
  ): void => {
    setAction(kind);
    setActionError(null);
    setConflictMessage(null);
    setCatchupNotice(null);
    invoke()
      .then(() => scan.refetch())
      .catch((error: unknown) => {
        // A conflicting existing job is not a failure to communicate —
        // it hands the user a decision (force-restart or leave it).
        if (kind === 'start' && isScanConflict(error)) {
          setConflictMessage(error.message);
        }
        // Catch-up reporting "already there" is good news, not an error.
        else if (kind === 'catchup' && isAlreadyCaughtUp(error)) {
          setCatchupNotice('Already at the chain head');
        }
        else {
          setActionError(describeMutationError(error, fallback));
        }
      })
      .finally(() => setAction(null));
  };

  const start = (force: boolean): void => {
    runAction(
      force ? 'force-start' : 'start',
      () =>
        startScanJob(chainId, address, {
          ...(parsedFrom === 'earliest' ? {} : { fromBlock: parsedFrom }),
          ...(force ? { force: true } : {}),
          ...(includeTraces ? { includeTraces: true } : {}),
        }),
      'Starting the deep scan failed.',
    );
  };

  // Catch up to latest: extend the settled walk's end bound to the
  // current chain head. runAction refetches on settle either way; on a
  // 202 the optimistic notice bridges until the refetched (then polled)
  // read shows the re-queued walk, and a 404 resolves null — the vanished
  // job needs no notice, the refetch re-syncs the panel to its absence.
  const catchup = (): void => {
    runAction(
      'catchup',
      async () => {
        const updated = await catchupScanJob(chainId, address);
        if (updated !== null) setCatchupNotice('Catching up…');
      },
      'Catching up the deep scan failed.',
    );
  };

  // Resolving whether a job exists at all: quiet skeleton, never the
  // no-job intro (which would flash a Start button that 400-conflicts).
  if (job === undefined) {
    if (scan.error !== undefined) {
      return (
        <section className={panelStyle} data-testid="deep-scan-panel">
          <h3 className={titleStyle}>Deep scan</h3>
          <div className={blockStyle}>
            <Alert variant="warning">
              Deep-scan status is unavailable right now — {scan.error.message}
            </Alert>
          </div>
        </section>
      );
    }
    return (
      <section className={panelStyle} data-testid="deep-scan-panel">
        <LoadingState message="Checking for a deep-scan job…" />
      </section>
    );
  }

  if (job === null) {
    return (
      <section className={panelStyle} data-testid="deep-scan-panel">
        <div className={titleRowStyle}>
          <h3 className={titleStyle}>Deep scan</h3>
        </div>
        <p className={statusLineStyle}>
          A deep scan walks the chain from a start block verifying balance
          checkpoints — it upgrades this address&apos;s coverage from
          discovered to complete for genesis-anchored walks.
        </p>
        <div className={startRowStyle}>
          <Input
            className={fromBlockInputStyle}
            aria-label="Deep scan start block"
            placeholder="Start block (default: 0 — earliest)"
            inputMode="numeric"
            value={fromBlockInput}
            onChange={e => setFromBlockInput(e.target.value)}
            disabled={action !== null}
          />
          <Button
            size="sm"
            onClick={() => start(false)}
            disabled={!fromBlockValid}
            loading={action === 'start'}
            data-testid="deep-scan-start"
          >
            Start deep scan
          </Button>
          <label className={tracesToggleStyle}>
            <input
              type="checkbox"
              checked={includeTraces}
              onChange={e => setIncludeTraces(e.target.checked)}
              disabled={action !== null}
              data-testid="deep-scan-include-traces"
            />
            Record internal transactions (slower — traces each block the
            walk stops on)
          </label>
          {!fromBlockValid && (
            <span className={mutedStyle}>Start block must be a non-negative integer.</span>
          )}
        </div>
        {conflictMessage !== null && (
          <div className={blockStyle} data-testid="deep-scan-conflict">
            <Alert variant="warning">
              <p>{conflictMessage}</p>
              <p>
                Restarting replaces the job&apos;s bounds and resets all
                progress and findings for this address.
              </p>
              <Button
                variant="danger"
                size="sm"
                onClick={() => start(true)}
                loading={action === 'force-start'}
                data-testid="deep-scan-force-restart"
              >
                Restart deep scan (reset progress)
              </Button>
            </Alert>
          </div>
        )}
        <ul className={hintListStyle}>
          <li>
            Non-genesis starts can never claim complete coverage — activity
            before the start block stays unverifiable.
          </li>
          <li>
            Record internal transactions captures internal calls only in
            blocks where this address changed — internal calls inside
            unrelated transactions in non-scanned blocks are not recorded.
          </li>
          <li>
            Needs an archive-capable RPC: public non-archive nodes reject
            the historical balance reads the walk depends on.
          </li>
          <li>
            The walk runs only while the explorer backend runs; it pauses
            across restarts and resumes.
          </li>
        </ul>
        {actionError !== null && (
          <div className={blockStyle} data-testid="deep-scan-action-error">
            <Alert variant="danger">{actionError}</Alert>
          </div>
        )}
      </section>
    );
  }

  const deleteTitle
    = 'Deletes the scan job and its persisted findings (the merged transaction list loses them).';

  const progressPercent
    = job.blocksTotal > 0 ? Math.min(100, (job.blocksWalked / job.blocksTotal) * 100) : 0;

  return (
    <section className={panelStyle} data-testid="deep-scan-panel">
      <div className={titleRowStyle}>
        <h3 className={titleStyle}>Deep scan</h3>
        <span className={metaLineStyle} data-testid="deep-scan-status">
          {STATUS_LINE[job.status]}
        </span>
      </div>
      <div className={progressBarWrapStyle}>
        <SegmentedProgressBar
          segments={[
            {
              rangeId: 0,
              fromBlock: job.fromBlock,
              toBlock: job.toBlock,
              currentBlock: job.cursorBlock,
              status: SEGMENT_STATUS[job.status],
              progress: progressPercent,
            },
          ]}
        />
      </div>
      <p className={metaLineStyle} data-testid="deep-scan-progress">
        Walked {job.blocksWalked.toLocaleString()} / {job.blocksTotal.toLocaleString()} blocks (
        {progressPercent.toFixed(1)}%) — cursor at block {job.cursorBlock.toLocaleString()}
      </p>
      <p className={metaLineStyle} data-testid="deep-scan-txs">
        Transactions found: {job.txsFound.toLocaleString()}
      </p>
      {/* Traces meta rides ONLY a job that asked for recording; an
          unrequested walk renders nothing (no zero-line noise). A probes
          refusal is honest, lowercase, and states the walk continued. */}
      {job.tracesRequested && (
        <p className={metaLineStyle} data-testid="deep-scan-traces">
          {job.tracesSupported === false
            ? 'traces unavailable on this RPC — the walk continued without them'
            : `Internal transactions recorded: ${job.tracesRecorded.toLocaleString()}`}
        </p>
      )}
      <p className={metaLineStyle} data-testid="deep-scan-eta">
        {eta === null
          ? 'Remaining time: no honest estimate yet (needs a measured walking rate)'
          : `~${formatEtaDuration(eta.remainingMs)} remaining (est. — ${eta.blocksPerSec.toFixed(1)} blocks/s sampled)`}
      </p>
      <div className={actionsRowStyle}>
        {job.status === 'running' && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => runAction('pause', () => pauseScanJob(chainId, address), 'Pausing the deep scan failed.')}
            loading={action === 'pause'}
            data-testid="deep-scan-pause"
          >
            Pause
          </Button>
        )}
        {(job.status === 'paused' || job.status === 'error') && (
          <Button
            size="sm"
            onClick={() => runAction('resume', () => resumeScanJob(chainId, address), 'Resuming the deep scan failed.')}
            loading={action === 'resume'}
            data-testid="deep-scan-resume"
          >
            Resume
          </Button>
        )}
        {/* Catch-up is a settled-state affordance ONLY: while the job is
            pending/running the walk is live and its toBlock is what it is
            — re-anchoring a live walk mid-flight would misrepresent its
            own progress contract. Once settled (complete/paused/error)
            the bound is frozen and stale, so the user may extend it to
            the current chain head. */}
        {(job.status === 'complete' || job.status === 'paused' || job.status === 'error') && (
          <Button
            variant="secondary"
            size="sm"
            onClick={catchup}
            loading={action === 'catchup'}
            data-testid="deep-scan-catchup"
          >
            Catch up to latest
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          title={deleteTitle}
          onClick={() => runAction('delete', () => deleteScanJob(chainId, address), 'Deleting the deep scan failed.')}
          loading={action === 'delete'}
          data-testid="deep-scan-delete"
        >
          Delete job
        </Button>
      </div>
      {catchupNotice !== null && (
        <p className={mutedStyle} data-testid="deep-scan-catchup-notice">
          {catchupNotice}
        </p>
      )}
      {job.status === 'error' && job.errorMessage !== null && (
        <div className={blockStyle} data-testid="deep-scan-error">
          <Alert variant="danger">{job.errorMessage}</Alert>
        </div>
      )}
      {job.status === 'complete' && job.coverage === 'complete' && (
        <p className={completeLineStyle} data-testid="deep-scan-complete">
          Deep scan complete — every block from genesis (0) to{' '}
          {job.toBlock.toLocaleString()} was walked and verified. No external
          transaction for this address exists outside this list: this is the
          product&apos;s only provable &quot;complete&quot; coverage … up to
          block{' '}
          {job.toBlock.toLocaleString()}.
        </p>
      )}
      {job.status === 'complete' && job.coverage === null && (
        <p className={mutedStyle}>
          Walk finished (blocks {job.fromBlock.toLocaleString()}–
          {job.toBlock.toLocaleString()}), but coverage stays discovered — a
          non-genesis start cannot prove there was no activity before block{' '}
          {job.fromBlock.toLocaleString()}.
        </p>
      )}
      {actionError !== null && (
        <div className={blockStyle} data-testid="deep-scan-action-error">
          <Alert variant="danger">{actionError}</Alert>
        </div>
      )}
    </section>
  );
}
