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
import { addressSearchSchema } from '@/views/Address/search';
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

// A mixed-case address with a bad EIP-55 checksum is rejected server-side
// by getValidatedAddress (HTTP 400 'Invalid address'); surface actionable
// guidance instead of the raw message, keeping the original as a
// secondary line.
const invalidChecksumHelp =
  'This address has an invalid checksum. Try the all-lowercase form or copy the address from a trusted source.';

const isInvalidAddressMessage = (message: string | undefined): boolean =>
  message?.includes('Invalid address') ?? false;

// Hard ceiling of the address-tx search window (blocks) — matches the
// backend clamp. "Search deeper" disables at this budget.
const MAX_SEARCH_WINDOW_BLOCKS = 50_000_000;

// The page's URL-driven state (?page= / ?window= / ?ttPage=) lives in the
// shared schema module (./search) so the transfers tab writes through the
// SAME schema — a narrower one would strip the other keys on every write.

// Recent-activity card tabs. The transfers tab renders its own component
// (and owns its query there), so the unmounted tab fetches nothing.
type ActivityTab = 'transactions' | 'transfers';
const activityTabs: ReadonlyArray<{ id: ActivityTab; label: string }> = [
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

function InvalidChecksumError({ original }: { original: string }) {
  return (
    <>
      <ErrorState message={invalidChecksumHelp} />
      <p className={errorSecondary}>Original error: {original}</p>
    </>
  );
}

export default function Address() {
  const { params, router } = useMatched();

  const currentChainId = Number.parseInt(params.chainId ?? '1', 10);
  const chainInfo = getChainInfo(currentChainId);
  const address = params.address ?? '';

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
  const { page: txPageParam, window: txWindowParam } = useSearch(addressSearchSchema);
  const txPage = Math.max(1, Math.floor(txPageParam));
  const setTxPage = (next: number) => {
    void setSearch(prev => ({
      ...prev,
      page: String(Math.max(1, Math.floor(next))),
    }));
  };

  // Recent-activity tab (segmented control in the card header). The
  // transfers query lives inside the TokenTransfers component; Refresh on
  // that tab reaches it through a signal bump and settles via callback.
  const [activityTab, setActivityTab] = useState<ActivityTab>('transactions');
  const [transfersRefreshSignal, setTransfersRefreshSignal] = useState(0);
  const [transfersRefreshing, setTransfersRefreshing] = useState(false);
  const selectActivityTab = (tab: ActivityTab) => {
    setActivityTab(tab);
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
  const txQuery = useAddressTransactions(
    currentChainId,
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
  // further below stays the fallback for those races.
  const txPageBeyondData =
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
  // Presentation-layer type verdict (./addressType): the persistent record
  // wins over the RPC code read — except an EIP-7702 delegation
  // designator, which outranks both channels (a delegated EOA carries
  // code yet remains an account, so "has code → contract" misfiles it).
  const addressType = classifyAddressType({
    persistentType: persistent?.isContract,
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

        {hasError && !isInitialLoading &&
          (isInvalidAddressMessage(errorMessage) ? (
            <InvalidChecksumError original={errorMessage ?? ''} />
          ) : (
            <ErrorState message={`Error: ${errorMessage}`} />
          ))}

        {!isInitialLoading && (
          <>
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

                    {txQuery.error &&
                      (isInvalidAddressMessage(txQuery.error.message) ? (
                        <InvalidChecksumError original={txQuery.error.message} />
                      ) : (
                        <ErrorState message={txQuery.error.message} />
                      ))}

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
