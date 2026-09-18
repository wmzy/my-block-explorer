import React, { useState, useEffect, useCallback } from 'react';
import { css } from '@linaria/core';
import { SegmentedProgressBar } from '../ui/SegmentedProgressBar';
import { toast } from 'sonner';
import { get, post, del } from '@/util/http';
import { ApiError } from '@/util/apiError';

const containerStyles = css`
  background: white;
  border: 1px solid #e1e5e9;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
`;

const headerStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;

  h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #1a1a1a;
  }

  .creation-info {
    font-size: 13px;
    color: #666;
  }
`;

const rangeListStyles = css`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const rangeItemStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #f8f9fa;
  border: 1px solid #e1e5e9;
  border-radius: 6px;

  &:hover {
    background: #f1f3f5;
  }
`;

const rangeInfoStyles = css`
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;

  .range-blocks {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 13px;
  }

  .range-progress {
    font-size: 12px;
    color: #666;
  }
`;

const statusBadgeStyles = css`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;

  &.pending {
    background: #fef3c7;
    color: #92400e;
  }

  &.indexing {
    background: #dbeafe;
    color: #1d4ed8;
  }

  &.paused {
    background: #f3e8ff;
    color: #7c3aed;
  }

  &.completed {
    background: #d1fae5;
    color: #065f46;
  }

  &.error {
    background: #fee2e2;
    color: #dc2626;
  }
`;

const directionBadgeStyles = css`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: #e5e7eb;
  border-radius: 4px;
  font-size: 11px;
  color: #374151;

  svg {
    width: 12px;
    height: 12px;
  }
`;

const stalenessBannerStyles = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2, 8px);
  margin-bottom: 12px;
  padding: var(--haze-space-2, 8px) var(--haze-space-3, 12px);
  font-size: var(--haze-text-sm, 13px);
  color: var(--haze-color-text-secondary, #6b7280);
  background: var(--haze-color-bg-subtle, #f9fafb);
  border: 1px solid var(--haze-color-border, #e5e7eb);
  border-radius: var(--haze-radius-md, 6px);
`;

const stalenessDotStyles = css`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--haze-color-warning, #f59e0b);
`;

const actionButtonStyles = css`
  padding: 6px 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  color: #374151;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    background: #f3f4f6;
    border-color: #9ca3af;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.primary {
    background: #3b82f6;
    border-color: #3b82f6;
    color: white;

    &:hover:not(:disabled) {
      background: #2563eb;
    }
  }

  &.danger {
    background: #ef4444;
    border-color: #ef4444;
    color: white;

    &:hover:not(:disabled) {
      background: #dc2626;
    }
  }
`;

const addFormStyles = css`
  display: flex;
  gap: 12px;
  align-items: flex-end;
  padding: 16px;
  background: #f8fafc;
  border: 1px solid #e1e5e9;
  border-radius: 6px;
  margin-top: 16px;
`;

const quickActionsStyles = css`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 16px;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 6px;
  margin-top: 16px;
`;

const quickButtonStyles = css`
  padding: 6px 12px;
  border: 1px solid #0ea5e9;
  border-radius: 4px;
  background: white;
  color: #0369a1;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    background: #e0f2fe;
    border-color: #0284c7;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const inputGroupStyles = css`
  display: flex;
  flex-direction: column;
  gap: 4px;

  label {
    font-size: 12px;
    font-weight: 500;
    color: #374151;
  }

  input,
  select {
    padding: 8px 12px;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    font-size: 13px;
    width: 120px;

    &:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
    }
  }
`;

const warningStyles = css`
  padding: 12px 16px;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 6px;
  margin-top: 12px;
  font-size: 13px;
  color: #92400e;

  strong {
    font-weight: 600;
  }
`;

const emptyStateStyles = css`
  text-align: center;
  padding: 24px;
  color: #6b7280;
  font-size: 14px;
`;

type RangeStatus = 'pending' | 'indexing' | 'paused' | 'completed' | 'error';
type RangeDirection = 'forward' | 'backward';

type IndexingRange = {
  chainId: number;
  address: `0x${string}`;
  rangeId: number;
  fromBlock: bigint;
  toBlock: bigint;
  direction: RangeDirection;
  currentBlock: bigint | null;
  status: RangeStatus;
  totalEventsIndexed: number;
  errorMessage: string | null;
  priority: number;
  createdAt: Date | null;
  updatedAt: Date | null;
};

// Statuses that keep a walked-block checkpoint (currentBlock persists; both
// start and resume continue from it). Their walked blocks are indexed and
// queryable, so both the per-range progress line and the coverage metric in
// EventStatistics count them — same set, same semantics.
const CHECKPOINTED_RANGE_STATUSES: ReadonlySet<RangeStatus> = new Set([
  'indexing',
  'paused',
  'error',
]);

type Overlap = {
  rangeId: number;
  fromBlock: bigint;
  toBlock: bigint;
  overlapStart: bigint;
  overlapEnd: bigint;
};

type Props = {
  chainId: number;
  contractAddress: `0x${string}`;
  creationBlock?: number | null;
  abi?: unknown[];
  onRefresh?: () => void;
};

type AddRangeForm = {
  fromBlock: string;
  toBlock: string;
  direction: RangeDirection;
};

type QuickMode = 'all' | 'recent' | 'first' | 'continue' | 'catchup';

type QuickCreateForm = {
  mode: QuickMode;
  blockCount: string;
};

const defaultFormState: AddRangeForm = {
  fromBlock: '',
  toBlock: '',
  direction: 'forward',
};

const defaultQuickFormState: QuickCreateForm = {
  mode: 'recent',
  blockCount: '1000',
};

// Client-side overlap precheck -------------------------------------------
//
// Integer interval intersection against the already-loaded ranges: the
// classic `from <= existing.to && to >= existing.from` test. IndexingRange
// bounds are always concrete bigints (the persisted model has no null or
// open-ended bounds — block tags only exist pre-submit), so Number() is
// safe here. Returns the FIRST overlapping range in list order; listing
// one in the warning is enough.
const findFirstOverlap = (
  ranges: readonly IndexingRange[],
  from: number,
  to: number,
): IndexingRange | null => {
  for (const existing of ranges) {
    if (from <= Number(existing.toBlock) && to >= Number(existing.fromBlock)) {
      return existing;
    }
  }
  return null;
};

// Pre-submit warning copy shown while the overlap gate is armed (bounds
// formatted like every other block number in the view).
const overlapWarningText = (range: IndexingRange): string =>
  `Overlaps existing range #${range.rangeId} (${Number(range.fromBlock).toLocaleString()}–${Number(range.toBlock).toLocaleString()}) — events in the overlap will be indexed twice`;

// A would-be range that overlaps an already-loaded one, pending an explicit
// second click. `source` picks which form's submit button relabels to
// 'Create anyway' and which input changes reset the gate.
type OverlapGate = {
  source: 'manual' | 'quick';
  range: IndexingRange;
};

// Client-side mirror of the backend quick-mode bounds (EventIndexingService
// createRangeAll/Recent/First/Continue), used ONLY for the overlap
// precheck — the POST payloads stay exactly as before. Returns null when a
// mode is exempt from the gate or its bounds cannot be approximated
// client-side (those submits rely on the server-side post-hoc overlap
// warning):
// - 'catchup' is never gated: it extends the furthest existing toBlock to
//   the current head, at most re-covering that single boundary block — a
//   gate would fire on every legitimate catch-up.
// - 'recent' IS gated: the backend window is [head - count, head], which
//   routinely overlaps catchup ranges or any range reaching near the head
//   — it is not overlap-free by design.
// 'first' with unknown creation 400s server-side; the First Blocks button
// is pre-disabled for that case and nothing needs gating client-side.
// - 'recent' with unknown head cannot be approximated client-side.
const quickModeBounds = (
  mode: QuickMode,
  blockCount: number | undefined,
  creationBlockNumber: number,
  headBlock: number,
  ranges: readonly IndexingRange[],
): { from: number; to: number } | null => {
  if (mode === 'catchup') return null;
  if (mode === 'all') {
    // Unknown creation indexes from genesis; an unknown head leaves the
    // upper bound open-ended ('latest' is at or beyond every existing
    // toBlock), so any existing range still intersects.
    return {
      from: creationBlockNumber,
      to: headBlock > 0 ? headBlock : Number.MAX_SAFE_INTEGER,
    };
  }
  if (mode === 'recent') {
    if (headBlock <= 0 || blockCount === undefined) return null;
    return {
      from: headBlock >= blockCount ? headBlock - blockCount : 0,
      to: headBlock,
    };
  }
  if (mode === 'first') {
    if (creationBlockNumber <= 0 || blockCount === undefined) return null;
    return { from: creationBlockNumber, to: creationBlockNumber + blockCount };
  }
  // 'continue': with no previous range the backend 400s ('No previous
  // range found. Cannot continue.') — the Continue button is pre-disabled
  // for that case, and the 400 stays as the backstop (e.g. the last range
  // was deleted after the mode was selected). Otherwise the backend
  // continues from ranges[0].toBlock INCLUSIVE (the same
  // priority/createdAt-desc ordering this component's list mirrors), so
  // the would-be range always re-touches that boundary block.
  if (ranges.length === 0 || blockCount === undefined) return null;
  const from = Number(ranges[0].toBlock);
  return { from, to: from + blockCount };
};

// actionLoading sentinels for the form-level actions: -1 manual add, -2
// quick create, -3 catch-up-to-head. Range rows use their rangeId.
const CATCHUP_ACTION_LOADING = -3;

// Mutating indexing actions answer a missing browser token with a raw 403
// body ('Invalid admin token.') that offers no path forward. This suffix
// points at where the token lives, mirroring the clear-cache notice in the
// Contract view.
export const ADMIN_TOKEN_GUIDANCE = 'Set it via ⚙️ RPC → Admin token (stored in this browser)';

// Toast copy for a failed mutating action: 403s carry the admin-token
// guidance, other API errors surface verbatim, non-API errors fall back to
// the action-specific message.
export const describeMutationError = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) {
    return error.status === 403 ? `${error.message} — ${ADMIN_TOKEN_GUIDANCE}` : error.message;
  }
  return fallback;
};

// Response of POST /ranges/quick: the created range's bounds plus whether
// the backend's auto-start actually kicked indexing off (and why not).
type QuickCreateResponse = {
  rangeId?: number;
  fromBlock?: number | string;
  toBlock?: number | string;
  started?: boolean;
  startError?: string;
};

// Success copy for the quick modes: they create AND auto-start, so the
// toast says "indexing started" only when the backend actually did.
const quickCreateToast = (data: QuickCreateResponse): void => {
  const blocks = `blocks ${data.fromBlock?.toLocaleString() ?? '?'} - ${data.toBlock?.toLocaleString() ?? '?'}`;
  if (data.started) {
    toast.success(`Indexing started: ${blocks}`);
    return;
  }
  toast.success(`Range created: ${blocks}${data.startError ? ` — not started: ${data.startError}` : ''}`);
};

export const IndexingRangeManager: React.FC<Props> = ({
  chainId,
  contractAddress,
  creationBlock,
  abi,
  onRefresh,
}) => {
  const [ranges, setRanges] = useState<IndexingRange[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formState, setFormState] = useState<AddRangeForm>(defaultFormState);
  const [quickFormState, setQuickFormState] = useState<QuickCreateForm>(defaultQuickFormState);
  const [overlaps, setOverlaps] = useState<Overlap[]>([]);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [headBlock, setHeadBlock] = useState(0);
  // Ranges whose pause was requested but whose polled status has not
  // flipped away from 'indexing' yet (the backend pauses between batches).
  const [pausingRangeIds, setPausingRangeIds] = useState<ReadonlySet<number>>(() => new Set());
  // Client-side overlap precheck: while set, the matching form's submit is
  // gated behind an explicit 'Create anyway' second click.
  const [overlapGate, setOverlapGate] = useState<OverlapGate | null>(null);

  // creationBlock may be null/undefined/0 when the backend could not
  // determine it — that must render as "unknown", never as block #0.
  const creationBlockNumber = creationBlock ?? 0;
  const hasKnownCreationBlock = creationBlockNumber > 0;
  const maxRangeToBlock = ranges.length > 0 ? Math.max(...ranges.map(r => Number(r.toBlock))) : 0;
  const quickUrl = `/api/chains/${chainId}/contracts/${contractAddress}/events/ranges/quick`;
  const fetchRanges = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<{ ranges?: IndexingRange[] }>(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/ranges`,
      );
      const nextRanges = data.ranges ?? [];
      setRanges(nextRanges);
      // Drop the transient 'Pausing…' state once the polled status is no
      // longer 'indexing' (paused, errored, or the range is gone).
      setPausingRangeIds(prev => {
        if (prev.size === 0) return prev;
        const next = new Set<number>();
        for (const id of prev) {
          const range = nextRanges.find(r => r.rangeId === id);
          if (range?.status === 'indexing') next.add(id);
        }
        return next;
      });
      if (nextRanges.length > 0) {
        // Refresh the chain head alongside the ranges so the staleness
        // banner tracks both sides of the gap. When the head is unknown
        // (RPC unavailable) the banner simply stays hidden.
        try {
          const status = await get<{ latestBlock?: number }>(
            `/api/chains/${chainId}/contracts/${contractAddress}/events/indexing-status`,
          );
          setHeadBlock(status.latestBlock ?? 0);
        } catch {
          // keep the last known head
        }
      }
    } catch (error) {
      console.error('Failed to fetch ranges:', error);
    } finally {
      setLoading(false);
    }
  }, [chainId, contractAddress]);
  useEffect(() => {
    fetchRanges();
  }, [fetchRanges]);
  useEffect(() => {
    const hasIndexing = ranges.some(r => r.status === 'indexing');
    if (hasIndexing) {
      const interval = setInterval(fetchRanges, 3000);
      return () => clearInterval(interval);
    }
  }, [ranges, fetchRanges]);
  // Data-staleness banner: how far the furthest-indexed range trails the
  // chain head. Hidden when the head is unknown (RPC unavailable).
  const maxCurrentBlock =
    ranges.length > 0 ? Math.max(...ranges.map(r => Number(r.currentBlock ?? 0))) : 0;
  const stalenessGap =
    headBlock > 0 && ranges.length > 0 ? Math.max(0, headBlock - maxCurrentBlock) : null;
  const handleAddRange = useCallback(async (confirmOverlap = false) => {
    const validBlockTags = ['latest', 'finalized', 'safe', 'earliest'];
    const fromBlockValue = formState.fromBlock.toLowerCase();
    const toBlockValue = formState.toBlock.toLowerCase();

    const isFromTag = validBlockTags.includes(fromBlockValue);
    const isToTag = validBlockTags.includes(toBlockValue);

    const fromBlock = isFromTag ? fromBlockValue : parseInt(formState.fromBlock);
    const toBlock = isToTag ? toBlockValue : parseInt(formState.toBlock);

    if (!isFromTag && isNaN(fromBlock as number)) {
      toast.error('Please enter valid block numbers or tags (latest, finalized, safe, earliest)');
      return;
    }
    if (!isToTag && isNaN(toBlock as number)) {
      toast.error('Please enter valid block numbers or tags (latest, finalized, safe, earliest)');
      return;
    }
    if (!isFromTag && !isToTag && (fromBlock as number) >= (toBlock as number)) {
      toast.error('From block must be less than to block');
      return;
    }
    if (!isFromTag && hasKnownCreationBlock && (fromBlock as number) < creationBlockNumber) {
      toast.error(
        `From block cannot be before contract creation block (${creationBlockNumber})`,
      );
      return;
    }
    // Client-side overlap precheck against the already-loaded list: the
    // first submit only reveals the warning and relabels the submit button
    // to 'Create anyway'; the second click (confirmOverlap) runs the POST.
    // Tagged bounds ('latest', …) cannot be resolved to a stable integer
    // client-side, so they skip the gate and rely on the server-side
    // post-hoc overlap warning.
    if (!isFromTag && !isToTag && !confirmOverlap) {
      const overlapping = findFirstOverlap(ranges, fromBlock as number, toBlock as number);
      if (overlapping) {
        setOverlapGate({ source: 'manual', range: overlapping });
        return;
      }
    }
    setActionLoading(-1);
    try {
      const data = await post<{
        overlaps?: Overlap[];
        message?: string;
        error?: string;
      }>(`/api/chains/${chainId}/contracts/${contractAddress}/events/ranges`, {
        fromBlock: isFromTag ? fromBlockValue : fromBlock,
        toBlock: isToTag ? toBlockValue : toBlock,
        direction: formState.direction,
      });
      setFormState(defaultFormState);
      setShowAddForm(false);
      await fetchRanges();
      if (data.overlaps && data.overlaps.length > 0) {
        setOverlaps(data.overlaps);
      }
      onRefresh?.();
    } catch (error) {
      console.error('Failed to add range:', error);
      toast.error(describeMutationError(error, 'Failed to add range'));
    } finally {
      setActionLoading(null);
      // The submit resolved — drop any armed confirmation so the form
      // returns to its one-click baseline.
      setOverlapGate(null);
    }
  }, [chainId, contractAddress, formState, ranges, creationBlockNumber, hasKnownCreationBlock, fetchRanges, onRefresh]);
  // Shared runner for every quick-create entry point (the quick form's
  // Create button, Catch up to head, and the empty-state one-clicks): POST
  // /ranges/quick — the backend creates the range AND auto-starts it in
  // the background, so the 3s polling shows live progress with no second
  // click. Returns whether the request succeeded so callers can reset
  // their form state selectively.
  const runQuickCreate = useCallback(
    async (mode: QuickMode, blockCount: number | undefined, loadingSentinel: number) => {
      setActionLoading(loadingSentinel);
      try {
        const data = await post<QuickCreateResponse>(quickUrl, {
          mode,
          blockCount,
          abi,
        });
        await fetchRanges();
        quickCreateToast(data);
        onRefresh?.();
        return true;
      } catch (error) {
        // 403 admin-token errors and contract 400s like 'No previous range
        // found. Cannot catch up.' surface verbatim via ApiError.
        console.error('Failed to create range:', error);
        toast.error(describeMutationError(error, 'Failed to create range'));
        return false;
      } finally {
        setActionLoading(null);
      }
    },
    [chainId, contractAddress, abi, fetchRanges, onRefresh],
  );
  const handleQuickCreate = useCallback(async (confirmOverlap = false) => {
    const { mode, blockCount } = quickFormState;
    const needsBlockCount = ['recent', 'first', 'continue'].includes(mode);
    const blockCountNum = needsBlockCount ? parseInt(blockCount) : 0;

    if (needsBlockCount && (isNaN(blockCountNum) || blockCountNum <= 0)) {
      toast.error('Please enter a valid block count');
      return;
    }

    // Same client-side overlap precheck as the manual form, mirroring the
    // backend's quick-mode bounds (see quickModeBounds). Exempt or
    // non-computable modes return null and POST directly.
    if (!confirmOverlap) {
      const bounds = quickModeBounds(
        mode,
        needsBlockCount ? blockCountNum : undefined,
        creationBlockNumber,
        headBlock,
        ranges,
      );
      const overlapping = bounds ? findFirstOverlap(ranges, bounds.from, bounds.to) : null;
      if (overlapping) {
        setOverlapGate({ source: 'quick', range: overlapping });
        return;
      }
    }

    const created = await runQuickCreate(
      mode,
      needsBlockCount ? blockCountNum : undefined,
      -2,
    );
    // runQuickCreate never throws (it catches internally), so the gate
    // always clears once the submit resolves.
    setOverlapGate(null);
    if (created) {
      setQuickFormState(defaultQuickFormState);
    }
  }, [quickFormState, ranges, creationBlockNumber, headBlock, runQuickCreate]);
  // One-click catch-up: the backend quick mode 'catchup' creates a range
  // from the furthest existing toBlock (inclusive) to the current head and
  // auto-starts it like every quick mode.
  const handleCatchupToHead = useCallback(async () => {
    await runQuickCreate('catchup', undefined, CATCHUP_ACTION_LOADING);
  }, [runQuickCreate]);
  const handleStartIndexing = useCallback(
    async (rangeId: number) => {
      setActionLoading(rangeId);
      try {
        // The backend acknowledges with 202 and indexes in the background;
        // the 3s polling below picks up progress.
        await post(
          `/api/chains/${chainId}/contracts/${contractAddress}/events/ranges/${rangeId}/start`,
          { abi },
        );
        toast.success('Indexing started');
        await fetchRanges();
      } catch (error) {
        console.error('Failed to start indexing:', error);
        toast.error(describeMutationError(error, 'Failed to start indexing'));
      } finally {
        setActionLoading(null);
      }
    },
    [chainId, contractAddress, abi, fetchRanges],
  );
  const handlePauseIndexing = useCallback(
    async (rangeId: number) => {
      // The pause route returns immediately; the job finishes its current
      // batch first. Keep a transient 'Pausing…' state until the polled
      // range status actually flips away from 'indexing'.
      setPausingRangeIds(prev => new Set(prev).add(rangeId));
      setActionLoading(rangeId);
      try {
        await post(
          `/api/chains/${chainId}/contracts/${contractAddress}/events/ranges/${rangeId}/pause`,
          {},
        );
        await fetchRanges();
      } catch (error) {
        // Pause did not take effect — clear the transient state so the
        // button does not stay stuck on 'Pausing…'.
        setPausingRangeIds(prev => {
          if (!prev.has(rangeId)) return prev;
          const next = new Set(prev);
          next.delete(rangeId);
          return next;
        });
        console.error('Failed to pause indexing:', error);
        toast.error(describeMutationError(error, 'Failed to pause indexing'));
      } finally {
        setActionLoading(null);
      }
    },
    [chainId, contractAddress, fetchRanges],
  );
  const handleResumeIndexing = useCallback(
    async (rangeId: number) => {
      setActionLoading(rangeId);
      try {
        // The backend acknowledges with 202 and indexes in the background;
        // the 3s polling below picks up progress.
        await post(
          `/api/chains/${chainId}/contracts/${contractAddress}/events/ranges/${rangeId}/resume`,
          { abi },
        );
        toast.success('Indexing resumed');
        await fetchRanges();
      } catch (error) {
        console.error('Failed to resume indexing:', error);
        toast.error(describeMutationError(error, 'Failed to resume indexing'));
      } finally {
        setActionLoading(null);
      }
    },
    [chainId, contractAddress, abi, fetchRanges],
  );
  const handleDeleteRange = useCallback(
    async (rangeId: number) => {
      // eslint-disable-next-line no-alert
      if (!window.confirm('Are you sure you want to delete this range?')) return;
      setActionLoading(rangeId);
      try {
        await del(`/api/chains/${chainId}/contracts/${contractAddress}/events/ranges/${rangeId}`);
        await fetchRanges();
        onRefresh?.();
      } catch (error) {
        console.error('Failed to delete range:', error);
        toast.error(describeMutationError(error, 'Failed to delete range'));
      } finally {
        setActionLoading(null);
      }
    },
    [chainId, contractAddress, fetchRanges, onRefresh],
  );
  const formatBlock = (block: bigint | number): string => {
    return Number(block).toLocaleString();
  };
  // Editing the gated form (or switching quick mode) invalidates the armed
  // confirmation: the next submit re-runs the precheck.
  const resetOverlapGate = useCallback((source: OverlapGate['source']) => {
    setOverlapGate(prev => (prev?.source === source ? null : prev));
  }, []);
  // Submit-button labels: while the overlap gate is armed for a form, its
  // submit button relabels to 'Create anyway' (the second click runs the
  // original submit).
  const manualSubmitLabel = (): string => {
    if (actionLoading === -1) return 'Adding...';
    if (overlapGate?.source === 'manual') return 'Create anyway';
    return 'Add Range';
  };
  const quickSubmitLabel = (): string => {
    if (actionLoading === -2) return 'Creating...';
    if (overlapGate?.source === 'quick') return 'Create anyway';
    return 'Create';
  };
  const calculateProgress = (range: IndexingRange): number => {
    if (!range.currentBlock) return 0;
    const totalBlocks = Number(range.toBlock) - Number(range.fromBlock) + 1;
    if (totalBlocks <= 0) return 0;
    const currentIndexed =
      range.direction === 'forward'
        ? Number(range.currentBlock) - Number(range.fromBlock) + 1
        : Number(range.toBlock) - Number(range.currentBlock) + 1;
    return Math.round((currentIndexed / totalBlocks) * 100);
  };
  const getStatusLabel = (status: RangeStatus): string => {
    const labels: Record<RangeStatus, string> = {
      pending: 'Pending',
      indexing: 'Indexing',
      paused: 'Paused',
      completed: 'Completed',
      error: 'Error',
    };
    return labels[status] || status;
  };
  const renderRangeActions = (range: IndexingRange) => {
    const isLoading = actionLoading === range.rangeId;
    const isPausing = pausingRangeIds.has(range.rangeId);
    // One primary action per state. Error ranges keep their checkpoint —
    // both the start and resume endpoints continue from currentBlock — so
    // a single Resume (with an explicit continuation label) replaces the
    // old ambiguous Start + Resume pair. There is no restart-from-scratch
    // backend endpoint, so none is offered.
    const canStart = range.status === 'pending';
    const canPause = range.status === 'indexing';
    const canResume = range.status === 'paused' || range.status === 'error';
    const canDelete = range.status !== 'indexing';
    const resumeLabel =
      range.status === 'error' ? 'Resume (continues from checkpoint)' : 'Resume';
    return (
      <div style={{ display: 'flex', gap: '8px' }}>
        {canStart && (
          <button
            className={`${actionButtonStyles} primary`}
            onClick={() => handleStartIndexing(range.rangeId)}
            disabled={isLoading}
          >
            {isLoading ? 'Starting...' : 'Start'}
          </button>
        )}
        {canPause && (
          <button
            className={actionButtonStyles}
            onClick={() => handlePauseIndexing(range.rangeId)}
            disabled={isLoading || isPausing}
          >
            {isLoading || isPausing ? 'Pausing...' : 'Pause'}
          </button>
        )}
        {canResume && (
          <button
            className={`${actionButtonStyles} primary`}
            onClick={() => handleResumeIndexing(range.rangeId)}
            disabled={isLoading}
          >
            {isLoading ? 'Resuming...' : resumeLabel}
          </button>
        )}
        {canDelete && (
          <button
            className={`${actionButtonStyles} danger`}
            onClick={() => handleDeleteRange(range.rangeId)}
            disabled={isLoading}
          >
            Delete
          </button>
        )}
      </div>
    );
  };
  if (loading) {
    return (
      <div className={containerStyles}>
        <div className={headerStyles}>
          <h3>Event Indexing Ranges</h3>
        </div>
        <div className={emptyStateStyles}>Loading...</div>
      </div>
    );
  }
  return (
    <div className={containerStyles}>
      <div className={headerStyles}>
        <h3>Event Indexing Ranges</h3>
        <span className="creation-info">
          {hasKnownCreationBlock
            ? `Contract created at block #${creationBlockNumber.toLocaleString()}`
            : 'Contract creation block: unknown'}
        </span>
        <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
          {ranges.length > 0 && headBlock > maxRangeToBlock && (
            <button
              className={`${actionButtonStyles} primary`}
              onClick={handleCatchupToHead}
              disabled={actionLoading !== null}
              title={`Catch up from block ${formatBlock(maxRangeToBlock)} to the head (${formatBlock(headBlock)})`}
            >
              {actionLoading === CATCHUP_ACTION_LOADING ? 'Catching up...' : 'Catch up to head'}
            </button>
          )}
          <button
            className={actionButtonStyles}
            onClick={() => {
              setShowAddForm(!showAddForm);
              // Closing (or reopening) the form drops any armed
              // confirmation — the reopened form starts from its baseline.
              setOverlapGate(null);
            }}
          >
            {showAddForm ? 'Cancel' : '+ Add Range'}
          </button>
        </div>
      </div>
      {stalenessGap !== null && (
        <div className={stalenessBannerStyles}>
          <span className={stalenessDotStyles} />
          {stalenessGap === 0
            ? 'Up to date'
            : `Indexed through block ${formatBlock(maxCurrentBlock)} - ${formatBlock(stalenessGap)} blocks behind head`}
        </div>
      )}
      {ranges.length > 0 && (
        <SegmentedProgressBar
          segments={ranges.map(r => ({
            rangeId: r.rangeId,
            fromBlock: Number(r.fromBlock),
            toBlock: Number(r.toBlock),
            currentBlock: r.currentBlock !== null ? Number(r.currentBlock) : null,
            status: r.status,
            progress: calculateProgress(r),
          }))}
        />
      )}
      {overlaps.length > 0 && (
        <div className={warningStyles}>
          <strong>Warning:</strong> Some existing ranges overlap with the range. Events in
          overlapping blocks will be re-indexed:
          <ul style={{ margin: '8px 0 0', paddingLeft: '16px' }}>
            {overlaps.map(o => (
              <li key={o.rangeId}>
                Range #{o.rangeId}: blocks {formatBlock(o.overlapStart)} -{' '}
                {formatBlock(o.overlapEnd)}
                <button
                  style={{
                    marginLeft: '8px',
                    padding: '2px 8px',
                    background: 'none',
                    border: 'none',
                    color: '#92400e',
                    cursor: 'pointer',
                  }}
                  onClick={() => setOverlaps([])}
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {ranges.length === 0 ? (
        <div className={emptyStateStyles}>
          <p>No indexing ranges configured. Add a range to start indexing events.</p>
          {/* Cold-start one-clicks: the quick form below '+ Add Range' is
              the manual path; these run the backend's quick modes (which
              create AND auto-start) without opening it. */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '12px' }}>
            <button
              className={`${actionButtonStyles} primary`}
              onClick={() => void runQuickCreate('all', undefined, -2)}
              disabled={actionLoading !== null}
            >
              {actionLoading === -2 ? 'Starting...' : 'Index everything'}
            </button>
            <button
              className={quickButtonStyles}
              onClick={() => void runQuickCreate('recent', 1000, -2)}
              disabled={actionLoading !== null}
              title="Create and start a range covering the most recent 1,000 blocks"
            >
              Index recent
            </button>
          </div>
        </div>
      ) : (
        <div className={rangeListStyles}>
          {ranges.map(range => (
            <div key={range.rangeId} className={rangeItemStyles}>
              <div className={rangeInfoStyles}>
                <div className="range-blocks">
                  <span className={statusBadgeStyles} data-status={range.status}>
                    {getStatusLabel(range.status)}
                  </span>
                  <span className={directionBadgeStyles}>
                    {range.direction === 'forward' ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M5 12l12M19 12" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M19 12l5 12" />
                      </svg>
                    )}
                    <span>{range.direction === 'forward' ? 'Forward' : 'Backward'}</span>
                  </span>
                  <span style={{ marginLeft: '8px' }}>
                    #{formatBlock(range.fromBlock)} - {formatBlock(range.toBlock)}
                  </span>
                </div>
                <div className="range-progress">
                  {/* Walked progress shows for every checkpointed status —
                      indexing, paused, and errored ranges all keep their
                      currentBlock, those blocks are indexed and queryable,
                      and EventStatistics counts them as covered. */}
                  {CHECKPOINTED_RANGE_STATUSES.has(range.status) && range.currentBlock && (
                    <>
                      Progress: {calculateProgress(range)}
                      %
                      {range.direction === 'forward'
                        ? `(${formatBlock(range.currentBlock)} / ${formatBlock(range.toBlock)})`
                        : `(${formatBlock(range.fromBlock)} / ${formatBlock(range.currentBlock)})`}
                    </>
                  )}
                  {range.totalEventsIndexed > 0 && (
                    <span>{range.totalEventsIndexed.toLocaleString()} events indexed</span>
                  )}
                  {range.errorMessage && (
                    <span style={{ color: '#dc2626' }}>{range.errorMessage}</span>
                  )}
                </div>
              </div>
              {renderRangeActions(range)}
            </div>
          ))}
        </div>
      )}
      {showAddForm && (
        <>
          <div className={quickActionsStyles}>
            <span
              style={{ fontSize: '12px', color: '#0369a1', fontWeight: 500, marginRight: '8px' }}
            >
              Quick Create:
            </span>
            <button
              className={quickButtonStyles}
              onClick={() => {
                setQuickFormState({ mode: 'all', blockCount: '' });
                resetOverlapGate('quick');
              }}
              disabled={actionLoading !== null}
            >
              Index All
            </button>
            <button
              className={quickButtonStyles}
              onClick={() => {
                setQuickFormState({ mode: 'recent', blockCount: '1000' });
                resetOverlapGate('quick');
              }}
              disabled={actionLoading !== null}
            >
              Recent Blocks
            </button>
            <button
              className={quickButtonStyles}
              onClick={() => {
                setQuickFormState({ mode: 'first', blockCount: '1000' });
                resetOverlapGate('quick');
              }}
              disabled={actionLoading !== null || !hasKnownCreationBlock}
              title={
                hasKnownCreationBlock ? undefined : 'Contract creation block unknown'
              }
            >
              First Blocks
            </button>
            <button
              className={quickButtonStyles}
              onClick={() => {
                setQuickFormState({ mode: 'continue', blockCount: '1000' });
                resetOverlapGate('quick');
              }}
              disabled={actionLoading !== null || ranges.length === 0}
              title={ranges.length === 0 ? 'No previous range yet' : undefined}
            >
              Continue
            </button>
            {quickFormState.mode !== 'all' && (
              <div className={inputGroupStyles} style={{ marginLeft: '8px' }}>
                <input
                  type="number"
                  placeholder="Count"
                  value={quickFormState.blockCount}
                  onChange={e => {
                    setQuickFormState({ ...quickFormState, blockCount: e.target.value });
                    resetOverlapGate('quick');
                  }}
                  style={{ width: '80px' }}
                  min={1}
                />
              </div>
            )}
            <button
              className={`${actionButtonStyles} primary`}
              onClick={() => void handleQuickCreate(overlapGate?.source === 'quick')}
              disabled={
                actionLoading !== null ||
                (quickFormState.mode !== 'all' && !quickFormState.blockCount)
              }
              style={{ marginLeft: 'auto' }}
            >
              {quickSubmitLabel()}
            </button>
          </div>
          {overlapGate?.source === 'quick' && (
            <div className={warningStyles} role="alert">
              {overlapWarningText(overlapGate.range)}
            </div>
          )}
          <div className={addFormStyles}>
            <div className={inputGroupStyles}>
              <label>From Block</label>
              <input
                type="text"
                placeholder={
                  hasKnownCreationBlock ? creationBlockNumber.toString() : 'start block (or earliest)'
                }
                value={formState.fromBlock}
                onChange={e => {
                  setFormState({ ...formState, fromBlock: e.target.value });
                  resetOverlapGate('manual');
                }}
              />
            </div>
            <div className={inputGroupStyles}>
              <label>To Block</label>
              <input
                type="text"
                placeholder={headBlock > 0 ? headBlock.toString() : 'latest, finalized, safe'}
                value={formState.toBlock}
                onChange={e => {
                  setFormState({ ...formState, toBlock: e.target.value });
                  resetOverlapGate('manual');
                }}
              />
            </div>
            <div className={inputGroupStyles}>
              <label>Direction</label>
              <select
                value={formState.direction}
                onChange={e => {
                  setFormState({ ...formState, direction: e.target.value as RangeDirection });
                  resetOverlapGate('manual');
                }}
              >
                <option value="forward">Forward (old to new)</option>
                <option value="backward">Backward (new to old)</option>
              </select>
            </div>
            <button
              className={`${actionButtonStyles} primary`}
              onClick={() => void handleAddRange(overlapGate?.source === 'manual')}
              disabled={actionLoading !== null || !formState.fromBlock || !formState.toBlock}
            >
              {manualSubmitLabel()}
            </button>
          </div>
          {overlapGate?.source === 'manual' && (
            <div className={warningStyles} role="alert">
              {overlapWarningText(overlapGate.range)}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default IndexingRangeManager;
