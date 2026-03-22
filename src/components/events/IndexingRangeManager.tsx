import React, { useState, useEffect, useCallback } from 'react';
import { css } from '@linaria/core';
import { SegmentedProgressBar } from '../ui/SegmentedProgressBar';
import { toast } from 'sonner';

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
  creationBlock?: number;
  abi?: unknown[];
  onRefresh?: () => void;
};

type AddRangeForm = {
  fromBlock: string;
  toBlock: string;
  direction: RangeDirection;
};

type QuickMode = 'all' | 'recent' | 'first' | 'continue';

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

export const IndexingRangeManager: React.FC<Props> = ({
  chainId,
  contractAddress,
  creationBlock = 0,
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

  const latestBlock = ranges.length > 0 ? Math.max(...ranges.map(r => Number(r.toBlock))) : 0;
  const fetchRanges = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/ranges`,
      );
      if (response.ok) {
        const data = await response.json();
        setRanges(data.ranges ?? []);
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
  const handleAddRange = useCallback(async () => {
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
    if (!isFromTag && creationBlock > 0 && (fromBlock as number) < creationBlock) {
      toast.error(`From block cannot be before contract creation block (${creationBlock})`);
      return;
    }
    setActionLoading(-1);
    try {
      const response = await fetch(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/ranges`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromBlock: isFromTag ? fromBlockValue : fromBlock,
            toBlock: isToTag ? toBlockValue : toBlock,
            direction: formState.direction,
          }),
        },
      );
      const data = await response.json();
      if (response.ok) {
        setFormState(defaultFormState);
        setShowAddForm(false);
        await fetchRanges();
        if (data.overlaps && data.overlaps.length > 0) {
          setOverlaps(data.overlaps);
        }
        onRefresh?.();
      } else {
        toast.error(data.message ?? data.error ?? 'Failed to add range');
      }
    } catch (error) {
      console.error('Failed to add range:', error);
      toast.error('Failed to add range');
    } finally {
      setActionLoading(null);
    }
  }, [chainId, contractAddress, formState, creationBlock, fetchRanges, onRefresh]);
  const handleQuickCreate = useCallback(async () => {
    const { mode, blockCount } = quickFormState;
    const needsBlockCount = ['recent', 'first', 'continue'].includes(mode);
    const blockCountNum = needsBlockCount ? parseInt(blockCount) : 0;

    if (needsBlockCount && (isNaN(blockCountNum) || blockCountNum <= 0)) {
      toast.error('Please enter a valid block count');
      return;
    }

    setActionLoading(-2);
    try {
      const response = await fetch(
        `/api/chains/${chainId}/contracts/${contractAddress}/events/ranges/quick`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            blockCount: needsBlockCount ? blockCountNum : undefined,
          }),
        },
      );
      const data = await response.json();
      if (response.ok) {
        setQuickFormState(defaultQuickFormState);
        await fetchRanges();
        toast.success(
          `Range created: blocks ${data.fromBlock?.toLocaleString() ?? '?'} - ${data.toBlock?.toLocaleString() ?? '?'}`,
        );
        onRefresh?.();
      } else {
        toast.error(data.message ?? data.error ?? 'Failed to create range');
      }
    } catch (error) {
      console.error('Failed to create range:', error);
      toast.error('Failed to create range');
    } finally {
      setActionLoading(null);
    }
  }, [chainId, contractAddress, quickFormState, fetchRanges, onRefresh]);
  const handleStartIndexing = useCallback(
    async (rangeId: number) => {
      setActionLoading(rangeId);
      try {
        const response = await fetch(
          `/api/chains/${chainId}/contracts/${contractAddress}/events/ranges/${rangeId}/start`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ abi }),
          },
        );
        if (response.ok) {
          await fetchRanges();
        } else {
          const data = await response.json();
          toast.error(data.error ?? 'Failed to start indexing');
        }
      } catch (error) {
        console.error('Failed to start indexing:', error);
        toast.error('Failed to start indexing');
      } finally {
        setActionLoading(null);
      }
    },
    [chainId, contractAddress, abi, fetchRanges],
  );
  const handlePauseIndexing = useCallback(
    async (rangeId: number) => {
      setActionLoading(rangeId);
      try {
        const response = await fetch(
          `/api/chains/${chainId}/contracts/${contractAddress}/events/ranges/${rangeId}/pause`,
          { method: 'POST' },
        );
        if (response.ok) {
          await fetchRanges();
        } else {
          const data = await response.json();
          toast.error(data.error ?? 'Failed to pause indexing');
        }
      } catch (error) {
        console.error('Failed to pause indexing:', error);
        toast.error('Failed to pause indexing');
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
        const response = await fetch(
          `/api/chains/${chainId}/contracts/${contractAddress}/events/ranges/${rangeId}/resume`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ abi }),
          },
        );
        if (response.ok) {
          await fetchRanges();
        } else {
          const data = await response.json();
          toast.error(data.error ?? 'Failed to resume indexing');
        }
      } catch (error) {
        console.error('Failed to resume indexing:', error);
        toast.error('Failed to resume indexing');
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
        const response = await fetch(
          `/api/chains/${chainId}/contracts/${contractAddress}/events/ranges/${rangeId}`,
          { method: 'DELETE' },
        );
        if (response.ok) {
          await fetchRanges();
          onRefresh?.();
        } else {
          const data = await response.json();
          toast.error(data.error ?? 'Failed to delete range');
        }
      } catch (error) {
        console.error('Failed to delete range:', error);
        toast.error('Failed to delete range');
      } finally {
        setActionLoading(null);
      }
    },
    [chainId, contractAddress, fetchRanges, onRefresh],
  );
  const formatBlock = (block: bigint | number): string => {
    return Number(block).toLocaleString();
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
    const canStart = range.status === 'pending' || range.status === 'error';
    const canPause = range.status === 'indexing';
    const canResume = range.status === 'paused' || range.status === 'error';
    const canDelete = range.status !== 'indexing';
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
            disabled={isLoading}
          >
            {isLoading ? 'Pausing...' : 'Pause'}
          </button>
        )}
        {canResume && (
          <button
            className={`${actionButtonStyles} primary`}
            onClick={() => handleResumeIndexing(range.rangeId)}
            disabled={isLoading}
          >
            {isLoading ? 'Resuming...' : 'Resume'}
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
          Contract created at block #{creationBlock.toLocaleString()}
        </span>
        <button
          className={actionButtonStyles}
          onClick={() => setShowAddForm(!showAddForm)}
          style={{ marginLeft: 'auto' }}
        >
          {showAddForm ? 'Cancel' : '+ Add Range'}
        </button>
      </div>
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
          No indexing ranges configured. Add a range to start indexing events.
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
                  {range.status === 'indexing' && range.currentBlock && (
                    <>
                      Progress: {calculateProgress(range)}
                      %%
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
              onClick={() => setQuickFormState({ mode: 'all', blockCount: '' })}
              disabled={actionLoading !== null}
            >
              Index All
            </button>
            <button
              className={quickButtonStyles}
              onClick={() => setQuickFormState({ mode: 'recent', blockCount: '1000' })}
              disabled={actionLoading !== null}
            >
              Recent Blocks
            </button>
            <button
              className={quickButtonStyles}
              onClick={() => setQuickFormState({ mode: 'first', blockCount: '1000' })}
              disabled={actionLoading !== null}
            >
              First Blocks
            </button>
            <button
              className={quickButtonStyles}
              onClick={() => setQuickFormState({ mode: 'continue', blockCount: '1000' })}
              disabled={actionLoading !== null}
            >
              Continue
            </button>
            {quickFormState.mode !== 'all' && (
              <div className={inputGroupStyles} style={{ marginLeft: '8px' }}>
                <input
                  type="number"
                  placeholder="Count"
                  value={quickFormState.blockCount}
                  onChange={e =>
                    setQuickFormState({ ...quickFormState, blockCount: e.target.value })}
                  style={{ width: '80px' }}
                  min={1}
                />
              </div>
            )}
            <button
              className={`${actionButtonStyles} primary`}
              onClick={handleQuickCreate}
              disabled={
                actionLoading !== null ||
                (quickFormState.mode !== 'all' && !quickFormState.blockCount)
              }
              style={{ marginLeft: 'auto' }}
            >
              {actionLoading === -2 ? 'Creating...' : 'Create'}
            </button>
          </div>
          <div className={addFormStyles}>
            <div className={inputGroupStyles}>
              <label>From Block</label>
              <input
                type="text"
                placeholder={creationBlock > 0 ? creationBlock.toString() : '0 (or earliest)'}
                value={formState.fromBlock}
                onChange={e => setFormState({ ...formState, fromBlock: e.target.value })}
              />
            </div>
            <div className={inputGroupStyles}>
              <label>To Block</label>
              <input
                type="text"
                placeholder={latestBlock > 0 ? latestBlock.toString() : 'latest, finalized, safe'}
                value={formState.toBlock}
                onChange={e => setFormState({ ...formState, toBlock: e.target.value })}
              />
            </div>
            <div className={inputGroupStyles}>
              <label>Direction</label>
              <select
                value={formState.direction}
                onChange={e =>
                  setFormState({ ...formState, direction: e.target.value as RangeDirection })}
              >
                <option value="forward">Forward (old to new)</option>
                <option value="backward">Backward (new to old)</option>
              </select>
            </div>
            <button
              className={`${actionButtonStyles} primary`}
              onClick={handleAddRange}
              disabled={actionLoading !== null || !formState.fromBlock || !formState.toBlock}
            >
              {actionLoading === -1 ? 'Adding...' : 'Add Range'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default IndexingRangeManager;
