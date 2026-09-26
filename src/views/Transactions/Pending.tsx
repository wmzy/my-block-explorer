// Pending-transactions view (/chain/:chainId/pending): the node's own
// transaction pool via txpool_content, fetched live in the browser over
// the shared viem client (pool contents are ephemeral node data — no
// backend caching, per the project's data-separation rule).
//
// Honesty rules this page encodes:
// - The pool is THIS node's view of its mempool: other nodes may hold
//   different entries, and listing does not guarantee inclusion. The note
//   under the table says so instead of implying a global truth, and the
//   analysis strip repeats it — every derived number on the page comes
//   from the same single-node snapshot.
// - Pool entries carry NO timestamps: there is no age column, and no
//   fabricated time. (Mined-tx pages have an Age column; this one cannot.)
// - txpool_* is a Geth-namespace extra most public RPCs disable: the
//   unsupported outcome renders an explicit card naming that fact, never
//   a spinning skeleton or a fake-empty pool.
// - to === null is a contract creation in flight — rendered as such, never
//   linked to a meaningless zero-address page.
// - The capped list says "showing first 200 of N" with the full counts;
//   the truncation is visible, never silent. The analysis strip derives
//   from the entries actually shown and says so when the cap bit.
// - Conflict analysis (utils/mempoolAnalysis): same-(from, nonce)
//   replacements are flagged Replaceable per row — including the current
//   likely winner, which the badge title names. The "winner" is the
//   highest effective gas cap, a heuristic the node is free to overrule;
//   tip statistics cover EIP-1559 entries only and the strip says so.
import { Fragment, useMemo } from 'react';
import { css } from '@linaria/core';
import { navigate } from '@native-router/core';
import { TypedLink, useMatched, useSearch, useSetSearch } from '@native-router/react';
import { formatUnits } from 'viem';
import { z } from 'zod';

import TopNavigation from '@/components/TopNavigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { DataTable, linkStyle, monoStyle } from '@/components/ui/DataTable';
import { EmptyState, ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/LoadingState';
import { BackButton, PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { getChainInfo, getChainName } from '@/config/chains';
import { usePendingTransactions, type PoolEntry } from '@/services/txpool';
import { formatGwei } from '@/services/gasHistory';
import {
  analyzeMempool,
  type AnalyzedPoolEntry,
  type MempoolAnalysis,
  type MempoolRenderUnit,
} from '@/utils/mempoolAnalysis';
import { formatNumber } from '@/utils/format';
import { parseChainIdParam } from '@/utils/chainParam';
import { UnsupportedChainState } from '@/views/Home/UnsupportedChainState';

const GWEI = 1_000_000_000;

// Search params: ?group=1 switches the listing to conflict-grouped
// rendering (winner first), so a grouped view is a shareable URL. The
// ?tab= discipline: optional().catch(undefined), never a `.catch(...)`
// default — an EXPLICIT ?group=1 must stay distinguishable from absence
// so the toggle can switch the mode OFF by removing the key instead of
// dead-ending on a default. Any other value ('0', 'true', '2', garbage)
// degrades to the flat default, so a malformed hand-edited link still
// renders instead of throwing during render.
export const pendingSearchSchema = z.object({
  group: z.enum(['1']).optional().catch(undefined),
});

// Counts strip above the table (Blocks/List notice-bar family): pending
// and queued counts, the truncation note when the cap bit, the grouped-
// view toggle, and the on-demand Refresh (the 5s poll owns the cadence
// otherwise).
const countsRow = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
  padding: var(--haze-space-2) var(--haze-space-3);
  margin-bottom: var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  background: var(--haze-color-primary-subtle);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
`;

const truncatedNote = css`
  color: var(--haze-color-text-secondary);
`;

// Quiet discoverability link under the page header (see the JSX below):
// sits inside the header's own bottom margin so it reads as a footnote
// to the title, not a section of the page.
const broadcastLinkNote = css`
  margin: calc(-1 * var(--haze-space-4)) 0 var(--haze-space-5);
  font-size: var(--haze-text-sm);
`;

// Analysis strip under the counts: the derived summary line plus the
// mandatory derivation caveat (same notice-bar family, stacked).
const analysisStrip = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
  padding: var(--haze-space-2) var(--haze-space-3);
  margin-bottom: var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  background: var(--haze-color-primary-subtle);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
`;

const analysisDerivation = css`
  color: var(--haze-color-text-secondary);
`;

// Standing mempool caveats (no timestamps, single-node view) — muted, kept
// under whatever the body rendered (table or empty state).
const mempoolNote = css`
  margin-top: var(--haze-space-3);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-muted);
`;

// The verbatim unsupported message is the card's lead line; the supporting
// paragraph explains what that means for the page.
const unsupportedLead = css`
  margin: 0 0 var(--haze-space-2) 0;
  font-weight: 600;
`;

// A contract creation in flight has no to-address to link.
const contractCreationNote = css`
  color: var(--haze-color-text-muted);
`;

// Tx-hash cell: the link plus the Replaceable badge for conflict members.
const hashCell = css`
  display: inline-flex;
  align-items: center;
  gap: var(--haze-space-2);
  flex-wrap: wrap;
`;

// Conflict-group header row: from + nonce + size, spanning the table.
const groupHeaderRow = css`
  td {
    background: var(--haze-color-primary-subtle);
    font-weight: 600;
    font-size: var(--haze-text-sm);
  }
`;

const formatHash = (hash: string): string => {
  if (!hash || hash.length < 16) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
};

const formatAddr = (addr: string): string => {
  if (!addr || addr.length < 10) return addr || 'N/A';
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
};

/**
 * Pool value for display: formatUnits at the chain's native decimals
 * (BigInt-exact), trailing fractional zeros cut, with the same sub-floor
 * display cutoff the mined-tx lists use ("0.0001 units in integer wei").
 */
export const formatPoolValue = (wei: bigint, decimals: number, symbol: string): string => {
  if (wei === 0n) return `0 ${symbol}`;
  if (decimals >= 4 && wei < 10n ** BigInt(decimals - 4)) return `<0.0001 ${symbol}`;
  const raw = formatUnits(wei, decimals);
  const trimmed = raw.includes('.') ? raw.replace(/0+$/, '').replace(/\.$/, '') : raw;
  return `${trimmed} ${symbol}`;
};

/**
 * Gas price cell: EIP-1559 entries show their fee cap ("≤" — the actual
 * base+tip paid is only known at inclusion), legacy entries their flat
 * gasPrice, entries without either an honest em dash. Never a fabricated
 * zero.
 */
export const gasPriceCellLabel = (entry: PoolEntry): string => {
  const asGwei = (wei: bigint) => `${formatGwei(Number(wei) / GWEI)} gwei`;
  if (entry.maxFeePerGas !== undefined) return `≤ ${asGwei(entry.maxFeePerGas)}`;
  if (entry.gasPrice !== undefined) return asGwei(entry.gasPrice);
  return '—';
};

const formatGweiWei = (wei: bigint): string => formatGwei(Number(wei) / GWEI);

/**
 * The analysis strip's summary line. Numbers derive from the entries the
 * snapshot actually listed (the service's display cap may have trimmed
 * the tail — the derivation line below the summary discloses that); the
 * percentile values are BigInt-picked, only the final render passes
 * through the shared gwei formatter. Empty pools say so instead of
 * rendering a wall of zeros and dashes. Pure so the wording contract is
 * testable. Nouns pluralize honestly (1 account, 2 accounts).
 */
export const analysisSummaryText = (analysis: MempoolAnalysis): string => {
  if (analysis.total === 0) return 'Pool snapshot empty';
  const accountWord = analysis.distinctAccounts === 1 ? 'account' : 'accounts';
  const conflictWord =
    analysis.conflictGroupCount === 1 ? 'replaceable conflict' : 'replaceable conflicts';
  const caps = analysis.capStats;
  const capsText =
    caps.count > 0 &&
    caps.min !== null &&
    caps.p25 !== null &&
    caps.median !== null &&
    caps.max !== null
      ? `fee caps min ${formatGweiWei(caps.min)} · p25 ${formatGweiWei(caps.p25)} · median ${formatGweiWei(caps.median)} · max ${formatGweiWei(caps.max)} gwei`
      : 'fee caps — no fee data reported';
  const tips = analysis.tipStats;
  const tipsText =
    tips.count > 0 && tips.p25 !== null && tips.median !== null
      ? `tips (1559 only) p25 ${formatGweiWei(tips.p25)} · median ${formatGweiWei(tips.median)} gwei`
      : 'tips (1559 only) — no EIP-1559 entries';
  return `${formatNumber(analysis.total)} pending · ${formatNumber(analysis.distinctAccounts)} ${accountWord} · ${formatNumber(analysis.conflictGroupCount)} ${conflictWord} · ${capsText} · ${tipsText}`;
};

/**
 * Replaceable badge tooltip: the conflict size and which entry currently
 * wins — the two facts a reader needs before trusting any member of the
 * group. Empty string for unopposed entries (no badge is rendered).
 */
export const conflictBadgeTitle = (entry: AnalyzedPoolEntry): string => {
  const conflict = entry.conflict;
  if (conflict === null) return '';
  return `${formatNumber(conflict.size)} transactions compete for this sender and nonce — ${formatHash(conflict.winnerHash)} currently the likely winner`;
};

export default function PendingTransactionsPage() {
  const { params, router } = useMatched();

  // An unparseable :chainId param is a broken link, not an unsupported
  // chain: parseChainIdParam returns null and the raw param travels on to
  // the unsupported state (same two-tier guard as the Charts view).
  const rawChainId = params.chainId;
  const parsedChainId = rawChainId === undefined ? 1 : parseChainIdParam(rawChainId);
  const currentChainId = parsedChainId ?? 0;
  const chainInfo = getChainInfo(currentChainId);

  const handleChainChange = (newChainId: number) => {
    void navigate(router, `/chain/${newChainId}/pending`).catch(() => undefined);
  };

  if (!chainInfo) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <PageContainer>
          <UnsupportedChainState chainId={currentChainId} rawChainId={rawChainId} />
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <PageContainer>
        <BackButton
          onClick={() => {
            void navigate(router, `/chain/${currentChainId}/transactions`).catch(
              () => undefined,
            );
          }}
          label="Back to Transactions"
        />

        <PageHeader
          title="Pending Transactions"
          chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
        />

        {/* Discoverability for the broadcast tool: one quiet link pulled
            into the header's bottom margin (muted note family — it must
            not compete with the table below). */}
        <p className={broadcastLinkNote}>
          <TypedLink to={`/chain/${currentChainId}/broadcast`} className={linkStyle}>
            Broadcast a signed transaction →
          </TypedLink>
        </p>

        <PendingBody chainId={currentChainId} />
      </PageContainer>
    </>
  );
}

/**
 * Feed-driven body, split out so the unsupported-chain early return above
 * keeps hook order stable regardless of the chain guard outcome (Charts
 * view pattern).
 */
function PendingBody({ chainId }: { chainId: number }) {
  const feed = usePendingTransactions(chainId);
  const setSearch = useSetSearch(pendingSearchSchema);
  const { group: groupParam } = useSearch(pendingSearchSchema);

  // Cross-chain guard (gasHistory/chartStats pattern): the query layer's
  // result store keeps the last settle across a chain switch, so another
  // chain's result is treated as absent — no cross-chain flash.
  const own = feed.data?.chainId === chainId ? feed.data : undefined;

  // Conflict analysis over the entries the snapshot listed. All hooks sit
  // above the early returns below (rules of hooks); a non-ok result keeps
  // an empty universe so the memo stays cheap and the states below stay
  // exactly as they were — analysis never masks unsupported/failed.
  const pendingEntries = own?.status === 'ok' ? own.pending : [];
  const analysis = useMemo(() => analyzeMempool(pendingEntries), [pendingEntries]);

  const grouped = groupParam !== undefined;
  const toggleGrouped = () => {
    void setSearch(prev => {
      if (!grouped) return { ...prev, group: '1' };
      const { group: _removed, ...rest } = prev;
      return rest;
    });
  };

  const native = getChainInfo(chainId)?.nativeCurrency;
  const decimals = native?.decimals ?? 18;
  const symbol = native?.symbol ?? 'ETH';

  // First-load skeleton only: later polls (own already set) keep the table
  // on screen while refetching.
  if (own === undefined && feed.loading) {
    return <TableSkeleton rows={10} cols={6} />;
  }

  if (own === undefined) {
    // Defensive escape hatch: the fetch layer never throws, so an absent
    // result with loading done means a hook-level error — the generic
    // failure wording with Retry (never an unsupported claim).
    return (
      <div data-testid="pending-failed">
        <ErrorState
          message={
            feed.error instanceof Error
              ? feed.error.message
              : 'Failed to fetch the transaction pool'
          }
          onRetry={feed.refetch}
        />
      </div>
    );
  }

  if (own.status === 'unsupported') {
    return (
      <div data-testid="pending-unsupported">
        <Card>
          <CardHeader>
            <CardTitle>Transaction pool unavailable</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={unsupportedLead}>{own.message}</p>
            <p className={mempoolNote}>
              Exposing the pool is a node operator decision — the endpoint this explorer uses
              keeps its txpool private. Nothing is wrong with the chain; the pending list simply
              cannot be served from here.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (own.status === 'failed') {
    return (
      <div data-testid="pending-failed">
        <ErrorState message={own.message} onRetry={feed.refetch} />
      </div>
    );
  }

  const note = (
    <p className={mempoolNote}>
      Pool entries carry no timestamps, so no age column is shown. This list is this node&rsquo;s
      own view of its mempool — other nodes may hold different entries, and being listed does not
      guarantee inclusion in a block.
    </p>
  );

  const units: MempoolRenderUnit[] = grouped
    ? analysis.renderPlan
    : analysis.entries.map(entry => ({ kind: 'solo', entry }));

  return (
    <>
      <div className={countsRow}>
        <span data-testid="pending-counts">
          {formatNumber(own.pendingCount)} pending · {formatNumber(own.queuedCount)} queued
        </span>
        {own.truncated && (
          <span className={truncatedNote} data-testid="pending-truncated">
            Showing first {formatNumber(own.pending.length)} of {formatNumber(own.pendingCount)}{' '}
            pending transactions
          </span>
        )}
        <Button variant="outline" size="sm" onClick={toggleGrouped} disabled={own.pending.length === 0}>
          {grouped ? 'Flat list' : 'Group conflicts'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void feed.refetch()}
          disabled={feed.fetching}
        >
          {feed.fetching ? 'Refreshing…' : '↻ Refresh'}
        </Button>
      </div>

      <div className={analysisStrip}>
        <span data-testid="pending-analysis">{analysisSummaryText(analysis)}</span>
        <span className={analysisDerivation} data-testid="pending-analysis-derivation">
          {own.truncated
            ? `Derived from this node’s current pool snapshot (first ${formatNumber(own.pending.length)} of ${formatNumber(own.pendingCount)} entries shown) — other nodes may hold a different view.`
            : 'Derived from this node’s current pool snapshot — other nodes may hold a different view.'}
        </span>
      </div>

      {own.pending.length === 0 ? (
        // An empty pool is a normal business outcome, not a failure (info
        // EmptyState; the red ErrorState above stays reserved for fetch
        // failures).
        <EmptyState message="No pending transactions — this node’s pool is empty right now" />
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>Txn Hash</th>
              <th>From</th>
              <th>To</th>
              <th>Value</th>
              <th>Gas Price</th>
              <th>Nonce</th>
            </tr>
          </thead>
          <tbody>
            {units.map(unit =>
              unit.kind === 'group' ? (
                <Fragment key={`conflict:${unit.group.winnerHash}`}>
                  <tr className={groupHeaderRow} data-testid="pending-conflict-group">
                    <td colSpan={6}>
                      {formatAddr(unit.group.from)} · nonce {formatNumber(unit.group.nonce)} ·{' '}
                      {formatNumber(unit.group.size)} competing transactions — likely winner first
                    </td>
                  </tr>
                  {unit.group.members.map(member => (
                    <PendingRow
                      key={member.hash}
                      entry={member}
                      chainId={chainId}
                      decimals={decimals}
                      symbol={symbol}
                    />
                  ))}
                </Fragment>
              ) : (
                <PendingRow
                  key={unit.entry.hash}
                  entry={unit.entry}
                  chainId={chainId}
                  decimals={decimals}
                  symbol={symbol}
                />
              ),
            )}
          </tbody>
        </DataTable>
      )}

      {note}
    </>
  );
}

/** One pending row; conflict members additionally carry the badge. */
function PendingRow({
  entry,
  chainId,
  decimals,
  symbol,
}: {
  entry: AnalyzedPoolEntry;
  chainId: number;
  decimals: number;
  symbol: string;
}) {
  return (
    <tr>
      <td>
        <span className={hashCell}>
          <CopyableHash
            value={entry.hash}
            truncated={formatHash(entry.hash)}
            href={`/chain/${chainId}/tx/${entry.hash}`}
          />
          {entry.conflict !== null && (
            <span title={conflictBadgeTitle(entry)} data-testid="pending-replaceable">
              <Badge variant="warning" size="sm">
                Replaceable
              </Badge>
            </span>
          )}
        </span>
      </td>
      <td>
        <CopyableHash
          value={entry.from}
          truncated={formatAddr(entry.from)}
          href={`/chain/${chainId}/address/${entry.from}`}
        />
      </td>
      <td>
        {entry.to === null ? (
          <span className={contractCreationNote}>Contract creation</span>
        ) : (
          <CopyableHash
            value={entry.to}
            truncated={formatAddr(entry.to)}
            href={`/chain/${chainId}/address/${entry.to}`}
          />
        )}
      </td>
      <td className={monoStyle}>{formatPoolValue(entry.value, decimals, symbol)}</td>
      <td className={monoStyle}>{gasPriceCellLabel(entry)}</td>
      <td className={monoStyle}>{entry.nonce}</td>
    </tr>
  );
}
