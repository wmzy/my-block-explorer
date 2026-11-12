/**
 * EventTable component - displays contract events with pagination, sorting, and filtering
 * Integrates with events API endpoints for real-time data display
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { css, cx } from '@linaria/core';
import { TypedLink } from '@native-router/react';
import { Address, AbiEvent } from 'viem';
import { EmptyState, ErrorState } from '@/components/ui/ErrorState';
import {
  monoStyle,
  pageButtonsStyle,
  pageInfoStyle,
  paginationBarStyle,
  tableBaseStyle,
  tableShellStyle,
} from '@/components/ui/DataTable';
import { spinnerBase } from '@/components/ui/Button';
import { formatDateTime, formatFixedDecimals, formatNumber, truncateMiddle } from '@/utils/format';
import { errorMessage } from '@/utils/errorHandler';
import { useGenerationGuard } from '@/util/useGenerationGuard';
import { EventFilterPanel, type EventFilterState } from './EventFilterPanel';
import { get } from '@/util/http';
import { getApiBase } from '@/util/apiBase';
import { CopyButton, copyButtonBase } from '@/components/ui/CopyButton';
import { parseStrictInteger } from '@/utils/validation';

// Types
type EventData = {
  blockNumber: number;
  // null when the block timestamp could not be fetched; rendered as a placeholder
  blockTimestamp: string | null;
  transactionHash: `0x${string}`;
  eventName: string;
  // false until the event's block finalizes and reorg reconciliation
  // verifies the log; undefined when the API omits the field
  isFinalized?: boolean | null;
  from?: string;
  to?: string;
  value?: string;
  // Raw log fields carried straight from the indexed contract_events row.
  // All nullable: rows written before a field existed (or rows supplied
  // via initialEvents) legitimately lack them, and the raw-log disclosure
  // degrades honestly instead of erroring.
  logIndex?: number | null;
  // The emitting contract of the log (indexing fetches logs by contract
  // address, so this is normally the table's own contractAddress)
  contractAddress?: string | null;
  topic0?: string | null;
  topic1?: string | null;
  topic2?: string | null;
  topic3?: string | null;
  data?: string | null;
  [key: string]: unknown;
};

type EventTableProps = {
  chainId: number;
  contractAddress: Address;
  initialEvents?: EventData[];
  className?: string;
  availableSortOptions?: SortOption[];
  defaultPageSize?: number;
  enableMultiSort?: boolean;
  enableCustomPageSize?: boolean;
  columnConfig?: ColumnConfig[];
  enableClientSideSort?: boolean;
  clientSideSortThreshold?: number;
  // Enhanced filtering props
  abiEvents?: AbiEvent[];
  enableDynamicFiltering?: boolean;
  onFiltersChange?: (filters: EventFilterState) => void;
  refreshKey?: number;
};

type PaginationState = {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  nextCursor?: string;
  prevCursor?: string;
  totalPages?: number;
  startIndex?: number;
  endIndex?: number;
};

type FilterState = {
  eventName?: string;
  fromBlock?: number;
  toBlock?: number;
  fromAddress?: string;
  toAddress?: string;
};

type SortState = {
  field: string;
  direction: 'asc' | 'desc';
};

type SortOption = {
  key: string;
  label: string;
  type: 'numeric' | 'text' | 'address' | 'timestamp';
  defaultDirection?: 'asc' | 'desc';
  description?: string;
};

type ColumnConfig = {
  key: string;
  label: string;
  sortable: boolean;
  width?: string;
  visible: boolean;
  priority: number;
};

// Styles: Linaria `css` classes over haze theme tokens (dark-theme safe).
// DOM structure is unchanged from the former styled layer. The card shell
// and table skeleton are the shared DataTable bases (single-sourced there);
// only EventTable's deltas live here.
const tableContainer = cx(
  tableShellStyle,
  css`
    box-shadow: var(--haze-shadow-md);
    /* The card never scrolls vertically — the pager below owns the page
       height, and a second scroll pane would nest inside it. */
    overflow-y: hidden;
  `,
);

const tableStyle = cx(
  tableBaseStyle,
  css`
    font-size: 14px;
  `,
);

const tableHeader = css`
  background: var(--haze-color-bg-subtle);
  border-bottom: 1px solid var(--haze-color-border);
`;

const tableHeaderCell = css`
  padding: 12px 16px;
  text-align: left;
  font-weight: 600;
  color: var(--haze-color-text);
  user-select: none;
  position: relative;

  &:hover {
    background: var(--haze-color-bg-muted);
  }
`;

// Sortable header cells add the pointer cursor; composed after tableHeaderCell.
const tableHeaderCellSortable = css`
  cursor: pointer;
`;

const sortIndicator = css`
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--haze-color-text-muted);
  font-size: 12px;
`;

const tableBody = css`
  & tr {
    border-bottom: 1px solid var(--haze-color-border);

    &:hover {
      background: var(--haze-color-bg-subtle);
    }
  }
`;

const tableCell = css`
  padding: 12px 16px;
  color: var(--haze-color-text);
  vertical-align: top;
`;

const eventNameCell = css`
  font-family: var(--haze-font-mono);
  font-weight: 600;
  color: var(--haze-color-primary);
`;

// Muted marker for rows whose block is not finalized yet: the event may still
// be reorged out until then.
const unfinalizedBadge = css`
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  font-family: inherit;
  color: var(--haze-color-warning);
  background: var(--haze-color-warning-subtle);
  vertical-align: middle;
`;

const valueCell = css`
  font-family: var(--haze-font-mono);
  font-weight: 600;
  color: var(--haze-color-success);
`;

const timestampCell = css`
  color: var(--haze-color-text-muted);
  font-size: 12px;
`;

// ─── Raw-log disclosure ──────────────────────────────────────────────────────
// Leading cell with the chevron toggle, plus the expandable detail row that
// renders the verbatim indexed log fields (topics, data hex, log identity).

const rawLogToggleCell = css`
  width: 40px;
  padding: 12px 4px;
  text-align: center;
`;

// Native button: keyboard operable out of the box (Enter/Space), and
// aria-expanded carries the disclosure state.
const rawLogToggleButton = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--haze-radius-sm);
  background: transparent;
  color: var(--haze-color-text-secondary);
  cursor: pointer;

  &:hover {
    background: var(--haze-color-bg-muted);
    color: var(--haze-color-text);
  }

  &:focus-visible {
    outline: 2px solid var(--haze-color-primary);
    outline-offset: 1px;
  }
`;

const rawLogChevron = css`
  width: 14px;
  height: 14px;
  transform: rotate(-90deg);
  transition: transform 0.15s ease;
`;

const rawLogChevronExpanded = css`
  transform: rotate(0deg);
`;

const rawLogRowCell = css`
  padding: 12px 16px;
  background: var(--haze-color-bg-subtle);
  border-bottom: 1px solid var(--haze-color-border);
`;

const rawLogDisclosure = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-3);
  min-width: 0;
`;

const rawLogMetaRow = cx(
  monoStyle,
  css`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 20px;
  `,
);

const rawLogMetaItem = css`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
`;

const rawLogMetaLabel = css`
  color: var(--haze-color-text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const rawLogLink = css`
  color: var(--haze-color-primary);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const rawLogHexValue = cx(
  monoStyle,
  css`
    color: var(--haze-color-text);
    word-break: break-all;
  `,
);

// Muted placeholder for a raw field the stored row does not carry — a
// stated absence, never a fabricated value.
const notStoredValue = css`
  color: var(--haze-color-text-muted);
  font-style: italic;
`;

const rawLogSectionLabel = css`
  font-size: 11px;
  color: var(--haze-color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const rawLogTopicRow = css`
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
`;

const rawLogTopicLabel = cx(
  monoStyle,
  css`
    color: var(--haze-color-text-muted);
    flex-shrink: 0;
    min-width: 48px;
  `,
);

// Chip chrome shared by both topic0 markers (resolved name / lookup link).
const rawLogChipBase = css`
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 500;
  color: var(--haze-color-primary);
  border: 1px solid var(--haze-color-border);
  flex-shrink: 0;
`;

// Resolved event name chip next to topic0 when the row decoded successfully.
const rawLogChip = cx(
  rawLogChipBase,
  css`
    font-family: inherit;
    background: var(--haze-color-bg-muted);
  `,
);

// Unknown topic0: link out to the signature lookup page instead of a chip.
const rawLogLookupChip = cx(
  rawLogChipBase,
  css`
    text-decoration: none;
    background: var(--haze-color-bg);

    &:hover {
      background: var(--haze-color-bg-muted);
      text-decoration: underline;
    }
  `,
);

const rawLogDataRow = css`
  display: flex;
  align-items: flex-start;
  gap: var(--haze-space-3);
  min-width: 0;
`;

// Scrollable mono pre (RawJson preStyle pattern): the unbroken data hex
// scrolls inside the box instead of stretching the table sideways.
const rawLogPre = cx(
  monoStyle,
  css`
    margin: 0;
    flex: 1 1 auto;
    min-width: 0;
    max-width: 640px;
    max-height: 200px;
    overflow: auto;
    border: 1px solid var(--haze-color-border);
    border-radius: var(--haze-radius-sm);
    background: var(--haze-color-bg);
    padding: var(--haze-space-2) var(--haze-space-3);
    line-height: var(--haze-leading-relaxed);
    white-space: pre;
  `,
);

// Shared copy-button chrome plus this table's deltas (12px text, no
// shrink inside the meta rows).
const rawLogCopyButton = cx(
  copyButtonBase,
  css`
    font-size: 12px;
    flex-shrink: 0;
  `,
);

// Honest degrade: the row predates raw-log storage (or was supplied without
// raw fields) — a stated absence, never an error state.
const rawLogNote = css`
  margin: 0;
  font-size: 13px;
  color: var(--haze-color-text-muted);
  font-style: italic;
`;

// Pager bar: the shared DataTable chrome plus an always-on wrap — this
// table's controls row (jump input, export link) is wider than the plain
// Prev/Next pair, so it wraps at every width instead of only on phones.
const paginationContainer = cx(
  paginationBarStyle,
  css`
    flex-wrap: wrap;
    gap: 8px;
  `,
);

const paginationControls = cx(
  pageButtonsStyle,
  css`
    align-items: center;
    flex-wrap: wrap;
  `,
);

const paginationButton = css`
  padding: 8px 12px;
  border: 1px solid var(--haze-color-border);
  background: var(--haze-color-bg);
  color: var(--haze-color-text);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  min-width: 36px;

  &:hover:not(:disabled) {
    background: var(--haze-color-bg-muted);
    border-color: var(--haze-color-border-hover);
  }

  &:disabled {
    background: var(--haze-color-bg-subtle);
    color: var(--haze-color-text-muted);
    cursor: not-allowed;
  }
`;

// Shared chrome for the toolbar's small form controls (page-jump input,
// sort and page-size selects): box, padding, 14px text, focus ring.
// Background/color live on the selects' delta only — the number input
// keeps its browser-default field colors, as before.
const fieldControlStyle = css`
  padding: 6px 8px;
  border: 1px solid var(--haze-color-border);
  border-radius: 4px;
  font-size: 14px;

  &:focus {
    outline: none;
    border-color: var(--haze-color-primary);
    box-shadow: 0 0 0 2px var(--haze-color-focus-ring);
  }
`;

const paginationInput = cx(
  fieldControlStyle,
  css`
    width: 60px;
    text-align: center;
  `,
);

// Disabled styling keys off the aria-disabled attribute the component already
// renders, so the modifier never loses to the hover rule on order.
const exportCsvButton = css`
  padding: 8px 12px;
  margin-left: 8px;
  border: 1px solid var(--haze-color-primary);
  background: var(--haze-color-primary);
  color: var(--haze-color-text-inverse);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  text-decoration: none;
  white-space: nowrap;

  &:hover {
    background: var(--haze-color-primary-hover);
    border-color: var(--haze-color-primary-hover);
  }

  &[aria-disabled='true'] {
    border-color: var(--haze-color-border);
    background: var(--haze-color-bg-muted);
    color: var(--haze-color-text-muted);
    cursor: not-allowed;
  }

  &:hover[aria-disabled='true'] {
    background: var(--haze-color-bg-muted);
    border-color: var(--haze-color-border);
  }
`;

// Inline preflight notice shown when the current filtered total exceeds the
// export cap, replacing a click that would only land on the backend 400.
const exportLimitNotice = css`
  margin-left: 12px;
  font-size: 12px;
  color: var(--haze-color-warning);
  white-space: nowrap;
`;

const goToPageContainer = css`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 16px;
`;

// Shared label text for the toolbar controls ("Go to:", "Rows per page:",
// "Sort:"). "Sort:" alone reads at weight 500 — its delta composes on top.
const controlLabelStyle = css`
  font-size: 14px;
  color: var(--haze-color-text);
`;

// "Page N / M" — the shared pager info text plus the gap from the counts.
const pageInfo = cx(
  pageInfoStyle,
  css`
    margin: 0 16px;
  `,
);

const paginationSeparator = css`
  width: 1px;
  height: 24px;
  background: var(--haze-color-border);
  margin: 0 8px;
`;

const loadingContainer = css`
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 48px;
  color: var(--haze-color-text-muted);
`;

// The events loading pane's spinner: the shared border-spinner base
// (Button's spinnerBase export) at 24px, recolored to the table's muted
// track and primary-lit quadrant — identical 2px geometry and 1s linear
// cadence; only size and colors are site deltas.
const loadingSpinner = css`
  width: 24px;
  height: 24px;
  --spinner-track: var(--haze-color-border);
  --spinner-indicator: var(--haze-color-primary);
`;

// Enhanced sorting controls
const sortControlsContainer = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: var(--haze-color-bg-subtle);
  border-bottom: 1px solid var(--haze-color-border);
`;

const sortOptionsContainer = css`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const sortLabel = cx(
  controlLabelStyle,
  css`
    font-weight: 500;
  `,
);

const sortSelect = cx(
  fieldControlStyle,
  css`
    background: var(--haze-color-bg);
    color: var(--haze-color-text);
  `,
);

// The active state rides aria-pressed so it wins specificity over the base
// hover rule regardless of class order.
const sortDirectionButton = css`
  padding: 6px 8px;
  border: 1px solid var(--haze-color-border);
  background: var(--haze-color-bg);
  color: var(--haze-color-text);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  margin-left: 4px;

  &:hover {
    background: var(--haze-color-bg-muted);
  }

  &[aria-pressed='true'] {
    border-color: var(--haze-color-primary);
    background: var(--haze-color-primary-subtle);
    color: var(--haze-color-primary);
  }

  &:hover[aria-pressed='true'] {
    background: var(--haze-color-primary-subtle);
  }
`;

const pageSizeControl = css`
  display: flex;
  align-items: center;
  gap: 8px;
`;

// Page-size select shares the sort select's chrome entirely (the former
// byte-identical pageSizeSelect const merged into sortSelect).

const multiSortContainer = css`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
`;

const multiSortTag = css`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--haze-color-primary-subtle);
  color: var(--haze-color-primary);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
`;

const multiSortRemove = css`
  background: none;
  border: none;
  color: var(--haze-color-primary);
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
  padding: 0;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background: var(--haze-color-bg-muted);
  }
`;

const addSortButton = css`
  padding: 4px 8px;
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: 4px;
  color: var(--haze-color-text);
  cursor: pointer;
  font-size: 12px;

  &:hover {
    background: var(--haze-color-bg-muted);
  }
`;

const performanceInfoContainer = css`
  position: absolute;
  top: 100%;
  right: 0;
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: 6px;
  padding: 12px;
  box-shadow: var(--haze-shadow-lg);
  z-index: 1000;
  min-width: 200px;
  font-size: 12px;
`;

const performanceHeader = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 600;
  color: var(--haze-color-text);
`;

const performanceCloseButton = css`
  background: none;
  border: none;
  color: var(--haze-color-text-muted);
  cursor: pointer;
  font-size: 16px;
  padding: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background: var(--haze-color-bg-muted);
    color: var(--haze-color-text);
  }
`;

const performanceMetric = css`
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  color: var(--haze-color-text-muted);
`;

const performanceMetricLabel = css`
  color: var(--haze-color-text);
`;

// data-highlight marks the "good" metric values (fast sort, cache hit).
const performanceMetricValue = css`
  color: var(--haze-color-text);
  font-weight: normal;

  &[data-highlight] {
    color: var(--haze-color-success);
    font-weight: 600;
  }
`;

// Like sortDirectionButton, the active state rides aria-pressed.
const performanceToggleButton = css`
  padding: 4px 8px;
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: 4px;
  color: var(--haze-color-text-muted);
  cursor: pointer;
  font-size: 11px;
  margin-left: 8px;

  &:hover {
    background: var(--haze-color-bg-muted);
  }

  &[aria-pressed='true'] {
    background: var(--haze-color-info-subtle);
    border-color: var(--haze-color-info);
    color: var(--haze-color-info);
  }

  &:hover[aria-pressed='true'] {
    background: var(--haze-color-info-subtle);
  }
`;

// Helper functions — thin N/A-fallback wrappers over the shared
// truncateMiddle (local lead/tail preserved: addresses 6/4, hashes 10/8).
const formatAddress = (address: string): string =>
  address ? truncateMiddle(address, 6, 4) : 'N/A';

const formatTransactionHash = (hash: string): string =>
  hash ? truncateMiddle(hash, 10, 8) : 'N/A';

const formatValue = (value?: string): string => {
  if (!value) return 'N/A';
  try {
    const wei = BigInt(value);
    if (wei === 0n) return '0.000000 ETH';
    // Exact integer rendering at 6 displayed decimals: the old
    // `parseFloat(formatEther(...)).toFixed(6)` printed a NONZERO value
    // below 0.0000005 ETH as an exact "0.000000 ETH" (a 400,000,000-wei
    // withdrawal read as zero), collapsed distinct amounts past 2^53,
    // and switched to "1e+21" above that.
    const shown = formatFixedDecimals(wei, 18, 6);
    if (shown === null) return `${value} wei`;
    if (/^0*\.?0*$/.test(shown)) return '<0.000001 ETH';
    return `${shown} ETH`;
  } catch {
    return `${value} wei`;
  }
};

// Import optimized sorting and search utilities
import {
  optimizedSort,
  type SortConfig,
  type SortingPerformanceMetrics,
} from '../../utils/sorting-optimization';

const clientSideSort = (
  data: EventData[],
  sortConfigs: SortConfig[],
  primarySort: SortState,
): { sortedData: EventData[]; metrics: SortingPerformanceMetrics } => {
  // The sorter itself handles the no-config case (returns a copy labeled
  // 'no-sort'), so there is no separate early return here.

  // Prepare sort configurations for optimized sorter
  let finalSortConfigs: SortConfig[] = [];

  if (sortConfigs.length > 0) {
    // Use multi-sort configurations
    finalSortConfigs = sortConfigs.map(config => ({
      ...config,
      type: config.type ?? 'text',
    }));
  } else if (primarySort.field) {
    // Use primary sort configuration
    const sortOption = defaultSortOptions.find(opt => opt.key === primarySort.field);
    finalSortConfigs = [
      {
        key: primarySort.field,
        direction: primarySort.direction,
        type: sortOption?.type ?? 'text',
        priority: 0,
      },
    ];
  }

  // Generate cache key based on sort configurations AND the data itself.
  // Size+configs alone would make the module-global sorter cache return a
  // stale ordering for a refetched page whose row count and sort did not
  // change — e.g. a refreshKey bump that swapped in new events would keep
  // rendering the previous page's rows. Row identity plus the fields that
  // legitimately mutate on refetch (timestamp backfill, finality
  // promotion) keys the cache to the actual content.
  const cacheKey = `sort_${JSON.stringify({
    dataSize: data.length,
    configs: finalSortConfigs.map(c => ({ k: c.key, d: c.direction, t: c.type })),
    rows: data.map(
      row =>
        `${row.transactionHash}-${row.logIndex ?? ''}-${row.blockNumber}-${
          row.blockTimestamp ?? ''
        }-${row.isFinalized ?? ''}`,
    ),
  })}`;

  // Use optimized sorting; the returned metrics describe THIS sort (real
  // algorithm used, honest cache hit) and feed the perf panel directly.
  return optimizedSort(data, finalSortConfigs, {
    useCache: true,
    cacheKey,
    threshold: 1000, // Use optimized sorting for datasets over 1000 items
  });
};

// The events route caps pageSize at 1000 (routes/events.ts), and the
// client-side-sort threshold is the same 1000. A total above that cap
// therefore cannot be fetched whole, so the branch falls back to
// server-side pagination (see shouldUseClientSideSort) rather than
// promising a set it cannot hold.
const EVENT_CLIENT_SORT_MAX_PAGE_SIZE = 1000;

const paginateData = (data: EventData[], page: number, limit: number): EventData[] => {
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  return data.slice(startIndex, endIndex);
};

// Serialize the active (non-empty) ABI arg filters as the `argFilters` query
// param consumed by the events API; undefined when nothing is set.
const argFiltersQueryParam = (abiFilters?: Record<string, string>): string | undefined => {
  if (!abiFilters) return undefined;
  const active = Object.fromEntries(Object.entries(abiFilters).filter(([, value]) => value !== ''));
  return Object.keys(active).length > 0 ? JSON.stringify(active) : undefined;
};

// Local loading indicator. Not ui/LoadingState: that renders a vertical
// column around a 32px Skeleton pulse with a 200px floor, while this table
// shows a horizontal 24px border-spinner row — too different to swap
// without a visual change. The spinner itself is shared geometry: Button's
// spinnerBase plus this table's size/color deltas (see loadingSpinner).
// Both loading branches share this single component instead of
// duplicating the layout JSX.
function LoadingIndicator({ message }: { message: string }) {
  return (
    <div className={loadingContainer}>
      <div className={cx(spinnerBase, loadingSpinner)} />
      <span style={{ marginLeft: 12 }}>{message}</span>
    </div>
  );
}

// The raw-log disclosure body rendered inside a row's expandable detail row.
// Every field comes straight from the indexed contract_events row and is
// nullable: a row whose raw fields are all absent (written before raw-log
// storage, or supplied via initialEvents) degrades to the honest "not
// stored" note — never an error and never a fabricated value.
function RawLogDisclosure({
  event,
  chainId,
  emitterFallback,
}: {
  event: EventData;
  chainId: number;
  // The table's own contract: the emitting address fallback for rows that
  // do not carry their own contractAddress field.
  emitterFallback: string;
}) {
  const topics = [event.topic0, event.topic1, event.topic2, event.topic3].flatMap((value, index) =>
    typeof value === 'string' && value !== '' ? [{ label: `topic${index}`, value }] : [],
  );
  const data = typeof event.data === 'string' && event.data !== '' ? event.data : null;
  // The indexer records 'Unknown' when a log did not decode against the ABI —
  // exactly the rows whose topic0 benefits from a signature lookup.
  const eventName = typeof event.eventName === 'string' ? event.eventName : '';
  const decodedNameKnown = eventName !== '' && eventName !== 'Unknown';
  const emitter =
    typeof event.contractAddress === 'string' && event.contractAddress !== ''
      ? event.contractAddress
      : emitterFallback;

  if (topics.length === 0 && data === null) {
    return <p className={rawLogNote}>Raw log not stored for this row</p>;
  }

  return (
    <div className={rawLogDisclosure} data-testid="raw-log-disclosure">
      <div className={rawLogMetaRow}>
        <span className={rawLogMetaItem}>
          <span className={rawLogMetaLabel}>Block</span>{' '}
          <TypedLink to={`/chain/${chainId}/block/${event.blockNumber}`} className={rawLogLink}>
            {String(event.blockNumber)}
          </TypedLink>
        </span>
        <span className={rawLogMetaItem}>
          <span className={rawLogMetaLabel}>Tx</span>{' '}
          <TypedLink
            to={`/chain/${chainId}/tx/${event.transactionHash}`}
            className={rawLogLink}
            title={event.transactionHash}
          >
            {formatTransactionHash(event.transactionHash)}
          </TypedLink>
        </span>
        <span className={rawLogMetaItem}>
          <span className={rawLogMetaLabel}>Log index</span>{' '}
          {typeof event.logIndex === 'number' ? (
            event.logIndex
          ) : (
            <span className={notStoredValue}>not stored</span>
          )}
        </span>
        <span className={rawLogMetaItem}>
          <span className={rawLogMetaLabel}>Address</span>{' '}
          <span className={rawLogHexValue}>{emitter}</span>
          <CopyButton text={emitter} label="Copy address" className={rawLogCopyButton} />
        </span>
      </div>

      <div>
        <div className={rawLogSectionLabel}>Topics</div>
        {topics.length > 0 ? (
          topics.map(topic => (
            <div key={topic.label} className={rawLogTopicRow}>
              <span className={rawLogTopicLabel}>{topic.label}</span>
              <span className={rawLogHexValue}>{topic.value}</span>
              {topic.label === 'topic0' &&
                (decodedNameKnown ? (
                  <span className={rawLogChip}>{eventName}</span>
                ) : (
                  <TypedLink
                    to="/signatures"
                    search={{ q: topic.value }}
                    className={rawLogLookupChip}
                    title={`Look up signature for ${topic.value}`}
                  >
                    Look up topic0
                  </TypedLink>
                ))}
            </div>
          ))
        ) : (
          <span className={notStoredValue}>not stored</span>
        )}
      </div>

      <div>
        <div className={rawLogSectionLabel}>Data</div>
        {data !== null ? (
          <div className={rawLogDataRow}>
            <pre className={rawLogPre} data-testid="raw-log-data">
              {data}
            </pre>
            <CopyButton text={data} label="Copy data" className={rawLogCopyButton} />
          </div>
        ) : (
          <span className={notStoredValue}>not stored</span>
        )}
      </div>
    </div>
  );
}

// Memoized table row: the toggle cell, the data cells, and the lazy
// disclosure row, exactly as the former inline map body rendered them.
// React.memo over {event, rowKey, chainId, emitterFallback, isExpanded,
// onToggle} means a single disclosure toggle re-renders only that row —
// event objects keep their identity across renders (expandedRawLogs is
// separate state) and onToggle (toggleRawLog) is a stable useCallback.
export type EventRowProps = {
  event: EventData;
  // Row identity (tx hash + log index), doubling as the disclosure key.
  rowKey: string;
  chainId: number;
  // Rendered as the emitter fallback when the row lacks contractAddress.
  emitterFallback: Address;
  isExpanded: boolean;
  onToggle: (key: string) => void;
};

export const EventRow = React.memo(({
  event,
  rowKey,
  chainId,
  emitterFallback,
  isExpanded,
  onToggle,
}: EventRowProps) => {
  const toggleLabel = `Raw log for block ${event.blockNumber}${
    typeof event.logIndex === 'number' ? `, log index ${event.logIndex}` : ''
  }`;

  return (
    <React.Fragment>
      <tr>
        <td className={rawLogToggleCell}>
          <button
            type="button"
            className={rawLogToggleButton}
            aria-expanded={isExpanded}
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={() => onToggle(rowKey)}
          >
            <svg
              className={cx(rawLogChevron, isExpanded && rawLogChevronExpanded)}
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
          </button>
        </td>
        <td className={tableCell}>{event.blockNumber}</td>
        <td className={cx(tableCell, timestampCell)}>
          {formatDateTime(event.blockTimestamp)}
        </td>
        <td className={cx(tableCell, eventNameCell)}>
          {event.eventName}
          {event.isFinalized === false && <span className={unfinalizedBadge}>unfinalized</span>}
        </td>
        <td className={cx(tableCell, monoStyle)}>
          {event.from ? (
            <a
              href={`/chain/${chainId}/address/${event.from}`}
              style={{ color: 'var(--haze-color-primary)', textDecoration: 'none' }}
            >
              {formatAddress(event.from)}
            </a>
          ) : (
            'N/A'
          )}
        </td>
        <td className={cx(tableCell, monoStyle)}>
          {event.to ? (
            <a
              href={`/chain/${chainId}/address/${event.to}`}
              style={{ color: 'var(--haze-color-primary)', textDecoration: 'none' }}
            >
              {formatAddress(event.to)}
            </a>
          ) : (
            'N/A'
          )}
        </td>
        <td className={cx(tableCell, valueCell)}>{formatValue(event.value)}</td>
        <td className={cx(tableCell, monoStyle)}>
          <a
            href={`/chain/${chainId}/tx/${event.transactionHash}`}
            style={{ color: 'var(--haze-color-primary)', textDecoration: 'none' }}
          >
            {formatTransactionHash(event.transactionHash)}
          </a>
        </td>
      </tr>
      {/* Lazy disclosure: the detail row only mounts while the
          row is expanded. */}
      {isExpanded && (
        <tr>
          <td colSpan={8} className={rawLogRowCell}>
            <RawLogDisclosure event={event} chainId={chainId} emitterFallback={emitterFallback} />
          </td>
        </tr>
      )}
    </React.Fragment>
  );
});

// Default sort options
// SortOption.key must name a REAL EventData field: the sorter's
// extractValue does a literal `obj[key]` walk, so a key that does not
// exist on a row reads undefined for every row and compares equal to
// every other — the column silently stops sorting. These keys used to be
// snake_case (`block_timestamp`, `block_number`, `event_name`,
// `transaction_hash`) while rows are camelCase EventData, so four of the
// five columns — including the default 'Time' — were no-ops in both
// directions. They now name the row fields they claim to sort.
const defaultSortOptions: SortOption[] = [
  {
    key: 'blockTimestamp',
    label: 'Time',
    type: 'timestamp',
    defaultDirection: 'desc',
    description: 'Sort by block time',
  },
  {
    key: 'blockNumber',
    label: 'Block',
    type: 'numeric',
    defaultDirection: 'desc',
    description: 'Sort by block number',
  },
  {
    key: 'eventName',
    label: 'Event Name',
    type: 'text',
    defaultDirection: 'asc',
    description: 'Sort by event name',
  },
  {
    key: 'from',
    label: 'From',
    type: 'address',
    defaultDirection: 'asc',
    description: 'Sort by sender address',
  },
  {
    key: 'to',
    label: 'To',
    type: 'address',
    defaultDirection: 'asc',
    description: 'Sort by recipient address',
  },
  {
    key: 'value',
    label: 'Value',
    type: 'numeric',
    defaultDirection: 'desc',
    description: 'Sort by transaction value',
  },
  {
    key: 'transactionHash',
    label: 'Tx Hash',
    type: 'text',
    defaultDirection: 'asc',
    description: 'Sort by transaction hash',
  },
];

const pageSizeOptions = [10, 20, 50, 100, 200];

// Mirrors EXPORT_MAX_ROWS in src/services/EventExportService.ts, enforced by
// the /events/export route in src/routes/events.ts (which 400s above it).
// Keep both values in sync. The backend 400 remains the backstop for cases
// where the client-side total is unknown.
const EXPORT_MAX_ROWS = 100_000;

// Main component
export const EventTable: React.FC<EventTableProps> = ({
  chainId,
  contractAddress,
  initialEvents = [],
  className,
  availableSortOptions = defaultSortOptions,
  defaultPageSize = 50,
  enableMultiSort = true,
  enableCustomPageSize = true,
  enableClientSideSort = true,
  clientSideSortThreshold = 1000,
  abiEvents = [],
  enableDynamicFiltering = false,
  onFiltersChange,
  refreshKey = 0,
}) => {
  const [allEvents, setAllEvents] = useState<EventData[]>(initialEvents);
  const [events, setEvents] = useState<EventData[]>(initialEvents);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    limit: defaultPageSize,
    total: initialEvents.length,
    hasMore: false,
  });
  const [filters, _setFilters] = useState<FilterState>({});
  const [sort, setSort] = useState<SortState>({
    field: 'blockTimestamp',
    direction: 'desc',
  });

  // Enhanced sorting state
  const [multiSort, setMultiSort] = useState<SortConfig[]>([]);
  const [currentSortField, setCurrentSortField] = useState<string>('blockTimestamp');
  const [showAdvancedSort, setShowAdvancedSort] = useState(false);

  // Enhanced pagination state
  const [pageInput, setPageInput] = useState<string>('');
  const [totalPages, setTotalPages] = useState<number>(1);

  // Performance monitoring state — per-sort facts straight from the sorter's
  // metrics (no global history: the deleted SortingPerformanceMonitor kept a
  // process-lifetime buffer whose averages mixed pages and sessions).
  const [sortingMetrics, setSortingMetrics] = useState<{
    sortTime: number;
    dataSize: number;
    algorithm: string;
    cacheHit: boolean;
  } | null>(null);
  const [showPerformanceInfo, setShowPerformanceInfo] = useState(false);

  // Enhanced filtering state
  const [dynamicFilters, setDynamicFilters] = useState<EventFilterState>({});

  // Raw-log disclosure: which rows are expanded. Detail rows render only
  // while their key is in the set (lazy), and keys survive sort/pagination
  // re-orders because they are the row identity (tx hash + log index).
  const [expandedRawLogs, setExpandedRawLogs] = useState<ReadonlySet<string>>(new Set());

  const toggleRawLog = useCallback((key: string) => {
    setExpandedRawLogs(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Determine if we should use client-side sorting
  // Use pagination.total (server-reported count) instead of allEvents.length (loaded data)
  // This prevents incorrect total count when only a page of data is loaded
  //
  // The branch also has to be a set it can actually HOLD: it paginates and
  // sorts locally, so the whole reported total must fit in one server
  // response. The events route caps pageSize at 1000, so a total above
  // that can never be fetched whole — that case stays server-paginated
  // rather than silently rendering an unreachable last page.
  const shouldUseClientSideSort =
    enableClientSideSort &&
    pagination.total > 0 &&
    pagination.total <= clientSideSortThreshold &&
    pagination.total <= EVENT_CLIENT_SORT_MAX_PAGE_SIZE;

  // Request-race guard (util/useGenerationGuard): every fetchEvents call
  // CLAIMS a fresh monotonic id, and each async setState below is gated on
  // the id still being current. When a slower earlier request (previous
  // page, old sort) resolves after a newer one, its response is discarded
  // instead of clobbering rows that no longer match the pagination/sort
  // state. The hook's unmount cleanup invalidates in-flight responses so
  // they never setState on a dead component.
  const requestGuard = useGenerationGuard();

  // API call function
  const fetchEvents = useCallback(
    async (cursor?: string, targetPage?: number, totalOverride?: number) => {
      const requestId = requestGuard.claim();
      setLoading(true);
      setError(null);

      try {
        const currentPage = targetPage ?? pagination.page;
        // The client-side branch paginates and sorts the rows it HOLDS,
        // and its threshold is the server-reported total — so the request
        // must cover that whole set. Asking for `pagination.limit` (50)
        // left `allEvents` holding one truncated server page while
        // `total` reported more: with 60 events the footer read
        // "Page 1 / 2", Next only bumped the page number, and page 2
        // sliced rows 50..60 out of a 50-row array — an empty page whose
        // last 10 events were unreachable. Server-side pagination keeps
        // asking for one page, which is all it renders.
        const pageSize = totalOverride ?? (shouldUseClientSideSort
          ? Math.min(Math.max(pagination.total, 1), EVENT_CLIENT_SORT_MAX_PAGE_SIZE)
          : pagination.limit);
        const queryParams = new URLSearchParams({
          page: currentPage.toString(),
          pageSize: pageSize.toString(),
          sort: sort.direction,
          sortBy: sort.field,
        });

        // Add multi-sort support
        if (enableMultiSort && multiSort.length > 0) {
          queryParams.set(
            'multiSort',
            JSON.stringify(
              multiSort.map(s => ({
                field: s.key,
                direction: s.direction,
                type: s.type,
                priority: s.priority,
              })),
            ),
          );
        }

        if (cursor) {
          queryParams.set('cursor', cursor);
        }

        // Add basic filters
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== undefined && value !== '') {
            queryParams.set(key, value.toString());
          }
        });

        // Dynamic filters: eventName + block range ride along as dedicated
        // params, and ABI arg filters are serialized as `argFilters` JSON so
        // matching runs server-side over the full indexed set instead of only
        // the loaded page.
        if (dynamicFilters.eventName) {
          queryParams.set('eventName', dynamicFilters.eventName);
        }
        if (dynamicFilters.fromBlock !== undefined) {
          queryParams.set('fromBlock', dynamicFilters.fromBlock.toString());
        }
        if (dynamicFilters.toBlock !== undefined) {
          queryParams.set('toBlock', dynamicFilters.toBlock.toString());
        }
        const argFilters = argFiltersQueryParam(dynamicFilters.abiFilters);
        if (argFilters) {
          queryParams.set('argFilters', argFilters);
        }

        const url = `/api/chains/${chainId}/contracts/${contractAddress}/events?${queryParams}`;

        const data = await get<{
          events: Array<{
            decodedArgs?: string | Record<string, unknown>;
            blockTimestamp?: number | string | null;
            isFinalized?: boolean | null;
            [key: string]: unknown;
          }>;
          total?: number;
          page?: number;
          totalPages?: number;
        }>(url);

        // Superseded by a newer request (or unmounted): discard instead of
        // rendering rows that no longer match the current pagination/sort.
        if (!requestGuard.isCurrent(requestId)) return;

        const normalizedEvents = (data.events ?? []).map(e => {
          const args =
            typeof e.decodedArgs === 'string'
              ? (() => {
                  try {
                    return JSON.parse(e.decodedArgs) as Record<string, unknown>;
                  } catch {
                    return {};
                  }
                })()
              : (e.decodedArgs ?? {});
          // null (timestamp never fetched) stays null and renders as a placeholder
          const blockTimestamp =
            typeof e.blockTimestamp === 'number'
              ? new Date(e.blockTimestamp * 1000).toISOString()
              : (e.blockTimestamp ?? null);
          return { ...args, ...e, blockTimestamp } as EventData;
        });

        const reportedTotal = data.total ?? data.events.length;
        // The client-side branch can only paginate the rows it HOLDS, and
        // the total is only known from this response — the mount request
        // could not have been sized by it. When the answer says the set
        // spans more than one page and the whole set fits the branch's
        // threshold, re-issue at full width exactly once so `allEvents`
        // really is the set the footer counts. A short first page
        // (reportedTotal > pageSize) is the trigger; the widened request
        // returns pageSize === reportedTotal, so this cannot loop.
        if (
          !cursor &&
          targetPage === undefined &&
          currentPage === 1 &&
          enableClientSideSort &&
          reportedTotal > pageSize &&
          reportedTotal <= Math.min(clientSideSortThreshold, EVENT_CLIENT_SORT_MAX_PAGE_SIZE)
        ) {
          setPagination(prev => ({ ...prev, total: reportedTotal }));
          void fetchEvents(undefined, 1, reportedTotal);
          return;
        }

        if (cursor) {
          setAllEvents(prev => [...prev, ...normalizedEvents]);
        } else {
          setAllEvents(normalizedEvents);
        }

        setPagination(prev => ({
          ...prev,
          total: reportedTotal,
          hasMore: (data.page ?? 1) < (data.totalPages ?? 1),
          totalPages: data.totalPages,
        }));
      } catch (err) {
        if (!requestGuard.isCurrent(requestId)) return;
        console.error('Failed to fetch events:', err);
        setError(errorMessage(err, 'Failed to load events'));
      } finally {
        // Only the newest request owns the loading flag: a superseded
        // request clearing it would un-disable controls mid-flight.
        if (requestGuard.isCurrent(requestId)) {
          setLoading(false);
        }
      }
    },
    [
      chainId,
      contractAddress,
      // Referentially stable (useGenerationGuard memoizes its api object),
      // listed for exhaustive-deps like the values above.
      requestGuard,
      pagination.page,
      pagination.limit,
      // The client-side branch's page size is derived from the reported
      // total, and the widened re-issue reads the threshold/cap, so all
      // three must be able to re-create this request.
      pagination.total,
      shouldUseClientSideSort,
      clientSideSortThreshold,
      sort,
      filters,
      enableMultiSort,
      multiSort,
      dynamicFilters,
    ],
  );

  // Initial load + refresh when refreshKey changes
  useEffect(() => {
    fetchEvents();
  }, [chainId, contractAddress, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Limit/sort changes refetch — except on mount, where the initial-load
  // effect above already issued the identical request (initialEvents
  // pre-populating allEvents makes the gate below pass, which used to
  // produce two identical fetches on mount).
  const skipFirstSortEffectRef = useRef(true);
  useEffect(() => {
    if (skipFirstSortEffectRef.current) {
      skipFirstSortEffectRef.current = false;
      return;
    }
    if (allEvents.length > 0) {
      fetchEvents();
    }
  }, [pagination.limit, sort.field, sort.direction]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enhanced sorting handlers
  const handleSort = (field: string) => {
    const newDirection = sort.field === field && sort.direction === 'asc' ? 'desc' : 'asc';
    setSort({ field, direction: newDirection });
    setCurrentSortField(field);

    if (!shouldUseClientSideSort) {
      // For server-side sorting, reset and fetch new data
      setEvents([]);
      setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
      fetchEvents(undefined, 1);
    } else {
      // For client-side sorting, just reset to first page
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  };

  const handleSortFieldChange = (field: string) => {
    setCurrentSortField(field);
    const sortOption = availableSortOptions.find(option => option.key === field);
    const direction = sortOption?.defaultDirection ?? 'asc';
    setSort({ field, direction });

    if (!shouldUseClientSideSort) {
      // For server-side sorting, reset and fetch new data
      setEvents([]);
      setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
      fetchEvents(undefined, 1);
    } else {
      // For client-side sorting, just reset to first page
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  };

  const handleSortDirectionChange = (direction: 'asc' | 'desc') => {
    setSort(prev => ({ ...prev, direction }));

    if (!shouldUseClientSideSort) {
      // For server-side sorting, reset and fetch new data
      setEvents([]);
      setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
      fetchEvents(undefined, 1);
    } else {
      // For client-side sorting, just reset to first page
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  };

  const handlePageSizeChange = (newLimit: number) => {
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));

    if (!shouldUseClientSideSort) {
      // For server-side pagination, fetch new data
      setEvents([]);
      fetchEvents(undefined, 1);
    }
    // For client-side pagination, the useEffect will handle the update
  };

  const addToMultiSort = () => {
    if (!enableMultiSort) return;

    const sortOption = availableSortOptions.find(option => option.key === currentSortField);
    if (!sortOption) return;

    const existingIndex = multiSort.findIndex(s => s.key === currentSortField);
    let newMultiSort: SortConfig[];

    if (existingIndex >= 0) {
      // Toggle direction if already exists
      newMultiSort = [...multiSort];
      newMultiSort[existingIndex] = {
        ...newMultiSort[existingIndex],
        direction: newMultiSort[existingIndex].direction === 'asc' ? 'desc' : 'asc',
      };
    } else {
      // Add new sort
      const newSortConfig: SortConfig = {
        key: currentSortField,
        direction: sortOption.defaultDirection ?? 'asc',
        type: sortOption.type,
        priority: multiSort.length,
      };
      newMultiSort = [...multiSort, newSortConfig];
    }

    setMultiSort(newMultiSort);
  };

  const removeFromMultiSort = (key: string) => {
    setMultiSort(prev => prev.filter(s => s.key !== key));
  };

  const clearMultiSort = () => {
    setMultiSort([]);
  };

  const applyMultiSort = () => {
    if (multiSort.length === 0) return;

    // Use the highest priority sort as the primary sort
    const primarySort = multiSort.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))[0];
    setSort({ field: primarySort.key, direction: primarySort.direction });

    if (!shouldUseClientSideSort) {
      // For server-side sorting, reset and fetch new data
      setEvents([]);
      setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
      fetchEvents(undefined, 1);
    } else {
      // For client-side sorting, just reset to first page
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  };

  // Enhanced pagination handlers
  const handleNextPage = () => {
    if (shouldUseClientSideSort) {
      // Client-side pagination - just update page state
      const nextPage = pagination.page + 1;
      setPagination(prev => ({ ...prev, page: nextPage }));
    } else {
      // Server-side pagination
      if (pagination.nextCursor) {
        fetchEvents(pagination.nextCursor);
      } else {
        const nextPage = pagination.page + 1;
        setPagination(prev => ({ ...prev, page: nextPage }));
        setEvents([]);
        fetchEvents(undefined, nextPage);
      }
    }
  };

  const handlePrevPage = () => {
    if (shouldUseClientSideSort) {
      // Client-side pagination - just update page state
      const prevPage = Math.max(1, pagination.page - 1);
      setPagination(prev => ({ ...prev, page: prevPage }));
    } else {
      // Server-side pagination
      const prevPage = Math.max(1, pagination.page - 1);
      setPagination(prev => ({ ...prev, page: prevPage }));
      setEvents([]);
      fetchEvents(undefined, prevPage);
    }
  };

  const handleFirstPage = () => {
    if (shouldUseClientSideSort) {
      // Client-side pagination - just update page state
      setPagination(prev => ({ ...prev, page: 1 }));
    } else {
      // Server-side pagination
      setPagination(prev => ({ ...prev, page: 1 }));
      setEvents([]);
      fetchEvents(undefined, 1);
    }
  };

  const handleLastPage = () => {
    if (shouldUseClientSideSort) {
      // Client-side pagination - just update page state
      if (totalPages > 0) {
        setPagination(prev => ({ ...prev, page: totalPages }));
      }
    } else {
      // Server-side pagination
      if (totalPages > 0) {
        setPagination(prev => ({ ...prev, page: totalPages }));
        setEvents([]);
        fetchEvents(undefined, totalPages);
      }
    }
  };

  const handleGoToPage = () => {
    // Strict parse: a page is an addressable offset, and parseInt's prefix
    // acceptance meant '2e' jumped to page 2 (or '3abc' to page 3) —
    // silently showing a page the user never asked for.
    const pageNumber = parseStrictInteger(pageInput);
    if (pageNumber !== null && pageNumber >= 1 && pageNumber <= totalPages) {
      setPagination(prev => ({ ...prev, page: pageNumber }));

      if (!shouldUseClientSideSort) {
        // For server-side pagination, fetch new data
        setEvents([]);
        fetchEvents(undefined, pageNumber);
      }
      setPageInput('');
    }
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value);
  };

  const handlePageInputKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleGoToPage();
    }
  };

  // Calculate pagination info - FIXED to avoid infinite loop
  const calculatePaginationInfo = useCallback(() => {
    const totalPagesCount = Math.ceil(pagination.total / pagination.limit);
    const startIndex = (pagination.page - 1) * pagination.limit + 1;
    const endIndex = Math.min(pagination.page * pagination.limit, pagination.total);

    setTotalPages(totalPagesCount);
    // Update pagination info in state
    setPagination(prev => ({
      ...prev,
      startIndex,
      endIndex,
    }));
  }, [pagination.total, pagination.limit, pagination.page]);

  useEffect(() => {
    calculatePaginationInfo();
  }, [calculatePaginationInfo]);

  useEffect(() => {
    if (shouldUseClientSideSort) {
      // Arg filtering runs server-side (argFilters query param); this block
      // only sorts/paginates the loaded rows for display. The server-reported
      // pagination total stays authoritative.
      const sortResult = clientSideSort(allEvents, multiSort, sort);
      const paginatedData = paginateData(
        sortResult.sortedData,
        pagination.page,
        pagination.limit,
      );

      setEvents(paginatedData);
      setSortingMetrics({
        // The sorter's own timing of this sort, plus its honest algorithm
        // label and cache-hit flag — never a wall-clock guess.
        sortTime: sortResult.metrics.executionTime,
        dataSize: sortResult.sortedData.length,
        algorithm: sortResult.metrics.algorithmUsed,
        cacheHit: sortResult.metrics.cacheHit,
      });
    } else {
      setEvents(allEvents);
      setSortingMetrics(null);
    }
  }, [allEvents, sort, multiSort, pagination.page, pagination.limit, shouldUseClientSideSort]);

  const handleRetry = () => {
    setError(null);
    fetchEvents();
  };

  // Enhanced filtering handlers
  const handleFilterChange = useCallback(
    (newFilters: EventFilterState) => {
      setDynamicFilters(newFilters);
      onFiltersChange?.(newFilters);
    },
    [onFiltersChange],
  );

  const handleFilterApply = useCallback(
    (appliedFilters: EventFilterState) => {
      setDynamicFilters(appliedFilters);
      onFiltersChange?.(appliedFilters);

      // Reset pagination and refetch
      setPagination(prev => ({ ...prev, page: 1, nextCursor: undefined }));
      fetchEvents(undefined, 1);
    },
    [onFiltersChange, fetchEvents],
  );

  // CSV export link carrying the same filters as the table query. The backend
  // replies with Content-Disposition, so the browser saves it as
  // events-{chainId}-{address}-{timestamp}.csv.
  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    if (dynamicFilters.eventName) {
      params.set('eventName', dynamicFilters.eventName);
    }
    if (dynamicFilters.fromBlock !== undefined) {
      params.set('fromBlock', dynamicFilters.fromBlock.toString());
    }
    if (dynamicFilters.toBlock !== undefined) {
      params.set('toBlock', dynamicFilters.toBlock.toString());
    }
    const argFilters = argFiltersQueryParam(dynamicFilters.abiFilters);
    if (argFilters) {
      params.set('argFilters', argFilters);
    }
    const query = params.toString();
    return `${getApiBase()}/api/chains/${chainId}/contracts/${contractAddress}/events/export${query ? `?${query}` : ''}`;
  }, [chainId, contractAddress, dynamicFilters]);

  // The server-reported total of the current filtered query (set by every
  // fetchEvents response) drives the export preflight. When the response
  // carried no total, pagination.total falls back to the loaded page size —
  // far below the cap — so the button stays enabled and the backend 400
  // remains the backstop, per design.
  const exportExceedsLimit = pagination.total > EXPORT_MAX_ROWS;

  // Degraded mode: with no discovered backend the export href would be a
  // broken same-origin relative link — disable the button instead.
  const backendConnected = getApiBase() !== '';

  // Empty-state honesty: with filters applied, an empty page means nothing
  // matched them; without any, it means nothing is indexed (yet). Different
  // problems, different guidance.
  const hasActiveFilters =
    dynamicFilters.eventName !== undefined ||
    dynamicFilters.fromBlock !== undefined ||
    dynamicFilters.toBlock !== undefined ||
    argFiltersQueryParam(dynamicFilters.abiFilters) !== undefined;

  // Render loading state
  if (loading && events.length === 0) {
    return (
      <div className={cx(tableContainer, className)}>
        <LoadingIndicator message="Loading events..." />
      </div>
    );
  }

  // Render error state
  if (error && events.length === 0) {
    return (
      <div className={cx(tableContainer, className)}>
        <ErrorState message={`Failed to load events: ${error}`} onRetry={handleRetry} />
      </div>
    );
  }

  return (
    <div className={cx(tableContainer, className)}>
      {enableDynamicFiltering && abiEvents.length > 0 && (
        <EventFilterPanel
          abiEvents={abiEvents}
          initialFilters={dynamicFilters}
          onApply={handleFilterApply}
          onFiltersChange={handleFilterChange}
          disabled={loading}
        />
      )}

      {events.length === 0 && !loading ? (
        <EmptyState message="No events found">
          <div>
            {hasActiveFilters
              ? 'No events match the current filters.'
              : 'No events indexed in this range yet.'}
          </div>
        </EmptyState>
      ) : (
        <>
          {/* Enhanced Sorting Controls */}
          <div className={sortControlsContainer}>
            <div className={sortOptionsContainer}>
              <span className={sortLabel}>Sort:</span>
              <select
                className={sortSelect}
                value={currentSortField}
                onChange={e => handleSortFieldChange(e.target.value)}
              >
                {availableSortOptions.map(option => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                className={sortDirectionButton}
                aria-pressed={sort.direction === 'desc'}
                onClick={() => handleSortDirectionChange(sort.direction === 'asc' ? 'desc' : 'asc')}
              >
                {sort.direction === 'asc' ? '↑ Ascending' : '↓ Descending'}
              </button>

              {enableMultiSort && (
                <>
                  <button className={addSortButton} onClick={addToMultiSort}>
                    + Add to multi-sort
                  </button>
                  <button
                    className={addSortButton}
                    onClick={() => setShowAdvancedSort(!showAdvancedSort)}
                  >
                    {showAdvancedSort ? 'Hide' : 'Show'} advanced sort
                  </button>
                </>
              )}
            </div>

            {enableCustomPageSize && (
              <div className={pageSizeControl}>
                <span className={controlLabelStyle}>Rows per page:</span>
                <select
                  className={sortSelect}
                  value={pagination.limit}
                  onChange={e => handlePageSizeChange(Number(e.target.value))}
                >
                  {pageSizeOptions.map(size => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Performance Info Toggle and Display */}
            {shouldUseClientSideSort && sortingMetrics && (
              <div style={{ position: 'relative' }}>
                <button
                  className={performanceToggleButton}
                  aria-pressed={showPerformanceInfo}
                  onClick={() => setShowPerformanceInfo(!showPerformanceInfo)}
                >
                  Perf: {sortingMetrics.sortTime.toFixed(1)}
                  ms
                </button>

                {showPerformanceInfo && (
                  <div className={performanceInfoContainer}>
                    <div className={performanceHeader}>
                      Sorting performance
                      <button
                        className={performanceCloseButton}
                        onClick={() => setShowPerformanceInfo(false)}
                      >
                        ×
                      </button>
                    </div>

                    <div className={performanceMetric}>
                      <span className={performanceMetricLabel}>Rows:</span>
                      <span className={performanceMetricValue}>
                        {formatNumber(sortingMetrics.dataSize ?? 0)}
                      </span>
                    </div>

                    <div className={performanceMetric}>
                      <span className={performanceMetricLabel}>Algorithm:</span>
                      <span className={performanceMetricValue}>{sortingMetrics.algorithm}</span>
                    </div>

                    <div className={performanceMetric}>
                      <span className={performanceMetricLabel}>Sort time:</span>
                      <span
                        className={performanceMetricValue}
                        data-highlight={sortingMetrics.sortTime < 10 || undefined}
                      >
                        {sortingMetrics.sortTime.toFixed(2)} ms
                      </span>
                    </div>

                    <div className={performanceMetric}>
                      <span className={performanceMetricLabel}>Cache hit:</span>
                      <span
                        className={performanceMetricValue}
                        data-highlight={sortingMetrics.cacheHit || undefined}
                      >
                        {sortingMetrics.cacheHit ? 'Yes' : 'No'}
                      </span>
                    </div>

                    <div className={performanceMetric}>
                      <span className={performanceMetricLabel}>Sort mode:</span>
                      <span className={performanceMetricValue} data-highlight>
                        Client-side
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Advanced Multi-Sort Controls */}
          {showAdvancedSort && enableMultiSort && multiSort.length > 0 && (
            <div
              className={sortControlsContainer}
              style={{
                background: 'var(--haze-color-bg-muted)',
                paddingTop: '8px',
                paddingBottom: '8px',
              }}
            >
              <div>
                <span className={sortLabel}>Multi-sort:</span>
                <div className={multiSortContainer}>
                  {multiSort.map(sortConfig => {
                    const option = availableSortOptions.find(opt => opt.key === sortConfig.key);
                    return (
                      <div className={multiSortTag} key={sortConfig.key}>
                        {option?.label ?? sortConfig.key} (
                        {sortConfig.direction === 'asc' ? '↑' : '↓'})
                        <button
                          className={multiSortRemove}
                          onClick={() => removeFromMultiSort(sortConfig.key)}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                  <button className={addSortButton} onClick={clearMultiSort}>
                    Clear all
                  </button>
                  <button className={addSortButton} onClick={applyMultiSort}>
                    Apply multi-sort
                  </button>
                </div>
              </div>
            </div>
          )}

          <table className={tableStyle}>
            <thead className={tableHeader}>
              <tr>
                <th scope="col" className={tableHeaderCell} aria-label="Raw log" />
                <th
                  className={cx(tableHeaderCell, tableHeaderCellSortable)}
                  onClick={() => handleSort('blockNumber')}
                >
                  Block
                  <span className={sortIndicator}>
                    {sort.field === 'blockNumber' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </th>
                <th
                  className={cx(tableHeaderCell, tableHeaderCellSortable)}
                  onClick={() => handleSort('blockTimestamp')}
                >
                  Time
                  <span className={sortIndicator}>
                    {sort.field === 'blockTimestamp'
                      ? sort.direction === 'asc'
                        ? '↑'
                        : '↓'
                      : '↕'}
                  </span>
                </th>
                <th
                  className={cx(tableHeaderCell, tableHeaderCellSortable)}
                  onClick={() => handleSort('eventName')}
                >
                  Event
                  <span className={sortIndicator}>
                    {sort.field === 'eventName' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </th>
                <th className={tableHeaderCell}>From</th>
                <th className={tableHeaderCell}>To</th>
                <th className={tableHeaderCell}>Value</th>
                <th className={tableHeaderCell}>Tx Hash</th>
              </tr>
            </thead>
            <tbody className={tableBody}>
              {events.map((event, index) => {
                // Row identity for the disclosure: tx hash + log index is the
                // primary key of the indexed row (index only as a fallback for
                // rows supplied without a logIndex).
                const rowKey = `${event.transactionHash}-${event.logIndex ?? index}`;
                return (
                  <EventRow
                    key={rowKey}
                    event={event}
                    rowKey={rowKey}
                    chainId={chainId}
                    emitterFallback={contractAddress}
                    isExpanded={expandedRawLogs.has(rowKey)}
                    onToggle={toggleRawLog}
                  />
                );
              })}
            </tbody>
          </table>

          {/* Loading indicator for pagination */}
          {loading && events.length > 0 && <LoadingIndicator message="Loading more events..." />}

          {/* Error overlay for pagination errors */}
          {error && events.length > 0 && (
            <ErrorState message="Error loading more events" onRetry={handleRetry} />
          )}

          {/* Enhanced Pagination controls */}
          <div className={paginationContainer}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div className={pageInfoStyle}>
                Showing {pagination.startIndex ?? 1}-{pagination.endIndex ?? events.length} of{' '}
                {pagination.total} events
              </div>

              {totalPages > 1 && (
                <div className={pageInfo}>
                  Page {pagination.page} / {totalPages}
                </div>
              )}
            </div>

            <div className={paginationControls}>
              <button
                className={paginationButton}
                onClick={handleFirstPage}
                disabled={pagination.page <= 1 || loading}
                title="First page"
              >
                ⇤
              </button>

              <button
                className={paginationButton}
                onClick={handlePrevPage}
                disabled={pagination.page <= 1 || loading}
                title="Previous page"
              >
                ←
              </button>

              {totalPages > 1 && (
                <>
                  <div className={paginationSeparator} />

                  <div className={goToPageContainer}>
                    <span className={controlLabelStyle}>Go to:</span>
                    <input
                      className={paginationInput}
                      type="number"
                      value={pageInput}
                      onChange={handlePageInputChange}
                      onKeyPress={handlePageInputKeyPress}
                      placeholder={pagination.page.toString()}
                      min={1}
                      max={totalPages}
                    />
                    <button
                      className={paginationButton}
                      onClick={handleGoToPage}
                      disabled={!pageInput || loading}
                    >
                      Go
                    </button>
                  </div>

                  <div className={paginationSeparator} />
                </>
              )}

              <button
                className={paginationButton}
                onClick={handleNextPage}
                disabled={(!pagination.hasMore && pagination.page >= totalPages) || loading}
                title="Next page"
              >
                →
              </button>

              {totalPages > 1 && (
                <button
                  className={paginationButton}
                  onClick={handleLastPage}
                  disabled={pagination.page >= totalPages || loading}
                  title="Last page"
                >
                  ⇥
                </button>
              )}

              {pagination.total > 0 && (
                <>
                  {/* Export preflight: the query total is known here, so
                      refuse above the cap up front instead of letting the
                      click hit the backend 400. */}
                  {exportExceedsLimit && (
                    <span className={exportLimitNotice}>
                      Too many rows ({formatNumber(pagination.total)}) — narrow the block range
                      or filters and export in chunks (limit 100,000 rows).
                    </span>
                  )}
                  {!backendConnected && (
                    <span className={exportLimitNotice}>
                      Backend not connected — export unavailable.
                    </span>
                  )}
                  <a
                    className={exportCsvButton}
                    {...(exportExceedsLimit || !backendConnected
                      ? {}
                      : { href: exportHref, download: true })}
                    aria-disabled={exportExceedsLimit || !backendConnected ? true : undefined}
                  >
                    Export CSV
                  </a>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default EventTable;
