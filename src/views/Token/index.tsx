// Token lens page (/chain/:chainId/token/:address): a token-contract-first
// view of one token. Everything reuses the address page's established
// machinery — the Multicall3 token probes (services/tokenMetadata), the
// token-mode eth_getLogs scan (services/tokenTransfers, rendered by the
// REAL TokenTransfers component so the scan logic is never forked), and
// the BigInt-exact discovered-holders netting (views/Address/
// tokenOverview, wrapped by ./tokenMath for ranking/shares/mint-burn).
// Discovered aggregates (holders, mint/burn) always carry the
// scanned-window caveat — nothing on this page is indexer truth.
//
// An EOA / non-token contract landing here is a fact, not a failure
// (RouterError's not_a_contract precedent, as an in-page card): the view
// self-guards, so the route needs NO loader — see NotATokenContractState.
import { useMemo, type ReactNode } from 'react';
import { css, cx } from '@linaria/core';
import { TypedLink, useMatched, useSearch } from '@native-router/react';
import { navigate } from '@native-router/core';
import { formatUnits, getAddress } from 'viem';

import TopNavigation from '@/components/TopNavigation';
import { redirectReplace } from '@/views/Home/Landing';
import { UnsupportedChainState } from '@/views/Home/UnsupportedChainState';
import { PageContainer, PageHeader, BackButton } from '@/components/ui/PageLayout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { InfoGrid, InfoItem } from '@/components/ui/InfoGrid';
import { linkStyle } from '@/components/ui/DataTable';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Badge } from '@/components/ui/Badge';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { useContractCode } from '@/services/addressRealTime';
import { useTokenOverviewProbe } from '@/services/tokenMetadata';
import { useTokenTransfers } from '@/services/tokenTransfers';
import { checkAddressValidity } from '@/views/Address/addressValidity';
import { InvalidAddressError } from '@/views/Address';
import { isEip7702Designator } from '@/views/Address/addressType';
import { addressSearchSchema } from '@/views/Address/search';
import {
  classifyTokenOverview,
  formatTokenSupply,
} from '@/views/Address/tokenOverview';
import TokenTransfers, { TRANSFER_LIMIT } from '@/views/Address/TokenTransfers';
import { getChainInfo, getChainName } from '@/config/chains';
import { aggregateMintBurn, formatSharePct, rankHolderShares } from './tokenMath';

// Top-10 ranking, per the discovered-holders surface contract (the address
// page's card shows the top 5; the dedicated page widens it).
const TOP_HOLDER_COUNT = 10;

const cardMargin = css`
  margin-top: var(--haze-space-5);
`;

// Card header row (title + classification badge): wraps on narrow screens
// — the honest long badge ("standard unknown — possibly ERC-721") never
// fits a ~340px row next to the title (same breakpoint/convention as the
// address page's Token Overview header).
const headerRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--haze-space-2);

  @media (max-width: 768px) {
    flex-wrap: wrap;
  }
`;

// Long token names never push the page into horizontal scroll.
const titleStyle = css`
  & h1 {
    overflow-wrap: anywhere;
  }
`;

// Checksummed address + cross-view links under the page header: wrap
// (never clip) on narrow screens.
const addressRow = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  flex-wrap: wrap;
  word-break: break-all;
  margin: calc(-1 * var(--haze-space-4)) 0 var(--haze-space-2);
`;

const headerLinks = css`
  display: flex;
  gap: var(--haze-space-4);
  flex-wrap: wrap;
  margin-bottom: var(--haze-space-5);
`;

// Completeness caveat under every discovered aggregate: scanned windows
// are partial, never a claim of full coverage.
const caveat = css`
  margin: var(--haze-space-2) 0 0;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

const mutedValue = css`
  color: var(--haze-color-text-muted);
`;

// One ranked holder row: rank number, address link, share bar, share
// percentage, discovered net. Wraps on narrow screens instead of
// crushing the bar out of existence.
const holderRankRow = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  min-width: 0;

  @media (max-width: 768px) {
    flex-wrap: wrap;
  }
`;

const rankNumber = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  min-width: 1.5em;
  text-align: right;
`;

// Share-of-discovered-supply bar, hand-rolled (no chart dependency — the
// Gas panel's sparkline visual language: primary fill on a subtle track).
const shareTrack = css`
  flex: 1 1 120px;
  min-width: 60px;
  height: 6px;
  border-radius: 3px;
  background: var(--haze-color-primary-subtle);
  overflow: hidden;
`;

const shareFill = css`
  height: 100%;
  border-radius: 3px;
  background: var(--haze-color-primary);
`;

const shareLabel = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  min-width: 52px;
  text-align: right;
`;

const holderAmount = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  margin-left: auto;
  text-align: right;
  white-space: nowrap;
`;

const nextStepLinks = css`
  display: inline-flex;
  flex-direction: column;
  gap: var(--haze-space-1);
  align-items: flex-end;

  @media (max-width: 768px) {
    align-items: flex-start;
  }
`;

const formatAddr = (a: string) => (a ? `${a.slice(0, 8)}...${a.slice(-6)}` : 'N/A');

/**
 * Dedicated not-a-token state (RouterError's not_a_contract precedent, as
 * an in-page card): an EOA, an EIP-7702 delegated account or a plain
 * contract deep-linked onto the token route is a fact about the address,
 * not a failure of the explorer — the card says which of the three it is
 * and hands the user the views that DO apply. Exported so a future
 * loader-level guard (or RouterError) could reuse the same verdict card.
 */
export function NotATokenContractState({
  chainId,
  address,
  reason,
}: {
  chainId: number;
  address: string;
  reason: 'no-code' | 'delegated-eoa' | 'no-token-interface';
}) {
  const explanation =
    reason === 'no-code'
      ? 'This address holds no on-chain code — it is an externally owned account (EOA), or no contract is deployed at it on this chain.'
      : reason === 'delegated-eoa'
        ? 'This address is an EIP-7702 delegated account — it borrows code from another contract but is not a token contract itself.'
        : 'A contract is deployed here, but none of the standard token probes (name, symbol, decimals, totalSupply) responded — it is not an ERC-20-style token.';
  // The contract view only exists for deployed code: a plain EOA has
  // nothing there, and a delegated EOA borrows code without deploying a
  // contract at this address (the address page's convention — no contract
  // link for delegated accounts either).
  const showsContractLink = reason === 'no-token-interface';
  return (
    <Card>
      <CardHeader>
        <CardTitle>This address is not a token contract</CardTitle>
      </CardHeader>
      <CardContent>
        <InfoGrid>
          <InfoItem label="Address">{address}</InfoItem>
          <InfoItem label="Next step">
            <span className={nextStepLinks}>
              <TypedLink
                to={`/chain/${chainId}/address/${address}`}
                className={linkStyle}
              >
                View as address →
              </TypedLink>
              {showsContractLink && (
                <TypedLink
                  to={`/chain/${chainId}/contract/${address}`}
                  className={linkStyle}
                >
                  View contract page →
                </TypedLink>
              )}
            </span>
          </InfoItem>
        </InfoGrid>
        <p className={caveat}>{explanation}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Small affordance for the ADDRESS page's Token Overview card: a link to
 * this page. Exported so Main can wire it next to the classification
 * badge without this module owning any Address-page file.
 */
export function TokenOverviewCardLink({
  chainId,
  address,
  className,
}: {
  chainId: number;
  address: string;
  className?: string;
}) {
  return (
    <TypedLink
      to={`/chain/${chainId}/token/${address}`}
      className={cx(linkStyle, className)}
    >
      View token page →
    </TypedLink>
  );
}

// Shared page chrome for the guard states below (nav, back, header).
function TokenPageShell({
  chainId,
  onBack,
  onChainChange,
  children,
}: {
  chainId: number;
  onBack: () => void;
  onChainChange: (chainId: number) => void;
  children: ReactNode;
}) {
  return (
    <>
      <TopNavigation currentChainId={chainId} onChainChange={onChainChange} />
      <PageContainer>
        <BackButton onClick={onBack} />
        <PageHeader
          title="Token"
          chainInfo={`${getChainName(chainId)} • Chain ID: ${chainId}`}
        />
        {children}
      </PageContainer>
    </>
  );
}

export default function TokenPage() {
  const { params, router } = useMatched();

  const currentChainId = Number.parseInt(params.chainId ?? '1', 10);
  const chainInfo = getChainInfo(currentChainId);
  const address = params.address ?? '';
  // Two-tier URL-param guard (the address page's twin, ./addressValidity):
  // a shape error or a checksum error renders the guidance card — an
  // invalid-checksum address is NEVER rendered as a valid token page.
  const validity = checkAddressValidity(address);

  // All hooks run before the guard returns below (rules of hooks); invalid
  // or unsupported targets park the queries on the services' disabled-key
  // shape (chainId 0 / enabled false → zero network).
  const codeQuery = useContractCode(
    validity.valid && chainInfo !== null ? currentChainId : 0,
    address,
  );
  const code = codeQuery.data;
  const hasCode = code !== undefined && code !== '0x' && code.length > 2;
  const delegatedEoa = isEip7702Designator(code);

  // Token detection: the settle-aware probe distinguishes "still reading"
  // from "answered with nothing" (a plain contract) and from a
  // transport-level failure (which per the service's honesty contract is
  // NOT a not-a-token verdict). Same multicall/cache path as the address
  // page's card — the two consumers share one batch.
  const probe = useTokenOverviewProbe(
    currentChainId,
    address,
    validity.valid && chainInfo !== null && hasCode && !delegatedEoa,
  );
  const classification = classifyTokenOverview(probe.reads);
  const isToken = classification !== null;
  const isErc20 = classification?.isErc20 === true;

  // Scan window (?ttWindow=) through the ADDRESS page's shared schema:
  // the piggyback query below keys identically to the transfers section's
  // page-1 token-mode query, so one scan feeds both (the address page's
  // own holders convention).
  const { ttWindow: ttWindowParam } = useSearch(addressSearchSchema);

  // Holders + mint/burn feed: page-1 token-mode scan rows through the
  // shared query cache (zero extra scans — the transfers section's own
  // first-page query is the same key).
  const holdersQuery = useTokenTransfers(
    isToken ? currentChainId : 0,
    address,
    '0',
    TRANSFER_LIMIT,
    ttWindowParam,
    'token',
  );
  // Mode guard (address-page convention): the store keeps the previous
  // settle across args switches, and a participant settle must never feed
  // the aggregation; pre-mode legacy payloads are trusted as-is.
  const holdersData =
    holdersQuery.data !== undefined &&
    (holdersQuery.data.mode === undefined || holdersQuery.data.mode === 'token')
      ? holdersQuery.data
      : undefined;
  // Memoized rows feed the two aggregations below (the raw expression is
  // a fresh array each render, which would churn their deps).
  const scanRows = useMemo(
    () => holdersData?.transfers ?? [],
    [holdersData],
  );

  const holders = useMemo(
    () =>
      isToken ? rankHolderShares(scanRows, address, isErc20, TOP_HOLDER_COUNT) : null,
    [isToken, scanRows, address, isErc20],
  );
  const mintBurn = useMemo(
    () => (isToken ? aggregateMintBurn(scanRows, address, isErc20) : null),
    [isToken, scanRows, address, isErc20],
  );

  const handleChainChange = (newChainId: number) => {
    void redirectReplace(router, `/chain/${newChainId}/token/${address}`).catch(
      () => undefined,
    );
  };
  const backToExplorer = () => {
    void navigate(router, `/chain/${currentChainId}`).catch(() => undefined);
  };

  // --- Guards (after every hook) ---

  if (chainInfo === null) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <PageContainer>
          <UnsupportedChainState chainId={currentChainId} />
        </PageContainer>
      </>
    );
  }

  if (!validity.valid) {
    return (
      <TokenPageShell
        chainId={currentChainId}
        onBack={backToExplorer}
        onChainChange={handleChainChange}
      >
        <InvalidAddressError address={address} chainId={currentChainId} />
      </TokenPageShell>
    );
  }

  if (code === undefined) {
    return (
      <TokenPageShell
        chainId={currentChainId}
        onBack={backToExplorer}
        onChainChange={handleChainChange}
      >
        {codeQuery.error !== undefined ? (
          <ErrorState
            message={`Could not read on-chain code for this address: ${codeQuery.error.message}`}
          />
        ) : (
          <LoadingState message="Checking token contract..." />
        )}
      </TokenPageShell>
    );
  }

  if (!hasCode || delegatedEoa) {
    return (
      <TokenPageShell
        chainId={currentChainId}
        onBack={backToExplorer}
        onChainChange={handleChainChange}
      >
        <NotATokenContractState
          chainId={currentChainId}
          address={address}
          reason={!hasCode ? 'no-code' : 'delegated-eoa'}
        />
      </TokenPageShell>
    );
  }

  if (!probe.settled) {
    return (
      <TokenPageShell
        chainId={currentChainId}
        onBack={backToExplorer}
        onChainChange={handleChainChange}
      >
        <LoadingState message="Reading token interface..." />
      </TokenPageShell>
    );
  }

  if (probe.reads === undefined) {
    // Settled WITHOUT reads = transport-level failure (the service keeps
    // reads honestly absent instead of guessing "not a token") — surface
    // the failure, never the not-a-token verdict.
    return (
      <TokenPageShell
        chainId={currentChainId}
        onBack={backToExplorer}
        onChainChange={handleChainChange}
      >
        <ErrorState message="Could not read the token interface from the RPC — this is not a verdict on the address. Try again, or use the address and contract views." />
        <div className={headerLinks}>
          <TypedLink
            to={`/chain/${currentChainId}/address/${address}`}
            className={linkStyle}
          >
            View as address →
          </TypedLink>
          <TypedLink
            to={`/chain/${currentChainId}/contract/${address}`}
            className={linkStyle}
          >
            View contract page →
          </TypedLink>
        </div>
      </TokenPageShell>
    );
  }

  if (classification === null) {
    // The contract answered and NO probe responded: settled not-a-token.
    return (
      <TokenPageShell
        chainId={currentChainId}
        onBack={backToExplorer}
        onChainChange={handleChainChange}
      >
        <NotATokenContractState
          chainId={currentChainId}
          address={address}
          reason="no-token-interface"
        />
      </TokenPageShell>
    );
  }

  // --- Token page proper ---

  const { name, symbol, decimals, totalSupply } = classification;
  const title =
    name !== null && symbol !== null
      ? `${name} (${symbol})`
      : name ?? symbol ?? 'Token';
  // The param passed the two-tier guard, so checksumming is safe for
  // display; the raw param stays canonical in the URL.
  const displayAddress = getAddress(address);
  const symbolSuffix = symbol !== null ? ` ${symbol}` : '';
  // Amount formatter with the TOKEN's own decimals — never a guessed
  // divisor (raw base units when decimals is unknown, like the supply).
  const formatNet = (net: bigint): string =>
    decimals !== null ? formatUnits(net, decimals) : net.toString();

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <PageContainer>
        <BackButton onClick={backToExplorer} />

        <PageHeader
          title={title}
          chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
          className={titleStyle}
        />

        <div className={addressRow}>
          <CopyableHash value={displayAddress} truncated={formatAddr(displayAddress)} />
        </div>

        <div className={headerLinks}>
          <TypedLink
            to={`/chain/${currentChainId}/contract/${address}`}
            className={linkStyle}
          >
            View contract page →
          </TypedLink>
          <TypedLink
            to={`/chain/${currentChainId}/address/${address}`}
            className={linkStyle}
          >
            View as address →
          </TypedLink>
        </div>

        {/* Overview: the address page's Token Overview card semantics —
            "ERC-20" only when decimals AND totalSupply responded; lines
            appear exactly when their probe responded; supply formats with
            the TOKEN's decimals, raw base units when decimals is
            unknown. */}
        <Card>
          <CardHeader>
            <div className={headerRow}>
              <CardTitle>Token Overview</CardTitle>
              <Badge variant={isErc20 ? 'success' : 'warning'} size="sm">
                {isErc20 ? 'ERC-20' : 'Token (standard unknown — possibly ERC-721)'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <InfoGrid>
              {name !== null && <InfoItem label="Name">{name}</InfoItem>}
              {symbol !== null && <InfoItem label="Symbol">{symbol}</InfoItem>}
              {decimals !== null && <InfoItem label="Decimals">{decimals}</InfoItem>}
              {totalSupply !== null && (
                <InfoItem label="Total Supply">
                  {formatTokenSupply(totalSupply, decimals)}
                  {decimals === null && (
                    <span className={mutedValue}>
                      {' '}
                      (raw base units — decimals unknown)
                    </span>
                  )}
                </InfoItem>
              )}
            </InfoGrid>
          </CardContent>
        </Card>

        {/* Holders: ERC-20 semantics only (an unknown-standard token
            renders no holder rows instead of guessing meaning for ids);
            shares divide by the DISCOVERED supply, never totalSupply. */}
        {isErc20 && holders !== null && (
          <Card className={cardMargin}>
            <CardHeader>
              <CardTitle>Top Holders (discovered)</CardTitle>
            </CardHeader>
            <CardContent>
              {holdersQuery.loading && holdersData === undefined ? (
                'Scanning token transfers...'
              ) : holdersQuery.error !== undefined ? (
                <span title={holdersQuery.error.message}>
                  Scan failed — see the Token Transfers section below.
                </span>
              ) : holders.shares.length === 0 ? (
                'No holders discovered in the scanned transfers.'
              ) : (
                <>
                  {holders.shares.map((holder, index) => (
                    <div key={holder.address} className={holderRankRow}>
                      <span className={rankNumber}>{index + 1}</span>
                      <CopyableHash
                        value={holder.address}
                        truncated={formatAddr(holder.address)}
                        href={`/chain/${currentChainId}/address/${holder.address}`}
                      />
                      <div className={shareTrack}>
                        {holder.shareBps !== null && (
                          <div
                            className={shareFill}
                            style={{ width: `${holder.shareBps / 100}%` }}
                          />
                        )}
                      </div>
                      <span className={shareLabel}>
                        {holder.shareBps !== null ? formatSharePct(holder.shareBps) : '—'}
                      </span>
                      <span className={holderAmount}>
                        {formatNet(holder.net)}
                        {symbolSuffix}
                      </span>
                    </div>
                  ))}
                  <p className={caveat}>
                    Discovered from scanned window — may be incomplete
                    {holders.excludedTransfers > 0
                      ? ` (non-ERC-20 rows excluded: ${holders.excludedTransfers.toLocaleString()})`
                      : ''}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Mint / burn: events counted for every standard, amounts summed
            only under proven ERC-20 semantics. */}
        {mintBurn !== null && (
          <Card className={cardMargin}>
            <CardHeader>
              <CardTitle>Mint / Burn (discovered)</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid>
                <InfoItem label="Mint events">
                  {mintBurn.mintCount.toLocaleString()}
                </InfoItem>
                <InfoItem label="Minted">
                  {mintBurn.minted !== null ? (
                    `${formatNet(mintBurn.minted)}${symbolSuffix}`
                  ) : (
                    <span
                      className={mutedValue}
                      title="Amounts are ERC-20 semantics — not summed for a token of unproven standard"
                    >
                      —
                    </span>
                  )}
                </InfoItem>
                <InfoItem label="Burn events">
                  {mintBurn.burnCount.toLocaleString()}
                </InfoItem>
                <InfoItem label="Burned">
                  {mintBurn.burned !== null ? (
                    `${formatNet(mintBurn.burned)}${symbolSuffix}`
                  ) : (
                    <span
                      className={mutedValue}
                      title="Amounts are ERC-20 semantics — not summed for a token of unproven standard"
                    >
                      —
                    </span>
                  )}
                </InfoItem>
              </InfoGrid>
              <p className={caveat}>
                Discovered from scanned window — may be incomplete
                {mintBurn.minted === null
                  ? ' (token standard unproven — events counted, amounts not summed)'
                  : ''}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Transfers: the REAL address-page component (never a fork). It
            detects this token through the same module-cached probes (zero
            extra multicall), scans in token mode by default, and brings
            the tab's whole honesty surface: coverage banners, cache-
            bypassing Retry, "Search deeper" (?ttWindow=), ?ttPage=
            pagination and the events-indexing CTA. isContract is true by
            construction here — the probes answering means code executed. */}
        <Card className={cardMargin}>
          <CardHeader>
            <CardTitle>Token Transfers</CardTitle>
          </CardHeader>
          <CardContent>
            <TokenTransfers chainId={currentChainId} address={address} isContract />
          </CardContent>
        </Card>
      </PageContainer>
    </>
  );
}
