// Token directory page (/chain/:chainId/tokens): the curated known-token
// list of the chain UNION tokens opened in this browser (localStorage) —
// never presented as a complete registry; the caveat line renders in every
// state, including the empty one. Entirely browser-side: ONE Multicall3
// batch enriches every row with runtime symbol/name/decimals/totalSupply
// (curation entries are display hints only — the same honesty rule as
// config/knownTokens), prices ride the existing DefiLlama spot batch, so
// there is no backend dependency and backend-offline is irrelevant here.
// ?q= filters client-side over the resolved symbol/name/address and rides
// the URL (Contracts/List debounce + settle-guard pattern), so filtered
// views are shareable links.
import { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@linaria/core';
import { TypedLink, useMatched, useSearch, useSetSearch } from '@native-router/react';
import { z } from 'zod';
import { Input } from 'haze-ui';

import TopNavigation from '@/components/TopNavigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { DataTable, linkStyle } from '@/components/ui/DataTable';
import { EmptyState, ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/LoadingState';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { getChainInfo, getChainName } from '@/config/chains';
import { redirectReplace } from '@/views/Home/Landing';
import { UnsupportedChainState } from '@/views/Home/UnsupportedChainState';
import {
  directoryRowsForChain,
  directoryStandardLabel,
  filterByQuery,
  tokenDirectoryAddressesKey,
  useTokenDirectoryReads,
  type TokenDirectoryRow,
} from '@/services/tokenDirectory';
import { useTokenUsdPrices, type UsdPriceSnapshot } from '@/services/prices';
import { UsdValue } from '@/components/ui/UsdValue';

// Header row: title on the left, the filter input and Refresh on the
// right (Contracts/List toolbar family).
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

  @media (max-width: 768px) {
    flex-wrap: wrap;
  }
`;

// The filter input keeps its own width; the Refresh button follows it.
// On narrow screens the input owns a full-width row (Contracts/List).
const filterBox = css`
  width: 280px;
  max-width: 100%;

  @media (max-width: 768px) {
    width: 100%;
  }
`;

// Honesty line under the toolbar — present in EVERY state (loading, error,
// empty, table): this is a curated list plus this browser's visits, not an
// on-chain registry.
const sourceNote = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
  margin-bottom: var(--haze-space-3);
`;

// Token cell: linked symbol, full name under it, address hash below
// (Contracts/List's address-cell convention).
const tokenCell = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
  align-items: flex-start;
`;

const tokenName = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
`;

// Filter effect count, shown only while a filter is active.
const filterCountNote = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-muted);
  margin-top: var(--haze-space-2);
`;

/** The caveat rendered in every state — pinned verbatim for the page tests. */
export const DIRECTORY_CAVEAT =
  'Known tokens on this chain — a curated list plus tokens opened in this browser. Not a complete registry.';

// Search params: ?q= is the client-side filter (any string is a legal
// query, so plain optional() — no catch needed). Exported for the page
// tests (Contracts/List convention).
export const searchSchema = z.object({ q: z.string().optional() });

// Debounce for the filter box: the URL (?q=) only moves once typing
// pauses, so the enrichment query and the filter are not re-keyed per
// keystroke.
const FILTER_DEBOUNCE_MS = 300;

/** One enriched, display-ready row (runtime reads first, hints as fallback). */
type DisplayRow = {
  address: string;
  symbol: string | null;
  name: string | null;
  provenance: TokenDirectoryRow['provenance'];
  standard: 'ERC-20' | null;
  price: UsdPriceSnapshot | null;
};

export default function TokensList() {
  const { params, router } = useMatched();
  const setSearch = useSetSearch(searchSchema);
  const { q: qParam } = useSearch(searchSchema);

  const currentChainId = Number.parseInt(params.chainId ?? '1', 10);
  const chainInfo = getChainInfo(currentChainId);

  // The filter input starts from the deep-linked ?q= and then leads the
  // URL: every debounced change replaces the URL entry (typing must not
  // spam history). No offset to reset — the directory is one bounded page.
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
        const { q: _oldQ, ...rest } = prev;
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

  // Directory rows: curated ∪ viewed, read from localStorage at mount and
  // on chain switches (navigating to a token page and back remounts this
  // view, so a fresh visit re-reads; the token page records through
  // services/tokenDirectory's recordViewedToken).
  const rows = useMemo(
    () => (chainInfo !== null ? directoryRowsForChain(currentChainId) : []),
    [chainInfo, currentChainId],
  );
  const addresses = useMemo(() => rows.map((row) => row.address), [rows]);
  const addressesKey = useMemo(() => tokenDirectoryAddressesKey(addresses), [addresses]);

  // Enrichment runs for the rendered chain even when unsupported (the
  // disabled key chainId 0 settles an empty page without a request); the
  // unsupported branch below renders before any table does.
  const readsQuery = useTokenDirectoryReads(
    chainInfo !== null ? currentChainId : 0,
    addresses,
  );

  // Settle guard (Contracts/List pattern): only a payload whose own echo
  // matches the rendered (chain, address set) is trusted — anything else
  // renders as pending, never as someone else's directory. A fetch error
  // outranks the pending look (the error state explains the wait).
  const readsData = readsQuery.data;
  const pageMatchesArgs =
    readsData?.chainId === currentChainId
    && readsData?.addressesKey === addressesKey;
  const reads = pageMatchesArgs ? readsData.reads : undefined;

  // Prices for the whole directory in one DefiLlama spot batch; unknown
  // chain/token settles an empty map without any network (the price cell
  // then renders blank — USD is strictly an enhancement).
  const prices = useTokenUsdPrices(
    chainInfo !== null ? currentChainId : 0,
    addresses,
  );

  // Display rows: runtime reads replace the display hints (chain truth),
  // the ERC-20 claim appears only when decimals AND totalSupply responded
  // (the address-page overview rule), and the price snapshot rides along.
  const displayRows = useMemo<DisplayRow[]>(
    () =>
      rows.map((row) => {
        const rowReads = reads?.get(row.address.toLowerCase());
        const price = prices?.get(row.address.toLowerCase()) ?? null;
        return {
          address: row.address,
          symbol: rowReads?.symbol ?? row.symbol,
          name: rowReads?.name ?? row.name,
          provenance: row.provenance,
          standard: directoryStandardLabel(rowReads),
          price,
        };
      }),
    [rows, reads, prices],
  );

  const visibleRows = useMemo(
    () => filterByQuery(displayRows, qParam),
    [displayRows, qParam],
  );

  const showSkeleton =
    readsQuery.error === undefined
    && (readsQuery.loading || (readsData !== undefined && !pageMatchesArgs));

  // The table paints only on a settle whose echo matches the rendered
  // directory — during a re-key (storage grew, chain switched) the pending
  // look renders the skeleton, never hint-only rows posing as enriched.
  const rowsVisible =
    !showSkeleton && readsQuery.error === undefined && visibleRows.length > 0;

  // Chain switches replace the current entry (Transactions/List pattern);
  // a ?q= filter legitimately survives — another chain may hold the same
  // symbol.
  const handleChainChange = (newChainId: number) => {
    void redirectReplace(router, `/chain/${newChainId}/tokens`).catch(() => undefined);
  };

  if (chainInfo === null) {
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

  const refresh = () => void readsQuery.refetch();

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <PageContainer>
        <div className={listToolbar}>
          <PageHeader
            title="Tokens"
            chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
          />
          <div className={toolbarActions}>
            <div className={filterBox}>
              <Input
                placeholder="Filter by symbol, name or address..."
                value={qInput}
                onChange={e => setQInput(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={readsQuery.fetching}
            >
              {readsQuery.fetching ? 'Refreshing…' : '↻ Refresh'}
            </Button>
          </div>
        </div>

        <div className={sourceNote}>{DIRECTORY_CAVEAT}</div>

        {showSkeleton && <TableSkeleton rows={8} cols={4} />}

        {readsQuery.error !== undefined && (
          <ErrorState
            message={
              readsQuery.error instanceof Error
                ? readsQuery.error.message
                : 'Failed to fetch token details'
            }
            onRetry={refresh}
          />
        )}

        {/* Empty directory / empty filter result: a normal business
            outcome, not a failure — the caveat above stays visible either
            way. The copy says exactly how the list grows. */}
        {!showSkeleton && readsQuery.error === undefined && visibleRows.length === 0 && (
          <EmptyState
            message={
              qParam !== undefined && qParam !== ''
                ? `No tokens match "${qParam}"`
                : 'No known tokens on this chain yet — open a token page to add it here'
            }
          />
        )}

        {rowsVisible && (
          <DataTable>
            <thead>
              <tr>
                <th>Token</th>
                <th>Standard</th>
                <th>Price</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const tokenHref = `/chain/${currentChainId}/token/${row.address}`;
                // Never a fabricated label: runtime symbol/name first,
                // then the display hints, then the bare address.
                const primaryLabel = row.symbol ?? row.name ?? row.address;
                return (
                  <tr key={row.address}>
                    <td>
                      <div className={tokenCell}>
                        <TypedLink to={tokenHref} className={linkStyle}>
                          {primaryLabel}
                        </TypedLink>
                        {row.symbol !== null && row.name !== null && (
                          <span className={tokenName}>{row.name}</span>
                        )}
                        <CopyableHash
                          value={row.address}
                          truncated={row.address}
                          href={tokenHref}
                        />
                      </div>
                    </td>
                    <td>
                      {/* Provable only: 'ERC-20' when decimals AND
                          totalSupply responded — otherwise an em-dash,
                          never a guessed standard. */}
                      {row.standard ?? '—'}
                    </td>
                    <td>
                      {/* Blank when unavailable (UsdValue's contract) —
                          USD is an enhancement, never a fixture. */}
                      {row.price !== null ? (
                        <UsdValue usd={row.price.usd} price={row.price} />
                      ) : null}
                    </td>
                    <td>
                      <Badge
                        variant={row.provenance === 'curated' ? 'info' : 'default'}
                        size="sm"
                      >
                        {row.provenance === 'curated' ? 'Curated' : 'Viewed'}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}

        {(qParam ?? '') !== '' && rowsVisible && (
          <div className={filterCountNote}>
            {visibleRows.length} of {displayRows.length} tokens match "{qParam}"
          </div>
        )}
      </PageContainer>
    </>
  );
}
