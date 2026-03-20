import { css, cx } from '@linaria/core';

export type SegmentStatus = 'pending' | 'indexing' | 'paused' | 'completed' | 'error';

export type Segment = {
  rangeId: number;
  fromBlock: number;
  toBlock: number;
  currentBlock: number | null;
  status: SegmentStatus;
  progress: number;
};

export type Props = {
  segments: Segment[];
  className?: string;
};

const containerStyle = css`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--haze-surface, #f9fafb);
  border: 1px solid var(--haze-border, #e5e7eb);
  border-radius: 8px;
  margin-bottom: 16px;
`;

const trackStyle = css`
  flex: 1;
  height: 8px;
  background: var(--haze-border, #e5e7eb);
  border-radius: 4px;
  overflow: hidden;
  display: flex;
`;

const segmentStyle = css`
  height: 100%;
  position: relative;
  transition: width 0.3s ease;

  &[data-status='completed'] {
    background: #22c55e;
  }

  &[data-status='indexing'] {
    background: linear-gradient(90deg, #3b82f6, #60a5fa);
    animation: pulse 1.5s ease-in-out infinite;

    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.7;
      }
    }
  }

  &[data-status='pending'] {
    background: #9ca3af;
  }

  &[data-status='paused'] {
    background: #eab308;
  }

  &[data-status='error'] {
    background: #ef4444;
  }
`;

const tooltipStyle = css`
  position: relative;

  &::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 8px;
    background: #1f2937;
    color: white;
    font-size: 11px;
    white-space: nowrap;
    border-radius: 4px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
    z-index: 10;
    margin-bottom: 4px;
  }

  &:hover::after {
    opacity: 1;
  }
`;

const legendStyle = css`
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--haze-text-secondary, #6b7280);
  margin-top: 8px;
`;

const legendItemStyle = css`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const statusDotStyle = css`
  width: 8px;
  height: 8px;
  border-radius: 50%;
`;

function getTooltipText(segment: Segment): string {
  const from = segment.fromBlock.toLocaleString();
  const to = segment.toBlock.toLocaleString();
  const pct = segment.progress.toFixed(1);
  const statusLabel = segment.status.charAt(0).toUpperCase() + segment.status.slice(1);

  if (segment.status === 'completed') {
    return `${from} - ${to} (Completed)`;
  }
  if (segment.status === 'pending') {
    return `${from} - ${to} (Pending)`;
  }
  if (segment.status === 'indexing') {
    return `${from} - ${to} (${pct}%)`;
  }
  if (segment.status === 'paused') {
    return `${from} - ${to} (Paused)`;
  }
  return `${from} - ${to} (Error)`;
}

export function SegmentedProgressBar({ segments, className }: Props) {
  if (segments.length === 0) {
    return (
      <div className={cx(containerStyle, className)}>
        <span style={{ color: 'var(--haze-text-secondary, #6b7280)', fontSize: '13px' }}>
          No indexing ranges defined
        </span>
      </div>
    );
  }

  const totalBlocks = segments.reduce((sum, s) => sum + (s.toBlock - s.fromBlock), 0);

  return (
    <div className={cx(containerStyle, className)}>
      <div className={trackStyle}>
        {segments.map(segment => {
          const width =
            totalBlocks > 0 ? ((segment.toBlock - segment.fromBlock) / totalBlocks) * 100 : 0;

          return (
            <div
              key={segment.rangeId}
              className={tooltipStyle}
              data-tooltip={getTooltipText(segment)}
              style={{ width: `${width}%` }}
            >
              <div
                className={segmentStyle}
                data-status={segment.status}
                style={{ width: `${segment.progress}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className={legendStyle}>
        <div className={legendItemStyle}>
          <div className={statusDotStyle} style={{ background: '#22c55e' }} />
          <span>Completed</span>
        </div>
        <div className={legendItemStyle}>
          <div className={statusDotStyle} style={{ background: '#3b82f6' }} />
          <span>Indexing</span>
        </div>
        <div className={legendItemStyle}>
          <div className={statusDotStyle} style={{ background: '#eab308' }} />
          <span>Paused</span>
        </div>
        <div className={legendItemStyle}>
          <div className={statusDotStyle} style={{ background: '#ef4444' }} />
          <span>Error</span>
        </div>
        <div className={legendItemStyle}>
          <div className={statusDotStyle} style={{ background: '#9ca3af' }} />
          <span>Pending</span>
        </div>
      </div>
    </div>
  );
}

export default SegmentedProgressBar;
