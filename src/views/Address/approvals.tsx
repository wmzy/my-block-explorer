// Approvals (discovered) — read-only ERC-20 approval viewer for the
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
// Honesty contract: discovery is window-limited (the response's
// windowBlocks/coverage carry the caveat) and allowance values were read
// at the head block of the scan — the mandatory caveat renders with every
// list. NO revoke/send plumbing anywhere: the only action surface is an
// external link to revoke.cash.
import { css } from '@linaria/core';
import { useCallback, useMemo, type ReactNode } from 'react';
import { formatUnits, getAddress } from 'viem';
import { Collapsible } from '@/components/ui/Collapsible';
import { ApiError } from '@/util/apiError';
import { get, longRunningApi, withSignal } from '@/util/http';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';
import { formatNumber } from '@/utils/format';
import { useTokenMetadata } from '@/services/tokenMetadata';

/** One approval row — the backend contract (values BigInt-exact decimal strings). */
export type DiscoveredApproval = {
  token: string;
  spender: string;
  allowance: string;
  isMax: boolean;
};

/** Response envelope of GET /api/chains/:chainId/addresses/:address/approvals. */
export type ApprovalsPage = {
  chainId: number;
  address: string;
  approvals: DiscoveredApproval[];
  // First-scan time of the server-side ~60s cache entry (a cache hit does
  // not reset it); optional so pre-scannedAt payloads stay renderable.
  scannedAt?: string;
  windowBlocks: number;
  coverage: 'complete' | 'partial' | 'scan-failed';
  // TOTAL distinct (token, spender) pairs discovered, pre-cap.
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
    `/chains/${chainId}/addresses/${address}/approvals`,
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

// --- helpers ---

const shortAddress = (a: string) => (a ? `${a.slice(0, 8)}...${a.slice(-6)}` : 'N/A');

/** One table row: token (symbol or short address), spender, current allowance. */
function ApprovalRow({
  approval,
  symbol,
  decimals,
}: {
  approval: DiscoveredApproval;
  symbol: string | null;
  decimals: number | null;
}) {
  // Allowance cell: Max badge for effectively-unlimited grants; otherwise
  // the decimals-formatted amount when the token's decimals resolved
  // (BigInt-exact via formatUnits), and the RAW decimal string when they
  // did not — a guessed decimals amount is never shown.
  let allowanceBody: ReactNode;
  if (approval.isMax) {
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

  return (
    <tr data-testid="approval-row">
      <td title={approval.token}>{symbol ?? shortAddress(approval.token)}</td>
      <td title={approval.spender}>{shortAddress(approval.spender)}</td>
      <td className={allowanceCell}>{allowanceBody}</td>
    </tr>
  );
}

// --- component ---

/**
 * Read-only "Approvals (discovered)" card for the Address page: distinct
 * (token, spender) ERC-20 approval pairs discovered in the scanned
 * window, each with its CURRENT allowance read at the scan's head block.
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
  // remounts — module-level cache in services/tokenMetadata).
  const tokens = useMemo(
    () => [...new Set((data?.approvals ?? []).map((row) => row.token))].map((token) => ({ address: token, kind: 'erc20' as const })),
    [data],
  );
  const metas = useTokenMetadata(chainId, tokens);

  // The only action surface: revoke.cash manages (shows/revokes)
  // approvals for the checksummed address. No revoke/send plumbing here.
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
              : 'No ERC-20 approvals found in the scanned window.'}
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
                  <th>Spender</th>
                  <th className={allowanceCell}>Allowance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const meta = metas?.get(row.token);
                  return (
                    <ApprovalRow
                      key={`${row.token}:${row.spender}`}
                      approval={row}
                      symbol={meta?.symbol ?? null}
                      decimals={meta?.decimals ?? null}
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
            <li>Approvals currently reading zero are omitted.</li>
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
          Approvals unavailable
          {query.error instanceof ApiError && query.error.message
            ? ` — ${query.error.message}`
            : ''}
          .
        </div>
      </Collapsible>
    );
  }

  // Defensive: gated key (chainId <= 0) resolves undefined without an
  // error — nothing to show, nothing to claim. Mirrors the guard above.
  return null;
}

export default ApprovalSection;
