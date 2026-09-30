// Ops dashboard: a one-glance operator overview of THIS backend — storage
// footprint, indexing/watch/deep-scan status and rate-limiter totals.
// Deliberately NOT chain-scoped (same stance as the SQL console): it reads
// the main DuckDB and the data/ directory, so no chain param is read.
// Guarded server-side by the OPT-IN admin tier (requireAdminTokenIfConfigured
// — open in a zero-config local session, x-admin-token enforced once
// ADMIN_TOKEN is set), unlike the SQL console's fail-closed strict gate —
// EXCEPT the uninstall danger zone, which strict-gates like the SQL console
// (erasing all data must fail closed; its card explains the CLI fallback).
//
// Honesty rules: every response section may be degraded to
// {error: 'unavailable'} by the backend; each section card renders that
// state with its own Retry (the summary endpoint is one request — a retry
// refetches the whole summary, and only the failing part may recover).
// The react-toolroom cache holds errors, so the page-level failure states
// (backend offline, admin gate, rate limit) carry retry affordances too.
import { css, cx } from '@linaria/core';
import { navigate } from '@native-router/core';
import { useRouter } from '@native-router/react';
import { Alert, Dialog, useToast } from 'haze-ui';
import { useControl } from 'react-use-control';
import { useState } from 'react';

import TopNavigation from '@/components/TopNavigation';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { BackendOfflineState } from '@/components/ui/ErrorState';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { readRememberedChainId } from '@/views/Home/Landing';
import { useOpsSummary, type OpsMeta, type OpsSummary } from '@/services/opsSummary';
import {
  UNINSTALL_CONFIRM_PHRASE,
  fetchUninstallPreview,
  requestBackendUninstall,
  type UninstallPreview,
} from '@/services/opsSummary';
import { ApiError } from '@/util/apiError';
import { copyText } from '@/util/clipboard';
import { isBackendUnreachable } from '@/util/http';
import { formatDuration, formatFileSize, formatNumber } from '@/utils/format';

// --- Error classification (exported for the view tests) ---

// The admin gate's two distinct 403 faces (same split as the SQL
// console): 'unauthorized' = the server has an ADMIN_TOKEN and this
// browser's stored token is missing or wrong. 'unconfigured' = the
// server answered from the STRICT tier's "no ADMIN_TOKEN" rejection —
// unreachable for the summary (its own opt-in gate passes tokenless
// requests through) but the everyday zero-config face of the UNINSTALL
// pair, which strict-gates because it erases all server data. The
// recovery copy differs, so the distinction must survive.
export type OpsAdminGate = 'unconfigured' | 'unauthorized';

export function opsAdminGateFromError(error: unknown): OpsAdminGate | null {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  return /Set ADMIN_TOKEN on the server/i.test(error.message) ? 'unconfigured' : 'unauthorized';
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
const KNOWN_STATUSES = [
  'indexing',
  'paused',
  'pending',
  'completed',
  'error',
  'running',
  'complete',
] as const;

export function formatStatusCounts(statuses: Record<string, number>): string {
  const known = KNOWN_STATUSES.filter(status => (statuses[status] ?? 0) > 0);
  const extras = Object.keys(statuses)
    .filter(
      status =>
        (statuses[status] ?? 0) > 0 &&
        !KNOWN_STATUSES.includes(status as (typeof KNOWN_STATUSES)[number]),
    )
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

// --- Copy-diagnostics builder (exported for the view tests) ---

// The five summary sections that can degrade independently. The builder
// below includes every one of them verbatim — degraded sections travel as
// their honest {error:'unavailable'} shape, never silently dropped — plus
// a `sections` verdict map so a bug-report reader sees at a glance which
// parts of the snapshot are trustworthy.
export type DiagnosticSection = 'storage' | 'indexing' | 'watch' | 'rateLimit' | 'deepScan';

export type OpsDiagnostics = {
  /** Client clock when Copy was clicked — correlates the snapshot with a report. */
  readonly generatedAt: string;
  /** The backend version, single-sourced from the summary's meta (bug reports ask for it). */
  readonly appVersion: string;
  /** The summary's own meta verbatim (version, uptime, snapshot timestamp). */
  readonly backend: OpsMeta;
  /** Per-section verdict: 'ok' or the degraded marker the backend actually sent. */
  readonly sections: Record<DiagnosticSection, 'ok' | 'unavailable'>;
  readonly storage: OpsSummary['storage'];
  readonly indexing: OpsSummary['indexing'];
  readonly watch: OpsSummary['watch'];
  readonly rateLimit: OpsSummary['rateLimit'];
  readonly deepScan: OpsSummary['deepScan'];
};

// Pure: builds the clipboard payload from an already-fetched summary.
// `now` is injectable so tests pin generatedAt deterministically.
export function buildOpsDiagnostics(
  payload: OpsSummary,
  now: () => Date = () => new Date(),
): OpsDiagnostics {
  const degraded = (section: OpsSummary[DiagnosticSection]): 'ok' | 'unavailable' =>
    'error' in section ? 'unavailable' : 'ok';
  return {
    generatedAt: now().toISOString(),
    appVersion: payload.meta.version,
    backend: payload.meta,
    sections: {
      storage: degraded(payload.storage),
      indexing: degraded(payload.indexing),
      watch: degraded(payload.watch),
      rateLimit: degraded(payload.rateLimit),
      deepScan: degraded(payload.deepScan),
    },
    storage: payload.storage,
    indexing: payload.indexing,
    watch: payload.watch,
    rateLimit: payload.rateLimit,
    deepScan: payload.deepScan,
  };
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
            The token is stored in this browser only and is sent as the x-admin-token header on
            every ops request.
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
        Rate limited — the ops summary allows 6 requests per minute.{' '}
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

function StorageCard({ summary, onRetry }: { summary: OpsSummary; onRetry: () => void }) {
  const storage = summary.storage;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage</CardTitle>
        <CardDescription>
          DuckDB files under data/ — the main database, per-chain event databases and the solc
          compiler cache.
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
                  {storage.mainDbBytes === null
                    ? 'size unknown'
                    : formatFileSize(storage.mainDbBytes)}
                </dd>
              </div>
              <div className={metaItem}>
                <dt className={metaLabel}>Per-chain event DBs</dt>
                <dd className={metaValue}>
                  {formatNumber(storage.perChainDbFiles.length)} file
                  {storage.perChainDbFiles.length === 1 ? '' : 's'}
                </dd>
              </div>
              <div className={metaItem}>
                <dt className={metaLabel}>Solc cache</dt>
                <dd className={metaValue}>
                  {formatNumber(storage.solcCache.files)} file
                  {storage.solcCache.files === 1 ? '' : 's'}
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

function IndexingCard({ summary, onRetry }: { summary: OpsSummary; onRetry: () => void }) {
  const indexing = summary.indexing;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Event indexing</CardTitle>
        <CardDescription>
          Indexing ranges per chain by status, from the main database — the scope is the ranges this
          operator configured, not contract lifetimes.
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
            No indexing ranges configured yet — create them from a contract&apos;s Events tab.
          </p>
        ) : (
          <ul className={sectionList}>
            {indexing.chains.map(chain => (
              <li key={chain.chainId} className={sectionRow}>
                <span className={mono}>chain {formatNumber(chain.chainId)}</span>
                <span>
                  {formatNumber(chain.total)} range{chain.total === 1 ? '' : 's'}
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

function WatchCard({ summary, onRetry }: { summary: OpsSummary; onRetry: () => void }) {
  const watch = summary.watch;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Watch subscriptions</CardTitle>
        <CardDescription>
          Server-side address watching (watch_subscriptions table, read directly), with each
          subscription&apos;s webhook delivery flag.
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
              <li key={`${sub.chainId}:${sub.address}`} className={sectionRow}>
                <span className={mono}>
                  chain {formatNumber(sub.chainId)}
                  {' · '}
                  {sub.address}
                </span>
                <span>{sub.webhookConfigured ? 'webhook configured' : 'no webhook'}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RateLimitCard({ summary, onRetry }: { summary: OpsSummary; onRetry: () => void }) {
  const rateLimit = summary.rateLimit;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rate limiting</CardTitle>
        <CardDescription>
          In-process token-bucket totals since the backend started, aggregated per bucket — no
          per-client data exists in this snapshot.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {'error' in rateLimit ? (
          <UnavailableSection hint="Rate-limit status unavailable." onRetry={onRetry} />
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
                  <td className={mono}>{formatNumber(bucket.requestsPerMinute)}/min</td>
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

function DeepScanCard({ summary, onRetry }: { summary: OpsSummary; onRetry: () => void }) {
  const deepScan = summary.deepScan;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Address deep scans</CardTitle>
        <CardDescription>
          Persistent, resumable transaction-discovery walks (address_scan_jobs table), counted by
          status.
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
              {formatNumber(deepScan.total)} job{deepScan.total === 1 ? '' : 's'}
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
          Server data and browser-local data are different things and back up differently.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className={gateText}>
          Event indexes are hours of compute: stop the server and copy the data/ directory for a
          cold backup. Browser-local data (labels, watchlist, theme, custom ABIs, private notes)
          exports from Settings → Backup &amp; restore.
        </p>
      </CardContent>
    </Card>
  );
}

// --- Uninstall (danger zone) ---

// Failure → operator-ready sentence. The 403 faces reuse the page's gate
// classification: the uninstall endpoints sit behind the STRICT gate (the
// summary does not), so a zero-config server surfaces as 'unconfigured'
// here — the copy must say the in-page action is disabled by design and
// offer both real ways out (configure a token, or use the CLI). The 429
// wait and backend-unreachable attribution follow the page's established
// copy. Exported for the view tests.
export function uninstallErrorText(error: unknown): string {
  const gate = opsAdminGateFromError(error);
  if (gate === 'unauthorized') {
    return 'The server requires an admin token for this action. Set it in the RPC/settings modal (⚙) and retry.';
  }
  if (gate !== null) {
    return 'This backend has no ADMIN_TOKEN configured, so it rejects every uninstall request by design — erasing all server data fails closed, and the server cannot authorize anyone. Start the server with ADMIN_TOKEN set and reload this page, or run my-block-explorer uninstall in a terminal (it deletes the same files).';
  }
  const wait = opsRateLimitWaitSeconds(error);
  if (wait !== null) return `Too many requests — retry after ${wait}s.`;
  if (isBackendUnreachable(error)) {
    return 'The backend is unreachable — it may already be shutting down. Nothing was confirmed.';
  }
  return error instanceof Error ? error.message : String(error);
}

const uninstallDialog = css`
  width: min(560px, 92vw);
`;

const uninstallList = css`
  margin: 0 0 var(--haze-space-3);
  display: grid;
  gap: var(--haze-space-1);
`;

const uninstallRow = css`
  display: flex;
  justify-content: space-between;
  gap: var(--haze-space-3);
  font-size: var(--haze-text-sm);
`;

const uninstallMissing = css`
  color: var(--haze-color-text-muted);
  text-decoration: line-through;
`;

const uninstallTotal = css`
  font-size: var(--haze-text-sm);
  font-weight: 600;
  margin: 0 0 var(--haze-space-3);
`;

const uninstallNote = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-muted);
  margin: 0 0 var(--haze-space-2);
`;

const uninstallActions = css`
  display: flex;
  gap: var(--haze-space-2);
  justify-content: flex-end;
  margin-top: var(--haze-space-4);
`;

const uninstallInput = css`
  padding: var(--haze-space-2) var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  font-size: var(--haze-text-sm);
  font-family: var(--haze-font-mono);
  background: var(--haze-color-bg-subtle);
  color: var(--haze-color-text);
  width: 100%;
  margin-bottom: var(--haze-space-3);

  &:focus {
    outline: none;
    border-color: var(--haze-color-danger);
  }
`;

// The danger zone: the in-server face of `my-block-explorer uninstall`.
// STRICT-gated (fails closed with no ADMIN_TOKEN — the preview error face
// then explains the terminal alternative). The preview lists exactly what
// the backend would erase (the CLI and the endpoint share one
// enumeration), the operator must TYPE the confirmation phrase the API
// demands verbatim, and a 202 means the backend tears itself down — close
// listeners, close DuckDB handles, delete, exit. The toast (not the
// dialog) carries the terminal message: it survives this page flipping to
// its backend-offline state when the process dies.
function UninstallCard() {
  const toast = useToast();
  // Control, never a plain boolean: haze-ui's Dialog treats a value prop
  // as the INITIAL value only (the AddressQr regression pins this).
  const [, setOpen, openControl] = useControl(false);
  const [phase, setPhase] = useState<'loading' | 'confirm' | 'executing' | 'accepted'>('loading');
  const [preview, setPreview] = useState<UninstallPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  const loadPreview = async () => {
    setPhase('loading');
    setError(null);
    try {
      setPreview(await fetchUninstallPreview());
      setPhase('confirm');
      setTyped('');
    } catch (err) {
      setError(uninstallErrorText(err));
      setPhase('confirm');
    }
  };

  const openDialog = () => {
    setOpen(true);
    void loadPreview();
  };

  const execute = async () => {
    setPhase('executing');
    setError(null);
    try {
      await requestBackendUninstall(UNINSTALL_CONFIRM_PHRASE);
      setPhase('accepted');
      toast.danger('Erasure scheduled — the backend is shutting down and exits after deleting.', {
        duration: 8000,
      });
    } catch (err) {
      setError(uninstallErrorText(err));
      setPhase('confirm');
    }
  };

  const existing = preview?.targets.filter(target => target.exists) ?? [];
  const missing = preview?.targets.filter(target => !target.exists) ?? [];

  return (
    <Card className={fullRow}>
      <CardHeader>
        <CardTitle>Uninstall — erase server data</CardTitle>
        <CardDescription>
          The in-server equivalent of <code>my-block-explorer uninstall</code>: deletes every file
          this explorer wrote and exits the backend process. Requires the server&apos;s admin token
          (fails closed without one) and a typed confirmation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className={gateText}>
          Removes the main DuckDB (verified sources, labels, custom chains, RPC configs, indexed
          events), the per-chain event databases, the solc cache and the IDE scratch dir.
          Browser-local data (watchlist, theme, custom ABIs, private notes, search history) is not
          touched — clear site data to remove those. Nothing happens until you confirm.
        </p>
        <div className={refreshRow}>
          <Button variant="danger" size="sm" onClick={openDialog} data-testid="uninstall-button">
            Erase server data…
          </Button>
        </div>
      </CardContent>

      <Dialog
        open={openControl}
        onClose={() => setOpen(false)}
        title="Erase server data"
        className={uninstallDialog}
      >
        {phase === 'accepted' ? (
          <div data-testid="uninstall-accepted">
            <p className={uninstallNote}>
              Erasure scheduled — the backend is shutting down: it closes its databases, deletes the
              files listed above and exits. This page goes offline within seconds; restart later
              with <code>npx my-block-explorer</code>.
            </p>
            <div className={uninstallActions}>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : phase === 'loading' ? (
          <p className={uninstallNote} data-testid="uninstall-loading">
            Enumerating what would be deleted…
          </p>
        ) : (
          <div data-testid="uninstall-confirm">
            {error !== null && (
              <div role="alert" data-testid="uninstall-error" className={uninstallNote}>
                {error}{' '}
                <Button variant="outline" size="sm" onClick={() => void loadPreview()}>
                  Retry
                </Button>
              </div>
            )}
            {preview !== null && (
              <>
                <div className={uninstallList} data-testid="uninstall-preview">
                  {existing.map(target => (
                    <div key={target.path} className={uninstallRow}>
                      <span>{target.label}</span>
                      <span>
                        {formatFileSize(target.bytes)} · {formatNumber(target.files)}{' '}
                        {target.files === 1 ? 'file' : 'files'}
                      </span>
                    </div>
                  ))}
                  {missing.map(target => (
                    <div key={target.path} className={cx(uninstallRow, uninstallMissing)}>
                      <span>{target.label}</span>
                      <span>not present</span>
                    </div>
                  ))}
                </div>
                <p className={uninstallTotal}>
                  {existing.length === 0
                    ? 'Nothing to delete — no explorer data exists on disk.'
                    : `Total: ${formatFileSize(preview.existingBytes)} across ${formatNumber(preview.existingFiles)} files.`}
                </p>
              </>
            )}
            <p className={uninstallNote}>
              The backend process exits right after erasing — every panel on this page goes
              offline. This cannot be undone.
            </p>
            <label className={uninstallNote} htmlFor="uninstall-confirm-input">
              Type <code>{UNINSTALL_CONFIRM_PHRASE}</code> to confirm
            </label>
            <input
              id="uninstall-confirm-input"
              type="text"
              className={uninstallInput}
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={UNINSTALL_CONFIRM_PHRASE}
              spellCheck={false}
              autoComplete="off"
              data-testid="uninstall-confirm-input"
            />
            <div className={uninstallActions}>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={typed !== UNINSTALL_CONFIRM_PHRASE || existing.length === 0}
                loading={phase === 'executing'}
                onClick={() => void execute()}
                data-testid="uninstall-execute"
              >
                Erase everything
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Card>
  );
}

export default function Ops() {
  const router = useRouter();
  const toast = useToast();
  // Not chain-scoped, but the topbar still is (its links and search route
  // into /chain/:chainId pages): the remembered chain provides that context,
  // same fallback order as the other chain-less pages (SQL console, Search).
  const navChainId = readRememberedChainId() ?? 1;
  const handleNavChainChange = (chainId: number) => {
    navigate(router, `/chain/${chainId}`).catch(() => undefined);
  };

  const summary = useOpsSummary();
  const retry = () => void summary.refetch();

  // One-click diagnostics for bug reports: the already-fetched summary,
  // serialized whole (per-section verdicts included) to the clipboard.
  // Same toast contract as CopyableHash — success and failure both say so.
  const copyDiagnostics = async () => {
    if (summary.data === undefined) return;
    const text = JSON.stringify(buildOpsDiagnostics(summary.data), null, 2);
    if (await copyText(text)) {
      toast('Diagnostics copied to clipboard', { variant: 'success', duration: 2000 });
    } else {
      toast('Failed to copy diagnostics', { variant: 'danger', duration: 2000 });
    }
  };

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
                    This snapshot came from the backend itself; it auto-refreshes every 30 seconds
                    while this tab is visible.
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
                    <Button variant="outline" size="sm" onClick={retry} loading={summary.fetching}>
                      Refresh
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void copyDiagnostics()}>
                      Copy diagnostics
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
              <UninstallCard />
            </div>
          </>
        )}
      </PageContainer>
    </>
  );
}
