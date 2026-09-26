// Ops dashboard view contract: cards render from a full summary (backend
// meta + storage/indexing/watch/rate-limit/deep-scan sections, backup
// guidance), degraded sections render honestly with their own Retry, the
// OPT-IN gate's 403 face renders the setup card (not the dashboard), the
// backend-offline attribution renders the self-help card, and empty states
// say so plainly. The service layer is stubbed so the view's own state
// machine is what is under test.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';
import Ops, {
  formatChainLabel,
  formatStatusCounts,
  opsAdminGateFromError,
} from '@/views/Ops';
import { ApiError } from '@/util/apiError';
import type { OpsSummary } from '@/services/opsSummary';

const { mockUseOpsSummary } = vi.hoisted(() => ({
  mockUseOpsSummary: vi.fn(),
}));

vi.mock('@/components/TopNavigation', () => ({
  default: () => <div data-testid="top-navigation" />,
}));

vi.mock('@/services/opsSummary', () => ({
  useOpsSummary: (...args: unknown[]) => mockUseOpsSummary(...args),
}));

// The view only reads the remembered chain for topbar context; pinning it
// keeps the test independent of localStorage state.
vi.mock('@/views/Home/Landing', () => ({
  readRememberedChainId: () => 1,
}));

const refetch = vi.fn();

const FULL_SUMMARY: OpsSummary = {
  meta: { version: '1.2.3', uptimeSeconds: 3725, timestamp: '2026-09-25T10:00:00.000Z' },
  storage: {
    mainDbBytes: 21_840_000,
    perChainDbFiles: [
      {
        chainType: 'mainnet',
        name: 'ethereum',
        chainId: 1,
        bytes: 4_194_304,
        mtime: '2026-09-24T01:02:03.000Z',
      },
      {
        chainType: 'mainnet',
        name: 'backups-2026',
        chainId: null,
        bytes: 512,
        mtime: '2026-09-24T01:02:03.000Z',
      },
    ],
    solcCache: { files: 1, bytes: 8_842_000 },
  },
  indexing: {
    total: 3,
    chains: [
      { chainId: 1, statuses: { completed: 2, error: 1 }, total: 3 },
      { chainId: 11155111, statuses: { indexing: 1 }, total: 1 },
    ],
  },
  watch: {
    total: 1,
    subscriptions: [
      { chainId: 1, address: '0xabc0000000000000000000000000000000000abc', webhookConfigured: true },
    ],
  },
  rateLimit: {
    buckets: [
      { name: 'ops-summary', capacity: 3, requestsPerMinute: 6, hits: 12, rejected: 0 },
      { name: 'sql-query', capacity: 3, requestsPerMinute: 6, hits: 4, rejected: 1 },
    ],
  },
  deepScan: { total: 2, byStatus: { running: 1, paused: 1 } },
};

const summaryQuery = (data: OpsSummary | undefined, error: Error | undefined = undefined) => ({
  data,
  loading: false,
  fetching: false,
  error,
  failureCount: 0,
  stale: false,
  dataUpdatedAt: 123,
  refetch,
});

const routes = createRoutes([{ path: '/ops', component: () => Ops }]);

// The router resolves the route component asynchronously, so every test
// must first settle on the page header before asserting on the view.
const renderOps = async () => {
  render(
    <MemoryRouter routes={routes} initialEntries={['/ops']}>
      <View />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Ops Dashboard')).toBeInTheDocument();
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockUseOpsSummary.mockReturnValue(summaryQuery(FULL_SUMMARY));
});

describe('cards render from a full summary', () => {
  it('renders the backend meta card with version, uptime and the refresh affordances', async () => {
    await renderOps();

    expect(screen.getByText('1.2.3')).toBeInTheDocument();
    expect(screen.getByText('1h 2m')).toBeInTheDocument();
    expect(screen.getByText('2026-09-25T10:00:00.000Z')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByText(/Auto-refresh: 30s while visible/)).toBeInTheDocument();
  });

  it('renders the storage card: sizes, per-chain files, odd names flagged', async () => {
    await renderOps();

    expect(screen.getByText('20.83 MB')).toBeInTheDocument(); // main db
    expect(screen.getByText('ethereum (1)')).toBeInTheDocument();
    // Both files sit under the mainnet/ chain-type directory.
    expect(screen.getAllByText('mainnet')).toHaveLength(2);
    expect(screen.getByText('4 MB')).toBeInTheDocument();
    // The unparseable name keeps its stem and says the id is unknown.
    expect(screen.getByText('backups-2026')).toBeInTheDocument();
    expect(screen.getByText('(id unknown)')).toBeInTheDocument();
  });

  it('renders per-chain indexing counts and deep-scan counts', async () => {
    await renderOps();

    expect(screen.getByText('chain 1')).toBeInTheDocument();
    expect(screen.getByText(/2 completed, 1 error/)).toBeInTheDocument();
    expect(screen.getByText('chain 11,155,111')).toBeInTheDocument();
    expect(screen.getByText(/1 paused, 1 running/)).toBeInTheDocument();
  });

  it('renders the watch subscription with its webhook flag', async () => {
    await renderOps();

    expect(
      screen.getByText(/0xabc0000000000000000000000000000000000abc/),
    ).toBeInTheDocument();
    expect(screen.getByText('webhook configured')).toBeInTheDocument();
  });

  it('renders the rate-limit buckets table with totals and no per-client data', async () => {
    await renderOps();

    expect(screen.getByRole('columnheader', { name: 'Bucket' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'ops-summary' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'sql-query' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '12' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '1' })).toBeInTheDocument();
    expect(screen.getByText(/no per-client data/i)).toBeInTheDocument();
  });

  it('renders the mandatory Backup & Durability card with the three-modes copy', async () => {
    await renderOps();

    expect(screen.getByText('Backup & durability')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Event indexes are hours of compute: stop the server and copy the data\/ directory for a cold backup\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Browser-local data \(labels, watchlist, theme, custom ABIs, private notes\) exports from Settings → Backup & restore\./,
      ),
    ).toBeInTheDocument();
  });
});

describe('honest degraded and empty states', () => {
  it('renders ONLY the failing section as unavailable, with its own Retry', async () => {
    mockUseOpsSummary.mockReturnValue(
      summaryQuery({
        ...FULL_SUMMARY,
        watch: { error: 'unavailable' },
      }),
    );
    await renderOps();

    expect(screen.getByText(/Watch status unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/pnpm db:migrate/)).toBeInTheDocument();
    // Healthy sections still render alongside the degraded one.
    expect(screen.getByText('1.2.3')).toBeInTheDocument();
    expect(screen.getByText(/2 completed, 1 error/)).toBeInTheDocument();

    const retry = screen.getAllByRole('button', { name: 'Retry' })[0];
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders every section unavailable when all collectors failed', async () => {
    mockUseOpsSummary.mockReturnValue(
      summaryQuery({
        meta: FULL_SUMMARY.meta,
        storage: { error: 'unavailable' },
        indexing: { error: 'unavailable' },
        watch: { error: 'unavailable' },
        rateLimit: { error: 'unavailable' },
        deepScan: { error: 'unavailable' },
      }),
    );
    await renderOps();

    expect(screen.getByText(/Storage status unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Indexing status unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Watch status unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Rate-limit status unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Deep-scan status unavailable/)).toBeInTheDocument();
    // The meta card and the backup guidance never depend on collectors.
    expect(screen.getByText('1.2.3')).toBeInTheDocument();
    expect(screen.getByText(/copy the data\/ directory/)).toBeInTheDocument();
  });

  it('says so plainly when nothing has been indexed, watched or scanned yet', async () => {
    mockUseOpsSummary.mockReturnValue(
      summaryQuery({
        ...FULL_SUMMARY,
        storage: {
          mainDbBytes: null,
          perChainDbFiles: [],
          solcCache: { files: 0, bytes: 0 },
        },
        indexing: { total: 0, chains: [] },
        watch: { total: 0, subscriptions: [] },
        deepScan: { total: 0, byStatus: {} },
      }),
    );
    await renderOps();

    expect(screen.getByText(/size unknown/)).toBeInTheDocument();
    expect(screen.getByText(/No per-chain event databases yet/)).toBeInTheDocument();
    expect(screen.getByText(/No indexing ranges configured yet/)).toBeInTheDocument();
    expect(screen.getByText(/No watch subscriptions on this backend/)).toBeInTheDocument();
    expect(screen.getByText(/No deep-scan jobs recorded/)).toBeInTheDocument();
  });
});

describe('page-level failure states', () => {
  it('renders the OPT-IN gate setup card (not the dashboard) on a 403', async () => {
    mockUseOpsSummary.mockReturnValue(
      summaryQuery(
        undefined,
        new ApiError('Invalid admin token.', 403),
      ),
    );
    await renderOps();

    expect(await screen.findByText(/Ops dashboard is locked/)).toBeInTheDocument();
    expect(screen.getByText(/ADMIN_TOKEN configured/)).toBeInTheDocument();
    expect(screen.getByText(/⚙️ RPC/)).toBeInTheDocument();
    // The dashboard itself is not offered behind the gate.
    expect(screen.queryByText('1.2.3')).not.toBeInTheDocument();
  });

  it('renders the backend-offline self-help card and retries the connection', async () => {
    mockUseOpsSummary.mockReturnValue(
      summaryQuery(undefined, new ApiError('Backend not connected — indexed data unavailable', 0)),
    );
    await renderOps();

    expect(await screen.findByText(/Backend offline/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces a 429 with its wait', async () => {
    mockUseOpsSummary.mockReturnValue(
      summaryQuery(
        undefined,
        new ApiError('Rate limit exceeded for ops-summary; retry after 3s.', 429),
      ),
    );
    await renderOps();

    expect(await screen.findByText(/Retry in 3s/)).toBeInTheDocument();
  });

  it('renders any other failure verbatim (the message is the fact)', async () => {
    mockUseOpsSummary.mockReturnValue(
      summaryQuery(undefined, new ApiError('Something failed upstream', 500)),
    );
    await renderOps();

    expect(await screen.findByText('Something failed upstream')).toBeInTheDocument();
  });

  it('renders the loading state before the first summary lands', async () => {
    mockUseOpsSummary.mockReturnValue(summaryQuery(undefined));
    await renderOps();

    expect(screen.getByText(/Loading the ops summary/)).toBeInTheDocument();
  });
});

describe('pure display helpers', () => {
  it('formatStatusCounts orders known statuses and appends unknown ones', () => {
    expect(formatStatusCounts({ completed: 2, error: 1 })).toBe('2 completed, 1 error');
    expect(formatStatusCounts({ indexing: 1, paused: 0, pending: 2 })).toBe('1 indexing, 2 pending');
    expect(formatStatusCounts({ weird: 3, error: 1 })).toBe('1 error, 3 weird');
    expect(formatStatusCounts({})).toBe('none');
  });

  it('formatChainLabel pairs the name with the id, or falls back to the stem', () => {
    expect(formatChainLabel('ethereum', 1)).toBe('ethereum (1)');
    expect(formatChainLabel('backups-2026', null)).toBe('backups-2026');
  });

  it('opsAdminGateFromError classifies the two 403 faces and nothing else', () => {
    expect(
      opsAdminGateFromError(
        new ApiError('Admin operations are disabled. Set ADMIN_TOKEN on the server to enable them.', 403),
      ),
    ).toBe('unconfigured');
    expect(opsAdminGateFromError(new ApiError('Invalid admin token.', 403))).toBe('unauthorized');
    expect(opsAdminGateFromError(new ApiError('Invalid admin token.', 401))).toBeNull();
    expect(opsAdminGateFromError(new Error('Invalid admin token.'))).toBeNull();
  });
});

describe('manual refresh', () => {
  it('refetches the summary from the header card Refresh button', async () => {
    await renderOps();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  });
});
