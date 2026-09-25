# Event Components

React components for contract event display and indexing management.

## COMPONENTS

| File                       | Lines | Purpose                                               |
| -------------------------- | ----- | ----------------------------------------------------- |
| EventTable.tsx             | 1595  | Full-featured table with sorting/filtering/pagination |
| EventStatistics.tsx        | ~200  | Indexing status display with progress bar             |
| IndexingRangeManager.tsx   | 658   | Range-based indexing control                          |
| DynamicEventFilterForm.tsx | ~400  | ABI-driven dynamic filter form                        |

## KEY PROPS

### EventTable

```typescript
interface EventTableProps {
  chainId: number;
  contractAddress: string;
  abi: Abi;
  pageSize?: number;
  clientSideSortThreshold?: number; // Default: 1000
}
```

### EventStatistics

```typescript
interface EventStatisticsProps {
  chainId: number;
  contractAddress: string;
  refreshInterval?: number; // Default: 5000ms
}
```

## STYLING

Uses the Linaria `css` tag + `cx()` composition over haze-ui theme
variables (no fixed colors — dark theme comes from the `--haze-*` tokens):

```typescript
import { css, cx } from '@linaria/core';
const tableContainer = css`...`;
<div className={cx(tableContainer, className)}>
```

CSS variables from haze-ui theme: `--haze-*`

## KEY FEATURES

### EventTable

- Client-side vs server-side sort detection
- Multi-column sorting with priority
- Dynamic filtering from ABI
- Performance monitoring integration
- Enhanced pagination (goto page, first/last)

### EventStatistics

- Real-time indexing progress bar
- Status badges: `idle | indexing | paused | error | completed`
- 5-second polling for updates
- Event type breakdown

## TEST CO-LOCATION

Tests in `__tests__/` subdirectory:

```
events/
├── EventTable.tsx
├── __tests__/
│   ├── EventTable.test.tsx
│   └── EventStatistics.test.tsx
```

## NOTES

- EventTable is the largest component (1595 lines)
- Uses `global.fetch = vi.fn()` pattern in tests
- Performance target: 1-9ms for cached queries
