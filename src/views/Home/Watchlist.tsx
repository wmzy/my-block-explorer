// Watchlist panel (Home): two sections with one honesty story.
//
// 1. Browser watchlist (below): addresses this browser tracks against
//    live blocks. Storage lives in util/watchlist.ts (localStorage, per
//    browser); matching runs only while THIS page is open against blocks
//    pushed by the live SSE stream — the copy in that section says so.
//
// 2. Server-side watching (backend): the panel backed by the explorer's
//    own watch service (routes/watch.ts + services/WatchService.ts) —
//    watching continues while the LOCAL backend runs, browser
//    notifications arrive while any explorer tab is open, and gaps wider
//    than 200 blocks are skipped and reported as gap markers. Never a
//    dead form: without a backend the section renders the honest offline
//    card instead.
//
// Cost control (a full-block fetch is the expensive part) for section 1:
// - the fetch happens ONLY while the watchlist is non-empty;
// - at most ONE fetch per block event (the stream manager already
//   de-duplicates blocks, and a per-chain scanned marker here makes the
//   guard local and testable);
// - only the first MAX_TXS_SCANNED transactions of a block are examined;
// - a failed fetch skips that block silently (no retry, no error surface).
import { css, cx } from '@linaria/core';
import { useEffect, useRef, useState } from 'react';
import { TypedLink } from '@native-router/react';
import { Input } from 'haze-ui';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatAddress, formatHash, formatNumber, formatRelativeTime } from '@/utils/format';
import { isDiscordWebhookUrl } from '@/utils/webhooks';
import { createRpcClient } from '@/utils/realTimeData';
import {
  addWatchlistEntry,
  readWatchlist,
  removeWatchlistEntry,
  WATCHLIST_MAX_ENTRIES,
} from '@/util/watchlist';
import { getApiBase, onApiBaseChange } from '@/util/apiBase';
import { isBackendUnreachable } from '@/util/http';
import { ApiError } from '@/util/apiError';
import { checkAddressValidity } from '@/views/Address/addressValidity';
import { useLiveBlockEvents, useWatchEvents, type LiveBlockPayload } from '@/services/liveChain';
import {
  deleteWatchSubscription,
  fetchWatchEvents,
  saveWatchSubscription,
  useWatchSubscriptions,
  watchEventKey,
  WATCH_FEED_ITEMS,
  type WatchEventView,
} from '@/services/watch';

// Hard ceiling on transactions examined per block: enough to cover real
// blocks comfortably, bounded enough that a pathological block cannot
// make matching expensive.
const MAX_TXS_SCANNED = 500;

// Both a browser-notification storm guard and the in-page list length:
// newest matches first, older ones fall off.
const MAX_MATCHES_KEPT = 5;

const ADD_REJECTION_COPY = {
  format: 'Not a valid address — expected 0x followed by 40 hex characters.',
  checksum:
    'Address checksum mismatch — use the all-lowercase form or copy a checksummed address.',
  duplicate: 'Already on the watchlist.',
  full: `Watchlist is full (${WATCHLIST_MAX_ENTRIES} addresses).`,
} as const;

// Minimal structural view of a viem full-block transaction — matching
// needs exactly from/to/hash.
type ScannedTransaction = { hash: string; from: string; to: string | null };

export type WatchlistMatch = {
  chainId: number;
  address: string;
  blockNumber: string;
  txHash: string;
};

/**
 * Pure matcher: which watched addresses appear as from/to in the given
 * transactions (case-insensitive), at most `cap` results, in scan order.
 */
export function findWatchedMatches(
  transactions: readonly ScannedTransaction[],
  watchedLower: ReadonlySet<string>,
  cap: number,
): { address: string; txHash: string }[] {
  const matches: { address: string; txHash: string }[] = [];
  for (const tx of transactions) {
    const from = tx.from.toLowerCase();
    const to = tx.to?.toLowerCase();
    const hit = watchedLower.has(from) ? from : to !== undefined && watchedLower.has(to) ? to : undefined;
    if (hit !== undefined) {
      matches.push({ address: hit, txHash: tx.hash });
      if (matches.length >= cap) break;
    }
  }
  return matches;
}

// --- styles ---

const panelCard = css`
  margin-bottom: var(--haze-space-6);
`;

const formRow = css`
  display: flex;
  gap: var(--haze-space-2);
  align-items: center;

  input {
    flex: 1;
    min-width: 0;
  }

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: stretch;

    button {
      width: 100%;
    }
  }
`;

const addErrorStyle = css`
  color: var(--haze-color-danger, #d33);
  font-size: var(--haze-text-xs);
  margin-top: var(--haze-space-2);
`;

const entryRow = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--haze-space-3);
  padding: var(--haze-space-2) 0;
  border-bottom: 1px solid var(--haze-color-border);
  text-align: left;

  &:last-child {
    border-bottom: none;
  }
`;

const entryList = css`
  margin-top: var(--haze-space-3);
`;

const matchRow = css`
  padding: var(--haze-space-2) 0;
  border-bottom: 1px solid var(--haze-color-border);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);

  &:last-child {
    border-bottom: none;
  }
`;

const note = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  margin-top: var(--haze-space-2);
`;

const permissionRow = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  flex-wrap: wrap;
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

// --- server-side watching (backend) styles ---

const serverSection = css`
  margin-top: var(--haze-space-4);
`;

const offlineCard = css`
  border: 1px dashed var(--haze-color-border);
  border-radius: var(--haze-radius-md, 8px);
  padding: var(--haze-space-4);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-muted);
`;

const serverErrorRow = css`
  margin-top: var(--haze-space-2);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-danger, #d33);
`;

const labelField = css`
  flex: 0 0 10rem;

  @media (max-width: 768px) {
    flex: 1 1 auto;
  }
`;

const webhookField = css`
  flex: 1 1 14rem;
  min-width: 0;

  @media (max-width: 768px) {
    flex: 1 1 auto;
  }
`;

const discordHint = css`
  margin-top: var(--haze-space-2);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-primary, #5865f2);
`;

const entryMain = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
  min-width: 0;
`;

const webhookMeta = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  overflow-wrap: anywhere;
`;

const webhookStatusFailed = css`
  color: var(--haze-color-danger, #d33);
`;

const cursorMeta = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  white-space: nowrap;
`;

const rowActions = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  flex-shrink: 0;
`;

const gapRow = css`
  padding: var(--haze-space-2) 0;
  border-bottom: 1px solid var(--haze-color-border);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-warning, #a80);

  &:last-child {
    border-bottom: none;
  }
`;

// --- component: browser watchlist (section 1) ---

export default function Watchlist({
  chainId,
  live,
}: {
  chainId: number;
  live: boolean;
}) {
  const [entries, setEntries] = useState<string[]>(() => readWatchlist());
  const [input, setInput] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [matches, setMatches] = useState<WatchlistMatch[]>([]);
  // 'unsupported' is our own tier for browsers without the Notification
  // API (matching still runs; only the OS-level alert is missing).
  const [permission, setPermission] = useState<'unsupported' | NotificationPermission>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  // Per-chain marker of the last block whose full transaction list was
  // fetched: one fetch per block event even if the stream re-delivers or
  // a re-render re-fires the callback. Stored with its chain so a chain
  // switch cannot collide on block numbers.
  const scannedRef = useRef<{ chainId: number; number: string } | null>(null);

  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const permissionRef = useRef(permission);
  permissionRef.current = permission;

  const handleAdd = () => {
    const result = addWatchlistEntry(input);
    setEntries(result.entries);
    if (result.ok) {
      setInput('');
      setAddError(null);
    } else {
      setAddError(ADD_REJECTION_COPY[result.reason]);
    }
  };

  const handleRemove = (address: string) => {
    setEntries(removeWatchlistEntry(address));
  };

  const handleEnableNotifications = () => {
    if (typeof Notification === 'undefined') return;
    void Notification.requestPermission().then(setPermission);
  };

  // Per-live-block matching. Runs only when the watchlist is non-empty
  // (cost control) and only while the stream actually delivers blocks —
  // useLiveBlockEvents never fires in polling mode.
  useLiveBlockEvents(chainId, block => {
    const watched = entriesRef.current;
    if (watched.length === 0) return;
    const scanned = scannedRef.current;
    if (scanned !== null && scanned.chainId === chainId && scanned.number === block.number) return;
    scannedRef.current = { chainId, number: block.number };
    void scanLiveBlock(chainId, block, new Set(watched.map(entry => entry.toLowerCase())));
  });

  // The scan itself. Never touches component state on failure — a failed
  // block fetch skips that block silently, exactly once (scannedRef has
  // already moved on).
  const scanLiveBlock = async (
    chainId: number,
    block: LiveBlockPayload,
    watchedLower: ReadonlySet<string>,
  ) => {
    let transactions: readonly ScannedTransaction[];
    try {
      const client = await createRpcClient(chainId);
      const full = await client.getBlock({
        blockNumber: BigInt(block.number),
        includeTransactions: true,
      });
      transactions = full.transactions;
    } catch {
      return;
    }
    const found = findWatchedMatches(
      transactions.slice(0, MAX_TXS_SCANNED),
      watchedLower,
      MAX_MATCHES_KEPT,
    );
    if (found.length === 0) return;

    setMatches(prev =>
      [
        ...found.map(match => ({
          chainId,
          address: match.address,
          blockNumber: block.number,
          txHash: match.txHash,
        })),
        ...prev,
      ].slice(0, MAX_MATCHES_KEPT),
    );

    if (permissionRef.current === 'granted') {
      for (const match of found) {
        try {
          new Notification('Watchlist activity', {
            body: `${formatAddress(match.address)} in block ${formatNumber(block.number)} · tx ${match.txHash}`,
            tag: `${chainId}-${match.txHash}-${match.address}`,
          });
        } catch {
          // A rejected constructor (e.g. platform restrictions) must not
          // break the in-page record above.
        }
      }
    }
  };

  const permissionCopy: Record<'unsupported' | NotificationPermission, string> = {
    unsupported:
      'Browser notifications are not supported here — matches still appear below.',
    default: 'Matches also appear below.',
    granted: 'Notifications on.',
    denied:
      'Blocked by the browser — re-enable site notifications in the browser settings to get alerts. Matches still appear below.',
  };

  return (
    <div data-testid="watchlist" className={panelCard}>
      <Card>
        <CardHeader>
          <CardTitle>Watchlist</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className={formRow}
            onSubmit={e => {
              e.preventDefault();
              if (input.trim()) handleAdd();
            }}
          >
            <Input
              placeholder="0x… address to watch"
              value={input}
              onChange={e => setInput(e.target.value)}
            />
            <Button variant="outline" disabled={!input.trim()} onClick={handleAdd}>
              Add
            </Button>
          </form>
          {addError !== null && <div className={addErrorStyle}>{addError}</div>}

          {entries.length > 0 && (
            <div className={entryList}>
              {entries.map(entry => (
                <div key={entry.toLowerCase()} className={entryRow}>
                  <TypedLink
                    to={`/chain/${chainId}/address/${entry}`}
                    title={entry}
                  >
                    {formatAddress(entry)}
                  </TypedLink>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRemove(entry)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className={permissionRow}>
            {permission === 'default' && (
              <Button variant="outline" size="sm" onClick={handleEnableNotifications}>
                Enable notifications
              </Button>
            )}
            <span>{permissionCopy[permission]}</span>
          </div>

          {matches.length > 0 && (
            <div>
              {matches.map(match => (
                <div
                  key={`${match.chainId}-${match.txHash}-${match.address}`}
                  className={matchRow}
                >
                  <TypedLink to={`/chain/${match.chainId}/address/${match.address}`}>
                    {formatAddress(match.address)}
                  </TypedLink>{' '}
                  in block {formatNumber(match.blockNumber)} · tx{' '}
                  <TypedLink to={`/chain/${match.chainId}/tx/${match.txHash}`}>
                    {formatHash(match.txHash)}
                  </TypedLink>
                </div>
              ))}
            </div>
          )}

          <div className={note}>
            Addresses are checked against live blocks while this page is
            open — not a background service. Matching looks at the from/to
            of each transaction in the newest blocks (first {MAX_TXS_SCANNED}{' '}
            per block).
            {!live && ' Live stream not connected — matching is inactive while the list updates by polling.'}
          </div>
        </CardContent>
      </Card>

      {/* Section 2: the backend's own watch service (DB-backed
          subscriptions + live feed). Owns its backend-presence guard so
          this panel never renders a dead form. */}
      <ServerWatchPanel chainId={chainId} />
    </div>
  );
}

// --- component: server-side watching (section 2) ---

// Two-tier copy mirrors the browser panel's add rejections; duplicate and
// full are the SERVER's verdicts here and surface with its messages.
const SERVER_ADD_REJECTION_COPY = {
  format: 'Not a valid address — expected 0x followed by 40 hex characters.',
  checksum:
    'Address checksum mismatch — use the all-lowercase form or copy a checksummed address.',
} as const;

// Same guidance the Contract view's gated writes give (403 = the browser
// has no/wrong token while the server requires ADMIN_TOKEN).
const ADMIN_TOKEN_GUIDANCE =
  'Requires admin token — set it via ⚙ RPC → Admin token. The server must have ADMIN_TOKEN configured.';

const describeServerError = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) {
    return error.status === 403 ? `${error.message} — ${ADMIN_TOKEN_GUIDANCE}` : error.message;
  }
  return fallback;
};

/**
 * Backend-presence gate: no discovered API base → the honest offline
 * card (never a dead form); a base (initial, late discovery, or manual
 * switch) renders the live panel. Split so the connected half can use
 * hooks unconditionally behind the guard.
 */
function ServerWatchPanel({ chainId }: { chainId: number }) {
  const [apiBase, setApiBaseState] = useState(getApiBase);
  useEffect(() => onApiBaseChange(() => setApiBaseState(getApiBase())), []);

  if (apiBase === '') {
    return (
      <Card className={serverSection}>
        <CardHeader>
          <CardTitle>Server-side watching (backend)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={offlineCard}>
            Server-side watching needs the local backend, which is not
            connected. The browser watchlist above keeps working against
            RPC directly — start the backend (or fix its address in ⚙ RPC
            settings) to subscribe addresses the backend watches for you.
          </div>
        </CardContent>
      </Card>
    );
  }
  return <ServerWatchPanelConnected key={chainId} chainId={chainId} />;
}

function ServerWatchPanelConnected({ chainId }: { chainId: number }) {
  const subs = useWatchSubscriptions(chainId);
  const [addressInput, setAddressInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [webhookInput, setWebhookInput] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [events, setEvents] = useState<WatchEventView[]>([]);
  const [eventsReload, setEventsReload] = useState(0);

  // Seed the feed with the ring buffer's newest entries; live updates
  // arrive through the SSE watch frames below. A failed seed leaves the
  // feed empty (it fills from the stream) — never fabricated rows.
  useEffect(() => {
    let alive = true;
    fetchWatchEvents(chainId, WATCH_FEED_ITEMS)
      .then(seed => {
        if (alive) setEvents(seed);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [chainId, eventsReload]);

  // Live tail: prepend each pushed event, deduped by its stable key.
  useWatchEvents(chainId, event => {
    setEvents(prev =>
      [event, ...prev.filter(existing => watchEventKey(existing) !== watchEventKey(event))].slice(
        0,
        WATCH_FEED_ITEMS,
      ),
    );
  });

  const handleAdd = async () => {
    const trimmed = addressInput.trim();
    const validity = checkAddressValidity(trimmed);
    if (!validity.valid) {
      setAddError(SERVER_ADD_REJECTION_COPY[validity.tier]);
      return;
    }
    setBusy(true);
    setAddError(null);
    try {
      // Empty webhook field = leave the stored webhook unchanged (the
      // server treats an absent key as unchanged — a label-only re-put
      // must not drop a configured webhook). Clearing is its own
      // per-row action below.
      await saveWatchSubscription(
        chainId,
        trimmed,
        labelInput.trim() === '' ? null : labelInput.trim(),
        webhookInput.trim() === '' ? undefined : webhookInput.trim(),
      );
      setAddressInput('');
      setLabelInput('');
      setWebhookInput('');
      void subs.refetch();
      setEventsReload(n => n + 1);
    } catch (error) {
      setAddError(describeServerError(error, 'Failed to save the subscription.'));
    } finally {
      setBusy(false);
    }
  };

  // Per-row webhook clear: the API's "empty string = clear" channel.
  // The label rides along unchanged so the row keeps its annotation.
  const handleClearWebhook = async (address: string, label: string | null) => {
    setBusy(true);
    setRemoveError(null);
    try {
      await saveWatchSubscription(chainId, address, label, '');
      void subs.refetch();
    } catch (error) {
      setRemoveError(describeServerError(error, 'Failed to clear the webhook.'));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (address: string) => {
    setBusy(true);
    setRemoveError(null);
    try {
      await deleteWatchSubscription(chainId, address);
      void subs.refetch();
    } catch (error) {
      // 404 = someone else removed it first; the refetch shows the truth.
      if (!(error instanceof ApiError && error.status === 404)) {
        setRemoveError(describeServerError(error, 'Failed to remove the subscription.'));
      } else {
        void subs.refetch();
      }
    } finally {
      setBusy(false);
    }
  };

  // Backend dropped after discovery: same honest card as never-connected.
  if (subs.error !== undefined && isBackendUnreachable(subs.error)) {
    return (
      <Card className={serverSection}>
        <CardHeader>
          <CardTitle>Server-side watching (backend)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={offlineCard}>
            The backend became unreachable — server-side watching is
            unavailable until it comes back (the browser watchlist above is
            unaffected). Check the backend process or its address in ⚙ RPC
            settings.
          </div>
        </CardContent>
      </Card>
    );
  }

  const subscriptions = subs.data;
  const subscriptionRows = subscriptions?.every(row => row.chainId === chainId)
    ? subscriptions
    : undefined;

  return (
    <Card className={serverSection}>
      <CardHeader>
        <CardTitle>Server-side watching (backend)</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className={formRow}
          onSubmit={e => {
            e.preventDefault();
            if (addressInput.trim() && !busy) void handleAdd();
          }}
        >
          <Input
            placeholder="0x… address for the backend to watch"
            value={addressInput}
            onChange={e => setAddressInput(e.target.value)}
          />
          <Input
            className={labelField}
            placeholder="Label (optional)"
            value={labelInput}
            onChange={e => setLabelInput(e.target.value)}
          />
          <Input
            className={webhookField}
            placeholder="Webhook URL (optional, Discord supported)"
            value={webhookInput}
            onChange={e => setWebhookInput(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={!addressInput.trim() || busy}
            onClick={() => void handleAdd()}
          >
            Watch
          </Button>
        </form>
        {isDiscordWebhookUrl(webhookInput.trim()) && (
          <div className={discordHint}>
            Discord webhook detected — sends an embed
          </div>
        )}
        {addError !== null && <div className={serverErrorRow}>{addError}</div>}
        {subs.error !== undefined && (
          <div className={serverErrorRow}>
            Could not load subscriptions — {describeServerError(subs.error, 'request failed')}.
          </div>
        )}
        {removeError !== null && <div className={serverErrorRow}>{removeError}</div>}

        {subscriptionRows !== undefined && subscriptionRows.length > 0 && (
          <div className={entryList}>
            {subscriptionRows.map(row => (
              <div key={row.address} className={entryRow}>
                <div className={entryMain}>
                  <TypedLink to={`/chain/${chainId}/address/${row.address}`} title={row.address}>
                    {row.label !== null && row.label !== ''
                      ? `${row.label} · ${formatAddress(row.address)}`
                      : formatAddress(row.address)}
                  </TypedLink>
                  {row.webhookUrl !== null && (
                    <span
                      className={cx(
                        webhookMeta,
                        row.webhookStatus !== null
                        && row.webhookStatus !== 'ok'
                        && webhookStatusFailed,
                      )}
                      title={row.webhookUrl}
                    >
                      webhook{' '}
                      {row.webhookStatus === null
                        ? 'pending'
                        : row.webhookStatus === 'ok'
                          ? 'ok'
                          : row.webhookStatus}
                      {row.webhookLastAt !== null && ` · last ${formatRelativeTime(row.webhookLastAt)}`}
                    </span>
                  )}
                </div>
                <span className={rowActions}>
                  <span className={cursorMeta}>
                    {row.lastProcessedBlock !== null
                      ? `through block ${formatNumber(row.lastProcessedBlock)}`
                      : 'starting at the next block'}
                  </span>
                  {row.webhookUrl !== null && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleClearWebhook(row.address, row.label)}
                    >
                      Clear webhook
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleRemove(row.address)}
                  >
                    Remove
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}

        {events.length > 0 && (
          <div className={entryList}>
            {events.map(event => (
              <div key={watchEventKey(event)} className={event.kind === 'gap' ? gapRow : matchRow}>
                {event.kind === 'gap' ? (
                  event.message
                ) : (
                  <>
                    <TypedLink to={`/chain/${event.chainId}/address/${event.address}`}>
                      {formatAddress(event.address)}
                    </TypedLink>{' '}
                    in block {formatNumber(event.blockNumber)} · tx{' '}
                    <TypedLink to={`/chain/${event.chainId}/tx/${event.txHash}`}>
                      {formatHash(event.txHash ?? '')}
                    </TypedLink>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div className={note}>
          Watching runs while your local backend runs; browser notifications
          arrive while an explorer tab is open. Gaps wider than 200 blocks
          are skipped and reported. Watching starts at the moment you
          subscribe — it never walks history. Webhook delivery also runs
          from the backend while it runs: each watched event is POSTed once
          (5s timeout, one retry), and each row shows the recorded outcome
          of its latest delivery — it does not retry until you re-put the
          subscription.
        </div>
      </CardContent>
    </Card>
  );
}
