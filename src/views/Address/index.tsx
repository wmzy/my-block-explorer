import { useState } from 'react';
import { css } from '@linaria/core';
import { TypedLink, useMatched } from '@native-router/react';
import { navigate } from '@native-router/core';
import { formatUnits } from 'viem';
import { Alert } from 'haze-ui';
import { getChainInfo, getChainName, getChainSymbol } from '@/config/chains';
import TopNavigation from '@/components/TopNavigation';
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

  const [txPage, setTxPage] = useState(1);
  // Widened search window (blocks) requested via ?window= — undefined is
  // the backend default. "Search deeper" escalates it; it rides in the
  // query args so a wider window is a fresh cache key/fetch.
  const [txSearchWindow, setTxSearchWindow] = useState<number | undefined>();
  const txLimit = 10;
  const txQuery = useAddressTransactions(
    currentChainId,
    address,
    txLimit,
    (txPage - 1) * txLimit,
    txSearchWindow,
  );

  const persistent: AddressInfoResponse['address'] | undefined =
    infoQuery.data?.address;
  const code = codeQuery.data;
  // Persistent record wins; the RPC code read only decides when the
  // persistent channel settled without data.
  const isContract = persistent
    ? persistent.isContract
    : code !== undefined
      ? Boolean(code && code !== '0x' && code.length > 2)
      : undefined;

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
          <ErrorState message={`Unsupported chain ID: ${params.chainId}`} />
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

  const txData = txQuery.data as AddressTxPage | undefined;
  const transactions = txData?.transactions ?? [];
  const txTotal = txData?.total ?? 0;
  const txTotalPages = Math.max(1, Math.ceil(txTotal / txLimit));

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
                      never label it a total transaction count. */}
                  <InfoItem label="Outgoing Transactions (Nonce)">
                    {realTimeQuery.data
                      ? realTimeQuery.data.transactionCount.toLocaleString()
                      : realTimeQuery.loading
                        ? 'Loading...'
                        : realTimeQuery.error
                          ? 'Error loading count'
                          : 'N/A'}
                  </InfoItem>

                  <InfoItem label="Type">
                    {isContract !== undefined
                      ? isContract
                        ? 'Contract'
                        : 'Externally Owned Account (EOA)'
                      : infoQuery.loading || codeQuery.loading
                        ? 'Loading...'
                        : 'Unknown'}
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

                  {persistent?.isContract && (
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
                  <CardTitle as="h2">Recent Transactions</CardTitle>
                  {/* Refresh honesty: the button refetches both channels the
                      page stamps — the tx history AND the realtime
                      balance/nonce read that owns 'Last updated'. */}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void txQuery.refetch();
                      void realTimeQuery.refetch();
                    }}
                    loading={txQuery.fetching || realTimeQuery.fetching}
                  >
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Indexing-scope notice: true at EVERY coverage level —
                    even 'complete' only covers native ETH activity. */}
                <p className={tokenNotice}>
                  Token transfers (ERC-20/721) and internal transactions
                  are not indexed — native ETH activity only.
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
                        onClick={() => setTxSearchWindow(nextSearchWindow)}
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
                      pageInfo={`Page ${txPage} of ${txTotalPages}`}
                      hasPrev={txPage > 1}
                      hasNext={txPage < txTotalPages}
                      onPrev={() => setTxPage(p => Math.max(1, p - 1))}
                      onNext={() => setTxPage(p => p + 1)}
                    />
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
