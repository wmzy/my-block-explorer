import { css, cx } from '@linaria/core';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
// Per-component submodule import instead of the 'haze-ui' barrel, mirroring
// Badge.tsx: barrel imports with aliases break vite-plugin-haze-ui's CSS
// scan, while non-barrel specifiers are outside its collection — the
// explicit CSS side-effect import below substitutes for the injection.
import { Tag as HazeTag } from 'haze-ui/components/Tag';
import 'haze-ui/css/tag.css';

// Coverage vocabulary for the page-level honesty badge. A level describes
// HOW one data source is (or is not) covered — the aggregate badge takes
// the worst level across sources so a page never looks better than its
// weakest source.
export type CoverageLevel =
  | 'live'
  | 'cached-immutable'
  | 'discovered'
  | 'sampled'
  | 'partial'
  | 'unavailable';

// Human word for each level, used to compose the aggregate chip label.
export const COVERAGE_WORDS: Record<CoverageLevel, string> = {
  'live': 'live',
  'cached-immutable': 'cached',
  'discovered': 'discovered',
  'sampled': 'sampled',
  'partial': 'partial',
  'unavailable': 'unavailable',
};

// Severity order for aggregation (ascending): unavailable is the worst —
// data a reader would expect is missing or failed — while live RPC reads
// are the gold standard. Exported indirectly through worstCoverage.
const COVERAGE_SEVERITY: Record<CoverageLevel, number> = {
  'live': 0,
  'cached-immutable': 1,
  'discovered': 2,
  'sampled': 3,
  'partial': 4,
  'unavailable': 5,
};

// Pure reducer: the more severe of two levels (ties resolve to `a`). Use
// as an Array.reduce callback to fold any number of source levels.
export function worstCoverage(a: CoverageLevel, b: CoverageLevel): CoverageLevel {
  return COVERAGE_SEVERITY[a] >= COVERAGE_SEVERITY[b] ? a : b;
}

// One source's contribution to the aggregate: the level plus the sentence
// the badge's expandable detail lists for it.
export type CoverageSource = {
  readonly level: CoverageLevel;
  readonly detail: string;
};

// The rendered badge props produced by aggregation (label pre-composed so
// views spread the summary straight onto <CoverageBadge />).
export type CoverageSummary = {
  readonly level: CoverageLevel;
  readonly label: string;
  readonly detail: readonly string[];
};

// Fold sources into one badge summary: the worst level wins, the detail
// keeps every source's line in the caller's order. An empty source list
// promises nothing, so it can only honestly read as unavailable.
const coverageLabel = (level: CoverageLevel): string =>
  `Data coverage: ${COVERAGE_WORDS[level]}`;

export function aggregateCoverage(sources: readonly CoverageSource[]): CoverageSummary {
  if (sources.length === 0) {
    return { level: 'unavailable', label: coverageLabel('unavailable'), detail: [] };
  }
  const level = sources.reduce<CoverageLevel>(
    (worst, source) => worstCoverage(worst, source.level),
    'live',
  );
  return {
    level,
    label: coverageLabel(level),
    detail: sources.map(source => source.detail),
  };
}

// Tag variant per level. Levels must stay distinguishable WITHOUT color:
// the icon shape (below) and the always-present label word carry the
// distinction; the palette only reinforces it.
const LEVEL_TAG_VARIANT: Record<
  CoverageLevel,
  'default' | 'primary' | 'success' | 'warning' | 'danger'
> = {
  'live': 'success',
  'cached-immutable': 'primary',
  'discovered': 'default',
  'sampled': 'default',
  'partial': 'warning',
  'unavailable': 'danger',
};

// One distinct 10x10 glyph per level (color-independent):
// live ● filled circle · cached-immutable ■ filled square ·
// discovered ◍ ring · sampled ▲ triangle · partial ◐ half-filled circle ·
// unavailable ✕ cross.
const LEVEL_ICON: Record<CoverageLevel, ReactNode> = {
  'live': (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="4" fill="currentColor" />
    </svg>
  ),
  'cached-immutable': (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" />
    </svg>
  ),
  'discovered': (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  'sampled': (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M5 1 9.3 9H0.7Z" fill="currentColor" />
    </svg>
  ),
  'partial': (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 1a4 4 0 0 0 0 8Z" fill="currentColor" />
    </svg>
  ),
  'unavailable': (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M1.8 1.8 8.2 8.2M8.2 1.8 1.8 8.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  ),
};

const rootStyle = css`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
`;

const chipRowStyle = css`
  display: inline-flex;
  align-items: center;
  gap: var(--haze-space-1);
`;

const tagStyle = css`
  display: inline-flex;
  align-items: center;
  gap: var(--haze-space-1);
`;

const iconStyle = css`
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
`;

// Quiet ⓘ affordance beside the chip (the same pattern as the Address
// page's nonce hint): opens the per-source detail list below the chip.
const infoButtonStyle = css`
  border: none;
  background: transparent;
  padding: 0;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
  line-height: 1;
  cursor: pointer;

  &:hover {
    color: var(--haze-color-text);
  }
`;

const detailListStyle = css`
  margin: var(--haze-space-2) 0 0;
  padding: var(--haze-space-2) var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  background: var(--haze-color-bg-subtle);
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
  /* Long honesty sentences wrap at a readable measure instead of
     stretching the page grid. */
  max-width: 72ch;
`;

export type CoverageBadgeProps = {
  level: CoverageLevel;
  /** Chip text, normally the aggregated summary label. */
  label: string;
  /** One line per data source; omit or empty renders no info affordance. */
  detail?: readonly string[];
  className?: string;
};

// Page-level coverage indicator: one small chip summarizing the worst
// source's coverage, with an expandable list explaining what each source's
// coverage IS. Pure aggregation helpers (worstCoverage/aggregateCoverage)
// live above so views derive their summary outside React and unit-test it.
export function CoverageBadge({ level, label, detail, className }: CoverageBadgeProps) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const hasDetail = detail !== undefined && detail.length > 0;

  return (
    <div
      className={cx(rootStyle, className)}
      data-testid="coverage-badge"
      data-level={level}
    >
      <span className={chipRowStyle}>
        <HazeTag variant={LEVEL_TAG_VARIANT[level]} size="sm" className={tagStyle}>
          <span className={iconStyle} aria-hidden="true">
            {LEVEL_ICON[level]}
          </span>
          {label}
        </HazeTag>
        {hasDetail && (
          <button
            type="button"
            className={infoButtonStyle}
            aria-expanded={open}
            aria-controls={detailId}
            aria-label={open ? 'Hide data coverage details' : 'Show data coverage details'}
            title="What this coverage means, per data source"
            data-testid="coverage-badge-toggle"
            onClick={() => setOpen(prev => !prev)}
          >
            ⓘ
          </button>
        )}
      </span>
      {open && hasDetail && (
        <ul id={detailId} className={detailListStyle} data-testid="coverage-badge-detail">
          {detail.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
