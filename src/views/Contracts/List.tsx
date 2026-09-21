// Cached-contract directory: every contract_sources row this explorer has
// fetched for the chain (opening or force-refreshing a contract page
// populates the cache). Server-side ?q= filtering (name substring or
// address prefix — same rule as the global search's local hits) and
// offset pagination both ride the URL (?q=, ?offset=), so filtered views
// and deep pages are shareable links.
import { useEffect, useRef, useState } from 'react';
import { css } from '@linaria/core';
import { TypedLink, useMatched, useSearch, useSetSearch } from '@native-router/react';
import { z } from 'zod';
import { Input } from 'haze-ui';

import TopNavigation from '@/components/TopNavigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { DataTable, Pagination, linkStyle } from '@/components/ui/DataTable';
import { EmptyState, ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/LoadingState';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { getChainInfo, getChainName } from '@/config/chains';
import { redirectReplace } from '@/views/Home/Landing';
import { UnsupportedChainState } from '@/views/Home/UnsupportedChainState';
import {
  CONTRACT_DIRECTORY_PAGE_SIZE,
  useContractDirectory,
} from '@/services/contractDirectory';
import { formatNumber, formatRelativeTime } from '@/utils/format';

// Header row: title on the left, the filter input and Refresh on the
// right (Transactions/List toolbar family).
const listToolbar = css`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--haze-space-4);
  margin-bottom: var(--haze-space-4);
  flex-wrap: wrap;
`;

const toolbarActions = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
`;

// The filter input keeps its own width; the Refresh button follows it.
const filterBox = css`
  width: 280px;
  max-width: 100%;
`;

// Honesty line under the toolbar: this lists the explorer's own cache,
// not an on-chain registry — the empty state and this note both say so.
const sourceNote = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
  margin-bottom: var(--haze-space-3);
`;

const verificationCell = css`
  display: inline-flex;
  align-items: center;
  gap: var(--haze-space-2);
`;

const verificationSourceText = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
`;

// Search params: ?q= is the server-side filter (any string is a legal
// query, so plain optional() — no catch needed); ?offset= is the page
// offset (0 when absent or garbage, same degradation as ?page= on the
// transactions list). Exported for the page tests.
export const searchSchema = z.object({
  q: z.string().optional(),
  offset: z.coerce.number().int().min(0).catch(0),
});

// Debounce for the filter box: the URL (?q=) only moves once typing
// pauses, so the query layer is not re-keyed per keystroke.
const FILTER_DEBOUNCE_MS = 300;

export default function ContractsList() {
  const { params, router } = useMatched();
  const setSearch = useSetSearch(searchSchema);
  const { q: qParam, offset } = useSearch(searchSchema);

  const currentChainId = Number.parseInt(params.chainId ?? '1', 10);
  const chainInfo = getChainInfo(currentChainId);

  // The filter input starts from the deep-linked ?q= and then leads the
  // URL: every debounced change replaces the URL entry (typing must not
  // spam history) and resets the offset (a new filter starts at page 1).
  const [qInput, setQInput] = useState(() => qParam ?? '');
  // The ?q= value this view itself last pushed — distinguishes the URL
  // write the debounce causes (input must keep leading) from an external
  // URL change (deep link, back/forward — input must follow).
  const lastPushedQRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = qInput.trim();
      if ((qParam ?? '') === next) return;
      lastPushedQRef.current = next;
      void setSearch(prev => {
        // Both keys are rebuilt: a new filter always restarts at offset 0.
        const { q: _oldQ, offset: _oldOffset, ...rest } = prev;
        return next === '' ? rest : { ...rest, q: next };
      }, { replace: true });
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [qInput, qParam, setSearch]);

  // External ?q= change (deep link, back/forward): sync the input unless
  // the URL carries exactly what this view just pushed.
  useEffect(() => {
    const urlQ = qParam ?? '';
    if (lastPushedQRef.current === urlQ) return;
    setQInput(urlQ);
  }, [qParam]);

  // The hook runs for the rendered chain even when unsupported (chainId 0
  // resolves to undefined without a request — liveHeadFeed pattern); the
  // unsupported branch below renders before any table does.
  const query = useContractDirectory(chainInfo ? currentChainId : 0, qParam, offset);
  const { data, loading, error, refetch, fetching } = query;

  // Settle guard (gasHistory pattern): the query store keeps the previous
  // args' settle across an argument switch, so only a payload whose own
  // echo matches the rendered (chain, q, offset) is trusted — anything
  // else renders as pending, never as someone else's page. A fetch error
  // outranks the pending look (the error state explains the wait).
  const pageMatchesArgs =
    data?.chainId === currentChainId
    && data.offset === offset
    && (data.q ?? '') === (qParam ?? '');
  const contracts = pageMatchesArgs ? data.contracts : [];
  const total = pageMatchesArgs ? data.total : 0;
  const showSkeleton = error === undefined && (loading || (data !== undefined && !pageMatchesArgs));

  // Chain switches replace the current entry via the shared Wave A helper
  // (Transactions/List pattern); a ?q= filter legitimately survives — the
  // directory of another chain may well hold the same name.
  const handleChainChange = (newChainId: number) => {
    void redirectReplace(router, `/chain/${newChainId}/contracts`).catch(() => undefined);
  };

  const page = Math.floor(offset / CONTRACT_DIRECTORY_PAGE_SIZE) + 1;
  const hasPrev = offset > 0;
  const hasNext = offset + contracts.length < total;

  const goPrev = () => {
    // Push, not replace: every page becomes a history entry.
    void setSearch(prev => ({
      ...prev,
      offset: String(Math.max(0, offset - CONTRACT_DIRECTORY_PAGE_SIZE)),
    }));
  };

  const goNext = () => {
    if (!hasNext) return;
    void setSearch(prev => ({ ...prev, offset: String(offset + CONTRACT_DIRECTORY_PAGE_SIZE) }));
  };

  if (!chainInfo) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <PageContainer>
          {/* Unsupported-chain deep link: recovery CTAs instead of a bare
              error (Home/Blocks/Transactions pattern). */}
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
            title="Contracts"
            chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
          />
          <div className={toolbarActions}>
            <div className={filterBox}>
              <Input
                placeholder="Filter by name or address prefix..."
                value={qInput}
                onChange={e => setQInput(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={fetching}>
              {fetching ? 'Refreshing…' : '↻ Refresh'}
            </Button>
          </div>
        </div>

        <div className={sourceNote}>
          Cached contract sources on this explorer — open a contract page to cache more.
        </div>

        {showSkeleton && <TableSkeleton rows={8} cols={4} />}

        {error && (
          <ErrorState
            message={error instanceof Error ? error.message : 'Failed to fetch contracts'}
            onRetry={refetch}
          />
        )}

        {/* Empty directory / empty filtered page: a normal business
            outcome, not a failure — the info-toned EmptyState family. The
            copy says exactly what the list is (the local cache) and how to
            grow it. */}
        {!showSkeleton && !error && contracts.length === 0 && (
          <EmptyState
            message={
              qParam !== undefined && qParam !== ''
                ? `No cached contracts match "${qParam}"`
                : offset > 0
                  ? 'No cached contracts on this page — go back'
                  : 'No cached contracts yet — open a contract page to cache its source'
            }
          />
        )}

        {contracts.length > 0 && (
          <DataTable>
            <thead>
              <tr>
                <th>Name</th>
                <th>Address</th>
                <th>Verification</th>
                <th>Cached</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map(row => (
                <tr key={row.address}>
                  <td>
                    {row.name !== null ? (
                      <TypedLink
                        to={`/chain/${currentChainId}/contract/${row.address}`}
                        className={linkStyle}
                      >
                        {row.name}
                      </TypedLink>
                    ) : (
                      // Unverified cache rows carry no name — an em-dash,
                      // never a fabricated label.
                      '—'
                    )}
                  </td>
                  <td>
                    <CopyableHash
                      value={row.address}
                      truncated={row.address}
                      href={`/chain/${currentChainId}/contract/${row.address}`}
                    />
                  </td>
                  <td>
                    <span className={verificationCell}>
                      {row.isVerified ? (
                        <Badge variant="success" size="sm">
                          Verified
                        </Badge>
                      ) : (
                        <Badge variant="default" size="sm">
                          Unverified
                        </Badge>
                      )}
                      {row.isVerified && row.verificationSource !== null && (
                        <span className={verificationSourceText}>{row.verificationSource}</span>
                      )}
                    </span>
                  </td>
                  <td>
                    {row.updatedAt !== null ? (
                      <span title={row.updatedAt}>{formatRelativeTime(row.updatedAt)}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}

        {(contracts.length > 0 || hasNext) && (
          <Pagination
            page={page}
            pageInfo={`Page ${page} • ${formatNumber(total)} cached contracts`}
            hasPrev={hasPrev}
            hasNext={hasNext}
            onPrev={goPrev}
            onNext={goNext}
          />
        )}
      </PageContainer>
    </>
  );
}
