// Watchlist panel (Home): addresses this browser tracks against live
// blocks. Storage lives in util/watchlist.ts (localStorage, per browser);
// this component owns the page-open half of the honesty contract —
// matching runs only while THIS page is open against blocks pushed by the
// live SSE stream. It is not a background service, and the copy below
// says so.
//
// Cost control (a full-block fetch is the expensive part):
// - the fetch happens ONLY while the watchlist is non-empty;
// - at most ONE fetch per block event (the stream manager already
//   de-duplicates blocks, and a per-chain scanned marker here makes the
//   guard local and testable);
// - only the first MAX_TXS_SCANNED transactions of a block are examined;
// - a failed fetch skips that block silently (no retry, no error surface).
import { css } from '@linaria/core';
import { useRef, useState } from 'react';
import { TypedLink } from '@native-router/react';
import { Input } from 'haze-ui';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatAddress, formatHash, formatNumber } from '@/utils/format';
import { createRpcClient } from '@/utils/realTimeData';
import {
  addWatchlistEntry,
  readWatchlist,
  removeWatchlistEntry,
  WATCHLIST_MAX_ENTRIES,
} from '@/util/watchlist';
import { useLiveBlockEvents, type LiveBlockPayload } from '@/services/liveChain';

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

// --- component ---

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
    </div>
  );
}
