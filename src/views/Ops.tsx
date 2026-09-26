// Ops dashboard: a one-glance operator overview of THIS backend — storage
// footprint, indexing/watch/deep-scan status and rate-limiter totals.
// Deliberately NOT chain-scoped (same stance as the SQL console): it reads
// the main DuckDB and the data/ directory, so no chain param is read.
// Guarded server-side by the OPT-IN admin tier (requireAdminTokenIfConfigured
// — open in a zero-config local session, x-admin-token enforced once
// ADMIN_TOKEN is set), unlike the SQL console's fail-closed strict gate.
//
// Honesty rules: every response section may be degraded to
// {error: 'unavailable'} by the backend; each section card renders that
// state with its own Retry (the summary endpoint is one request — a retry
// refetches the whole summary, and only the failing part may recover).
// The react-toolroom cache holds errors, so the page-level failure states
// (backend offline, admin gate, rate limit) carry retry affordances too.
import { css } from '@linaria/core';
import { navigate } from '@native-router/core';
import { useRouter } from '@native-router/react';
import { Alert } from 'haze-ui';

import TopNavigation from '@/components/TopNavigation';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { BackendOfflineState } from '@/components/ui/ErrorState';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { readRememberedChainId } from '@/views/Home/Landing';
import { useOpsSummary, type OpsSummary } from '@/services/opsSummary';
import { ApiError } from '@/util/apiError';
import { isBackendUnreachable } from '@/util/http';
import { formatDuration, formatFileSize, formatNumber } from '@/utils/format';

// --- Error classification (exported for the view tests) ---

// The OPT-IN gate's two distinct 403 faces (same split as the SQL console,
// but only one is normally reachable here): 'unauthorized' = the server has
// an ADMIN_TOKEN and this browser's stored token is missing or wrong — the
// everyday face of this gate. 'unconfigured' = the server answered from the
// STRICT tier's "no ADMIN_TOKEN" rejection, which this endpoint's opt-in
// gate never produces on its own — it means something stricter is in front
// of the route. The recovery copy differs, so the distinction must survive.
export type OpsAdminGate = 'unconfigured' | 'unauthorized';

export function opsAdminGateFromError(error: unknown): OpsAdminGate | null {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  return /Set ADMIN_TOKEN on the server/i.test(error.message)
    ? 'unconfigured'
    : 'unauthorized';
}

// The backend's 429 body message carries the wait ("…retry after 3s."),
// same fixed format as every limiter in this app.
export function opsRateLimitWaitSeconds(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.status !== 429) return null;
  const match = /retry after (\d+)s/i.exec(error.message);
  return match ? Number(match[1]) : null;
}

// --- Pure display helpers (exported for the view tests) ---

// "8 completed, 2 error, 1 indexing" — stable status order (the states the
// indexer/scan-writer actually use, then anything unknown alphabetically),
// never fabricated: only statuses with a non-zero count are listed.
const KNOWN_STATUSES = ['indexing', 'paused', 'pending', 'completed', 'error', 'running', 'complete'] as const;

export function formatStatusCounts(statuses: Record<string, number>): string {
  const known = KNOWN_STATUSES.filter(status => (statuses[status] ?? 0) > 0);
  const extras = Object.keys(statuses)
    .filter(status => (statuses[status] ?? 0) > 0 && !KNOWN_STATUSES.includes(status as (typeof KNOWN_STATUSES)[number]))
    .sort();
  const entries = [...known, ...extras];
  if (entries.length === 0) return 'none';
  return entries.map(status => `${formatNumber(statuses[status])} ${status}`).join(', ');
}

// "Chain 1 · ethereum" — the id is the fact from the filename; a null id
// (unparseable file name) renders as just the raw stem.
export function formatChainLabel(name: string, chainId: number | null): string {
  return chainId === null ? name : `${name} (${formatNumber(chainId)})`;
}

// --- Styles ---

const grid = css`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: var(--haze-space-4);
  align-items: start;
`;

const fullRow = css`
  grid-column: 1 / -1;
`;

const metaGrid = css`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--haze-space-3);
  margin: 0;
`;

const metaItem = css`
  min-width: 0;
`;

const metaLabel = css`
  display: block;
  font-size: var(--haze-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--haze-color-text-muted);
  margin: 0 0 var(--haze-space-1);
`;

const metaValue = css`
  margin: 0;
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  word-break: break-all;
`;

const refreshRow = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  margin-top: var(--haze-space-4);
`;

const refreshHint = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
`;

const mono = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
`;

const sectionList = css`
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
  font-size: var(--haze-text-sm);
`;

const sectionRow = css`
  display: flex;
  flex-wrap: wrap;
  gap: var(--haze-space-2);
  align-items: baseline;
  justify-content: space-between;
`;

const unavailableBox = css`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--haze-space-2);
`;

const unavailableText = css`
  margin: 0;
  font-size: var(--haze-text-sm);
  line-height: var(--haze-leading-relaxed);
`;

const emptyNote = css`
  margin: 0;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
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

const pageError = css`
  max-width: 640px;
`;

// --- Components ---

// The degraded-section body: what is known (the section key), why it might
// be unavailable when the backend already said so (the watch section names
// the pre-migration column), and a Retry that refetches the summary.
function UnavailableSection({ hint, onRetry }: { hint: string; onRetry: () => void }) {
  return (
    <div className={unavailableBox}>
      <p className={unavailableText}>{hint}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

// The OPT-IN gate's setup card. The everyday face is 'unauthorized' (server
// has a token, this browser does not); the 'unconfigured' face cannot come
// from this endpoint's own gate and says so honestly instead of inventing a
// setup step that would not fix it.
function AdminGateCard({ gate }: { gate: OpsAdminGate }) {
  return (
    <Card className={gateCard}>
      <Alert variant="warning">
        <div className={gateBody}>
          <strong>Ops dashboard is locked — admin token required.</strong>
          <p className={gateText}>
            {gate === 'unauthorized'
              ? 'This backend has an ADMIN_TOKEN configured, so the ops summary requires it — and this browser has none (or a wrong one) stored. Open the settings dialog (⚙️ RPC, top right), enter the server\u2019s ADMIN_TOKEN in the Admin token section, and save.'
              : 'The ops summary is open in zero-config local sessions, so this 403 did not come from its own gate — something stricter is answering for this backend. Storing the operator\u2019s ADMIN_TOKEN in this browser (⚙️ RPC → Admin token) and retrying is the fastest way forward.'}
          </p>
          <p className={gateText}>
            The token is stored in this browser only and is sent as the x-admin-token
            header on every ops request.
          </p>
        </div>
      </Alert>
    </Card>
  );
}

// Page-level failure of the single summary request: attribution for a
// missing backend (the established self-help card), the limiter's wait made
// explicit, anything else verbatim.
function SummaryErrorNotice({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (isBackendUnreachable(error)) {
    return <BackendOfflineState onRetryConnection={onRetry} />;
  }
  if (error instanceof ApiError && error.status === 429) {
    const wait = opsRateLimitWaitSeconds(error);
    return (
      <Alert variant="warning">
        Rate limited — the ops summary allows 6 requests per minute.
        {' '}
        {wait !== null ? `Retry in ${wait}s.` : error.message}
      </Alert>
    );
  }
  return (
    <Alert variant="danger">
      {error instanceof Error ? error.message : 'Failed to load the ops summary.'}
    </Alert>
  );
}

function StorageCard({
  summary,
  onRetry,
}: {
  summary: OpsSummary;
  onRetry: () => void;
}) {
  const storage = summary.storage;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage</CardTitle>
        <CardDescription>
          DuckDB files under data/ — the main database, per-chain event
          databases and the solc compiler cache.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {'error' in storage ? (
          <UnavailableSection
            hint="Storage status unavailable — the data/ directory could not be scanned."
            onRetry={onRetry}
          />
        ) : (
          <>
            <dl className={metaGrid}>
              <div className={metaItem}>
                <dt className={metaLabel}>Main database</dt>
                <dd className={metaValue}>
                  {storage.mainDbBytes === null ? 'size unknown' : formatFileSize(storage.mainDbBytes)}
                </dd>
              </div>
              <div className={metaItem}>
                <dt className={metaLabel}>Per-chain event DBs</dt>
                <dd className={metaValue}>
                  {formatNumber(storage.perChainDbFiles.length)}
                  {' '}
                  file{storage.perChainDbFiles.length === 1 ? '' : 's'}
                </dd>
              </div>
              <div className={metaItem}>
                <dt className={metaLabel}>Solc cache</dt>
                <dd className={metaValue}>
                  {formatNumber(storage.solcCache.files)}
                  {' '}
                  file{storage.solcCache.files === 1 ? '' : 's'}
                  {', '}
                  {formatFileSize(storage.solcCache.bytes)}
                </dd>
              </div>
            </dl>
            {storage.perChainDbFiles.length === 0 ? (
              <p className={emptyNote}>
                No per-chain event databases yet — created when event indexing runs.
              </p>
            ) : (
              <DataTable>
                <thead>
                  <tr>
                    <th scope="col">Chain</th>
                    <th scope="col">Type</th>
                    <th scope="col">Size</th>
                    <th scope="col">Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {storage.perChainDbFiles.map(file => (
                    <tr key={`${file.chainType}/${file.name}-${file.chainId ?? 'x'}`}>
                      <td className={mono}>
                        {formatChainLabel(file.name, file.chainId)}
                        {file.chainId === null && (
                          <span title="File name does not match the documented {name}-{id}.db pattern">
                            {' '}
                            (id unknown)
                          </span>
                        )}
                      </td>
                      <td className={mono}>{file.chainType}</td>
                      <td className={mono}>{formatFileSize(file.bytes)}</td>
                      <td className={mono} title={file.mtime}>
                        {file.mtime}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function IndexingCard({
  summary,
  onRetry,
}: {
  summary: OpsSummary;
  onRetry: () => void;
}) {
  const indexing = summary.indexing;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Event indexing</CardTitle>
        <CardDescription>
          Indexing ranges per chain by status, from the main database — the
          scope is the ranges this operator configured, not contract
          lifetimes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {'error' in indexing ? (
          <UnavailableSection
            hint="Indexing status unavailable — the indexing_ranges table could not be read."
            onRetry={onRetry}
          />
        ) : indexing.chains.length === 0 ? (
          <p className={emptyNote}>
            No indexing ranges configured yet — create them from a contract&apos;s
            Events tab.
          </p>
        ) : (
          <ul className={sectionList}>
            {indexing.chains.map(chain => (
              <li key={chain.chainId} className={sectionRow}>
                <span className={mono}>chain {formatNumber(chain.chainId)}</span>
                <span>
                  {formatNumber(chain.total)}
                  {' '}
                  range{chain.total === 1 ? '' : 's'}
                  {': '}
                  {formatStatusCounts(chain.statuses)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function WatchCard({
  summary,
  onRetry,
}: {
  summary: OpsSummary;
  onRetry: () => void;
}) {
  const watch = summary.watch;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Watch subscriptions</CardTitle>
        <CardDescription>
          Server-side address watching (watch_subscriptions table, read
          directly), with each subscription&apos;s webhook delivery flag.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {'error' in watch ? (
          <UnavailableSection
            hint="Watch status unavailable — the watch_subscriptions table could not be read (a database from before the webhook column needs pnpm db:migrate)."
            onRetry={onRetry}
          />
        ) : watch.subscriptions.length === 0 ? (
          <p className={emptyNote}>No watch subscriptions on this backend.</p>
        ) : (
          <ul className={sectionList}>
            {watch.subscriptions.map(sub => (
              <li
                key={`${sub.chainId}:${sub.address}`}
                className={sectionRow}
              >
                <span className={mono}>
                  chain {formatNumber(sub.chainId)}
                  {' · '}
                  {sub.address}
                </span>
                <span>
                  {sub.webhookConfigured ? 'webhook configured' : 'no webhook'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RateLimitCard({
  summary,
  onRetry,
}: {
  summary: OpsSummary;
  onRetry: () => void;
}) {
  const rateLimit = summary.rateLimit;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rate limiting</CardTitle>
        <CardDescription>
          In-process token-bucket totals since the backend started,
          aggregated per bucket — no per-client data exists in this
          snapshot.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {'error' in rateLimit ? (
          <UnavailableSection
            hint="Rate-limit status unavailable."
            onRetry={onRetry}
          />
        ) : rateLimit.buckets.length === 0 ? (
          <p className={emptyNote}>No rate limiters registered.</p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th scope="col">Bucket</th>
                <th scope="col">Capacity</th>
                <th scope="col">Rate</th>
                <th scope="col">Hits</th>
                <th scope="col">Rejected</th>
              </tr>
            </thead>
            <tbody>
              {rateLimit.buckets.map(bucket => (
                <tr key={bucket.name}>
                  <td className={mono}>{bucket.name}</td>
                  <td className={mono}>{formatNumber(bucket.capacity)}</td>
                  <td className={mono}>
                    {formatNumber(bucket.requestsPerMinute)}/min
                  </td>
                  <td className={mono}>{formatNumber(bucket.hits)}</td>
                  <td className={mono}>{formatNumber(bucket.rejected)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </CardContent>
    </Card>
  );
}

function DeepScanCard({
  summary,
  onRetry,
}: {
  summary: OpsSummary;
  onRetry: () => void;
}) {
  const deepScan = summary.deepScan;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Address deep scans</CardTitle>
        <CardDescription>
          Persistent, resumable transaction-discovery walks (address_scan_jobs
          table), counted by status.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {'error' in deepScan ? (
          <UnavailableSection
            hint="Deep-scan status unavailable — the address_scan_jobs table could not be read."
            onRetry={onRetry}
          />
        ) : deepScan.total === 0 ? (
          <p className={emptyNote}>No deep-scan jobs recorded.</p>
        ) : (
          <p className={sectionRow}>
            <span>
              {formatNumber(deepScan.total)}
              {' '}
              job{deepScan.total === 1 ? '' : 's'}
              {': '}
            </span>
            <span>{formatStatusCounts(deepScan.byStatus)}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Static guidance card: the durability story of this deployment. Copy is
// aligned with docs/INSTALLATION.md's three-modes wording (server files vs
// browser-local data) — the two live in different places and back up
// differently, which is the one fact an operator must not get wrong.
function BackupCard() {
  return (
    <Card className={fullRow}>
      <CardHeader>
        <CardTitle>Backup &amp; durability</CardTitle>
        <CardDescription>
          Server data and browser-local data are different things and back up
          differently.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className={gateText}>
          Event indexes are hours of compute: stop the server and copy the
          data/ directory for a cold backup. Browser-local data (labels,
          watchlist, theme, custom ABIs, private notes) exports from Settings
          → Backup &amp; restore.
        </p>
      </CardContent>
    </Card>
  );
}

export default function Ops() {
  const router = useRouter();
  // Not chain-scoped, but the topbar still is (its links and search route
  // into /chain/:chainId pages): the remembered chain provides that context,
  // same fallback order as the other chain-less pages (SQL console, Search).
  const navChainId = readRememberedChainId() ?? 1;
  const handleNavChainChange = (chainId: number) => {
    navigate(router, `/chain/${chainId}`).catch(() => undefined);
  };

  const summary = useOpsSummary();
  const retry = () => void summary.refetch();

  const gate = opsAdminGateFromError(summary.error);

  return (
    <>
      <TopNavigation currentChainId={navChainId} onChainChange={handleNavChainChange} />
      <PageContainer>
        <PageHeader
          title="Ops Dashboard"
          chainInfo="Operator overview of this backend — storage, indexing, watch subscriptions, deep scans and rate limiting. Not chain-scoped: it reads the main DuckDB and the data/ directory, like the SQL console."
        />
        {gate !== null ? (
          <AdminGateCard gate={gate} />
        ) : summary.error !== undefined ? (
          <div className={pageError} role="alert">
            <SummaryErrorNotice error={summary.error} onRetry={retry} />
          </div>
        ) : summary.data === undefined ? (
          <Card>
            <CardContent>
              <p className={emptyNote}>Loading the ops summary…</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className={grid}>
              <Card className={fullRow}>
                <CardHeader>
                  <CardTitle>Backend</CardTitle>
                  <CardDescription>
                    This snapshot came from the backend itself; it auto-refreshes
                    every 30 seconds while this tab is visible.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className={metaGrid}>
                    <div className={metaItem}>
                      <dt className={metaLabel}>Version</dt>
                      <dd className={metaValue}>{summary.data.meta.version}</dd>
                    </div>
                    <div className={metaItem}>
                      <dt className={metaLabel}>Uptime</dt>
                      <dd className={metaValue}>
                        {formatDuration(summary.data.meta.uptimeSeconds)}
                      </dd>
                    </div>
                    <div className={metaItem}>
                      <dt className={metaLabel}>Snapshot taken</dt>
                      <dd className={metaValue}>{summary.data.meta.timestamp}</dd>
                    </div>
                  </dl>
                  <div className={refreshRow}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={retry}
                      loading={summary.fetching}
                    >
                      Refresh
                    </Button>
                    <span className={refreshHint}>
                      {summary.fetching ? 'Refreshing…' : 'Auto-refresh: 30s while visible'}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <StorageCard summary={summary.data} onRetry={retry} />
              <IndexingCard summary={summary.data} onRetry={retry} />
              <WatchCard summary={summary.data} onRetry={retry} />
              <RateLimitCard summary={summary.data} onRetry={retry} />
              <DeepScanCard summary={summary.data} onRetry={retry} />
              <BackupCard />
            </div>
          </>
        )}
      </PageContainer>
    </>
  );
}
