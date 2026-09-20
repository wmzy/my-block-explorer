import { useEffect, useState } from 'react';
import { css } from '@linaria/core';
import { TypedLink, useMatched, useSearch, useSetSearch } from '@native-router/react';
import { navigate } from '@native-router/core';
import { formatUnits } from 'viem';
import { Alert } from 'haze-ui';
import { getChainInfo, getChainName, getChainSymbol } from '@/config/chains';
import TopNavigation from '@/components/TopNavigation';
import TokenTransfers from '@/views/Address/TokenTransfers';
import {
  classifyAddressType,
  delegationTarget,
} from '@/views/Address/addressType';
import { checkAddressValidity } from '@/views/Address/addressValidity';
import {
  addressSearchSchema,
  effectiveActivityTab,
  type ActivityTabId,
} from '@/views/Address/search';
import { isBackendUnreachable } from '@/util/http';
import {
  useAddressInfo,
  useAddressTransactions,
  type AddressInfoResponse,
} from '@/services/addresses';
import {
  useContractCode,
  useRealTimeAddressData,
} from '@/services/addressRealTime';
import { useEnsName } from '@/services/ens';
import { formatRelativeTime } from '@/utils/format';
import { getExternalToolLinks } from '@/config/externalTools';
import { redirectReplace } from '@/views/Home/Landing';
import { UnsupportedChainState } from '@/views/Home/UnsupportedChainState';
import { PageContainer, PageHeader, BackButton } from '@/components/ui/PageLayout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { InfoGrid, InfoItem } from '@/components/ui/InfoGrid';
import { DataTable, Pagination, linkStyle } from '@/components/ui/DataTable';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { ExternalLinks } from '@/components/ui/ExternalLinks';

const headerRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--haze-space-4);
`;

const bannerLinks = css`
  margin: var(--haze-space-2) 0 var(--haze-space-3);
`;

// ENS row under the page header: name badge + the full hex address, still
// visible and copyable (CopyableHash without truncation).
const ensHeaderRow = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  flex-wrap: wrap;
  word-break: break-all;
  margin: calc(-1 * var(--haze-space-4)) 0 var(--haze-space-5);
`;

const transactionsCard = css`
  margin-top: var(--haze-space-5);
`;

// Segmented control replacing the card title: Transactions vs Token
// Transfers. The active state rides on aria-pressed so the control stays
// accessible and styled from one source of truth.
const segmentedTabs = css`
  display: inline-flex;
  gap: var(--haze-space-1);
  padding: var(--haze-space-1);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  background: var(--haze-color-bg-subtle);
`;

const tabButton = css`
  border: none;
  background: transparent;
  padding: var(--haze-space-1) var(--haze-space-3);
  border-radius: var(--haze-radius-md);
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text-muted);
  cursor: pointer;

  &:hover {
    color: var(--haze-color-text);
  }

  &[aria-pressed='true'] {
    background: var(--haze-color-bg);
    color: var(--haze-color-text);
    box-shadow: inset 0 0 0 1px var(--haze-color-border);
  }
`;

const valueCell = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
`;

const errorSecondary = css`
  margin: 0 0 var(--haze-space-5);
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

// Inline backend-offline attribution above the Overview card: scoped to
// the indexed fields the card would otherwise silently omit. Deliberately
// not another BackendOfflineState — the global connection banner already
// owns the recovery path; this only explains the missing data.
const offlineNotice = css`
  margin: 0 0 var(--haze-space-4);
`;

// Persistent indexing-scope notice under the tx card header: token
// transfers and internal txs are outside the heuristic's reach at every
// coverage level, so it renders unconditionally.
const tokenNotice = css`
  margin: 0 0 var(--haze-space-3);
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

// Beyond-data page row (total > 0 but this page slid past the data —
// e.g. a widened search shrank the discovered set).
const emptyPageCell = css`
  color: var(--haze-color-text-muted);
  text-align: center;
`;

// Low-key inline marker beside the nonce value: the RPC count is exact
// for outgoing transactions, but the discovered history below is
// heuristic — one click routes to the Transactions tab where the
// coverage banners live (the hint itself never restates them).
const nonceHint = css`
  margin-left: var(--haze-space-1);
  padding: 0;
  border: none;
  background: transparent;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
  line-height: 1;
  cursor: pointer;

  &:hover {
    color: var(--haze-color-text);
  }
`;

// Serialized transaction row as the API returns it (formatTransactionForApi):
// numeric fields arrive as strings over JSON.
type TxRecord = {
  hash: string;
  blockNumber: string;
  fromAddress: string;
  toAddress: string;
  value: string;
  status: number | null;
  timestamp?: string;
};

// The address-info endpoint is typed by its service (AddressInfoResponse):
// a wrapper whose `address` member carries the persistent fields
// (isContract, contractName, verificationStatus, creation/proxy info).
// Balance and transaction count never ride on this channel — they come
// from the realtime hook below.

type AddressTxPage = {
  transactions: TxRecord[];
  /** Discovered (deduped) count — never the nonce (new API contract). */
  total: number;
  coverage?: 'complete' | 'partial' | 'none';
  reason?:
    | 'no-transactions'
    | 'no-outgoing-transactions'
    | 'zero-balance'
    | 'search-failed';
  searchWindowBlocks?: number;
};

// The address-page two-tier validity verdict lives in ./addressValidity
// (shape error vs checksum error — the frontend twin of the server's
// getValidatedAddress). The ADDRESS STRING is the ground truth: the page
// branches on it directly, never on a server error message, so an invalid
// address shows one guidance card no matter which queries reject first.

// Hard ceiling of the address-tx search window (blocks) — matches the
// backend clamp. "Search deeper" disables at this budget.
const MAX_SEARCH_WINDOW_BLOCKS = 50_000_000;

// The page's URL-driven state (?page= / ?window= / ?ttPage=) lives in the
// shared schema module (./search) so the transfers tab writes through the
// SAME schema — a narrower one would strip the other keys on every write.

// Recent-activity card tabs. The transfers tab renders its own component
// (and owns its query there), so the unmounted tab fetches nothing.
const activityTabs: ReadonlyArray<{ id: ActivityTabId; label: string }> = [
  { id: 'transactions', label: 'Transactions' },
  { id: 'transfers', label: 'Token Transfers' },
];

// status: 1 → success, 0 → failed, -1 → pending (no receipt yet, NOT
// failed), null/undefined → unknown (the heuristic discovers txs from
// block data without receipts — never read that as "pending").
function TxStatusBadge({
  status,
  hasBlock,
}: {
  status: number | null | undefined;
  hasBlock: boolean;
}) {
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
  // Without a receipt status, only a block-less tx can honestly read as
  // pending (mempool); a mined tx with unknown status says "Unknown".
  return (
    <Badge variant="default" size="sm">
      {hasBlock ? 'Unknown' : 'Pending'}
    </Badge>
  );
}

// The two-tier invalid-address guidance card, rendered page-level for any
// address the local validity check rejects (see ./addressValidity). The
// tier comes from the address string itself, so the card is query-error
// agnostic — the queries' 400s are a symptom of the same verdict, not
// additional information worth surfacing.
export function InvalidAddressError({
  address,
  chainId,
}: {
  address: string;
  chainId: number;
}) {
  const validity = checkAddressValidity(address);
  // Shape tier: no checksum exists to retry in lowercase, so checksum
  // advice (and a lowercase link) would be misleading.
  if (!validity.valid && validity.tier === 'format') {
    return (
      <ErrorState message="Not a valid address format — expected 0x followed by 40 hexadecimal characters." />
    );
  }
  // Checksum tier: the mixed-case form disagrees with its EIP-55
  // checksum. The all-lowercase form is valid everywhere (the
  // checksum-less convention), so recovery is one click away.
  return (
    <>
      <ErrorState message="This address has an invalid checksum — its mixed-case form disagrees with the EIP-55 checksum. Copy the address from a trusted source, or use the all-lowercase form below." />
      <div className={errorSecondary}>
        <TypedLink
          to={`/chain/${chainId}/address/${address.toLowerCase()}`}
          className={linkStyle}
        >
          Open the all-lowercase form →
        </TypedLink>
      </div>
    </>
  );
}

export default function Address() {
  const { params, router } = useMatched();

  const currentChainId = Number.parseInt(params.chainId ?? '1', 10);
  const chainInfo = getChainInfo(currentChainId);
  const address = params.address ?? '';
  // Page-level two-tier verdict (./addressValidity): an invalid address
  // renders the guidance card instead of the data cards below — the
  // queries may even succeed against a forgiving RPC, but their results
  // are meaningless for an address the explorer cannot accept.
  const addressValidity = checkAddressValidity(address);

  // All hooks run before the guard returns below (rules of hooks); invalid
  // args are gated inside the service fetches (zero network).
  const infoQuery = useAddressInfo(currentChainId, address);
  const realTimeQuery = useRealTimeAddressData(currentChainId, address);
  // Contract-code fallback: when the persistent channel fails, the code
  // read still decides Contract vs EOA (the old hook's fallback path).
  // Costs one extra eth_getCode per address view; cached 24h.
  const codeQuery = useContractCode(currentChainId, address);

  // Reverse ENS resolution is mainnet-pinned (see services/ens.ts); the
  // resolved name, when any, becomes the header's primary label.
  const ensQuery = useEnsName(address, currentChainId);
  const ensName = ensQuery.data;

  // Tx-list pagination and the deepened search window are URL-driven
  // (?page= / ?window=): shareable deep links and working back/forward.
  // useSetSearch validates/writes through the same schema (values as
  // strings on the wire). Writes merge into the current search so a page
  // change never drops the window and vice versa.
  const setSearch = useSetSearch(addressSearchSchema);
  const { page: txPageParam, window: txWindowParam, tab: tabParam, ttPage: ttPageParam } =
    useSearch(addressSearchSchema);
  const txPage = Math.max(1, Math.floor(txPageParam));
  const setTxPage = (next: number) => {
    void setSearch(prev => ({
      ...prev,
      page: String(Math.max(1, Math.floor(next))),
    }));
  };

  // Recent-activity tab (segmented control in the card header) rides the
  // URL as ?tab= — a tab choice survives refresh/share and back/forward.
  // A deep-linked transfers page (?ttPage=2+) without ?tab= selects the
  // transfers tab (see effectiveActivityTab); explicit ?tab= always wins.
  const activityTab = effectiveActivityTab(tabParam, ttPageParam);
  const [transfersRefreshSignal, setTransfersRefreshSignal] = useState(0);
  const [transfersRefreshing, setTransfersRefreshing] = useState(false);
  const selectActivityTab = (tab: ActivityTabId) => {
    void setSearch(prev => ({ ...prev, tab }));
    // A pending transfers refresh can no longer report back once the tab
    // unmounts — drop its spinner instead of spinning forever.
    setTransfersRefreshing(false);
  };

  // Widened search window (blocks) from ?window= — undefined is the
  // backend default. "Search deeper" escalates it by writing the URL (a
  // fresh history entry, like ?page=); it rides in the query args so a
  // wider window is a fresh cache key/fetch.
  const txSearchWindow = txWindowParam;
  const txLimit = 10;
  // Tx-scan gating, symmetric with the transfers tab's lazy fetch: the
  // heuristic history scan is expensive (tens of seconds on deep windows)
  // and only the transactions tab renders it, so a transfers-only deep
  // link (?tab=transfers / ?ttPage=2+) must not pay for it. Args-level
  // gate — chainId <= 0 is the services' own disabled-key shape (resolves
  // undefined without touching the network); switching back to the tab
  // restores the real key and the fetch runs then.
  const txTabActive = activityTab === 'transactions';
  const txQuery = useAddressTransactions(
    txTabActive ? currentChainId : 0,
    address,
    txLimit,
    (txPage - 1) * txLimit,
    txSearchWindow,
  );

  // Settled tx payload + the deepest page the discovered total can fill.
  // Computed before the early guards below so the convergence effect runs
  // unconditionally (rules of hooks).
  const txData = txQuery.data as AddressTxPage | undefined;
  const txTotal = txData?.total ?? 0;
  const txTotalPages = Math.max(1, Math.ceil(txTotal / txLimit));

  // Beyond-data convergence (Transactions/List semantics): once a payload
  // settles and ?page= exceeds the deepest valid page, the URL is pinned
  // (replaced) to that page — an empty page is never shareable or
  // refreshable, and Prev-walking back becomes unnecessary. Mid-flight
  // (or failed) fetches converge nothing: the transient empty-page row
  // further below stays the fallback for those races. Gated on the tx tab
  // like the fetch itself — a transfers-tab visit never rewrites the URL
  // behind a scan it is not running.
  const txPageBeyondData =
    txTabActive &&
    txData !== undefined &&
    !txQuery.loading &&
    txQuery.error === undefined &&
    txPage > txTotalPages;
  useEffect(() => {
    if (!txPageBeyondData) return;
    void setSearch(prev => ({ ...prev, page: String(txTotalPages) }), {
      replace: true,
    });
  }, [txPageBeyondData, txTotalPages, setSearch]);

  const persistent: AddressInfoResponse['address'] | undefined =
    infoQuery.data?.address;
  const code = codeQuery.data;
  // Backend-unreachable verdict for the attribution banner below: the
  // indexed fields (verification, contract name, creator) silently
  // disappear when the persistent channel dies, so the Overview card
  // must say why instead of just omitting rows.
  const persistentOffline = isBackendUnreachable(infoQuery.error);
  // Presentation-layer type verdict (./addressType): the persistent
  // record wins over the RPC code read — EXCEPT when the persistent
  // channel has ERRORED (offline backend): then it contributes no
  // verdict at all (not even stale cached data), and the live RPC code
  // read decides EOA vs Contract on its own. An EIP-7702 delegation
  // designator still outranks both channels (a delegated EOA carries
  // code yet remains an account, so "has code → contract" misfiles it).
  const addressType = classifyAddressType({
    persistentType:
      infoQuery.error === undefined ? persistent?.isContract : undefined,
    rpcCode: code,
  });
  // Independent RPC verdict for the contract-view link below: the link is
  // a navigation affordance, so EITHER channel saying "contract" is enough
  // — a stale persistent row (or a failed persistent channel) must not
  // hide the contract page when the code read itself found contract code.
  // A delegated EOA is the one exception: its designator is bytecode-like
  // but deploys nothing at this address, so no contract page is offered.
  const rpcClassifiesContract = code !== undefined && code !== '0x' && code.length > 2;
  // Explicit `=== true` keeps this a plain-boolean || (not nullish), so the
  // either-channel-suffices semantics survives the nullish-coalescing rule.
  const showsContractLink =
    addressType !== 'delegated-eoa' &&
    (persistent?.isContract === true || rpcClassifiesContract);

  // Old error semantics: the persistent error only surfaces when the code
  // fallback failed too; the realtime error surfaces on its own.
  const persistentError =
    infoQuery.error !== undefined && codeQuery.error !== undefined
      ? infoQuery.error
      : undefined;
  const hasError = persistentError ?? realTimeQuery.error;
  const errorMessage =
    persistentError?.message ?? realTimeQuery.error?.message;

  const getDirection = (tx: TxRecord) => {
    const lowerAddr = address?.toLowerCase();
    const from = tx.fromAddress?.toLowerCase();
    const to = tx.toAddress?.toLowerCase();
    if (from === lowerAddr && to === lowerAddr) return 'self';
    if (to === lowerAddr) return 'in';
    return 'out';
  };

  const directionVariant = { in: 'success', out: 'error', self: 'info' } as const;
  const directionLabel = { in: 'IN', out: 'OUT', self: 'SELF' } as const;

  const formatAddr = (a: string) => (a ? `${a.slice(0, 8)}...${a.slice(-6)}` : 'N/A');
  const formatHash = (h: string) => (h ? `${h.slice(0, 10)}...${h.slice(-8)}` : '');

  // BigInt-safe block number display; falls back to the raw string when a
  // row arrives without a parseable number (pending txs).
  const formatBlockNumber = (n: string) => {
    try {
      return Number(BigInt(n)).toLocaleString();
    } catch {
      return n;
    }
  };

  const formatTxValue = (value: string) => {
    const symbol = getChainSymbol(currentChainId);
    try {
      // BigInt-safe wei → whole-token conversion honoring the chain's
      // native-currency decimals (most are 18; parseFloat/1e18 would both
      // hardcode the wrong divisor and lose precision past 2^53).
      const decimals = chainInfo?.nativeCurrency.decimals ?? 18;
      const v = Number(formatUnits(BigInt(value), decimals));
      if (v === 0) return `0 ${symbol}`;
      if (v < 0.0001) return `<0.0001 ${symbol}`;
      return `${v.toFixed(4)} ${symbol}`;
    } catch {
      return value;
    }
  };

  // Chain switch replaces the current history entry (the old page's
  // semantics) via preload + commitReplace, so Back from the switched
  // view never resurfaces the same address on the previous chain.
  const handleChainChange = (newChainId: number) => {
    void redirectReplace(router, `/chain/${newChainId}/address/${address}`).catch(
      () => undefined,
    );
  };

  const isInitialLoading =
    infoQuery.loading &&
    realTimeQuery.loading &&
    !infoQuery.data &&
    !realTimeQuery.data;

  if (!chainInfo) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <PageContainer>
          <UnsupportedChainState chainId={currentChainId} />
        </PageContainer>
      </>
    );
  }

  if (!address) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <PageContainer>
          <ErrorState message="Invalid address" />
        </PageContainer>
      </>
    );
  }

  // Invalid address (either tier): the guidance card replaces the whole
  // data area — Overview, tabs, ENS row — so the screen carries ONE
  // verdict instead of the old mix of a normal-looking card, tab-level
  // guidance and raw 400s. Not gated on any query state: the address
  // string itself is the ground truth.
  if (!addressValidity.valid) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <PageContainer>
          <BackButton
            onClick={() => {
              void navigate(router, `/chain/${currentChainId}`).catch(() => undefined);
            }}
          />
          <PageHeader
            title="Address Details"
            chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
          />
          <InvalidAddressError address={address} chainId={currentChainId} />
        </PageContainer>
      </>
    );
  }

  const transactions = txData?.transactions ?? [];

  // Coverage banners are driven by the contract fields only (coverage /
  // reason); the backend's `method` tag is diagnostics, never UI state.
  const txCoverage = txData?.coverage;
  const txReason = txData?.reason;
  const txSearchWindowBlocks = txData?.searchWindowBlocks;
  const searchWindowLabel = txSearchWindowBlocks !== undefined
    ? `within the last ${txSearchWindowBlocks.toLocaleString()} blocks`
    : 'within a capped block window';
  const externalToolLinks = getExternalToolLinks(currentChainId, address);

  // "Search deeper" escalation: quadruple the effective window, capped at
  // the RPC budget ceiling. An unknown window (legacy payload without
  // searchWindowBlocks) jumps straight to the cap — the only step that
  // guarantees progress when the current range cannot be read.
  const searchWindowAtCap =
    txSearchWindowBlocks !== undefined &&
    txSearchWindowBlocks >= MAX_SEARCH_WINDOW_BLOCKS;
  const nextSearchWindow = txSearchWindowBlocks !== undefined
    ? Math.min(txSearchWindowBlocks * 4, MAX_SEARCH_WINDOW_BLOCKS)
    : MAX_SEARCH_WINDOW_BLOCKS;

  // Totals honesty: `total` is what heuristic discovery actually found —
  // a floor, not a full-indexer count. Only authoritative 'complete'
  // coverage may read as an exact total; anything else (partial/none, or
  // a legacy cached payload without coverage tags) renders "at least N".
  // Pagination math itself stays on `total` unchanged.
  const txCountPhrase = txCoverage === 'complete'
    ? `${txTotal.toLocaleString()} transactions`
    : `At least ${txTotal.toLocaleString()} transactions discovered`;

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <PageContainer>
        <BackButton
          onClick={() => {
            void navigate(router, `/chain/${currentChainId}`).catch(() => undefined);
          }}
        />

        <PageHeader
          title={ensName ?? 'Address Details'}
          chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
        />

        {ensName && (
          <div className={ensHeaderRow}>
            <Badge variant="info" size="sm">
              ENS
            </Badge>
            <CopyableHash value={address} />
          </div>
        )}

        {isInitialLoading && <LoadingState message="Loading address information..." />}

        {/* Real failures only: an invalid address never reaches this
            branch (the page-level validity guard above owns that
            verdict), so the raw message needs no message-sniffing. */}
        {hasError && !isInitialLoading && (
          <ErrorState message={`Error: ${errorMessage}`} />
        )}

        {!isInitialLoading && (
          <>
            {/* Offline attribution for the indexed fields: the persistent
                channel is down, so verification/contract-name/creator rows
                are absent BY CAUSE — say so, while the RPC-derived rows
                (balance, nonce, EOA/contract type) keep working. */}
            {persistentOffline && (
              <div className={offlineNotice} role="status">
                <Alert variant="warning">
                  Indexed address details are unavailable — the explorer&apos;s
                  indexing backend is not connected. Verification status,
                  contract name and creation info need it; balance, nonce and
                  the type classification below still come from the live
                  chain RPC.
                </Alert>
              </div>
            )}
            <Card>
              <CardHeader>
                <CardTitle>Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <InfoGrid>
                  <InfoItem label="Address">{address}</InfoItem>

                  <InfoItem label="Balance">
                    {realTimeQuery.data
                      ? `${realTimeQuery.data.balance} ${getChainSymbol(currentChainId)}`
                      : realTimeQuery.loading
                        ? 'Loading...'
                        : realTimeQuery.error
                          ? 'Error loading balance'
                          : 'N/A'}
                  </InfoItem>

                  {/* The RPC nonce counts OUTGOING transactions only —
                      never label it a total transaction count. The inline
                      marker points at the partial-discovery semantics the
                      Transactions tab's banners explain. */}
                  <InfoItem label="Outgoing Transactions (Nonce)">
                    {realTimeQuery.data ? (
                      <>
                        {realTimeQuery.data.transactionCount.toLocaleString()}
                        <button
                          type="button"
                          className={nonceHint}
                          title="Transaction history is partially discovered — see the Transactions tab"
                          aria-label="About transaction history coverage"
                          onClick={() => selectActivityTab('transactions')}
                        >
                          ⓘ
                        </button>
                      </>
                    ) : realTimeQuery.loading
                      ? 'Loading...'
                      : realTimeQuery.error
                        ? 'Error loading count'
                        : 'N/A'}
                  </InfoItem>

                  <InfoItem label="Type">
                    {addressType === 'delegated-eoa' ? (
                      <span
                        title={`EIP-7702 delegation — code is executed by ${
                          delegationTarget(code) ?? 'its delegate contract'
                        }`}
                      >
                        Delegated EOA (EIP-7702)
                      </span>
                    ) : addressType === 'contract' ? (
                      'Contract'
                    ) : addressType === 'eoa' ? (
                      'Externally Owned Account (EOA)'
                    ) : infoQuery.loading || codeQuery.loading ? (
                      'Loading...'
                    ) : (
                      'Unknown'
                    )}
                  </InfoItem>

                  {persistent?.isContract && persistent.contractName && (
                    <InfoItem label="Contract Name">{persistent.contractName}</InfoItem>
                  )}

                  {persistent?.isContract && persistent.verificationStatus && (
                    <InfoItem label="Verification Status">
                      {persistent.verificationStatus === 'verified' && 'Verified'}
                      {persistent.verificationStatus === 'partial' && 'Partially Verified'}
                      {persistent.verificationStatus === 'unverified' && 'Unverified'}
                    </InfoItem>
                  )}

                  {showsContractLink && (
                    <InfoItem label="Contract">
                      <TypedLink
                        to={`/chain/${currentChainId}/contract/${address}`}
                        className={linkStyle}
                      >
                        View Contract Details →
                      </TypedLink>
                    </InfoItem>
                  )}

                  {persistent?.contractCreationBlock && (
                    <InfoItem label="Created at Block">
                      {persistent.contractCreationBlock.toLocaleString()}
                    </InfoItem>
                  )}

                  {persistent?.contractCreator && (
                    <InfoItem label="Contract Creator">
                      <TypedLink
                        to={`/chain/${currentChainId}/address/${persistent.contractCreator}`}
                        className={linkStyle}
                      >
                        {formatAddr(persistent.contractCreator)}
                      </TypedLink>
                    </InfoItem>
                  )}

                  {persistent?.isProxy && (
                    <>
                      <InfoItem label="Proxy Type">
                        {persistent.proxyType ?? 'Standard Proxy'}
                      </InfoItem>
                      {persistent.implementationAddress && (
                        <InfoItem label="Implementation">
                          {formatAddr(persistent.implementationAddress)}
                        </InfoItem>
                      )}
                    </>
                  )}

                  {realTimeQuery.data && (
                    <InfoItem label="Latest Block">
                      {realTimeQuery.data.latestBlock.toLocaleString()}
                    </InfoItem>
                  )}

                  {realTimeQuery.data && (
                    <InfoItem label="Last Updated">
                      Updated {formatRelativeTime(realTimeQuery.data.lastUpdatedAt)}
                    </InfoItem>
                  )}

                  <InfoItem label="External Tools">
                    <ExternalLinks links={externalToolLinks} />
                  </InfoItem>
                </InfoGrid>
              </CardContent>
            </Card>

            <Card className={transactionsCard}>
              <CardHeader>
                <div className={headerRow}>
                  <div className={segmentedTabs} role="group" aria-label="Recent activity">
                    {activityTabs.map(tab => (
                      <button
                        key={tab.id}
                        type="button"
                        className={tabButton}
                        aria-pressed={activityTab === tab.id}
                        onClick={() => selectActivityTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  {/* Refresh honesty: the button refetches what the ACTIVE
                      tab shows — the tx history + the realtime balance read
                      that owns 'Last updated', or the token-transfer scan
                      (through the refresh signal the transfers component
                      consumes). */}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (activityTab === 'transactions') {
                        void txQuery.refetch();
                        void realTimeQuery.refetch();
                      } else {
                        setTransfersRefreshing(true);
                        setTransfersRefreshSignal(signal => signal + 1);
                      }
                    }}
                    loading={
                      activityTab === 'transactions'
                        ? txQuery.fetching || realTimeQuery.fetching
                        : transfersRefreshing
                    }
                  >
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {activityTab === 'transfers' ? (
                  <TokenTransfers
                    chainId={currentChainId}
                    address={address}
                    /* The events-indexing CTA is a contract-only
                       affordance: a delegated EOA (or an unsettled
                       classification) renders no contract CTA. */
                    isContract={addressType === 'contract'}
                    refreshSignal={transfersRefreshSignal}
                    onRefreshed={() => setTransfersRefreshing(false)}
                  />
                ) : (
                  <>
                    {/* Indexing-scope notice (tx tab only): internal txs stay
                    outside the heuristic's reach at every coverage level;
                    token transfers moved to their own tab with its own
                    coverage banners. */}
                    <p className={tokenNotice}>
                      Internal transactions are not indexed — native ETH activity
                      only. Token transfers (ERC-20/721/1155) live in the Token
                      Transfers tab.
                    </p>

                    {txQuery.loading && (
                      <LoadingState message="Scanning recent chain history..." />
                    )}

                    {txQuery.error && <ErrorState message={txQuery.error.message} />}

                    {!txQuery.loading && !txQuery.error && txCoverage === 'none' && txReason === 'search-failed' && (
                      <>
                        <Alert variant="danger">
                          Transaction search failed (timeout). History is temporarily
                          unavailable - this is NOT an empty result.
                        </Alert>
                        <div className={bannerLinks}>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={txQuery.fetching}
                            onClick={() => {
                              void txQuery.refetch();
                            }}
                          >
                            Retry search
                          </Button>
                        </div>
                      </>
                    )}

                    {!txQuery.loading && !txQuery.error && txCoverage === 'none' && txReason === 'zero-balance' && (
                      <>
                        <Alert variant="warning">
                          {realTimeQuery.data
                            ? `This address has sent ${realTimeQuery.data.transactionCount.toLocaleString()} transactions (nonce).`
                            : 'This address has sent an unknown number of transactions (nonce unavailable).'}
                          {' '}Incoming activity cannot be scanned because the
                          balance-history heuristic needs non-zero balance; token
                          activity is never scanned.
                        </Alert>
                        <div className={bannerLinks}>
                          <ExternalLinks links={externalToolLinks} />
                        </div>
                      </>
                    )}

                    {/* nonce=0: outgoing history is provably empty, but incoming
                    activity stays invisible to the heuristic — never read
                    this as a trusted "no transactions at all". */}
                    {!txQuery.loading && !txQuery.error
                      && txCoverage === 'partial'
                      && txReason === 'no-outgoing-transactions' && (
                      <>
                        <Alert variant="warning">
                          No OUTGOING transactions found. Incoming transactions
                          are undetectable without a full indexer — check an
                          external explorer.
                        </Alert>
                        <div className={bannerLinks}>
                          <ExternalLinks links={externalToolLinks} />
                        </div>
                      </>
                    )}

                    {/* Generic partial banner: only for a SEARCH that ran and
                    covered a window. The no-outgoing-transactions case has
                    its own banner above — the search never ran there, so
                    "search deeper" would be a no-op (backend early-returns
                    on nonce=0 regardless of window). */}
                    {!txQuery.loading && !txQuery.error && txCoverage === 'partial'
                      && txReason !== 'no-outgoing-transactions' && (
                      <>
                        <Alert variant="warning">
                          Partial history - transactions are discovered heuristically
                          (native-token transfers {searchWindowLabel}). Token
                          transfers and contract interactions may be missing.
                        </Alert>
                        <div className={bannerLinks}>
                          <ExternalLinks links={externalToolLinks} />
                          {/* Escalation: quadruple the searched window. Disabled
                          with a title once the RPC budget cap is reached —
                          the button stays visible (still partial) so the
                          limitation stays explained. */}
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={searchWindowAtCap}
                            title={
                              searchWindowAtCap
                                ? 'maximum RPC budget reached'
                                : undefined
                            }
                            loading={txQuery.fetching}
                            onClick={() => {
                              // The widened window rides in the URL (pushed
                              // history entry like ?page=): it survives
                              // pagination, sharing and back/forward.
                              void setSearch(prev => ({
                                ...prev,
                                window: String(nextSearchWindow),
                              }));
                            }}
                          >
                            Search deeper
                          </Button>
                        </div>
                      </>
                    )}

                    {/* Trusted empty ONLY for authoritative coverage ('complete'):
                    the backend asserts the full history is known. Anything
                    else that looks empty must not read as "no history". */}
                    {!txQuery.loading && !txQuery.error
                      && transactions.length === 0 && txTotal === 0
                      && txCoverage === 'complete' && (
                      <Alert variant="info">No transactions found</Alert>
                    )}

                    {/* Pre-coverage cached payload (no coverage/method tags):
                    the empty list is unverified, so say so instead of
                    implying a trusted empty result. */}
                    {!txQuery.loading && !txQuery.error
                      && transactions.length === 0 && txTotal === 0
                      && txCoverage === undefined && (
                      <>
                        <Alert variant="warning">
                          Transaction data source unknown — history may be
                          incomplete. Verify on an external explorer.
                        </Alert>
                        <div className={bannerLinks}>
                          <ExternalLinks links={externalToolLinks} />
                        </div>
                      </>
                    )}

                    {(transactions.length > 0 || txTotal > 0) && (
                      <>
                        <DataTable>
                          <thead>
                            <tr>
                              <th>Txn Hash</th>
                              <th>Block</th>
                              <th>Age</th>
                              <th>Direction</th>
                              <th>From</th>
                              <th>To</th>
                              <th>Value</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {transactions.map(tx => {
                              const dir = getDirection(tx);
                              return (
                                <tr key={tx.hash}>
                                  <td>
                                    <CopyableHash
                                      value={tx.hash}
                                      truncated={formatHash(tx.hash)}
                                      href={`/chain/${currentChainId}/tx/${tx.hash}`}
                                    />
                                  </td>
                                  <td>
                                    <TypedLink
                                      to={`/chain/${currentChainId}/block/${tx.blockNumber}`}
                                      className={linkStyle}
                                    >
                                      {formatBlockNumber(tx.blockNumber)}
                                    </TypedLink>
                                  </td>
                                  <td>{tx.timestamp ? formatRelativeTime(tx.timestamp) : 'N/A'}</td>
                                  <td>
                                    <Badge variant={directionVariant[dir]} size="sm">
                                      {directionLabel[dir]}
                                    </Badge>
                                  </td>
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
                                  <td className={valueCell}>{formatTxValue(tx.value)}</td>
                                  <td>
                                    <TxStatusBadge
                                      status={tx.status}
                                      hasBlock={tx.blockNumber !== undefined}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                            {/* Page slid past the data (total > 0 but this page
                            is empty — e.g. a widened search shrank the
                            discovered set): never read as "no history". */}
                            {transactions.length === 0 && (
                              <tr>
                                <td className={emptyPageCell} colSpan={8}>
                                  No transactions on this page
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </DataTable>
                        <Pagination
                          page={txPage}
                          pageInfo={`Page ${txPage} of ${txTotalPages} • ${txCountPhrase}`}
                          hasPrev={txPage > 1}
                          hasNext={txPage < txTotalPages}
                          onPrev={() => setTxPage(txPage - 1)}
                          onNext={() => setTxPage(txPage + 1)}
                        />
                      </>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </PageContainer>
    </>
  );
}
