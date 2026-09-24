// SQL console view contract: run + render rows (columns as headers, cells
// as normalized text), the truncated notice, localStorage-backed query
// history (click to refill, cap 10, re-run moves to front), the admin-gate
// setup card for both STRICT-tier 403 faces, the 429 wait notice, and the
// sidebar's schema browser. The service layer is stubbed so the view's own
// state machine is what is under test.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';
import SqlConsole, {
  SQL_HISTORY_KEY,
  pushSqlHistory,
  readSqlHistory,
} from '@/views/Sql';
import { ApiError } from '@/util/apiError';

const { mockRunSqlQuery, mockUseSqlTables } = vi.hoisted(() => ({
  mockRunSqlQuery: vi.fn(),
  mockUseSqlTables: vi.fn(),
}));

vi.mock('@/components/TopNavigation', () => ({
  default: () => <div data-testid="top-navigation" />,
}));

vi.mock('@/services/sqlConsole', () => ({
  runSqlQuery: (...args: unknown[]) => mockRunSqlQuery(...args),
  useSqlTables: () => mockUseSqlTables(),
}));

// The view only reads the remembered chain for topbar context; pinning it
// keeps the test independent of localStorage state.
vi.mock('@/views/Home/Landing', () => ({
  readRememberedChainId: () => 1,
}));

const TABLES_OK = {
  data: [{ table: 'blocks', columns: ['number', 'hash'] }],
  loading: false,
  fetching: false,
  error: undefined,
  refetch: vi.fn(),
};

const routes = createRoutes([{ path: '/sql', component: () => SqlConsole }]);

// The router resolves the route component asynchronously, so every test
// must first settle on the page header before interacting with the view.
const renderConsole = async () => {
  render(
    <MemoryRouter routes={routes} initialEntries={['/sql']}>
      <View />
    </MemoryRouter>,
  );
  expect(await screen.findByText('SQL Console')).toBeInTheDocument();
};

const runQuery = async (sql: string) => {
  fireEvent.change(screen.getByLabelText('SQL query'), {
    target: { value: sql },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockUseSqlTables.mockReturnValue({ ...TABLES_OK, refetch: vi.fn() });
  mockRunSqlQuery.mockResolvedValue({
    columns: ['n'],
    rows: [[1]],
    rowCount: 1,
    truncated: false,
  });
});

describe('run + render', () => {
  it('runs the typed query and renders columns and rows', async () => {
    mockRunSqlQuery.mockResolvedValue({
      columns: ['block_number', 'hash'],
      rows: [
        [18000001, '0xabc'],
        [18000000, null],
      ],
      rowCount: 2,
      truncated: false,
    });
    await renderConsole();

    await runQuery('SELECT * FROM blocks LIMIT 2');

    await waitFor(() =>
      expect(screen.getByRole('table')).toBeInTheDocument(),
    );
    expect(mockRunSqlQuery).toHaveBeenCalledWith('SELECT * FROM blocks LIMIT 2');
    expect(screen.getByRole('columnheader', { name: 'block_number' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'hash' })).toBeInTheDocument();
    expect(screen.getByText('18000001')).toBeInTheDocument();
    expect(screen.getByText('0xabc')).toBeInTheDocument();
    // SQL NULL stays distinguishable from '' — the cell reads NULL.
    expect(screen.getByText('NULL')).toBeInTheDocument();
    expect(screen.getByText('2 rows')).toBeInTheDocument();
  });

  it('runs on Cmd/Ctrl+Enter without clicking Run', async () => {
    await renderConsole();
    fireEvent.change(screen.getByLabelText('SQL query'), {
      target: { value: 'SELECT 1' },
    });
    fireEvent.keyDown(screen.getByLabelText('SQL query'), {
      key: 'Enter',
      metaKey: true,
    });
    await waitFor(() => expect(mockRunSqlQuery).toHaveBeenCalledTimes(1));
  });

  it('shows the truncated notice only when the backend reports truncation', async () => {
    mockRunSqlQuery.mockResolvedValue({
      columns: ['n'],
      rows: Array.from({ length: 500 }, (_, i) => [i]),
      rowCount: 500,
      truncated: true,
    });
    await renderConsole();
    await runQuery('SELECT n FROM big');
    expect(await screen.findByText(/result truncated/)).toBeInTheDocument();
    expect(screen.getByText('500 rows')).toBeInTheDocument();
  });

  it('renders an explicit 0-row state', async () => {
    mockRunSqlQuery.mockResolvedValue({
      columns: ['n'],
      rows: [],
      rowCount: 0,
      truncated: false,
    });
    await renderConsole();
    await runQuery('SELECT 1 WHERE false');
    expect(await screen.findByText(/0 rows/)).toBeInTheDocument();
  });

  it('surfaces the backend DuckDB error verbatim on a failed run', async () => {
    mockRunSqlQuery.mockRejectedValue(
      new ApiError('Parser Error: syntax error at or near "FROMM"', 400, 'invalid_query'),
    );
    await renderConsole();
    await runQuery('SELECT 1 FROMM t');
    expect(await screen.findByText(/Parser Error/)).toBeInTheDocument();
  });

  it('shows the wait in seconds on a 429', async () => {
    mockRunSqlQuery.mockRejectedValue(
      new ApiError('Rate limit exceeded for sql-query; retry after 3s.', 429, undefined),
    );
    await renderConsole();
    await runQuery('SELECT 1');
    expect(await screen.findByText(/Retry in 3s/)).toBeInTheDocument();
  });
});

describe('query history (localStorage be:sqlConsole)', () => {
  it('records the run and refills the editor on click', async () => {
    await renderConsole();
    await runQuery('SELECT * FROM blocks LIMIT 2');
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    // Recorded under the documented key.
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(SQL_HISTORY_KEY) ?? '[]')).toEqual([
        'SELECT * FROM blocks LIMIT 2',
      ]),
    );

    // Refill: clearing the editor then clicking the entry restores it.
    const editor = screen.getByLabelText<HTMLTextAreaElement>('SQL query');
    fireEvent.change(editor, { target: { value: '' } });
    expect(editor.value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'SELECT * FROM blocks LIMIT 2' }));
    expect(editor.value).toBe('SELECT * FROM blocks LIMIT 2');
  });

  it('moves a re-run query to the front without duplicating', async () => {
    await renderConsole();
    await runQuery('SELECT 1');
    await waitFor(() => expect(mockRunSqlQuery).toHaveBeenCalledTimes(1));
    await runQuery('SELECT 2');
    await waitFor(() => expect(mockRunSqlQuery).toHaveBeenCalledTimes(2));
    await runQuery('SELECT 1');
    await waitFor(() => expect(mockRunSqlQuery).toHaveBeenCalledTimes(3));

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(SQL_HISTORY_KEY) ?? '[]')).toEqual([
        'SELECT 1',
        'SELECT 2',
      ]),
    );
  });
});

describe('history pure helpers', () => {
  it('caps the history at 10 entries', () => {
    let history: string[] = [];
    for (let i = 0; i < 15; i++) {
      history = pushSqlHistory(history, `SELECT ${i}`);
    }
    expect(history).toHaveLength(10);
    expect(history[0]).toBe('SELECT 14');
    expect(history[9]).toBe('SELECT 5');
  });

  it('readSqlHistory tolerates absent, malformed and non-array payloads', () => {
    expect(readSqlHistory()).toEqual([]);
    window.localStorage.setItem(SQL_HISTORY_KEY, '{not json');
    expect(readSqlHistory()).toEqual([]);
    window.localStorage.setItem(SQL_HISTORY_KEY, '"just a string"');
    expect(readSqlHistory()).toEqual([]);
    window.localStorage.setItem(
      SQL_HISTORY_KEY,
      JSON.stringify(['SELECT 1', 42, null, 'SELECT 2']),
    );
    expect(readSqlHistory()).toEqual(['SELECT 1', 'SELECT 2']);
  });
});

describe('admin gate honest states', () => {
  it('renders the setup card (not the console) when the server has no ADMIN_TOKEN', async () => {
    mockUseSqlTables.mockReturnValue({
      data: undefined,
      loading: false,
      fetching: false,
      error: new ApiError(
        'Admin operations are disabled. Set ADMIN_TOKEN on the server to enable them.',
        403,
      ),
      refetch: vi.fn(),
    });
    await renderConsole();

    expect(await screen.findByText(/SQL console is locked/)).toBeInTheDocument();
    expect(screen.getByText(/no ADMIN_TOKEN configured/)).toBeInTheDocument();
    expect(screen.getByText(/ADMIN_TOKEN=your-local-secret/)).toBeInTheDocument();
    // The whole console is unusable behind the gate — no editor offered.
    expect(screen.queryByLabelText('SQL query')).not.toBeInTheDocument();
  });

  it('renders the browser-token variant when the stored token is missing or wrong', async () => {
    mockUseSqlTables.mockReturnValue({
      data: undefined,
      loading: false,
      fetching: false,
      error: new ApiError('Invalid admin token.', 403),
      refetch: vi.fn(),
    });
    await renderConsole();

    expect(await screen.findByText(/SQL console is locked/)).toBeInTheDocument();
    expect(screen.getByText(/⚙️ RPC/)).toBeInTheDocument();
    expect(screen.queryByLabelText('SQL query')).not.toBeInTheDocument();
  });

  it('locks the console when only the run (not the sidebar) reports the gate', async () => {
    mockRunSqlQuery.mockRejectedValue(
      new ApiError('Invalid admin token.', 403),
    );
    await renderConsole();
    await runQuery('SELECT 1');

    expect(await screen.findByText(/SQL console is locked/)).toBeInTheDocument();
    expect(screen.queryByLabelText('SQL query')).not.toBeInTheDocument();
  });
});

describe('schema sidebar', () => {
  it('lists tables and columns, and a click fills a starter query', async () => {
    await renderConsole();

    expect(await screen.findByText('blocks')).toBeInTheDocument();
    expect(screen.getByText(/number, hash/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'blocks' }));
    const editor = screen.getByLabelText<HTMLTextAreaElement>('SQL query');
    expect(editor.value).toBe('SELECT *\nFROM "blocks"\nLIMIT 100;');
  });

  it('says so plainly when the database has no tables yet', async () => {
    mockUseSqlTables.mockReturnValue({
      data: [],
      loading: false,
      fetching: false,
      error: undefined,
      refetch: vi.fn(),
    });
    await renderConsole();
    expect(await screen.findByText(/No tables yet/)).toBeInTheDocument();
  });

  it('keeps the console usable when the sidebar itself fails', async () => {
    mockUseSqlTables.mockReturnValue({
      data: undefined,
      loading: false,
      fetching: false,
      error: new Error('Schema listing failed.'),
      refetch: vi.fn(),
    });
    await renderConsole();

    expect(await screen.findByText(/Schema unavailable/)).toBeInTheDocument();
    expect(screen.getByLabelText('SQL query')).toBeInTheDocument();
  });
});
