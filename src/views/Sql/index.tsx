// SQL console: an admin-only, read-only window onto this explorer's own
// DuckDB — "query your own indexer". Deliberately NOT chain-scoped: every
// other page narrows to /chain/:chainId because it renders one network's
// RPC/indexed view, but the console queries the single main database where
// all chains' indexed rows live — the copy says so, and no chain param is
// read. Guarded server-side by the STRICT admin tier (fails closed without
// ADMIN_TOKEN); the honest states below cover exactly the ways that gate
// and the local power-user workflow can present themselves.
import { useState, type KeyboardEvent } from 'react';
import { css } from '@linaria/core';
import { navigate } from '@native-router/core';
import { useRouter } from '@native-router/react';
import { Alert } from 'haze-ui';

import TopNavigation from '@/components/TopNavigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { BackendOfflineState, EmptyState } from '@/components/ui/ErrorState';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { readRememberedChainId } from '@/views/Home/Landing';
import {
  runSqlQuery,
  useSqlTables,
  type SqlCellValue,
  type SqlQueryResult,
} from '@/services/sqlConsole';
import { ApiError } from '@/util/apiError';
import { isBackendUnreachable } from '@/util/http';

// --- Query history (localStorage, max 10, click to refill the editor) ---

export const SQL_HISTORY_KEY = 'be:sqlConsole';
export const SQL_HISTORY_MAX = 10;

export function readSqlHistory(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(SQL_HISTORY_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .slice(0, SQL_HISTORY_MAX);
  } catch {
    // Unreadable or unavailable storage degrades to "no history".
    return [];
  }
}

// Pure history step: a re-run query moves to the front instead of
// duplicating, and the list never exceeds the cap.
export function pushSqlHistory(history: string[], query: string): string[] {
  const trimmed = query.trim();
  if (trimmed === '') return history;
  return [trimmed, ...history.filter(entry => entry !== trimmed)].slice(
    0,
    SQL_HISTORY_MAX,
  );
}

function persistSqlHistory(history: string[]): void {
  try {
    globalThis.localStorage?.setItem(SQL_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Storage unavailable (private mode): history lives for this session only.
  }
}

// --- Error classification (exported for the view tests) ---

// The STRICT admin gate's two distinct 403 faces: 'unconfigured' = the
// server has no ADMIN_TOKEN at all (fail-closed by design — the backend
// literally cannot authorize anyone); 'unauthorized' = the server has one
// but this browser's stored token is missing or wrong. The recovery copy
// differs (restart with a token vs. store the token here), so the
// distinction must survive to the UI.
export type SqlAdminGate = 'unconfigured' | 'unauthorized';

export function sqlAdminGateFromError(error: unknown): SqlAdminGate | null {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  return /Set ADMIN_TOKEN on the server/i.test(error.message)
    ? 'unconfigured'
    : 'unauthorized';
}

// The backend's 429 body message carries the wait ("…retry after 3s.");
// toApiError keeps the message but not the structured field, so the
// seconds are parsed back out of our own limiter's fixed format.
export function rateLimitWaitSeconds(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.status !== 429) return null;
  const match = /retry after (\d+)s/i.exec(error.message);
  return match ? Number(match[1]) : null;
}

// One cell as display text: NULL reads as SQL NULL (not the empty string —
// '' is a real value a query can return), nested lists/structs render as
// their JSON form.
export function formatSqlCell(cell: SqlCellValue): string {
  if (cell === null) return 'NULL';
  if (typeof cell === 'string') return cell;
  if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell);
  return JSON.stringify(cell) ?? String(cell);
}

// --- Styles ---

const consoleLayout = css`
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: var(--haze-space-5);
  align-items: start;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const sidebar = css`
  font-size: var(--haze-text-sm);
  position: sticky;
  top: var(--haze-space-4);
  max-height: calc(100vh - 120px);
  overflow-y: auto;
`;

const sidebarTitle = css`
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text-muted);
  margin: 0 0 var(--haze-space-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const sidebarNote = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
  margin: 0 0 var(--haze-space-2);
`;

const sidebarTable = css`
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: var(--haze-space-1) 0;
  color: var(--haze-color-text);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  cursor: pointer;

  &:hover {
    color: var(--haze-color-primary);
    text-decoration: underline;
  }
`;

const sidebarColumns = css`
  margin: 0 0 var(--haze-space-3);
  padding-left: var(--haze-space-3);
  color: var(--haze-color-text-muted);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  line-height: var(--haze-leading-relaxed);
  word-break: break-all;
`;

const editorCard = css`
  padding: var(--haze-space-4);
`;

const editorArea = css`
  display: block;
  width: 100%;
  min-height: 150px;
  resize: vertical;
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  line-height: var(--haze-leading-relaxed);
  padding: var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  background: var(--haze-color-bg);
  color: var(--haze-color-text);

  &:focus-visible {
    outline: 2px solid var(--haze-color-primary);
    outline-offset: -1px;
  }
`;

const editorActions = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  margin-top: var(--haze-space-3);
`;

const shortcutHint = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
`;

const historySection = css`
  margin-top: var(--haze-space-4);
`;

const historyTitle = css`
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text-muted);
  margin: 0 0 var(--haze-space-2);
`;

const historyItem = css`
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: var(--haze-space-1) 0;
  color: var(--haze-color-primary);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover {
    text-decoration: underline;
  }
`;

const resultsSection = css`
  margin-top: var(--haze-space-5);
`;

const resultsMeta = css`
  display: flex;
  align-items: baseline;
  gap: var(--haze-space-3);
  margin-bottom: var(--haze-space-3);
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
`;

const runErrorBox = css`
  margin-top: var(--haze-space-4);
`;

const gateCard = css`
  max-width: 640px;
`;

const gateBody = css`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--haze-space-2);
`;

const gateText = css`
  margin: 0;
  line-height: var(--haze-leading-relaxed);
`;

const gateCode = css`
  align-self: flex-start;
  padding: var(--haze-space-1) var(--haze-space-3);
  border-radius: var(--haze-radius-sm);
  background: color-mix(in srgb, var(--haze-color-warning) 12%, transparent);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  word-break: break-all;
`;

const cellStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  white-space: nowrap;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
`;

// --- Components ---

// The STRICT gate's setup card. Both faces point at the same browser-side
// fix (the ⚙ RPC dialog's admin-token field), but say honestly which side
// is missing: a server without ADMIN_TOKEN cannot be authorized around —
// the operator must set one and restart; a wrong browser token is fixed in
// place.
function AdminGateCard({ gate }: { gate: SqlAdminGate }) {
  return (
    <Card className={gateCard}>
      <Alert variant="warning">
        <div className={gateBody}>
          <strong>SQL console is locked — admin token required.</strong>
          <p className={gateText}>
            {gate === 'unconfigured'
              ? 'This backend has no ADMIN_TOKEN configured, so it rejects every SQL console request by design (the console executes raw SQL and fails closed). Start the server with a token set — for example:'
              : 'This backend requires an admin token, and this browser has none (or a wrong one) stored. Open the settings dialog (⚙️ RPC, top right), enter the server\u2019s ADMIN_TOKEN in the Admin token section, and save.'}
          </p>
          {gate === 'unconfigured' && (
            <code className={gateCode}>ADMIN_TOKEN=your-local-secret pnpm dev:server</code>
          )}
          <p className={gateText}>
            {gate === 'unconfigured'
              ? 'Then store the same token in this browser via ⚙️ RPC → Admin token, reload this page, and the console unlocks.'
              : 'The token is stored in this browser only and is sent as the x-admin-token header on every console request.'}
          </p>
        </div>
      </Alert>
    </Card>
  );
}

// The run outcomes that are not results: attribution for a missing
// backend (the established self-help card), the limiter's wait made
// explicit, and any other failure verbatim — a 400 carries the backend's
// real DuckDB error, the most useful text on this page for the operator
// who typed the query.
function RunErrorNotice({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (isBackendUnreachable(error)) {
    return <BackendOfflineState onRetryConnection={onRetry} />;
  }
  if (error instanceof ApiError && error.status === 429) {
    const wait = rateLimitWaitSeconds(error);
    return (
      <Alert variant="warning">
        Rate limited — the console allows 6 queries per minute.
        {' '}
        {wait !== null ? `Retry in ${wait}s.` : error.message}
      </Alert>
    );
  }
  return <Alert variant="danger">{error instanceof Error ? error.message : 'Query failed.'}</Alert>;
}

function SqlResults({ result }: { result: SqlQueryResult }) {
  return (
    <section className={resultsSection} aria-label="Query results">
      <div className={resultsMeta}>
        <span>
          {result.rowCount}
          {' '}
          {result.rowCount === 1 ? 'row' : 'rows'}
        </span>
        {result.truncated && (
          <span title="The result set had more rows than the console returns">
            ⚠ showing the first 500 rows — result truncated; narrow the query (LIMIT / filters) to see the rest
          </span>
        )}
      </div>
      {result.rowCount === 0 ? (
        <EmptyState message="0 rows — the query ran successfully and returned no rows." />
      ) : (
        <DataTable>
          <thead>
            <tr>
              {result.columns.map(column => (
                <th key={column} scope="col">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, columnIndex) => (
                  <td key={columnIndex} className={cellStyle} title={formatSqlCell(cell)}>
                    {formatSqlCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}

export default function SqlConsole() {
  const router = useRouter();
  // The console is not chain-scoped, but the topbar still is (its links
  // and search route into /chain/:chainId pages): the remembered chain —
  // never a hard-coded one — provides that context, same fallback order
  // as the other chain-less pages (Search).
  const navChainId = readRememberedChainId() ?? 1;
  const handleNavChainChange = (chainId: number) => {
    navigate(router, `/chain/${chainId}`).catch(() => undefined);
  };

  const tables = useSqlTables();
  const [queryText, setQueryText] = useState('');
  const [result, setResult] = useState<SqlQueryResult | null>(null);
  const [runError, setRunError] = useState<unknown>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>(readSqlHistory);

  // Whichever endpoint reported the gate first speaks for the whole page:
  // the browser token and the server configuration are page-global facts.
  const gate
    = sqlAdminGateFromError(runError) ?? sqlAdminGateFromError(tables.error);

  const runQuery = async () => {
    const query = queryText.trim();
    if (query === '' || running) return;
    setRunning(true);
    setRunError(null);
    // Recorded on execute (not on success): a query that errored is still
    // the one the operator wants one keystroke away while iterating.
    setHistory(current => {
      const next = pushSqlHistory(current, query);
      persistSqlHistory(next);
      return next;
    });
    try {
      setResult(await runSqlQuery(query));
    } catch (error) {
      setResult(null);
      setRunError(error);
    } finally {
      setRunning(false);
    }
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void runQuery();
    }
  };

  const sidebarTableList = tables.data ?? [];

  return (
    <>
      <TopNavigation currentChainId={navChainId} onChainChange={handleNavChainChange} />
      <PageContainer>
        <PageHeader
          title="SQL Console"
          chainInfo="Read-only SELECT/WITH queries against this explorer's own DuckDB — every chain's indexed rows in one database, not a per-chain view or per-chain event files. Results cap at 500 rows."
        />
        {gate ? (
          <AdminGateCard gate={gate} />
        ) : (
          <div className={consoleLayout}>
            <aside className={sidebar} aria-label="Database schema">
              <h2 className={sidebarTitle}>Tables</h2>
              {tables.loading ? (
                <p className={sidebarNote}>Loading schema…</p>
              ) : tables.error ? (
                isBackendUnreachable(tables.error) ? (
                  <BackendOfflineState
                    onRetryConnection={() => void tables.refetch()}
                  />
                ) : (
                  <div>
                    <p className={sidebarNote}>
                      Schema unavailable:
                      {' '}
                      {tables.error instanceof Error ? tables.error.message : 'unknown error'}
                    </p>
                    <Button variant="outline" size="sm" onClick={() => void tables.refetch()}>
                      Retry
                    </Button>
                  </div>
                )
              ) : sidebarTableList.length === 0 ? (
                <p className={sidebarNote}>
                  No tables yet — the indexer creates them as data arrives.
                </p>
              ) : (
                sidebarTableList.map(({ table, columns }) => (
                  <div key={table}>
                    <button
                      type="button"
                      className={sidebarTable}
                      onClick={() =>
                        setQueryText(`SELECT *\nFROM "${table}"\nLIMIT 100;`)}
                      title={`Fill the editor with a starter query for "${table}"`}
                    >
                      {table}
                    </button>
                    <div className={sidebarColumns}>{columns.join(', ')}</div>
                  </div>
                ))
              )}
            </aside>

            <main>
              <Card className={editorCard}>
                <textarea
                  className={editorArea}
                  value={queryText}
                  onChange={event => setQueryText(event.target.value)}
                  onKeyDown={handleEditorKeyDown}
                  placeholder={'SELECT *\nFROM transactions\nLIMIT 100;'}
                  spellCheck={false}
                  aria-label="SQL query"
                  data-testid="sql-editor"
                />
                <div className={editorActions}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void runQuery()}
                    disabled={running || queryText.trim() === ''}
                  >
                    {running ? 'Running…' : 'Run'}
                  </Button>
                  <span className={shortcutHint}>⌘/Ctrl + Enter</span>
                </div>
              </Card>

              {runError !== null && (
                <div className={runErrorBox} role="alert">
                  <RunErrorNotice error={runError} onRetry={() => void runQuery()} />
                </div>
              )}

              {history.length > 0 && (
                <div className={historySection}>
                  <h3 className={historyTitle}>Recent queries</h3>
                  {history.map(entry => (
                    <button
                      key={entry}
                      type="button"
                      className={historyItem}
                      title={entry}
                      onClick={() => setQueryText(entry)}
                    >
                      {entry}
                    </button>
                  ))}
                </div>
              )}

              {result !== null && runError === null && <SqlResults result={result} />}
            </main>
          </div>
        )}
      </PageContainer>
    </>
  );
}
