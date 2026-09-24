// Approvals (discovered) — read-only token-approval viewer for the
// Address page.
//
// Self-contained (BalanceHistory card pattern): fetches its own page from
// GET /api/chains/:chainId/addresses/:address/approvals through the query
// layer on mount, resolves token symbol/decimals through the shared
// frontend metadata cache (services/tokenMetadata — RPC reads are
// frontend territory by design; the backend deliberately returns raw
// token addresses), and renders null only for gated keys (chainId <= 0 /
// blank address). Loading, error, empty and degraded states all say what
// they are.
//
// Rows span the three standards the backend discovers: ERC-20 allowances,
// ERC-721 single-token approvals (tokenId column) and ERC-1155 operator
// approvals ("operator" wording, all-token-ids scope).
//
// Below the current-allowance table, a collapsed-by-default "Approval
// history" sub-section rides the SAME fetch: the raw approval events the
// scan retained (newest first, server-capped at 200) — event-level
// context for the snapshot above, never presented as complete history.
//
// Honesty contract: discovery is window-limited (the response's
// windowBlocks/coverage carry the caveat) and current values were read
// at the head block of the scan — the mandatory caveat renders with every
// list. The only in-product action is each row's Revoke link, which lands
// on the token contract's Interact tab with a ?revoke= intent that
// pre-fills the standard revocation call on the existing wallet-send
// flow (views/Contract/revokeIntent.ts) — this card never broadcasts
// anything itself. revoke.cash stays as the secondary external escape
// hatch.
import { css } from '@linaria/core';
import { useCallback, useMemo, type ReactNode } from 'react';
import { TypedLink } from '@native-router/react';
import { formatUnits, getAddress } from 'viem';
import { Collapsible } from '@/components/ui/Collapsible';
import { Button } from '@/components/ui/Button';
import { linkStyle } from '@/components/ui/DataTable';
import { ApiError } from '@/util/apiError';
import { get, longRunningApi, withSignal } from '@/util/http';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';
import { formatHash, formatNumber } from '@/utils/format';
import { useTokenMetadata, type TokenMetadata } from '@/services/tokenMetadata';
import { encodeRevokeIntent } from '@/views/Contract/revokeIntent';

/** Approval standards the backend discovers (absent kind = pre-kind payload = ERC-20). */
export type ApprovalKind = 'erc20' | 'erc721' | 'erc1155';

/**
 * One approval row — the backend contract (values BigInt-exact decimal
 * strings). `kind` is absent only on pre-kind payloads (= ERC-20).
 * `allowance`/`isMax` are kind-dependent scope values on the wire (see
 * the backend type): exact ERC-20 amounts, or '1'-sentinels for the NFT
 * kinds — the per-kind rendering below never surfaces the sentinels.
 */
export type DiscoveredApproval = {
  token: string;
  spender: string;
  kind?: ApprovalKind;
  tokenId?: string;
  allowance: string;
  isMax: boolean;
};

/**
 * One raw approval event from the sweep (the backend's bounded history —
 * see its service doc): a DIFFERENT projection of the same discovery,
 * not deduped to distinct pairs. Revocations are represented honestly —
 * ERC-20 rows carry value '0', and ApprovalForAll revocations are
 * excluded server-side (the wire shape cannot say "unapproved").
 */
export type ApprovalHistoryEvent = {
  kind: ApprovalKind;
  approvalEvent: 'Approval' | 'ApprovalForAll';
  token: string;
  owner: string;
  spender: string;
  blockNumber: number;
  txHash: string;
  // ERC-20 amount (BigInt-exact decimal string; '0' = a revocation);
  // null for the NFT kinds.
  value: string | null;
};

/** Response envelope of GET /api/chains/:chainId/addresses/:address/approvals. */
export type ApprovalsPage = {
  chainId: number;
  address: string;
  approvals: DiscoveredApproval[];
  // Raw events retained by the scan, newest-first, server-capped at 200.
  // Absent when the scan saw none (the endpoint's additive contract).
  history?: ApprovalHistoryEvent[];
  // True when more raw events existed than the server cap keeps.
  historyTruncated?: boolean;
  // First-scan time of the server-side ~60s cache entry (a cache hit does
  // not reset it); optional so pre-scannedAt payloads stay renderable.
  scannedAt?: string;
  windowBlocks: number;
  coverage: 'complete' | 'partial' | 'scan-failed';
  // TOTAL distinct approvals discovered, pre-cap, across ALL kinds.
  pairCount: number;
  truncated: boolean;
  // Present when pairs were discovered but the current-value reads
  // failed — approvals is then empty, honestly.
  reason?: 'allowance-read-failed';
};

/**
 * Fetch the approvals page. Rides `longRunningApi` (the server scans
 * under its own budget) and resolves undefined without a request for
 * gated keys (chainId <= 0 / blank address).
 */
export function fetchAddressApprovals(
  chainId: number,
  address: string,
  window?: number,
  signal?: AbortSignal,
): Promise<ApprovalsPage | undefined> {
  if (chainId <= 0 || address === '') return Promise.resolve(undefined);
  return get<ApprovalsPage>(
    `/api/chains/${chainId}/addresses/${address}/approvals`,
    { window },
    withSignal(longRunningApi, signal),
  );
}

export const approvalsCache = createQueryCache<
  ApprovalsPage | undefined,
  [number, string, number | undefined]
>('address-approvals');

const queryApprovals = bindQueryFn(fetchAddressApprovals, approvalsCache);

const useApprovalsQuery = createQueryHook({ queryFn: queryApprovals });

export type ApprovalSectionProps = {
  chainId: number;
  address: string;
};

// --- styles ---

const approvalsToolbar = css`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
  margin-bottom: var(--haze-space-3);
`;

const approvalsScannedAt = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-font-size-sm);
`;

const externalLink = css`
  color: var(--haze-color-primary);
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`;

const approvalsTableWrap = css`
  overflow-x: auto;
`;

const approvalsTable = css`
  width: 100%;
  border-collapse: collapse;
  font-size: var(--haze-font-size-sm);

  th {
    text-align: left;
    color: var(--haze-color-text-muted);
    font-weight: var(--haze-font-weight-medium, 500);
    padding: var(--haze-space-2) var(--haze-space-3) var(--haze-space-2) 0;
    border-bottom: 1px solid var(--haze-color-border);
    white-space: nowrap;
  }

  td {
    padding: var(--haze-space-2) var(--haze-space-3) var(--haze-space-2) 0;
    border-bottom: 1px solid var(--haze-color-border);
    vertical-align: top;
    word-break: break-word;
  }
`;

const allowanceCell = css`
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
`;

const maxBadge = css`
  display: inline-block;
  padding: 0 var(--haze-space-2);
  border-radius: var(--haze-radius-full, 999px);
  background: var(--haze-color-warning-subtle, var(--haze-color-warning));
  color: var(--haze-color-warning);
  font-size: var(--haze-font-size-xs, 0.75rem);
  font-weight: 600;
  line-height: 1.6;
`;

// Kind chip: same quiet shape as the Max badge, neutral palette (the
// standard a row belongs to is context, not an alert).
const kindBadge = css`
  display: inline-block;
  padding: 0 var(--haze-space-2);
  border-radius: var(--haze-radius-full, 999px);
  background: var(--haze-color-bg-muted, var(--haze-color-bg-subtle));
  color: var(--haze-color-text-muted);
  font-size: var(--haze-font-size-xs, 0.75rem);
  font-weight: 600;
  line-height: 1.6;
  white-space: nowrap;
`;

// In-product Revoke action (same link treatment as the external one).
const revokeLink = css`
  color: var(--haze-color-primary);
  text-decoration: none;
  white-space: nowrap;
  &:hover {
    text-decoration: underline;
  }
`;

const approvalsCaveats = css`
  list-style: none;
  margin: var(--haze-space-3) 0 0;
  padding: 0;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-font-size-sm);
  display: grid;
  gap: var(--haze-space-1);
`;

const approvalsNote = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-font-size-sm);
`;

const approvalsUnavailable = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-font-size-sm);
  padding: var(--haze-space-2) 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--haze-space-2);
  flex-wrap: wrap;
`;

const approvalsSkeleton = css`
  display: inline-block;
  width: 100%;
  height: 3rem;
  border-radius: var(--haze-radius-md, var(--haze-radius-lg));
  background: linear-gradient(
    90deg,
    var(--haze-color-bg-subtle) 25%,
    var(--haze-color-bg-muted) 50%,
    var(--haze-color-bg-subtle) 75%
  );
  background-size: 200% 100%;
  animation: approvals-shimmer 1.2s ease-in-out infinite;
  @keyframes approvals-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
`;

// History sub-section: rides the SAME fetch below the current-allowance
// table, as its own collapsed-by-default collapsible.
const historySection = css`
  margin-top: var(--haze-space-4);
`;

// --- helpers ---

const shortAddress = (a: string) => (a ? `${a.slice(0, 8)}...${a.slice(-6)}` : 'N/A');

const KIND_LABELS: Record<ApprovalKind, string> = {
  erc20: 'ERC-20',
  erc721: 'ERC-721',
  erc1155: 'ERC-1155',
};

/**
 * The in-product revoke target for one row, or null when there is nothing
 * to revoke: an ERC-20 allowance reading zero, or an ERC-721/1155 row
 * whose current-state read no longer says approved (the backend omits
 * those rows, so this is the client-side guard of the same rule).
 */
const revokeHref = (approval: DiscoveredApproval): string | null => {
  const kind = approval.kind ?? 'erc20';
  if (kind === 'erc20' && approval.allowance === '0') return null;
  if (kind === 'erc721' && approval.tokenId === undefined) return null;
  return encodeRevokeIntent({
    kind,
    token: approval.token,
    spender: approval.spender,
    ...(kind === 'erc721' ? { tokenId: approval.tokenId } : {}),
  });
};

/**
 * One table row: token (symbol or short address), kind chip, spender /
 * operator, ERC-721 token id, and the current grant — a formatted
 * allowance for ERC-20, an honest live-approval label for the NFT kinds
 * (their rows exist only while the current-state read says approved) —
 * plus the in-product Revoke action when there is something to revoke.
 */
function ApprovalRow({
  approval,
  symbol,
  decimals,
  chainId,
}: {
  approval: DiscoveredApproval;
  symbol: string | null;
  decimals: number | null;
  chainId: number;
}) {
  const kind = approval.kind ?? 'erc20';

  // Allowance / state cell. ERC-20: Max badge for effectively-unlimited
  // grants; otherwise the decimals-formatted amount when the token's
  // decimals resolved (BigInt-exact via formatUnits), and the RAW decimal
  // string when they did not — a guessed decimals amount is never shown.
  // ERC-721: the row exists only while getApproved(tokenId) still names
  // this spender. ERC-1155: isApprovedForAll covers every token id of the
  // contract — the scope IS the grant. (The NFT kinds' wire sentinels are
  // never surfaced.)
  let allowanceBody: ReactNode;
  if (kind === 'erc721') {
    allowanceBody = (
      <span title="getApproved(tokenId) still names this spender (read at the scan's head block)">
        Approved
      </span>
    );
  } else if (kind === 'erc1155') {
    allowanceBody = (
      <span title="isApprovedForAll(owner, operator) read true at the scan's head block — the operator may move every token id of this contract">
        All token IDs
      </span>
    );
  } else if (approval.isMax) {
    allowanceBody = (
      <span className={maxBadge} data-testid="approval-max-badge" title={approval.allowance}>
        Max
      </span>
    );
  } else if (decimals !== null) {
    allowanceBody = (
      <span title={approval.allowance}>
        {formatUnits(BigInt(approval.allowance), decimals)}
        {symbol !== null ? ` ${symbol}` : ''}
      </span>
    );
  } else {
    allowanceBody = <span title="Token decimals unknown — raw value">{approval.allowance}</span>;
  }

  const revoke = revokeHref(approval);

  return (
    <tr data-testid="approval-row">
      <td title={approval.token}>{symbol ?? shortAddress(approval.token)}</td>
      <td>
        <span className={kindBadge} data-testid="approval-kind">
          {KIND_LABELS[kind]}
        </span>
      </td>
      <td title={kind === 'erc1155' ? `Operator ${approval.spender}` : `Spender ${approval.spender}`}>
        {shortAddress(approval.spender)}
      </td>
      <td>{kind === 'erc721' ? `#${approval.tokenId}` : '—'}</td>
      <td className={allowanceCell}>{allowanceBody}</td>
      <td>
        {revoke !== null ? (
          // Plain anchor (EventTable pattern): this section renders
          // standalone outside any Router context, and the revoke target
          // is a full deep link anyway — the encoded intent is lowercase
          // dot-delimited hex/digits, so encodeURIComponent is a no-op
          // guard, not a necessity.
          <a
            href={`/chain/${chainId}/contract/${approval.token}?tab=interact&revoke=${encodeURIComponent(revoke)}`}
            className={revokeLink}
          >
            <span data-testid="approval-revoke-link">Revoke</span>
          </a>
        ) : (
          <span title="Nothing to revoke — the current read shows no live approval">—</span>
        )}
      </td>
    </tr>
  );
}

// --- approval history (raw events from the same sweep) ---

// "Unlimited" threshold mirroring the backend's isMax rule: history
// grants at or above 2^128 render as the Max badge, never an absurd
// decimals-formatted number.
const HISTORY_MAX_THRESHOLD = 2n ** 128n;

/**
 * The granted-value cell for one history row: null (NFT kinds — the
 * grant is not a value) renders the honest em dash; a decoded ERC-20
 * amount renders Max / formatted / raw under the same rules as the
 * current-allowance table (a guessed decimals amount is never shown).
 */
function historyValueBody(
  event: ApprovalHistoryEvent,
  symbol: string | null,
  decimals: number | null,
): ReactNode {
  if (event.value === null) {
    return (
      <span title="Not a valued grant — ERC-721 token approvals and ERC-1155 operator approvals have no amount">
        —
      </span>
    );
  }
  const amount = BigInt(event.value);
  if (amount >= HISTORY_MAX_THRESHOLD) {
    return (
      <span className={maxBadge} data-testid="approval-history-max" title={event.value}>
        Max
      </span>
    );
  }
  if (decimals !== null) {
    return (
      <span title={event.value}>
        {formatUnits(amount, decimals)}
        {symbol !== null ? ` ${symbol}` : ''}
      </span>
    );
  }
  return <span title="Token decimals unknown — raw value">{event.value}</span>;
}

/**
 * One history row: block, the tx (TypedLink), the token (TypedLink to
 * its token page), kind chip, spender / operator and the granted value
 * — as written at the time, NOT the current allowance.
 */
function ApprovalHistoryRow({
  event,
  symbol,
  decimals,
  chainId,
}: {
  event: ApprovalHistoryEvent;
  symbol: string | null;
  decimals: number | null;
  chainId: number;
}) {
  const kind = event.kind;

  return (
    <tr data-testid="approval-history-row">
      <td className={allowanceCell}>{formatNumber(event.blockNumber)}</td>
      <td>
        <TypedLink
          to={`/chain/${chainId}/tx/${event.txHash}`}
          className={linkStyle}
          title={event.txHash}
        >
          {formatHash(event.txHash)}
        </TypedLink>
      </td>
      <td title={event.token}>
        <TypedLink
          to={`/chain/${chainId}/token/${event.token}`}
          className={linkStyle}
        >
          {symbol ?? shortAddress(event.token)}
        </TypedLink>
      </td>
      <td>
        <span className={kindBadge}>{KIND_LABELS[kind]}</span>
      </td>
      <td title={kind === 'erc1155' ? `Operator ${event.spender}` : `Spender ${event.spender}`}>
        {shortAddress(event.spender)}
      </td>
      <td className={allowanceCell}>{historyValueBody(event, symbol, decimals)}</td>
    </tr>
  );
}

/**
 * Collapsible "Approval history" sub-section riding the SAME fetch: the
 * raw approval events the scan retained (newest first, server-capped at
 * 200). Collapsed by default — the current-allowance snapshot above is
 * the primary surface; this is the event-level context under it. The
 * bounded-window caveat renders with every list (same honesty family
 * as the section copy above).
 */
function ApprovalHistory({
  history,
  historyTruncated,
  chainId,
  metas,
}: {
  history: ApprovalHistoryEvent[];
  historyTruncated: boolean;
  chainId: number;
  metas: Map<string, TokenMetadata> | undefined;
}) {
  return (
    <div className={historySection}>
      <Collapsible
        title="Approval history"
        badge={String(history.length)}
        className="approval-history-section"
      >
        <div className={approvalsTableWrap}>
          <table className={approvalsTable} data-testid="approval-history-table">
            <thead>
              <tr>
                <th>Block</th>
                <th>Tx</th>
                <th>Token</th>
                <th>Kind</th>
                <th>Spender / Operator</th>
                <th className={allowanceCell}>Value</th>
              </tr>
            </thead>
            <tbody>
              {history.map((event) => {
                const meta = metas?.get(event.token);
                return (
                  <ApprovalHistoryRow
                    key={`${event.kind}:${event.approvalEvent}:${event.blockNumber}:${event.txHash}:${event.spender}`}
                    event={event}
                    symbol={meta?.symbol ?? null}
                    decimals={meta?.decimals ?? null}
                    chainId={chainId}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className={approvalsCaveats} data-testid="approval-history-caveats">
          <li>
            Raw approval events from the same scanned window — this is not a
            complete approval history.
          </li>
          {historyTruncated && (
            <li data-testid="approval-history-truncated">
              Showing the first 200 events; older ones were dropped.
            </li>
          )}
          <li>
            Values are as granted at the time, not current allowances;
            ERC-20 revocations appear with a value of 0.
          </li>
        </ul>
      </Collapsible>
    </div>
  );
}

// --- component ---

/**
 * Read-only "Approvals (discovered)" card for the Address page: distinct
 * approvals across ERC-20, ERC-721 and ERC-1155 discovered in the scanned
 * window, each with its CURRENT state read at the scan's head block.
 * Auto-fetches on mount (bounded by the endpoint's rate limit — a
 * degraded fetch says why). Renders null for gated keys only; loading,
 * error, empty and discovery-without-values states are all explicit.
 */
export function ApprovalSection({ chainId, address }: ApprovalSectionProps): ReactNode {
  // Cache identity is the lowercase address (topic filters and the API
  // contract are lowercase); the page's own data guard below keeps a
  // cross-args switch honest.
  const owner = useMemo(() => address.trim().toLowerCase(), [address]);

  const query = useApprovalsQuery([chainId, owner, undefined]);

  // Cross-args guard (BalanceHistory pattern): the query layer's store
  // keeps the last settle across an args switch, so another chain's
  // payload is treated as absent.
  const data = query.data?.chainId === chainId ? query.data : undefined;

  // Token metadata through the shared frontend cache: one aggregated
  // Multicall3 batch for the page's distinct tokens (never re-fetched on
  // remounts — module-level cache in services/tokenMetadata). Kind rides
  // the request: decimals are only read for ERC-20s (721/1155 resolve
  // symbol only, or honestly fall back to the short address). History
  // events contribute their tokens too — a revoked approval keeps its
  // row (and symbol) here even though it is gone from the snapshot.
  const tokens = useMemo(() => {
    const kindByToken = new Map<string, ApprovalKind>();
    const contribute = (token: string, kind: ApprovalKind): void => {
      const existing = kindByToken.get(token);
      if (existing === undefined || (existing !== 'erc20' && kind === 'erc20')) {
        kindByToken.set(token, kind);
      }
    };
    for (const row of data?.approvals ?? []) contribute(row.token, row.kind ?? 'erc20');
    for (const event of data?.history ?? []) contribute(event.token, event.kind);
    return [...kindByToken.entries()].map(([address, kind]) => ({ address, kind }));
  }, [data]);
  const metas = useTokenMetadata(chainId, tokens);

  // The secondary escape hatch: revoke.cash manages approvals for the
  // checksummed address outside this explorer. (The primary action is
  // each row's in-product Revoke link above.)
  const revokeUrl = useCallback(
    () => `https://revoke.cash/address/${getAddress(owner)}`,
    [owner],
  );

  // Gated keys (defensive — the mount passes a route-validated address):
  // nothing useful to say, render nothing.
  if (chainId <= 0 || owner === '') return null;

  let body: ReactNode;
  if (data !== undefined) {
    const rows = data.approvals;
    const scannedLabel = data.scannedAt !== undefined
      ? new Date(data.scannedAt).toLocaleString()
      : null;

    if (data.reason === 'allowance-read-failed' && rows.length === 0) {
      // Discovery succeeded, current-value reads did not: the honest
      // middle state — never render it as "no approvals".
      body = (
        <div className={approvalsNote} data-testid="approvals-degraded">
          Discovered {formatNumber(data.pairCount)} approval
          {data.pairCount === 1 ? '' : 's'}, but current allowances could not
          be read from this RPC.
        </div>
      );
    } else if (rows.length === 0) {
      body = (
        <div className={approvalsNote} data-testid="approvals-empty">
          {data.coverage === 'scan-failed'
            ? 'The approval scan failed — no approvals could be discovered.'
            : data.coverage === 'partial'
              ? 'No approvals discovered before the scan stopped — this is not proof of absence.'
              : 'No ERC-20 approvals found in the scanned window — and no ERC-721 or ERC-1155 approvals either.'}
        </div>
      );
    } else {
      body = (
        <>
          <div className={approvalsTableWrap}>
            <table className={approvalsTable} data-testid="approvals-table">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Kind</th>
                  <th>Spender / Operator</th>
                  <th>Token ID</th>
                  <th className={allowanceCell}>Allowance / Scope</th>
                  <th>Revoke</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const meta = metas?.get(row.token);
                  return (
                    <ApprovalRow
                      key={`${row.kind ?? 'erc20'}:${row.token}:${row.spender}:${row.tokenId ?? ''}`}
                      approval={row}
                      symbol={meta?.symbol ?? null}
                      decimals={meta?.decimals ?? null}
                      chainId={chainId}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className={approvalsCaveats} data-testid="approvals-caveats">
            <li>
              Discovered from the scanned window; current values read at the
              latest block.
            </li>
            <li>
              Approval logs searched over the most recent{' '}
              {formatNumber(data.windowBlocks)} blocks.
            </li>
            {data.truncated && (
              <li>
                Showing the first 100 of {formatNumber(data.pairCount)}{' '}
                discovered approvals.
              </li>
            )}
            {data.coverage === 'partial' && (
              <li>
                The scan stopped before covering the whole window — older
                approvals may be missing.
              </li>
            )}
            {data.coverage === 'scan-failed' && (
              <li>
                The scan aborted partway — approvals older than the failure
                point may be missing.
              </li>
            )}
            <li>
              Approvals whose current read says no longer live are omitted
              (a zero ERC-20 allowance, a revoked ERC-721 token approval or
              ERC-1155 operator).
            </li>
          </ul>
        </>
      );
    }

    return (
      <Collapsible
        title="Approvals (discovered)"
        defaultExpanded
        badge={String(data.pairCount)}
        className="approvals-section"
      >
        <div className={approvalsToolbar}>
          <span className={approvalsScannedAt}>
            {scannedLabel !== null ? `Scanned at ${scannedLabel}` : 'Approvals scan'}
          </span>
          <a
            className={externalLink}
            href={revokeUrl()}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="approvals-revoke-link"
          >
            Manage on revoke.cash ↗
          </a>
        </div>
        {body}
        {(data.history?.length ?? 0) > 0 && (
          <ApprovalHistory
            history={data.history ?? []}
            historyTruncated={data.historyTruncated ?? false}
            chainId={chainId}
            metas={metas}
          />
        )}
      </Collapsible>
    );
  }

  if (query.loading) {
    return (
      <Collapsible title="Approvals (discovered)" defaultExpanded>
        <span className={approvalsSkeleton} data-testid="approvals-skeleton" />
      </Collapsible>
    );
  }

  if (query.error !== undefined) {
    return (
      <Collapsible title="Approvals (discovered)" defaultExpanded>
        <div className={approvalsUnavailable} data-testid="approvals-error">
          <span>
            Approvals unavailable
            {query.error instanceof ApiError && query.error.message
              ? ` — ${query.error.message}`
              : ''}
            .
          </span>
          {/* The query layer caches a settled error until refetch or
              remount — without this affordance a transient RPC/rate-limit
              failure sticks for the whole visit. Same shape as the tab
              retry buttons elsewhere on the Address page. */}
          <Button
            variant="secondary"
            size="sm"
            data-testid="approvals-retry"
            onClick={() => {
              void query.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </Collapsible>
    );
  }

  // Defensive: gated key (chainId <= 0) resolves undefined without an
  // error — nothing to show, nothing to claim. Mirrors the guard above.
  return null;
}

export default ApprovalSection;
