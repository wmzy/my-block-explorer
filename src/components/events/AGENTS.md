# Event Components

React components for contract event display and indexing management.

## COMPONENTS

| File                     | Lines | Purpose                                               |
| ------------------------ | ----- | ----------------------------------------------------- |
| EventTable.tsx           | ~2300 | Full-featured table with sorting/filtering/pagination |
| EventFilterPanel.tsx     | ~410  | ABI-driven filter panel (the one EventTable renders)  |
| EventStatistics.tsx      | ~380  | Indexing status display with progress bar             |
| IndexingRangeManager.tsx | ~1600 | Range-based indexing control                          |

The former `DynamicEventFilterForm` + `components/forms/DynamicFormGenerator`
subsystem was deleted 2026-11-08 — it had zero importers (EventTable renders
`EventFilterPanel` for the same `abiEvents` prop).

## KEY PROPS

### EventTable

```typescript
type EventTableProps = {
  chainId: number;
  contractAddress: string;
  abi: Abi;
  pageSize?: number;
  clientSideSortThreshold?: number; // Default: 1000
};
```

### EventStatistics

```typescript
type EventStatisticsProps = {
  chainId: number;
  contractAddress: string;
  refreshInterval?: number; // Default: 5000ms
};
```

## STYLING

Uses the Linaria `css` tag + `cx()` composition over haze-ui theme variables (no
fixed colors — dark theme comes from the `--haze-*` tokens):

```typescript
import { css, cx } from '@linaria/core';
const tableContainer = css`...`;
<div className={cx(tableContainer, className)}>
```

## SHARED UI (do not re-roll local copies)

- Error/empty states render the shared `ui/ErrorState` / `ui/EmptyState`
  (adopted 2026-11-08 — the local error CSS is deleted).
- Copy feedback runs through `util/useCopyFeedback`.
- Address/hash truncation uses `utils/format truncateMiddle`.

## KEY FEATURES

### EventTable

- Client-side vs server-side sort detection
- Multi-column sorting with priority
- ABI-driven filtering (EventFilterPanel)
- Request-generation guard on polls (claim an id, never read a shared one)
- Enhanced pagination (goto page, first/last)

### EventStatistics

- Real-time indexing progress bar
- Status badges: `idle | indexing | paused | error | completed`
- 5-second polling for updates
- Event type breakdown

## TESTS

Tests live in the repo-wide `tests/unit/` tree (`tests/unit/eventTable.test.tsx`
etc.), not co-located `__tests__/` directories.

## NOTES

- EventTable is the largest component (~2300 lines)
- Uses `global.fetch = vi.fn()` pattern in tests
