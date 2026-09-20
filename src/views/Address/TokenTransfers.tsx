// Token Transfers tab of the address page: rows come from the on-demand
// eth_getLogs scan (see services/tokenTransfers.ts) — there is no indexer
// behind it, so coverage honesty is part of the surface. Token symbol and
// decimals enrichment is frontend RPC territory by design: the backend
// deliberately never reads token metadata.
import { useEffect, useRef, useState } from 'react';
import { css } from '@linaria/core';
import { TypedLink, useSearch, useSetSearch } from '@native-router/react';
import { erc20Abi, formatUnits } from 'viem';
import { Alert } from 'haze-ui';
import { useTokenTransfers, requestTokenTransfersRefresh, type TokenTransfer } from '@/services/tokenTransfers';
import { createRpcClient } from '@/utils/realTimeData';
import { addressSearchSchema, shouldPinTransfersPage } from '@/views/Address/search';
import { getExternalToolLinks } from '@/config/externalTools';
import { formatRelativeTime } from '@/utils/format';
import { DataTable, Pagination, linkStyle } from '@/components/ui/DataTable';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { ExternalLinks } from '@/components/ui/ExternalLinks';

const TRANSFER_LIMIT = 25;

// Hard ceiling of the scan window (blocks) — matches the backend clamp
// (route schema + service MAX_WINDOW_BLOCKS). "Search deeper" disables at
// this budget.
const MAX_WINDOW_BLOCKS = 50_000_000;

const valueCell = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
`;

const mutedValue = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

const bannerLinks = css`
  margin: var(--haze-space-2) 0 var(--haze-space-3);
`;

// Window disclosure for complete coverage (the partial case carries the
// same number inside its warning banner).
const windowNote = css`
  margin: 0 0 var(--haze-space-3);
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

// Freshness disclosure at the head of the tab (first-scan time).
const scanNote = css`
  margin: 0 0 var(--haze-space-3);
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

// Legend under the table: the scan contract carries no timestamps, so the
// Age column's placeholder stays explained instead of looking broken.
const timestampLegend = css`
  margin: var(--haze-space-2) 0 0;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

// Beyond-data page row (nextCursor already null but the local page slid
// past the data) — never read as "no transfers".
const emptyPageCell = css`
  color: var(--haze-color-text-muted);
  text-align: center;
`;

const formatAddr = (a: string) => (a ? `${a.slice(0, 8)}...${a.slice(-6)}` : 'N/A');
const formatHash = (h: string) => (h ? `${h.slice(0, 10)}...${h.slice(-8)}` : '');

// Resolved token metadata. `decimals` present classifies the token as
// ERC-20; decimals rejected while symbol resolves reads as ERC-721;
// both rejected leaves the token unknown (raw-value fallback).
type TokenMeta = {
  symbol?: string;
  decimals?: number;
};

// Module-level cache keyed `${chainId}:${token}`: resolved entries
// (including the both-calls-rejected unknown marker) are shared across
// rows and remounts, so each token costs at most one symbol() + one
// decimals() read per session.
const tokenMetaCache = new Map<string, TokenMeta>();
const tokenMetaPending = new Map<string, Promise<TokenMeta>>();

async function loadTokenMeta(chainId: number, token: string): Promise<TokenMeta> {
  try {
    const client = await createRpcClient(chainId);
    const address = token as `0x${string}`;
    // Independent calls with individual fallbacks: a reverting decimals()
    // is the ERC-721 signal, not a failure of the whole lookup.
    const symbol = await client
      .readContract({ address, abi: erc20Abi, functionName: 'symbol' })
      .then(s => String(s), () => undefined);
    const decimals = await client
      .readContract({ address, abi: erc20Abi, functionName: 'decimals' })
      .then(d => Number(d), () => undefined);
    return { symbol, decimals };
  } catch {
    return {};
  }
}

function startTokenMetaLoad(chainId: number, token: string, key: string): Promise<TokenMeta> {
  const pending = loadTokenMeta(chainId, token).then(
    meta => {
      tokenMetaCache.set(key, meta);
      tokenMetaPending.delete(key);
      return meta;
    },
    // Unreachable in practice (loadTokenMeta never rejects) — degrade to
    // the unknown marker rather than leaving a dangling shared promise.
    () => {
      const meta: TokenMeta = {};
      tokenMetaCache.set(key, meta);
      tokenMetaPending.delete(key);
      return meta;
    },
  );
  tokenMetaPending.set(key, pending);
  return pending;
}

// undefined while the metadata is still loading; {} once resolved as
// unreadable (the row then keeps the raw-value fallback).
function useTokenMeta(chainId: number, token: string): TokenMeta | undefined {
  const key = token ? `${chainId}:${token.toLowerCase()}` : '';
  const [meta, setMeta] = useState<TokenMeta | undefined>(() =>
    key ? tokenMetaCache.get(key) : undefined,
  );
  useEffect(() => {
    if (!key) return;
    const cached = tokenMetaCache.get(key);
    if (cached) {
      setMeta(cached);
      return;
    }
    let cancelled = false;
    // Deduped across rows mounting in the same tick for one token.
    const pending =
      tokenMetaPending.get(key) ?? startTokenMetaLoad(chainId, token, key);
    pending.then(resolved => {
      if (!cancelled) setMeta(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [key, chainId, token]);
  return meta;
}

function StandardPill({ transfer, meta }: { transfer: TokenTransfer; meta: TokenMeta | undefined }) {
  let label: string;
  if (transfer.standard === 'erc1155-single') label = 'ERC-1155';
  else if (transfer.standard === 'erc1155-batch') label = 'ERC-1155 Batch';
  else if (meta?.decimals !== undefined) label = 'ERC-20';
  else if (meta?.symbol !== undefined) label = 'ERC-721';
  else label = 'ERC-20/721';
  return (
    <Badge variant="default" size="sm">
      {label}
    </Badge>
  );
}

function AmountCell({ transfer, meta }: { transfer: TokenTransfer; meta: TokenMeta | undefined }) {
  // ERC-1155 rows never need metadata: ids and amounts ride on the log.
  if (transfer.standard === 'erc1155-single') {
    const id = transfer.tokenIds?.[0];
    const amount = transfer.amounts?.[0] ?? transfer.value;
    return (
      <td className={valueCell}>
        {id !== undefined ? `ID ${id}` : 'ID ?'} × {amount}
      </td>
    );
  }
  if (transfer.standard === 'erc1155-batch') {
    const ids = transfer.tokenIds;
    return (
      <td className={valueCell}>
        {!ids || ids.length === 0
          ? `${transfer.value} IDs`
          : ids.length === 1
            ? `ID ${ids[0]}`
            : `ID ${ids[0]} +${ids.length - 1} more`}
      </td>
    );
  }
  // erc20-or-erc721: decimals() resolved → ERC-20 amount.
  if (meta?.decimals !== undefined) {
    try {
      return (
        <td className={valueCell}>
          {formatUnits(BigInt(transfer.value), meta.decimals)}
          {meta.symbol !== undefined ? ` ${meta.symbol}` : ''}
        </td>
      );
    } catch {
      // Non-numeric value: fall through to the raw fallback below.
    }
  }
  // decimals() rejected while symbol() resolved → ERC-721 token id.
  if (meta !== undefined && meta.decimals === undefined && meta.symbol !== undefined) {
    return (
      <td className={valueCell}>
        Token ID {transfer.value} {meta.symbol}
      </td>
    );
  }
  // Metadata unknown (still loading or unreadable): the raw value plus
  // the shortened token address — never a guessed decimals amount.
  return (
    <td className={valueCell}>
      <span>{transfer.value}</span>{' '}
      <span className={mutedValue}>{formatAddr(transfer.token)}</span>
    </td>
  );
}

function TransferRow({ chainId, transfer }: { chainId: number; transfer: TokenTransfer }) {
  // Only the shared-signature standard needs metadata; passing '' for the
  // ERC-1155 rows keeps the hook unconditional (rules of hooks) while
  // skipping their enrichment entirely.
  const meta = useTokenMeta(
    chainId,
    transfer.standard === 'erc20-or-erc721' ? transfer.token : '',
  );
  return (
    <tr>
      <td>
        <CopyableHash
          value={transfer.txHash}
          truncated={formatHash(transfer.txHash)}
          href={`/chain/${chainId}/tx/${transfer.txHash}`}
        />
      </td>
      <td>
        <TypedLink
          to={`/chain/${chainId}/block/${transfer.blockNumber}`}
          className={linkStyle}
        >
          {transfer.blockNumber.toLocaleString()}
        </TypedLink>
      </td>
      {/* The scan contract carries no timestamps — an em dash, never a
          fabricated age; the title explains the placeholder. */}
      <td title="Timestamps are not available for scan results">—</td>
      <td>
        <Badge
          variant={transfer.direction === 'in' ? 'success' : 'error'}
          size="sm"
        >
          {transfer.direction === 'in' ? 'IN' : 'OUT'}
        </Badge>
      </td>
      <td>
        <CopyableHash
          value={transfer.token}
          truncated={meta?.symbol ?? formatAddr(transfer.token)}
          href={`/chain/${chainId}/address/${transfer.token}`}
        />
      </td>
      <td>
        <StandardPill transfer={transfer} meta={meta} />
      </td>
      <td>
        <CopyableHash
          value={transfer.from}
          truncated={formatAddr(transfer.from)}
          href={`/chain/${chainId}/address/${transfer.from}`}
        />
      </td>
      <td>
        <CopyableHash
          value={transfer.to}
          truncated={formatAddr(transfer.to)}
          href={`/chain/${chainId}/address/${transfer.to}`}
        />
      </td>
      <AmountCell transfer={transfer} meta={meta} />
    </tr>
  );
}

type TokenTransfersProps = {
  chainId: number;
  address: string;
  /**
   * Contract classification from the parent (persistent channel wins, RPC
   * code read as fallback). Only a known `true` renders the
   * events-indexing CTA on an empty list; undefined stays honest (no CTA).
   */
  isContract?: boolean;
  /** Bumped by the parent's Refresh button; each bump refetches here. */
  refreshSignal?: number;
  /** Reports a refreshSignal-triggered refetch settling (spinner control). */
  onRefreshed?: () => void;
};

export default function TokenTransfers({
  chainId,
  address,
  isContract,
  refreshSignal = 0,
  onRefreshed,
}: TokenTransfersProps) {
  // The tab's pagination lives in the URL (?ttPage=) through the shared
  // address-page schema: deep pages are shareable, refresh-stable and
  // back/forward works. Writes go through the functional form so the tx
  // tab's ?page=/?window= merge in instead of being clobbered; invalid or
  // absent values coerce to 1, and the view clamps to >= 1. Every write
  // also pins ?tab=transfers — this component only renders on that tab,
  // so its URL writes must keep the deep link landing there.
  const setSearch = useSetSearch(addressSearchSchema);
  const { ttPage: ttPageParam, ttWindow: ttWindowParam } = useSearch(addressSearchSchema);
  const page = Math.max(1, Math.floor(ttPageParam));
  const setPage = (next: number) => {
    void setSearch(prev => ({
      ...prev,
      tab: 'transfers',
      ttPage: String(Math.max(1, Math.floor(next))),
    }));
  };
  // Widened scan window (blocks) from ?ttWindow= — undefined is the
  // backend default. URL-driven (never local state): the window survives
  // refresh/share, and a different address's URL cannot carry it over —
  // navigating between addresses re-parses the search in the SAME render
  // pass the address changes, so no frame ever scans a new address with
  // the previous one's window (the old reset-in-effect lagged one frame).
  const searchWindow = ttWindowParam;

  // Cursor = decimal offset into the cached list ('0' = first page).
  const cursor = String((page - 1) * TRANSFER_LIMIT);
  const query = useTokenTransfers(chainId, address, cursor, TRANSFER_LIMIT, searchWindow);

  const transfers = query.data?.transfers ?? [];
  const coverage = query.data?.coverage;
  const windowBlocks = query.data?.windowBlocks;
  // First-scan time (server cache hit) — absent on legacy payloads
  // without the field, in which case no freshness is claimed.
  const scannedAt = query.data?.scannedAt;
  const windowLabel = windowBlocks !== undefined ? windowBlocks.toLocaleString() : undefined;
  // nextCursor drives Next (null = end of the discovered list); no total
  // is claimed — the scan never asserts one.
  const hasNext = query.data ? query.data.nextCursor !== null : false;
  const externalToolLinks = getExternalToolLinks(chainId, address);

  // Beyond-data convergence (Transactions/List semantics): once a payload
  // settles with no rows at this offset on a page past the first, the URL
  // is pinned (replaced) to page 1 — an empty transfers page is never
  // shareable or refreshable. Mid-flight (or failed) fetches converge
  // nothing; the empty-page row further below is the honest fallback for
  // those races. The scan cannot report a deepest valid page (no total is
  // claimed), so page 1 is the only provably valid target.
  const pageBeyondData = shouldPinTransfersPage(
    {
      hasData: query.data !== undefined,
      loading: query.loading,
      hasError: query.error !== undefined,
    },
    transfers.length,
    page,
  );
  useEffect(() => {
    if (!pageBeyondData) return;
    void setSearch(prev => ({ ...prev, tab: 'transfers', ttPage: '1' }), {
      replace: true,
    });
  }, [pageBeyondData, setSearch]);

  // "Search deeper" escalation (mirrors the tx tab): quadruple the
  // effective window the RESPONSE reported (post-clamp truth, not the
  // requested value), capped at the RPC budget ceiling.
  const searchWindowAtCap =
    windowBlocks !== undefined && windowBlocks >= MAX_WINDOW_BLOCKS;
  const nextSearchWindow = windowBlocks !== undefined
    ? Math.min(windowBlocks * 4, MAX_WINDOW_BLOCKS)
    : MAX_WINDOW_BLOCKS;

  // Explicit Retry: bypass BOTH caches — refetch() drops the frontend
  // entry, the latch sends ?refresh=1 so the backend re-scans instead of
  // re-serving its (possibly 'partial') 60s cache entry.
  const retryFresh = () => {
    requestTokenTransfersRefresh();
    void query.refetch();
  };

  // The tab's fetch lives here (not in the parent), so the unmounted tab
  // fetches nothing. A parent Refresh arrives as a signal bump and is an
  // explicit refresh too — same cache-bypass semantics as Retry.
  const appliedSignal = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === appliedSignal.current) return;
    appliedSignal.current = refreshSignal;
    requestTokenTransfersRefresh();
    void Promise.resolve(query.refetch()).finally(() => onRefreshed?.());
  }, [refreshSignal, query, onRefreshed]);

  if (query.loading && !query.data) {
    return <LoadingState message="Scanning token transfers..." />;
  }

  return (
    <>
      {query.loading && query.data && <LoadingState message="Loading page..." />}

      {/* Freshness of the tab's data: the scan rides a ~60s server cache,
          and a cache hit reports the FIRST scan's time (not the serve
          time), so the age honestly keeps growing within the TTL. Legacy
          payloads without the field claim no freshness at all. */}
      {!query.loading && !query.error && scannedAt !== undefined && (
        <p className={scanNote}>Scanned {formatRelativeTime(scannedAt)}</p>
      )}

      {query.error && (
        <ErrorState
          message={query.error.message}
          onRetry={() => {
            void query.refetch();
          }}
        />
      )}

      {/* Partial coverage: the scan budget ran out — Retry re-scans it
          (cache-bypassing); Search deeper widens the window. */}
      {!query.loading && !query.error && coverage === 'partial' && (
        <>
          <Alert variant="warning">
            {transfers.length === 0
              ? `Scan budget exhausted after the last ${windowLabel ?? 'capped'} blocks — no token transfers found within that range. This is not proof that none exist.`
              : `Partial coverage — the scan budget ran out after the last ${windowLabel ?? 'capped'} blocks; older token transfers may be missing.`}
          </Alert>
          <div className={bannerLinks}>
            <Button
              variant="secondary"
              size="sm"
              loading={query.fetching}
              onClick={retryFresh}
            >
              Retry
            </Button>
            {/* Escalation: quadruple the scanned window. Disabled with a
            title once the RPC budget cap is reached — the button stays
            visible (still partial) so the limitation stays explained. */}
            <Button
              variant="secondary"
              size="sm"
              disabled={searchWindowAtCap}
              title={
                searchWindowAtCap
                  ? 'maximum RPC budget reached'
                  : undefined
              }
              loading={query.fetching}
              onClick={() => {
                // refresh=1 so the widened request never re-serves the
                // shallower window's backend cache entry; the window
                // rides ?ttWindow= (a pushed history entry, like ?ttPage=)
                // so the depth survives refresh, share and back/forward,
                // and a different address's URL never inherits it.
                requestTokenTransfersRefresh();
                void setSearch(prev => ({
                  ...prev,
                  tab: 'transfers',
                  ttWindow: String(nextSearchWindow),
                }));
              }}
            >
              Search deeper
            </Button>
          </div>
        </>
      )}

      {/* Complete coverage: the window disclosure stays visible (the
          partial banner above already carries it). */}
      {!query.loading && !query.error && coverage === 'complete' && windowLabel && (
        <p className={windowNote}>Scanned within the last {windowLabel} blocks.</p>
      )}

      {/* Trusted empty ONLY for authoritative coverage on the first page. */}
      {!query.loading && !query.error && transfers.length === 0 && coverage === 'complete' && page === 1 && (
        <Alert variant="info">No token transfers found</Alert>
      )}

      {/* Pre-coverage cached payload (no coverage tag): an empty list is
          unverified, so "coverage unknown" reads differently from a
          complete scan that found nothing — never a trusted empty. */}
      {!query.loading && !query.error
        && query.data !== undefined && transfers.length === 0
        && coverage === undefined && (
        <>
          <Alert variant="warning">
            Token transfer data source unknown — scan coverage for this
            address is unknown, so this is not proof that none exist.
            Verify on an external explorer.
          </Alert>
          <div className={bannerLinks}>
            <ExternalLinks links={externalToolLinks} />
          </div>
        </>
      )}

      {/* Dual-channel CTA: the eth_getLogs scan is budget-capped, but a
          contract's full history is reachable through the persistent
          events-indexing channel — offer it exactly when the list came
          back empty and the address is a known contract. */}
      {!query.loading && !query.error && transfers.length === 0 && isContract === true && (
        <div className={bannerLinks}>
          <TypedLink
            to={`/chain/${chainId}/contract/${address}/events`}
            className={linkStyle}
          >
            Index this contract's events for full history →
          </TypedLink>
        </div>
      )}

      {(transfers.length > 0 || page > 1) && (
        <>
          <DataTable>
            <thead>
              <tr>
                <th>Tx Hash</th>
                <th>Block</th>
                <th title="Timestamps are not available for scan results">Age</th>
                <th>Direction</th>
                <th>Token</th>
                <th>Standard</th>
                <th>From</th>
                <th>To</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map(transfer => (
                <TransferRow key={`${transfer.txHash}-${transfer.logIndex}`} chainId={chainId} transfer={transfer} />
              ))}
              {transfers.length === 0 && (
                <tr>
                  <td className={emptyPageCell} colSpan={9}>
                    No transfers on this page
                  </td>
                </tr>
              )}
            </tbody>
          </DataTable>
          {/* Same explanation as the Age header tooltip, stated once in
              full: the eth_getLogs scan contract carries no timestamps. */}
          <p className={timestampLegend}>
            Timestamps are not available for scan results.
          </p>
          <Pagination
            page={page}
            pageInfo={`Page ${page}`}
            hasPrev={page > 1}
            hasNext={hasNext}
            onPrev={() => setPage(page - 1)}
            onNext={() => setPage(page + 1)}
          />
        </>
      )}
    </>
  );
}
