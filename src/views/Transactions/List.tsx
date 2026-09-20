import { useEffect, useRef, useState } from 'react';
import { css } from '@linaria/core';
import {
  TypedLink,
  useMatched,
  useSearch,
  useSearchParams,
  useSetSearch,
} from '@native-router/react';
import { z } from 'zod';

import TopNavigation from '@/components/TopNavigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { DataTable, Pagination, linkStyle, monoStyle } from '@/components/ui/DataTable';
import { EmptyState, ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/LoadingState';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { getChainInfo, getChainName, getChainSymbol } from '@/config/chains';
import { redirectReplace } from '@/views/Home/Landing';
import { UnsupportedChainState } from '@/views/Home/UnsupportedChainState';
import { useLatestTransactions } from '@/services/chainRpc';
import { useLatestBlocksFeed } from '@/services/homeFeed';
import { txCursorFromBlock } from '@/utils/blockRpcData';
import { formatNumber, formatRelativeTime, formatValue } from '@/utils/format';

const LIMIT = 20;

// Header row: the page title on the left, the Refresh control on the right
// (re-anchors the walk at the live chain head).
const listToolbar = css`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--haze-space-3);
`;

// Staleness hint row rendered under the table (Blocks/List pattern): the
// walk is anchored to the displayed page's snapshot, but the live head
// moved on — offer the one-click refresh.
const newBlocksHint = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  padding: var(--haze-space-2) var(--haze-space-3);
  margin-bottom: var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  background: var(--haze-color-primary-subtle);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
`;

// Header controls (anchored views get "Show latest" beside Refresh).
const toolbarActions = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
`;

// Anchor notice strip (?block= dropped as malformed / anchor beyond the
// live head): the same bordered, subtle-background note family as the
// staleness hint row — explained business outcomes, never an error
// palette (the red ErrorState is reserved for real fetch failures).
const anchorNoticeBar = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  padding: var(--haze-space-2) var(--haze-space-3);
  margin-bottom: var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  background: var(--haze-color-primary-subtle);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
`;

// Search params: an optional ?block=N deep link starts the walk at block N;
// ?page=K is the pagination index (1 when absent or garbage). Exported for
// unit tests of the malformed-?block= detection contract (a value the
// schema drops must parse to undefined).
export const searchSchema = z.object({
  block: z.coerce.number().int().min(0).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
});

// Anchor notice the list owes the user when the ?block= deep link is not
// usable as given. Pure logic, exported for focused unit tests.
export type TxAnchorNotice =
  | { kind: 'invalid-block' }
  | { kind: 'future-anchor'; block: number };

// Pure: which anchor notice (if any) applies. Priority is invalid-block >
// future-anchor > none. A malformed ?block= the schema dropped outranks
// everything; a future anchor needs a known live head to compare against
// (no head → no verdict, never a guess — strictly greater, an anchor AT
// the head is the newest produced block and needs no note). The two param
// conditions are exclusive by construction (invalid means the parse
// dropped the value), but the ordering lives here in one place anyway.
export function resolveAnchorNotice(input: {
  invalidBlockDropped: boolean;
  blockParam: number | undefined;
  liveHead: bigint | null;
}): TxAnchorNotice | null {
  if (input.invalidBlockDropped) return { kind: 'invalid-block' };
  if (
    input.blockParam !== undefined &&
    input.liveHead !== null &&
    BigInt(input.blockParam) > input.liveHead
  ) {
    return { kind: 'future-anchor', block: input.blockParam };
  }
  return null;
}

// Pure: the URL still carries a ?block= key the schema dropped — the raw
// param is the only witness that a malformed value was ever there (zod's
// .catch(undefined) erases it from the parsed output).
export function isDroppedBlockParam(
  rawBlockParam: string | null,
  blockParam: number | undefined,
): boolean {
  return rawBlockParam !== null && blockParam === undefined;
}

const formatHash = (hash: string): string => {
  if (!hash || hash.length < 16) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
};

const formatAddr = (addr: string): string => {
  if (!addr || addr.length < 10) return addr || 'N/A';
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
};

// status: 1 → success, 0 → failed, -1 → pending (no receipt yet, NOT failed).
function TxStatusBadge({ status }: { status: number }) {
  if (status === 1) {
    return (
      <Badge variant="success" size="sm">
        Success
      </Badge>
    );
  }
  if (status === 0) {
    return (
      <Badge variant="error" size="sm">
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="default" size="sm">
      Pending
    </Badge>
  );
}

export default function TransactionsList() {
  const { params, router } = useMatched();
  const setSearch = useSetSearch(searchSchema);
  const { block: blockParam, page: pageParam } = useSearch(searchSchema);
  // Raw search params (pre-schema): the only witness that a ?block= value
  // the schema's .catch(undefined) dropped was ever in the URL.
  const [rawSearchParams] = useSearchParams();
  const rawBlockParam = rawSearchParams.get('block');

  const currentChainId = Number.parseInt(params.chainId ?? '1', 10);
  const chainInfo = getChainInfo(currentChainId);
  const symbol = getChainSymbol(currentChainId);

  // Cursor pagination: page 1 is the head — or the ?block=N deep-link seed
  // (cursor = (N+1, 0): start at block N and walk down); every older page
  // resumes from the nextCursor its predecessor returned, so pages tile the
  // (blockNumber, transactionIndex) sequence with no duplicate and no gap.
  // The page INDEX lives in the URL (?page= — back/forward and deep links
  // work); the discovered continuation cursors are component state that
  // only grows as pages are actually visited.
  const initialCursor = blockParam !== undefined ? txCursorFromBlock(blockParam) : undefined;
  const [cursorStack, setCursorStack] = useState<readonly (bigint | undefined)[]>([initialCursor]);

  // The rendered page is the URL page clamped to the walked depth; a URL
  // page beyond the stack advances below once cursors are discovered.
  const page = Math.min(pageParam, cursorStack.length);

  // The deep link seeds page 1 only; a changed ?block param re-seeds the
  // walk at page 1. A ref distinguishes a genuine seed change from the
  // mount pass so an initial ?page=K deep link is left intact.
  const seededCursorRef = useRef(initialCursor);
  useEffect(() => {
    if (seededCursorRef.current === initialCursor) return;
    seededCursorRef.current = initialCursor;
    setCursorStack([initialCursor]);
    if (pageParam !== 1) {
      void setSearch(prev => ({ ...prev, page: '1' }), { replace: true });
    }
  }, [initialCursor, pageParam, setSearch]);

  // Malformed ?block= deep link (e.g. ?block=abc): the schema already
  // degraded it to "no anchor", so the walk serves the latest transactions.
  // Latch a one-time notice (state below survives the URL strip) and
  // replace the URL without the key so a refresh does not re-trigger the
  // notice. A later VALID ?block= deep link clears the latch — the notice
  // belongs to the URL it explained, not to the view.
  const [invalidBlockDropped, setInvalidBlockDropped] = useState(false);
  useEffect(() => {
    if (blockParam !== undefined) {
      if (invalidBlockDropped) setInvalidBlockDropped(false);
      return;
    }
    if (rawBlockParam === null || invalidBlockDropped) return;
    setInvalidBlockDropped(true);
    void setSearch(prev => {
      const { block: _dropped, ...rest } = prev;
      return rest;
    }, { replace: true });
  }, [blockParam, rawBlockParam, invalidBlockDropped, setSearch]);

  // Head entry (no cursor): the Refresh vehicle at the live head. Its key
  // never changes, so headQuery.refetch() always targets the live head,
  // and page 1 at the head rides this instance so the refetched answer is
  // displayed immediately (a second hook instance on the same key would
  // settle on its own stores — see the polledQuery.ts header).
  const headQuery = useLatestTransactions(currentChainId, LIMIT);

  // Page-1 entry under the current ?block= seed: the Refresh vehicle while
  // anchored (mirrors headQuery's role at the live head).
  const seedQuery = useLatestTransactions(currentChainId, LIMIT, initialCursor);

  const pageCursor = cursorStack[page - 1];
  const pageQuery = useLatestTransactions(currentChainId, LIMIT, pageCursor);
  // Page 1 rides its refresh vehicle — the live head when unanchored, the
  // seed entry when anchored — so a refresh's answer displays immediately.
  const query =
    page === 1 && pageCursor === undefined
      ? headQuery
      : page === 1 && pageCursor === initialCursor
        ? seedQuery
        : pageQuery;
  const { data, loading, error, refetch } = query;
  const transactions = data?.transactions ?? [];

  // A URL page beyond the walked depth (deep link or reload mid-walk) is
  // reached by walking: each loaded page's nextCursor extends the stack
  // until it covers the requested page. When the chain runs out first, the
  // URL is pinned (replaced) to the deepest reachable page so the address
  // bar never reports a page the chain cannot produce. Gated while a
  // Refresh re-anchor is in flight: the stale ?page= the replace is about
  // to drop must not kick off a walk (and a wasted fetch) in the gap.
  const reanchorInFlightRef = useRef(false);
  const walkNextCursor = data?.nextCursor;
  useEffect(() => {
    if (reanchorInFlightRef.current) return;
    if (cursorStack.length >= pageParam) return;
    if (walkNextCursor !== undefined) {
      setCursorStack(prev => (prev.length >= pageParam ? prev : [...prev, walkNextCursor]));
    } else if (data !== undefined && error === undefined) {
      void setSearch(prev => ({ ...prev, page: String(cursorStack.length) }), { replace: true });
    }
  }, [cursorStack.length, pageParam, walkNextCursor, data, error, setSearch]);

  const goOlder = () => {
    const next = data?.nextCursor;
    if (next === undefined) return;
    setCursorStack(prev => (prev.length > page ? prev : [...prev, next]));
    // Push, not replace: every page becomes a history entry, so browser
    // back/forward steps between pages.
    void setSearch(prevSearch => ({ ...prevSearch, page: String(page + 1) }));
  };

  const goNewer = () => {
    if (page <= 1) return;
    void setSearch(prevSearch => ({ ...prevSearch, page: String(page - 1) }));
  };

  // Refresh re-pulls page 1 of the CURRENT anchor: at the live head it
  // re-anchors (truncates the cursor stack — page 1 becomes the live head
  // again, dropping every stale continuation cursor) exactly like
  // Blocks/List; under a ?block= seed the anchor is the point of the page,
  // so the seed entry is refetched instead and "Show latest" is the way
  // out. The page-1 URL replaces the current entry (Refresh is a
  // re-pull, not a navigation).
  const refreshQuery = initialCursor === undefined ? headQuery : seedQuery;
  const handleRefresh = () => {
    // Suppress the walk until the page-1 URL lands (see walk effect).
    reanchorInFlightRef.current = true;
    setCursorStack([initialCursor]);
    // setSearch's object form types as void | Promise<void>; normalize so
    // the catch/finally chain typechecks.
    Promise.resolve(setSearch(prev => ({ ...prev, page: '1' }), { replace: true }))
      .catch(() => undefined)
      .finally(() => {
        reanchorInFlightRef.current = false;
      });
    void refreshQuery.refetch();
  };

  // "Show latest" clears the ?block= anchor: the seed-change effect above
  // re-seeds the walk at the live head (page 1, no cursor). The key is
  // DELETED rather than set to undefined (SearchInput values are strings;
  // stringifySearch drops null-ish entries, the type forbids them). Pushed,
  // so the anchored view stays a history entry to come back to.
  const handleShowLatest = () => {
    void setSearch(prev => {
      const { block: _dropped, ...rest } = prev;
      return { ...rest, page: '1' };
    });
  };

  // Live head for the staleness hint (same polled feed as the Blocks list
  // and Home): keeps reporting the chain head while the displayed page
  // holds the snapshot it was fetched with. The feed guards non-positive
  // chain ids without an RPC call, so the unsupported-chain branch passes
  // 0 and stays offline.
  const liveHeadFeed = useLatestBlocksFeed(chainInfo ? currentChainId : 0);
  const liveHead = liveHeadFeed.data?.latestBlockNumber ?? null;

  // Anchor notice for the header area (pure resolver above): a dropped
  // malformed ?block= outranks a future anchor, which outranks silence.
  const anchorNotice = resolveAnchorNotice({
    invalidBlockDropped,
    blockParam,
    liveHead,
  });

  // Blocks mined beyond the displayed page's head snapshot since it was
  // fetched. Strictly greater: a head at or below the snapshot is not
  // stale news and renders nothing.
  const anchorHead = data?.latestBlockNumber ?? null;
  const newBlockCount =
    anchorHead !== null && liveHead !== null && liveHead > anchorHead
      ? liveHead - anchorHead
      : null;

  // Chain switches replace the current entry via the shared Wave A helper;
  // the list legitimately drops a ?block= deep-link param on switch (the
  // seeded block belongs to the old chain).
  const handleChainChange = (newChainId: number) => {
    void redirectReplace(router, `/chain/${newChainId}/transactions`).catch(() => undefined);
  };

  if (!chainInfo) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <PageContainer>
          {/* Unsupported-chain deep link: recovery CTAs instead of a bare
              error (Home/Blocks pattern). */}
          <UnsupportedChainState chainId={currentChainId} />
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <PageContainer>
        <div className={listToolbar}>
          <PageHeader
            title={
              blockParam !== undefined
                ? `Transactions · anchored at Block #${formatNumber(blockParam)}`
                : 'Transactions'
            }
            chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
          />
          <div className={toolbarActions}>
            {blockParam !== undefined && (
              <Button variant="secondary" size="sm" onClick={handleShowLatest}>
                Show latest
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshQuery.fetching}
            >
              {refreshQuery.fetching ? 'Refreshing…' : '↻ Refresh'}
            </Button>
          </div>
        </div>

        {/* Anchor notice (malformed ?block= dropped / anchor beyond the live
            head): an explained outcome in the page's notice family, never
            an error palette. One bar — the resolver's priority contract
            guarantees at most one notice. */}
        {anchorNotice !== null && (
          <div className={anchorNoticeBar} role="status">
            {anchorNotice.kind === 'invalid-block'
              ? 'Invalid block parameter ignored — showing latest transactions'
              : `Anchor block ${formatNumber(anchorNotice.block)} has not been produced yet — showing nearest earlier transactions`}
          </div>
        )}

        {loading && <TableSkeleton rows={10} cols={7} />}

        {error && (
          <ErrorState
            message={error instanceof Error ? error.message : 'Failed to fetch transactions'}
            onRetry={refetch}
          />
        )}

        {/* Empty scan window is a normal business outcome, not a failure:
            the info-toned EmptyState (Blocks/List family) — the red
            ErrorState above stays reserved for fetch failures. */}
        {!loading && !error && transactions.length === 0 && (
          <EmptyState
            message={
              data?.hasMore === true
                ? 'No transactions in the scanned range — go older to continue'
                : 'No transactions found'
            }
          />
        )}

        {transactions.length > 0 && (
          <DataTable>
            <thead>
              <tr>
                <th>Txn Hash</th>
                <th>Block</th>
                <th>Age</th>
                <th>From</th>
                <th>To</th>
                <th>Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(tx => (
                <tr key={tx.hash}>
                  <td>
                    <CopyableHash
                      value={tx.hash}
                      truncated={formatHash(tx.hash)}
                      href={`/chain/${currentChainId}/tx/${tx.hash}`}
                    />
                  </td>
                  <td>
                    {tx.blockNumber === null ? (
                      // Pending tx (no block position): plain Pending text,
                      // never a /block/0 link.
                      'Pending'
                    ) : (
                      <TypedLink
                        to={`/chain/${currentChainId}/block/${tx.blockNumber}`}
                        className={linkStyle}
                      >
                        {formatNumber(BigInt(tx.blockNumber))}
                      </TypedLink>
                    )}
                  </td>
                  <td>{tx.timestamp ? formatRelativeTime(tx.timestamp) : 'N/A'}</td>
                  <td>
                    <CopyableHash
                      value={tx.fromAddress}
                      truncated={formatAddr(tx.fromAddress)}
                      href={`/chain/${currentChainId}/address/${tx.fromAddress}`}
                    />
                  </td>
                  <td>
                    <CopyableHash
                      value={tx.toAddress}
                      truncated={formatAddr(tx.toAddress)}
                      href={`/chain/${currentChainId}/address/${tx.toAddress}`}
                    />
                  </td>
                  <td className={monoStyle}>{formatValue(BigInt(tx.value), symbol)}</td>
                  <td>
                    <TxStatusBadge status={tx.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}

        {/* Staleness hint (Blocks/List pattern): the footer's "Latest
            block" reports the displayed page's fetch-time snapshot, so
            once the polled live head moves past it the page says so
            instead of letting Age cells silently creep. One click on
            Refresh re-pulls page 1 of the current anchor. */}
        {transactions.length > 0 && newBlockCount !== null && (
          <div className={newBlocksHint}>
            <span>
              {formatNumber(Number(newBlockCount))} new {newBlockCount === 1n ? 'block' : 'blocks'}{' '}
              —
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshQuery.fetching}
            >
              Refresh
            </Button>
          </div>
        )}

        {(transactions.length > 0 || data?.hasMore === true) && (
          <Pagination
            page={page}
            pageInfo={`Page ${page}${
              data?.latestBlockNumber !== undefined
                ? ` • Latest block: ${formatNumber(data.latestBlockNumber)}`
                : ''
            }`}
            hasPrev={page > 1}
            hasNext={data?.hasMore === true}
            onPrev={goNewer}
            onNext={goOlder}
            prevLabel="Newer"
            nextLabel="Older"
          />
        )}
      </PageContainer>
    </>
  );
}
