import { useCallback, useEffect, useMemo, useState } from 'react';
import { css, cx } from '@linaria/core';
import type { ReactNode } from 'react';
import { TypedLink, useMatched, useSearch, useSetSearch } from '@native-router/react';
import { navigate } from '@native-router/core';
import { erc20Abi, formatUnits } from 'viem';
import type { ContractFunctionParameters } from 'viem';
import { Alert } from 'haze-ui';
import { getChainInfo, getChainName, getChainSymbol } from '@/config/chains';
import TopNavigation from '@/components/TopNavigation';
import TokenTransfers, {
  TRANSFER_LIMIT,
  useTokenMetas,
  type TokenMeta,
} from '@/views/Address/TokenTransfers';
import {
  aggregateTokenHoldings,
  estimateHoldingsUsd,
  type SharedTokenClass,
  type TokenHolding,
} from '@/views/Address/holdings';
import {
  classifyTokenOverview,
  computeDiscoveredHolders,
  formatTokenSupply,
} from '@/views/Address/tokenOverview';
import {
  classifyAddressType,
  delegationTarget,
} from '@/views/Address/addressType';
import { checkAddressValidity } from '@/views/Address/addressValidity';
import {
  addressSearchSchema,
  effectiveActivityTab,
  effectiveTxFilters,
  hasActiveTxFilters,
  type ActivityTabId,
} from '@/views/Address/search';
import { TxFilterBar, distinctRowSelectors } from '@/views/Address/TxFilterBar';
import { deriveAddressCoverage } from '@/views/Address/coverage';
import { DeepScan } from '@/views/Address/DeepScan';
import { scanJobFromTxPayload } from '@/services/addressScan';
import {
  computeAddressSummaryStats,
  formatNativeTotal,
  formatSeenBoundary,
  type SummaryTxRow,
} from '@/views/Address/summaryStats';
import { isBackendUnreachable } from '@/util/http';
import { getApiBase } from '@/util/apiBase';
import { ApiError } from '@/util/apiError';
import {
  labelMatchesTarget,
  saveAddressLabel,
  deleteAddressLabel,
  useAddressLabel,
} from '@/services/labels';
import {
  useAddressInfo,
  useAddressTransactions,
  type AddressInfoResponse,
} from '@/services/addresses';
import { useTokenUsdPrices } from '@/services/prices';
import { UsdValue } from '@/components/ui/UsdValue';
import {
  useContractCode,
  useRealTimeAddressData,
} from '@/services/addressRealTime';
import { useTokenTransfers } from '@/services/tokenTransfers';
import { useTokenOverview } from '@/services/tokenMetadata';
import { BalanceHistory, useBalanceHistoryQuery, withBlockTimes } from '@/views/Address/BalanceHistory';
import KnownTokens from '@/views/Address/KnownTokens';
import NftHoldings from '@/views/Address/NftHoldings';
import InternalTxns from '@/views/Address/InternalTxns';
import { CrossChainStrip } from '@/views/Address/CrossChainStrip';
import { ApprovalSection } from '@/views/Address/approvals';
import { aggregateNftHoldings } from '@/views/Address/nftHoldings';
import {
  ACTIVITY_ANCHOR_ID,
  APPROVALS_ANCHOR_ID,
  KNOWN_TOKENS_ANCHOR_ID,
  NFT_HOLDINGS_ANCHOR_ID,
  OVERVIEW_ANCHOR_ID,
  TOKEN_HOLDINGS_ANCHOR_ID,
  deriveAddressSectionAnchors,
  type SectionAnchor,
} from '@/views/Address/sectionAnchors';
import { knownTokensForChain } from '@/config/knownTokens';
import { useKnownTokenBalances } from '@/services/knownTokenBalances';
import { createRpcClient } from '@/utils/realTimeData';
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
import { CoverageBadge } from '@/components/ui/CoverageBadge';
import { Button } from '@/components/ui/Button';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { ExternalLinks } from '@/components/ui/ExternalLinks';
import { PrivateNoteChip } from '@/components/ui/PrivateNoteChip';
import { AddressQr } from '@/components/ui/AddressQr';

const headerRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--haze-space-4);

  /* Narrow screens: the activity header (segmented tabs + Export CSV +
     Refresh) and the Token Overview title + classification badge never
     fit one ~340px row — wrap to stacked lines instead of overflowing
     the card (same breakpoint as the Contract page's tab header). */
  @media (max-width: 768px) {
    flex-wrap: wrap;
    gap: var(--haze-space-2);
  }
`;

const bannerLinks = css`
  margin: var(--haze-space-2) 0 var(--haze-space-3);
`;

// Page-level coverage badge row: sits under the page header (below the ENS
// row when present) — one aggregated honesty chip above the cards, with
// the per-source explanations expanding from its ⓘ affordance.
const coverageBadgeRow = css`
  margin: 0 0 var(--haze-space-4);
`;

// --- In-page section anchor chips (sticky row under the page header) ---

// Sticky offset math assumes the top navigation's fixed 60px bar (its
// desktop shape); the row itself is ~44px, so jumped-to sections keep
// 116px of clearance (60 nav + row + breathing room) via scroll-margin.
const anchorTarget = css`
  scroll-margin-top: 116px;
`;

// The sticky chip row itself. The page background (--haze-color-bg on the
// themed root) masks the content scrolling beneath the stuck row.
// Hidden below the top nav's own 768px wrap breakpoint: there the nav is
// taller than the 60px bar this row's sticky offset (and the targets'
// scroll-margin) assume, and at phone widths (375px) the full chip set
// would wrap past two rows — a deterministic hide, not a measured guess.
const anchorNavRow = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--haze-space-2);
  position: sticky;
  top: 60px;
  z-index: 90;
  background: var(--haze-color-bg);
  padding: var(--haze-space-2) 0;
  margin: 0 0 var(--haze-space-4);

  @media (max-width: 767px) {
    display: none;
  }
`;

// One anchor chip: a real <a href="#…"> (focusable, Enter-activated),
// pill-shaped like the section family it navigates within.
const anchorChip = css`
  display: inline-flex;
  align-items: center;
  padding: var(--haze-space-1) var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-full, 999px);
  background: var(--haze-color-bg-subtle);
  color: var(--haze-color-text-muted);
  text-decoration: none;
  font-size: var(--haze-text-xs);
  font-weight: var(--haze-weight-semibold);
  white-space: nowrap;

  &:hover {
    color: var(--haze-color-text);
    border-color: var(--haze-color-primary);
    text-decoration: none;
  }
`;

// Anchor wrapper for one row INSIDE the Overview InfoGrid: the wrapped
// InfoItem is always :last-child of this wrapper, so its own bottom
// border switches off — the wrapper draws the identical separator in its
// place and the grid keeps its exact row rhythm. Renders only when the
// section itself renders (the page's presence mirrors), so the id always
// resolves to real content.
const anchorGridRow = css`
  border-bottom: 1px solid var(--haze-color-bg-muted);
  scroll-margin-top: 116px;
`;

// ENS names carry no length ceiling, and the page title is one: without a
// break opportunity a long name pushes the whole page into horizontal
// scroll. `anywhere` only kicks in for names that actually overflow —
// normal titles (and "Address Details") are untouched.
const addressHeaderStyle = css`
  & h1 {
    overflow-wrap: anywhere;
  }
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

// Page title + header actions: the QR affordance sits right of the title,
// in the same header family as the back button above it. The title keeps
// its own margins (PageHeader), so the action only aligns to the top.
const addressTitleRow = css`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--haze-space-3);
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

  /* Narrow screens: the tab strip gets its own horizontal scroll (labels
     stay one line — see tabButton's nowrap) instead of squeezing or
     pushing the Export/Refresh actions out of the card. Mirrors the
     Contract page's tab-strip affordance. */
  @media (max-width: 768px) {
    max-width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
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
  /* Labels never wrap mid-word: the strip scrolls instead (see above). */
  white-space: nowrap;

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

// Discovered-holdings section of the Overview card: each row is one
// aggregate NET value from the scanned transfers — an approximation, and
// the caveat under the list never lets it read as indexer truth.
const holdingsRow = css`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--haze-space-1) var(--haze-space-2);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  margin-bottom: var(--haze-space-1);

  @media (max-width: 768px) {
    justify-content: flex-start;
  }
`;

// Not-scanned hint above the scan CTA (small, muted — an affordance, not
// a data row).
const holdingsHint = css`
  display: block;
  margin-bottom: var(--haze-space-2);
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

// Secondary on-chain-verification value (chain truth wins, but the
// discovered net stays visible alongside).
const holdingsMuted = css`
  color: var(--haze-color-text-muted);
`;

// Completeness caveat: must render with every list — discovered transfers
// are a partial scan, never a claim of full holdings.
const holdingsCaveat = css`
  margin: var(--haze-space-2) 0 0;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

// Estimated USD total line: sits between the holdings rows and the
// caveat — small, but a figure the reader may act on, so one step above
// the xs caveat text.
const holdingsEstimateStyle = css`
  margin: var(--haze-space-3) 0 0;
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
`;

// Token Overview card: only contracts whose token probes answered render
// it; it sits between the Overview card and the activity card.
const tokenOverviewCard = css`
  margin-top: var(--haze-space-5);
`;

// The classification badge in the Token Overview header: haze badges
// nowrap by default, and the honest long label ("Token (standard unknown
// — possibly ERC-721)") out-measures a phone row — on narrow screens the
// pill wraps its text instead of silently overflowing the card.
const tokenBadgeStyle = css`
  @media (max-width: 768px) {
    & > span {
      white-space: normal;
    }
  }
`;

// Export CSV affordance in the tx tab toolbar: an ANCHOR (the backend's
// Content-Disposition drives the file save), visually a sibling of the
// Refresh button. Disabled keeps it visible with a title reason — the
// export always mirrors what the list shows, never a mystery download.
const exportCsvLink = css`
  display: inline-flex;
  align-items: center;
  gap: var(--haze-space-1);
  padding: var(--haze-space-1) var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-sm, 6px);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  text-decoration: none;
  white-space: nowrap;

  &:hover {
    background: var(--haze-color-bg-muted);
  }
`;

const exportCsvLinkDisabled = css`
  opacity: 0.5;
  pointer-events: none;
`;

// One discovered-holder row: participant address on the left, net balance
// on the right — the same mono/xs treatment as the holdings rows.
const holderRow = css`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--haze-space-1) var(--haze-space-2);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  margin-bottom: var(--haze-space-1);

  @media (max-width: 768px) {
    justify-content: flex-start;
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
  // Additive backend row field: the calldata's 4-byte function selector
  // ('0x' + 8 lowercase hex) or null for plain transfers / creations.
  // Absent on legacy cached payloads — undefined reads "not carried",
  // and the method filter (and the chips) skip such rows rather than
  // guessing (the logStandard precedent).
  selector?: string | null;
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
// (and owns its query there), so the unmounted tab fetches nothing; the
// internal tab likewise owns its traces and reuses the tx tab's rows.
const activityTabs: ReadonlyArray<{ id: ActivityTabId; label: string }> = [
  { id: 'transactions', label: 'Transactions' },
  { id: 'transfers', label: 'Token Transfers' },
  { id: 'internal', label: 'Internal Txns' },
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

// Canonical Multicall3 deployment (same constant as
// services/tokenMetadata.ts): the viem client built by
// utils/realTimeData is not tied to one chain type, so the multicall
// address cannot be inferred from chain config — pass it explicitly.
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

// Per-kind label of one holding row. The verified branch only applies to
// ERC-20 rows (the only standard the on-chain balanceOf batch checks);
// erc721/erc1155/unclassified rows render the discovered aggregate.
function holdingRowContent(
  holding: TokenHolding,
  meta: TokenMeta | undefined,
  verifiedBalance: bigint | undefined,
): { text: ReactNode; title: string | undefined } {
  if (holding.kind === 'erc20') {
    // classifyShared only returns 'erc20' when decimals resolved, so the
    // formatted amount is normally available; the raw net string is the
    // honest fallback for an incomplete metadata record (never a guessed
    // 18-decimal formatting).
    const formatAmount = (amount: bigint): string =>
      meta?.decimals !== undefined
        ? formatUnits(amount, meta.decimals)
        : amount.toString();
    const symbolSuffix = meta?.symbol !== undefined ? ` ${meta.symbol}` : '';
    if (verifiedBalance === undefined) {
      return {
        text: `${formatAmount(holding.net)}${symbolSuffix}`,
        title: undefined,
      };
    }
    if (verifiedBalance !== holding.net) {
      // Chain truth is primary; the discovered net stays visible next to
      // it (muted) — the scan-derived value is never dropped.
      return {
        text: (
          <>
            On-chain {formatAmount(verifiedBalance)}
            {symbolSuffix}{' '}
            <span className={holdingsMuted}>
              discovered {formatAmount(holding.net)}
              {symbolSuffix}
            </span>
          </>
        ),
        title: undefined,
      };
    }
    return {
      text: `${formatAmount(holding.net)}${symbolSuffix} (on-chain verified)`,
      title: undefined,
    };
  }
  if (holding.kind === 'erc721') {
    return {
      text: `${holding.heldIds.length} id(s)`,
      // Every counted id, comma-joined — the row itself only reports the
      // count.
      title: holding.heldIds.join(', '),
    };
  }
  if (holding.kind === 'erc1155') {
    return {
      text: `ID ${holding.tokenId} × ${holding.net.toLocaleString()}`,
      title: undefined,
    };
  }
  return {
    text: `${holding.net.toLocaleString()} (standard unresolved)`,
    title: undefined,
  };
}

// Discovered-holdings list for the Overview card. Renders one contract
// link per holding and, for the top ERC-20 holdings (already sorted by
// transfer count), verifies balances against the chain through one
// Multicall3 batch. Only successful slots that decode to a bigint are
// recorded; a transport-level failure records nothing — a verified
// balance is never invented.
function HoldingsList({
  chainId,
  address,
  holdings,
  metas,
}: {
  chainId: number;
  address: string;
  holdings: TokenHolding[];
  metas: Record<string, TokenMeta | undefined>;
}) {
  // The first five ERC-20 tokens (the aggregator sorts by transfer count,
  // so these are the most active ones). ',' never appears in an address,
  // so the joined key round-trips through split().
  const verifyTokens = useMemo(
    () =>
      holdings
        .filter(holding => holding.kind === 'erc20')
        .slice(0, 5)
        .map(holding => holding.token),
    [holdings],
  );
  const verifyTokensKey = verifyTokens.join(',');
  const [verifiedBalances, setVerifiedBalances] = useState<Record<string, bigint>>({});
  useEffect(() => {
    if (verifyTokensKey === '') return;
    let cancelled = false;
    void (async () => {
      try {
        const client = await createRpcClient(chainId);
        // Typed like services/tokenMetadata.ts (the same client): the
        // untyped client cannot infer per-contract return types, so the
        // outcomes are narrowed defensively below.
        const contracts: ContractFunctionParameters[] = [];
        for (const token of verifyTokens) {
          contracts.push({
            address: token as `0x${string}`,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          });
        }
        const outcomes = await client.multicall({
          contracts,
          allowFailure: true,
          multicallAddress: MULTICALL3_ADDRESS,
        });
        if (cancelled) return;
        const balances: Record<string, bigint> = {};
        verifyTokens.forEach((token, index) => {
          const outcome = outcomes[index];
          if (outcome?.status === 'success' && typeof outcome.result === 'bigint') {
            balances[token.toLowerCase()] = outcome.result;
          }
        });
        setVerifiedBalances(balances);
      } catch {
        // No verification is claimed for any token — the rows stay on
        // the discovered values.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [verifyTokensKey, chainId, address]);

  return (
    <>
      {holdings.map(holding => {
        const { text, title } = holdingRowContent(
          holding,
          metas[holding.token.toLowerCase()],
          holding.kind === 'erc20'
            ? verifiedBalances[holding.token.toLowerCase()]
            : undefined,
        );
        return (
          <TypedLink
            key={`${holding.kind}:${holding.token.toLowerCase()}:${holding.kind === 'erc1155' ? holding.tokenId : ''}`}
            to={`/chain/${chainId}/contract/${holding.token}`}
            className={cx(holdingsRow, linkStyle)}
            title={title}
          >
            {text}
          </TypedLink>
        );
      })}
    </>
  );
}

// --- Address label: the user's personal annotation for this address ---

// Saved label chip: distinct from data rows on purpose — a label is an
// annotation, not chain truth, so it renders as a badge-like pill.
const labelChip = css`
  display: inline-flex;
  align-items: center;
  gap: var(--haze-space-1);
  padding: 0 var(--haze-space-2);
  border: 1px solid var(--haze-color-border);
  border-radius: 999px;
  background: var(--haze-color-bg-muted);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  max-width: 100%;
  overflow-wrap: anywhere;
`;

// Subtle edit affordance beside the chip (icon button).
const labelEditButton = css`
  border: none;
  background: none;
  padding: 0 var(--haze-space-1);
  color: var(--haze-color-text-muted);
  cursor: pointer;
  font-size: var(--haze-text-sm);

  &:hover {
    color: var(--haze-color-text);
  }
`;

// Built-in provenance marker beside a seeded chip: quieter than the chip
// itself — the label reads as one unit, with the marker only explaining
// where it came from (and how to make it yours). Never shown for
// operator-authored labels.
const labelBuiltinMark = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  white-space: nowrap;
`;

// The "+ add label" affordance: quiet on purpose (an invitation, not a
// data row) but always visible — this is a single-user tool.
const labelAddButton = css`
  border: none;
  background: none;
  padding: 0;
  color: var(--haze-color-text-muted);
  cursor: pointer;
  font-size: var(--haze-text-sm);
  text-decoration: underline dotted;

  &:hover {
    color: var(--haze-color-text);
  }
`;

// Inline editor: label input + optional note input + Save/Cancel (and
// Remove when overwriting an existing label). Stacks vertically inside the
// InfoItem value cell.
const labelEditor = css`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--haze-space-2);
  width: 100%;

  @media (max-width: 768px) {
    align-items: stretch;
  }
`;

const labelEditorRow = css`
  display: flex;
  gap: var(--haze-space-2);
  width: 100%;
`;

const labelInput = css`
  flex: 1;
  min-width: 0;
`;

// Muted inline hint/error under the editor (403 guidance, network error).
const labelHint = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-muted);
  margin: 0;
  text-align: right;

  @media (max-width: 768px) {
    text-align: left;
  }
`;

const LABEL_MAX_CHARS = 64;
const NOTE_MAX_CHARS = 500;

// The Label row's value cell. Read state: chip + note tooltip + ✎ edit
// (or the subtle "+ add label" affordance when nothing is saved). Editor
// state: label input + optional note + Save/Cancel (+ Remove over an
// existing label). Honesty rules: a 403 keeps the editor open with the
// admin-token hint (the fix is one settings panel away), a network failure
// keeps it open with the error shown, and the saved chip only renders for
// a result that matches THIS (chainId, address) — the query store keeps
// the previous settle across args switches.
function AddressLabelRow({ chainId, address }: { chainId: number; address: string }) {
  const labelQuery = useAddressLabel(chainId, address);
  const saved = labelMatchesTarget(labelQuery.data, chainId, address)
    ? labelQuery.data
    : undefined;

  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // null = no complaint; 'admin-token' = 403 guidance; otherwise the
  // honest error message from the failed request.
  const [editorHint, setEditorHint] = useState<string | null>(null);

  const trimmedLabel = labelDraft.trim();
  const trimmedNote = noteDraft.trim();
  const labelValid = trimmedLabel.length >= 1 && trimmedLabel.length <= LABEL_MAX_CHARS;
  const noteValid = trimmedNote.length <= NOTE_MAX_CHARS;

  const startEditing = () => {
    setLabelDraft(saved?.label ?? '');
    setNoteDraft(saved?.note ?? '');
    setEditorHint(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditorHint(null);
  };

  const classifySaveError = (error: unknown): string =>
    error instanceof ApiError && error.status === 403
      ? 'admin-token'
      : error instanceof Error
        ? error.message
        : 'Failed to save label';

  const save = async () => {
    setSaving(true);
    setEditorHint(null);
    try {
      await saveAddressLabel(
        chainId,
        address,
        trimmedLabel,
        trimmedNote === '' ? null : trimmedNote,
      );
      await labelQuery.refetch();
      setEditing(false);
    }
    catch (error) {
      setEditorHint(classifySaveError(error));
    }
    finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setEditorHint(null);
    try {
      await deleteAddressLabel(chainId, address);
      await labelQuery.refetch();
      setEditing(false);
    }
    catch (error) {
      // A 404 on remove means the label is already gone — the goal state.
      if (error instanceof ApiError && error.status === 404) {
        await labelQuery.refetch();
        setEditing(false);
      }
      else {
        setEditorHint(classifySaveError(error));
      }
    }
    finally {
      setSaving(false);
    }
  };

  if (editing) {
    const saveDisabled = saving || !labelValid || !noteValid;
    const saveDisabledReason = !labelValid
      ? `Label must be 1-${LABEL_MAX_CHARS} characters after trimming`
      : !noteValid
          ? `Note must be at most ${NOTE_MAX_CHARS} characters`
          : undefined;
    return (
      <div className={labelEditor}>
        <div className={labelEditorRow}>
          <input
            className={labelInput}
            value={labelDraft}
            onChange={e => setLabelDraft(e.target.value)}
            placeholder="Label (required)"
            aria-label="Address label"
            maxLength={LABEL_MAX_CHARS + 10}
            disabled={saving}
            data-testid="label-input"
          />
        </div>
        <div className={labelEditorRow}>
          <input
            className={labelInput}
            value={noteDraft}
            onChange={e => setNoteDraft(e.target.value)}
            placeholder="Note (optional)"
            aria-label="Address label note"
            maxLength={NOTE_MAX_CHARS + 10}
            disabled={saving}
            data-testid="label-note-input"
          />
        </div>
        {editorHint !== null && (
          <p className={labelHint} data-testid="label-editor-hint">
            {editorHint === 'admin-token'
              ? 'Set the admin token in ⚙ RPC settings to edit labels'
              : editorHint}
          </p>
        )}
        <div className={labelEditorRow}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void save()}
            loading={saving}
            disabled={saveDisabled}
            title={saveDisabled ? saveDisabledReason : 'Save the label'}
            data-testid="label-save"
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={cancelEditing}
            disabled={saving}
          >
            Cancel
          </Button>
          {saved !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void remove()}
              disabled={saving}
              title="Remove the saved label"
            >
              Remove
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Read state. A label-channel failure renders a muted inline note — the
  // rest of the Overview keeps working (the same scoping as the indexed
  // fields' offline notice).
  if (labelQuery.error !== undefined) {
    return (
      <span
        className={labelHint}
        title={labelQuery.error.message}
        data-testid="label-unavailable"
      >
        Label unavailable
      </span>
    );
  }

  if (saved === undefined) {
    // Still loading (or genuinely absent): while the first fetch is in
    // flight the affordance waits — an absent label and an unsettled one
    // must not flash between states.
    if (labelQuery.loading) return <span className={labelHint}>…</span>;
    return (
      <button
        type="button"
        className={labelAddButton}
        onClick={startEditing}
        data-testid="label-add"
      >
        + add label
      </button>
    );
  }

  return (
    <>
      <span
        className={labelChip}
        title={saved.note ?? undefined}
        data-testid="label-chip"
      >
        {saved.label}
        {saved.note !== null && (
          <span aria-label="This label has a note">ⓘ</span>
        )}
      </span>
      {saved.source === 'builtin' && (
        <span
          className={labelBuiltinMark}
          title="Bundled with the explorer — edit or delete to make it yours"
          data-testid="label-builtin-mark"
        >
          built-in
        </span>
      )}
      <button
        type="button"
        className={labelEditButton}
        onClick={startEditing}
        aria-label="Edit label"
        title="Edit label"
        data-testid="label-edit"
      >
        ✎
      </button>
    </>
  );
}

// --- Overview summary stats (discovered set) ---

// Etherscan-density strip at the top of the Overview card: FIRST/LAST
// SEEN + TOTAL IN/OUT over the tx rows the Transactions tab discovered
// for the current window. Sits above the InfoGrid rows; the page-level
// CoverageBadge above the cards keeps the long coverage explanation, so
// this strip carries only the one-line discovered caveat below.
const summaryStatsStyle = css`
  margin: 0 0 var(--haze-space-4);
  padding-bottom: var(--haze-space-4);
  border-bottom: 1px solid var(--haze-color-bg-muted);
`;

const summaryStatsGrid = css`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--haze-space-3) var(--haze-space-4);

  /* 375px pass: four cells cannot share a phone row — stack 2×2 (the
     same breakpoint the InfoGrid rows and card headers stack at). */
  @media (max-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
`;

const summaryStatsCell = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
  min-width: 0;
`;

const summaryStatsLabel = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
  font-weight: var(--haze-weight-medium);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
`;

const summaryStatsValue = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  overflow-wrap: anywhere;
`;

// The discovered semantics, one line: the glyph is the CoverageBadge's
// color-independent 'discovered' mark (◍ ring) — the long explanation
// lives in the page badge's expandable detail, never duplicated here.
const summaryStatsCaveat = css`
  margin: var(--haze-space-3) 0 0;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

// Boundary-block timestamp lookups. The discovered-set wire rows carry no
// timestamp, so each boundary block resolves through ONE cached
// browser-RPC getBlock (module-level: pagination and remounts reuse it);
// a failed lookup caches null and the cell keeps the honest block-number
// fallback. Never estimated, never retried per render.
const blockTimestampCache = new Map<string, number | null>();

// Test isolation for the module-level lookup cache (the same pattern as
// services/prices' resetPricesForTests): without it one test's cached
// block lookup would suppress the next test's RPC path.
export const resetBlockTimestampCacheForTests = (): void => {
  blockTimestampCache.clear();
};

const formatDateTimeLocal = (epochMs: number): string => new Date(epochMs).toLocaleString();

// The row-carrying boundary wins as-is; a boundary whose row carried no
// timestamp reads the RPC lookup cache (number → date, null/absent → the
// "Block N" fallback below).
const withCachedTimestamp = (
  chainId: number,
  seen: { blockNumber: number; timestamp?: number },
): { blockNumber: number; timestamp?: number } => {
  if (seen.timestamp !== undefined) return seen;
  const cached = blockTimestampCache.get(`${chainId}:${seen.blockNumber}`);
  return cached === undefined || cached === null
    ? seen
    : { blockNumber: seen.blockNumber, timestamp: cached };
};

// Exported for its focused test file (the same pattern as
// InvalidAddressError): pure props + one lazy RPC effect, no router.
export function SummaryStatsRow({
  chainId,
  address,
  rows,
  symbol,
  decimals,
  discoveredTotal,
}: {
  chainId: number;
  address: string;
  // Structural minimum: satisfied by both the tx tab's TxRecord and the
  // balance-history page's BalanceTxInput (the current data source).
  rows: readonly SummaryTxRow[];
  symbol: string;
  decimals: number;
  /** Full discovered count for the window — rows may be a capped slice; the caveat says which. */
  discoveredTotal?: number;
}) {
  const stats = useMemo(
    () => computeAddressSummaryStats(rows, address),
    [rows, address],
  );

  // Boundaries still needing a timestamp: the row carried none and no
  // cached lookup (success or failure) answered yet.
  const pendingBlocks = [stats.firstSeen, stats.lastSeen].reduce<number[]>(
    (acc, boundary) => {
      if (
        boundary !== null &&
        boundary.timestamp === undefined &&
        !blockTimestampCache.has(`${chainId}:${boundary.blockNumber}`) &&
        !acc.includes(boundary.blockNumber)
      ) {
        acc.push(boundary.blockNumber);
      }
      return acc;
    },
    [],
  );
  const pendingKey = `${chainId}:${pendingBlocks.join(',')}`;
  // Lookup outcomes only re-render the strip (the cache itself is the
  // display's source of truth above).
  const [, bumpLookupTick] = useState(0);
  useEffect(() => {
    if (pendingBlocks.length === 0) return;
    let cancelled = false;
    void (async () => {
      const client = await createRpcClient(chainId).catch(() => null);
      for (const blockNumber of pendingBlocks) {
        const block =
          client === null
            ? null
            : await client.getBlock({ blockNumber: BigInt(blockNumber) }).catch(() => null);
        if (cancelled) return;
        blockTimestampCache.set(
          `${chainId}:${blockNumber}`,
          block === null ? null : Number(block.timestamp) * 1000,
        );
        bumpLookupTick(tick => tick + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
    // pendingKey pins the exact (chain, blocks) request set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  // Clean absence: no discovered rows → no strip, never zeros-as-facts.
  if (stats.txCount === 0 || stats.firstSeen === null || stats.lastSeen === null) {
    return null;
  }

  const cells = [
    {
      label: 'First Seen',
      value: formatSeenBoundary(
        withCachedTimestamp(chainId, stats.firstSeen),
        formatDateTimeLocal,
      ),
    },
    {
      label: 'Last Seen',
      value: formatSeenBoundary(
        withCachedTimestamp(chainId, stats.lastSeen),
        formatDateTimeLocal,
      ),
    },
    { label: 'Total In', value: formatNativeTotal(stats.totalIn, decimals, symbol) },
    { label: 'Total Out', value: formatNativeTotal(stats.totalOut, decimals, symbol) },
  ];

  return (
    <div className={summaryStatsStyle} data-testid="summary-stats-row">
      <div className={summaryStatsGrid}>
        {cells.map(cell => (
          <div key={cell.label} className={summaryStatsCell}>
            <span className={summaryStatsLabel}>{cell.label}</span>
            <span className={summaryStatsValue}>{cell.value}</span>
          </div>
        ))}
      </div>
      <p className={summaryStatsCaveat}>
        ◍ Over{' '}
        {discoveredTotal !== undefined && discoveredTotal > stats.txCount
          ? `the newest ${stats.txCount.toLocaleString()} of ${discoveredTotal.toLocaleString()} discovered transactions`
          : `the ${stats.txCount.toLocaleString()} discovered transactions`}{' '}
        of the selected window — not lifetime totals.
      </p>
    </div>
  );
}

// Sticky chip row of in-page section anchors (derivation in
// ./sectionAnchors — the view only supplies what it knows). Chips are
// native <a href="#…"> links: focusable, keyboard-activated, announced
// with their labels. The click is intercepted ONLY to scroll smoothly
// while honoring the sticky-offset scroll-margin (native fragment jumps
// are instant, and writing a hash would push router-owned URLs into
// history); reduced-motion users get the instant jump. jsdom has no
// scrollIntoView, so the call is guarded for unit tests.
function SectionAnchorNav({ anchors }: { anchors: SectionAnchor[] }) {
  return (
    <nav className={anchorNavRow} aria-label="Jump to sections">
      {anchors.map(anchor => (
        <a
          key={anchor.id}
          href={`#${anchor.id}`}
          className={anchorChip}
          onClick={event => {
            event.preventDefault();
            const target = document.getElementById(anchor.id);
            if (target === null) return;
            const reducedMotion = window.matchMedia(
              '(prefers-reduced-motion: reduce)',
            ).matches;
            if (typeof target.scrollIntoView === 'function') {
              target.scrollIntoView({
                behavior: reducedMotion ? 'auto' : 'smooth',
                block: 'start',
              });
            }
          }}
        >
          {anchor.label}
        </a>
      ))}
    </nav>
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

  // Page-level read of the label channel for the coverage badge: same args
  // as the Label row below, so the query store shares ONE cache entry (no
  // second fetch) — this only mirrors its state at page scope.
  const labelCoverageQuery = useAddressLabel(currentChainId, address);

  // Tx-list pagination and the deepened search window are URL-driven
  // (?page= / ?window=): shareable deep links and working back/forward.
  // useSetSearch validates/writes through the same schema (values as
  // strings on the wire). Writes merge into the current search so a page
  // change never drops the window and vice versa.
  const setSearch = useSetSearch(addressSearchSchema);
  const {
    page: txPageParam,
    window: txWindowParam,
    tab: tabParam,
    ttPage: ttPageParam,
    ttWindow: ttWindowParam,
    tfFrom: tfFromParam,
    tfTo: tfToParam,
    tfMin: tfMinParam,
    tfMax: tfMaxParam,
    tfMethod: tfMethodParam,
  } = useSearch(addressSearchSchema);
  const txPage = Math.max(1, Math.floor(txPageParam));
  const setTxPage = (next: number) => {
    void setSearch(prev => ({
      ...prev,
      page: String(Math.max(1, Math.floor(next))),
    }));
  };

  // Advanced tx filters (?tfFrom= / ?tfTo= / ?tfMin= / ?tfMax= /
  // ?tfMethod=): the URL carries the RAW strings (shareable,
  // back/forward); effectiveTxFilters degrades malformed ones to absent
  // so a hand-crafted link never fires a doomed request. Raw presence
  // (not validity) decides whether the filter bar renders open — the
  // bar shows what the link carried and its field errors explain why it
  // is not being sent.
  const txUrlFilterValues = {
    from: tfFromParam ?? '',
    to: tfToParam ?? '',
    min: tfMinParam ?? '',
    max: tfMaxParam ?? '',
    method: tfMethodParam ?? '',
  };
  const txUrlFilterParamCount = [
    tfFromParam,
    tfToParam,
    tfMinParam,
    tfMaxParam,
    tfMethodParam,
  ].filter(param => param !== undefined).length;
  const txFilters = effectiveTxFilters({
    tfFrom: tfFromParam,
    tfTo: tfToParam,
    tfMin: tfMinParam,
    tfMax: tfMaxParam,
    tfMethod: tfMethodParam,
  });
  const hasTxFilters = hasActiveTxFilters(txFilters);

  // The bar starts open iff the deep link carries tf params, and re-opens
  // whenever they appear in the URL (back/forward into a filtered view).
  // Closing is the user's call and survives until the URL changes again —
  // never auto-closed, so mid-edit state is not yanked away.
  const [txFilterBarOpen, setTxFilterBarOpen] = useState(txUrlFilterParamCount > 0);
  useEffect(() => {
    if (txUrlFilterParamCount > 0) setTxFilterBarOpen(true);
  }, [txUrlFilterParamCount]);

  // Apply writes all five params in one history entry and RESETS the page
  // (the filtered set can only shrink, so deeper pages may no longer
  // exist); empty fields delete their key (absence IS the unfiltered
  // state — the ?ttStandard= discipline). Clear drops every tf param but
  // keeps the page: the unfiltered set is a superset, so the page stays
  // valid (beyond-data convergence covers any staleness).
  const applyTxFilters = (next: {
    from: string;
    to: string;
    min: string;
    max: string;
    method: string;
  }) => {
    void setSearch(prev => {
      const merged: Record<string, string | string[]> = { ...prev, page: '1' };
      if (next.from === '') delete merged.tfFrom;
      else merged.tfFrom = next.from;
      if (next.to === '') delete merged.tfTo;
      else merged.tfTo = next.to;
      if (next.min === '') delete merged.tfMin;
      else merged.tfMin = next.min;
      if (next.max === '') delete merged.tfMax;
      else merged.tfMax = next.max;
      if (next.method === '') delete merged.tfMethod;
      else merged.tfMethod = next.method;
      return merged;
    });
  };
  const clearTxFilters = () => {
    void setSearch(prev => {
      const merged: Record<string, string | string[]> = { ...prev };
      delete merged.tfFrom;
      delete merged.tfTo;
      delete merged.tfMin;
      delete merged.tfMax;
      delete merged.tfMethod;
      return merged;
    });
  };

  // Recent-activity tab (segmented control in the card header) rides the
  // URL as ?tab= — a tab choice survives refresh/share and back/forward.
  // A deep-linked transfers page (?ttPage=2+) without ?tab= selects the
  // transfers tab (see effectiveActivityTab); explicit ?tab= always wins.
  const activityTab = effectiveActivityTab(tabParam, ttPageParam);
  const [transfersRefreshSignal, setTransfersRefreshSignal] = useState(0);
  const [transfersRefreshing, setTransfersRefreshing] = useState(false);
  // Same spinner-signal pattern for the internal tab's re-trace.
  const [internalRefreshSignal, setInternalRefreshSignal] = useState(0);
  const [internalRefreshing, setInternalRefreshing] = useState(false);
  const selectActivityTab = (tab: ActivityTabId) => {
    void setSearch(prev => ({ ...prev, tab }));
    // A pending transfers/internal refresh can no longer report back once
    // the tab unmounts — drop its spinner instead of spinning forever.
    setTransfersRefreshing(false);
    setInternalRefreshing(false);
  };

  // Widened search window (blocks) from ?window= — undefined is the
  // backend default. "Search deeper" escalates it by writing the URL (a
  // fresh history entry, like ?page=); it rides in the query args so a
  // wider window is a fresh cache key/fetch.
  const txSearchWindow = txWindowParam;
  const txLimit = 10;
  // Tx-scan gating, symmetric with the transfers tab's lazy fetch: the
  // heuristic history scan is expensive (tens of seconds on deep windows)
  // and only the transactions/internal tabs render it, so a transfers-only
  // deep link (?tab=transfers / ?ttPage=2+) must not pay for it. The
  // internal tab reuses the SAME key (limit/offset/window) so switching
  // between it and the transactions tab never refetches — the internal
  // traces ride the rows already in the cache. Args-level gate — chainId
  // <= 0 is the services' own disabled-key shape (resolves undefined
  // without touching the network); switching back to a consuming tab
  // restores the real key and the fetch runs then.
  const txScanActive = activityTab !== 'transfers';
  const txQuery = useAddressTransactions(
    txScanActive ? currentChainId : 0,
    address,
    txLimit,
    (txPage - 1) * txLimit,
    txSearchWindow,
    // Filters ride in the query args (fresh cache key per filter set) —
    // the backend narrows the SAME cached discovered set, never a scan.
    txFilters,
  );

  // Settled tx payload + the deepest page the discovered total can fill.
  // Computed before the early guards below so the convergence effect runs
  // unconditionally (rules of hooks).
  const txData = txQuery.data as AddressTxPage | undefined;
  const txTotal = txData?.total ?? 0;
  const txTotalPages = Math.max(1, Math.ceil(txTotal / txLimit));

  // Shared balance-history page: SAME cache entry the BalanceHistory
  // chart consumes (identical args — zero extra requests), the widest
  // single-page slice of the discovered set (limit 50) with
  // backend-aligned timestamps. Feeds the Overview's SummaryStatsRow so
  // the stats strip and the chart can never disagree.
  const balanceHistoryQuery = useBalanceHistoryQuery([currentChainId, address, txSearchWindow]);
  // Cross-chain guard (the chart's own pattern): the query layer keeps
  // the last settle across an args switch — only same-chain data serves.
  const balanceHistoryPage =
    balanceHistoryQuery.data?.chainId === currentChainId
      ? balanceHistoryQuery.data
      : undefined;
  const summaryStatsRows = useMemo(
    () => (balanceHistoryPage === undefined ? [] : withBlockTimes(balanceHistoryPage)),
    [balanceHistoryPage],
  );

  // CSV export URL: mirrors the tx list's CURRENT ?window= param (the
  // backend replays the same discovery), so the download always matches
  // what the list paginates through. Built only when the tx tab is active
  // (the button renders there alone).
  const txExportHref = `${getApiBase()}/api/chains/${currentChainId}/addresses/${address}/transactions/export${
    txSearchWindow !== undefined ? `?window=${txSearchWindow}` : ''
  }`;
  // Disabled with a reason while the list itself is loading/errored, or in
  // degraded mode (a same-origin relative link would 404/serve SPA HTML):
  // export what the list shows, not a mystery.
  const txExportDisabledReason = txQuery.loading
    ? 'Waiting for the transaction list to settle…'
    : txQuery.error !== undefined
      ? 'The transaction list failed — export follows the list'
      : getApiBase() === ''
        ? 'Backend not connected — export unavailable'
        : undefined;

  // Beyond-data convergence (Transactions/List semantics): once a payload
  // settles and ?page= exceeds the deepest valid page, the URL is pinned
  // (replaced) to that page — an empty page is never shareable or
  // refreshable, and Prev-walking back becomes unnecessary. Mid-flight
  // (or failed) fetches converge nothing: the transient empty-page row
  // further below stays the fallback for those races. Gated on the tx
  // scan's tabs like the fetch itself — a transfers-tab visit never
  // rewrites the URL behind a scan it is not running.
  const txPageBeyondData =
    txScanActive &&
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

  // Persistent record + code read (both declared here so the type verdict
  // below — which must precede the token-mode holders query — can read
  // them without forward references).
  const persistent: AddressInfoResponse['address'] | undefined =
    infoQuery.data?.address;
  const code = codeQuery.data;

  // Presentation-layer type verdict (./addressType): the persistent
  // record wins over the RPC code read — EXCEPT when the persistent
  // channel has ERRORED (offline backend): then it contributes no
  // verdict at all (not even stale cached data), and the live RPC code
  // read decides EOA vs Contract on its own. An EIP-7702 delegation
  // designator still outranks both channels (a delegated EOA carries
  // code yet remains an account, so "has code → contract" misfiles it).
  // Lives ABOVE the transfers/holdings queries: the token-mode holders
  // feed below branches on the settled token verdict, and hooks cannot
  // be ordered after the values they feed.
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

  // Token Overview detection (contracts only): one Multicall3 batch of
  // name()/symbol()/decimals()/totalSupply() decides token-ness and the
  // supply. EOAs (and unsettled classifications) arm nothing — zero
  // multicall, zero network. A transport-level failure stays undefined so
  // the card renders nothing rather than a wrong "not a token" verdict.
  const tokenOverviewReads = useTokenOverview(
    currentChainId,
    address,
    addressType === 'contract',
  );
  // Pure classification: null = not a token (or not settled) → no card.
  const tokenClassification = classifyTokenOverview(tokenOverviewReads);

  // Token-holdings Overview section (discovered): the scan is the
  // transfers tab's own query — the Overview piggybacks on it with the
  // SAME cache key (first page), so a scan already triggered by the tab
  // never re-runs here (in-flight sharing through the query cache).
  // Sticky arming: once the user visits the transfers tab (or presses
  // Scan in the section) the query stays armed forever; before that the
  // section shows the not-scanned hint and holds NO scan at all —
  // chainId 0 is the services' disabled-key shape (resolves undefined,
  // zero network), the same gate txTabActive uses.
  const [transfersScanned, setTransfersScanned] = useState(activityTab === 'transfers');
  useEffect(() => {
    if (activityTab === 'transfers') setTransfersScanned(true);
  }, [activityTab]);

  const holdingsQuery = useTokenTransfers(
    transfersScanned ? currentChainId : 0,
    address,
    '0',
    TRANSFER_LIMIT,
    ttWindowParam,
  );
  const holdingsTransfers = holdingsQuery.data?.transfers ?? [];

  // Token-side holders feed: a token contract gets its own scan in TOKEN
  // mode (every row's token === the viewed contract — exactly what
  // computeDiscoveredHolders aggregates). Keyed identically to the
  // transfers tab's page-1 token-mode query, so the tab's scan populates
  // the holders for free through the query cache. The PARTICIPANT rows
  // above keep feeding aggregateTokenHoldings: token-mode rows carry
  // direction 'none' (mints/burns) which the holdings nets would
  // misclassify. Same lazy gate (transfersScanned) plus the settled token
  // verdict — chainId 0 until both hold (the services' disabled-key
  // shape, zero network).
  const tokenHoldersQuery = useTokenTransfers(
    transfersScanned && tokenClassification !== null ? currentChainId : 0,
    address,
    '0',
    TRANSFER_LIMIT,
    ttWindowParam,
    'token',
  );
  // Mode guard: the result store keeps the previous settle across args
  // switches, and a participant settle must never feed the holders
  // aggregation (pre-mode legacy payloads without a mode field are
  // trusted as-is).
  const tokenHoldersData =
    tokenHoldersQuery.data?.mode === 'participant'
      ? undefined
      : tokenHoldersQuery.data;
  const tokenHoldersTransfers = tokenHoldersData?.transfers ?? [];
  // Metadata is only meaningful for the shared ERC-20/721 signature —
  // ERC-1155 rows carry their ids/amounts on the log themselves.
  const metaTokens = useMemo(
    () => [
      ...new Set(
        holdingsTransfers
          .filter(transfer => transfer.standard === 'erc20-or-erc721')
          .map(transfer => transfer.token.toLowerCase()),
      ),
    ],
    [holdingsTransfers],
  );
  const tokenMetas = useTokenMetas(currentChainId, metaTokens);

  // Shared-signature classification for the aggregator: decimals resolved
  // → ERC-20; symbol only (decimals() reverted) → ERC-721; both
  // unreadable (or still loading) → unknown (raw-magnitude fallback).
  const classifyShared = useCallback(
    (token: string): SharedTokenClass => {
      const meta = tokenMetas[token.toLowerCase()];
      if (meta?.decimals !== undefined) return 'erc20';
      if (meta?.symbol !== undefined) return 'erc721';
      return 'unknown';
    },
    [tokenMetas],
  );
  const holdings = useMemo(
    () => aggregateTokenHoldings(holdingsTransfers, classifyShared),
    [holdingsTransfers, classifyShared],
  );

  // USD estimate over the discovered ERC-20 holdings rows: prices come
  // from the browser-side DefiLlama layer in ONE batched request (≤30
  // uncached ids per GET; unknown chains/tokens never fetch). The hook
  // digests the token list itself, so the fresh map literal is safe.
  const erc20Holdings = useMemo(
    () =>
      holdings.filter(
        (holding): holding is Extract<TokenHolding, { kind: 'erc20' }> =>
          holding.kind === 'erc20',
      ),
    [holdings],
  );
  const erc20HoldingPrices = useTokenUsdPrices(
    currentChainId,
    erc20Holdings.map((holding) => holding.token),
  );
  const holdingsUsdEstimate = useMemo(
    () =>
      erc20HoldingPrices === undefined
        ? null
        : estimateHoldingsUsd(
            erc20Holdings.map((holding) => ({
              amount: holding.net,
              decimals: tokenMetas[holding.token.toLowerCase()]?.decimals,
              price: erc20HoldingPrices.get(holding.token.toLowerCase()),
            })),
          ),
    [erc20HoldingPrices, erc20Holdings, tokenMetas],
  );

  // Backend-unreachable verdict for the attribution banner below: the
  // indexed fields (verification, contract name, creator) silently
  // disappear when the persistent channel dies, so the Overview card
  // must say why instead of just omitting rows.
  const persistentOffline = isBackendUnreachable(infoQuery.error);
  const tokenIsErc20 = tokenClassification?.isErc20 === true;
  // Render-ready fields: decimals double as the holder-amount formatter
  // (only reached when isErc20, but the fallback keeps the raw units
  // honest if that invariant ever loosens).
  const tokenDecimals = tokenClassification?.decimals ?? null;
  const tokenSymbol = tokenClassification?.symbol ?? null;
  const tokenSymbolSuffix = tokenSymbol !== null ? ` ${tokenSymbol}` : '';
  // Discovered holders of the viewed token itself: net per-participant
  // balances from the token-mode scan rows (each row IS this token),
  // ERC-20 semantics only, ids excluded.
  const tokenHolders = useMemo(
    () =>
      tokenIsErc20 ? computeDiscoveredHolders(tokenHoldersTransfers, address, true) : null,
    [tokenIsErc20, tokenHoldersTransfers, address],
  );

  // --- Section-anchor presence mirrors (./sectionAnchors derivation) ---
  //
  // Known Tokens presence mirrors the component's own gate EXACTLY (same
  // shared-cache hook + cross-args guard — the labelCoverageQuery pattern:
  // ONE cache entry, zero extra requests): a curated list for the chain
  // AND a settled same-key payload. In-flight/error checks render nothing
  // in the component, so they anchor nothing here either.
  const knownTokensCurated = knownTokensForChain(currentChainId);
  const knownTokensOwner = address.trim().toLowerCase();
  const knownTokensQuery = useKnownTokenBalances(currentChainId, knownTokensOwner);
  const knownTokensData =
    knownTokensQuery.data?.chainId === currentChainId &&
    knownTokensQuery.data.address === knownTokensOwner
      ? knownTokensQuery.data
      : undefined;
  const knownTokensPresent =
    knownTokensCurated.length > 0 && knownTokensData !== undefined;

  // NFT-holdings presence mirrors NftHoldings' own gate over the SAME
  // inputs (same transfers rows, same shared metadata cache → the same
  // aggregation): nothing renders while the scan is still empty-handed
  // or when the window holds no NFT rows. `holdingsScanning` is the
  // exact expression the component's loading prop receives below.
  const holdingsScanning = holdingsQuery.loading && !holdingsQuery.data;
  const nftHoldingsAggregated = useMemo(
    () => aggregateNftHoldings(holdingsTransfers, address, classifyShared),
    [holdingsTransfers, address, classifyShared],
  );
  const nftHoldingsPresent =
    !(holdingsScanning && holdingsTransfers.length === 0) &&
    nftHoldingsAggregated.holdings.length > 0;

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

  // Method-filter chips: the DISTINCT selectors the currently loaded page
  // actually carries (rows without a selector — transfers, creations,
  // legacy payloads — contribute nothing). Pure derivation in TxFilterBar
  // so the evidence rule ("a chip is offered only for a method this
  // window's discovered set proves") is unit-testable.
  const txRowSelectorOptions = distinctRowSelectors(transactions);

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
  // Pagination math itself stays on `total` unchanged. Under active
  // filters `total` is the FILTERED count of the discovered set — the
  // "at least" floor belongs to discovery, not to the narrowing, so the
  // phrase says "matching" instead.
  const txCountPhrase = hasTxFilters
    ? `${txTotal.toLocaleString()} matching discovered transactions`
    : txCoverage === 'complete'
      ? `${txTotal.toLocaleString()} transactions`
      : `At least ${txTotal.toLocaleString()} transactions discovered`;

  // Page-level coverage aggregate (PM review: one honest chip near the
  // header instead of stacked caveat paragraphs). Pure derivation in
  // ./coverage, unit-tested there — the long per-source sentences live in
  // the badge's expandable detail; the inline caveats keep one-liners.
  const addressCoverage = deriveAddressCoverage({
    realtime: {
      loading: realTimeQuery.loading,
      failed: realTimeQuery.error !== undefined,
    },
    indexed: {
      loading: infoQuery.loading,
      failed: infoQuery.error !== undefined,
    },
    txHistory: {
      active: txScanActive,
      loading: txQuery.loading,
      failed: txQuery.error !== undefined,
      coverage: txCoverage,
      reason: txReason,
      searchWindowBlocks: txSearchWindowBlocks,
      // Additive deep-scan field off the tx payload (parsed defensively:
      // legacy payloads carry no job and leave the levels untouched).
      deepScanCoverage: scanJobFromTxPayload(txData)?.coverage,
    },
    transfersScan: {
      scanned: transfersScanned,
      loading: holdingsQuery.loading,
      failed: holdingsQuery.error !== undefined,
    },
    labels: {
      loading: labelCoverageQuery.loading,
      failed: labelCoverageQuery.error !== undefined,
    },
  });

  // In-page section-anchor chips (./sectionAnchors): Overview, Token
  // Holdings and Approvals render for every valid address; NFT/Known
  // Tokens ride the presence mirrors above; the activity chip carries the
  // ACTIVE tab's label (the other tabs' content is not in the DOM). The
  // derivation returns [] when nothing is left to jump between.
  const sectionAnchors = deriveAddressSectionAnchors(activityTab, {
    overview: true,
    approvals: true,
    tokenHoldings: true,
    nftHoldings: nftHoldingsPresent,
    knownTokens: knownTokensPresent,
  });

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <PageContainer>
        <BackButton
          onClick={() => {
            void navigate(router, `/chain/${currentChainId}`).catch(() => undefined);
          }}
        />

        <div className={addressTitleRow}>
          <PageHeader
            title={ensName ?? 'Address Details'}
            chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
            className={addressHeaderStyle}
          />
          {/* Header action family (beside the back button): QR of the
              checksummed address for wallet hand-off. */}
          <AddressQr address={address} />
        </div>

        {ensName && (
          <div className={ensHeaderRow}>
            <Badge variant="info" size="sm">
              ENS
            </Badge>
            <CopyableHash value={address} />
          </div>
        )}

        {/* One aggregated coverage chip above the cards: the per-source
            explanations expand from its ⓘ affordance, so the cards below
            keep only their mandatory one-liner caveats. */}
        <CoverageBadge
          level={addressCoverage.level}
          label={addressCoverage.label}
          detail={addressCoverage.detail}
          className={coverageBadgeRow}
        />

        {isInitialLoading && <LoadingState message="Loading address information..." />}

        {/* Real failures only: an invalid address never reaches this
            branch (the page-level validity guard above owns that
            verdict), so the raw message needs no message-sniffing. */}
        {hasError && !isInitialLoading && (
          <ErrorState message={`Error: ${errorMessage}`} />
        )}

        {!isInitialLoading && (
          <>
            {/* Sticky in-page anchor chips (derivation in
                ./sectionAnchors): the row renders only when there is
                something to jump between, and only here — before this
                point the sections it links to are not in the DOM yet. */}
            {sectionAnchors.length > 0 && <SectionAnchorNav anchors={sectionAnchors} />}
            {/* Offline attribution for the indexed fields: the persistent
                channel is down, so verification/contract-name/creator rows
                are absent BY CAUSE — say so, while the RPC-derived rows
                (balance, nonce, EOA/contract type) keep working. */}
            {persistentOffline && (
              <div className={offlineNotice} role="status">
                <Alert variant="warning">
                  Indexed address details are unavailable — the explorer&apos;s
                  indexing backend is not connected; balance, nonce and the
                  type classification below still come from the live chain
                  RPC (per-source detail in the coverage badge above).
                </Alert>
              </div>
            )}
            {/* anchor target: the Overview card (unstyled wrapper — the
                card's own margins collapse straight through it). */}
            <div id={OVERVIEW_ANCHOR_ID} className={anchorTarget}>
              <Card>
                <CardHeader>
                  <CardTitle>Overview</CardTitle>
                </CardHeader>
                <CardContent>
                  {/* Summary stats over the balance-history page's discovered
                    rows (the same cached response the chart below renders —
                    limit 50, timestamps backend-aligned): renders only when
                    that set is non-empty (clean absence otherwise); dates
                    fall back to honest block numbers when no timestamp
                    resolves. */}
                  <SummaryStatsRow
                    chainId={currentChainId}
                    address={address}
                    rows={summaryStatsRows}
                    symbol={getChainSymbol(currentChainId)}
                    decimals={chainInfo.nativeCurrency?.decimals ?? 18}
                    discoveredTotal={balanceHistoryPage?.total}
                  />
                  <InfoGrid>
                    <InfoItem label="Address">{address}</InfoItem>

                    {/* Personal annotation (backend-persisted, per chain):
                      chip + edit when set, "+ add label" when not. Always
                      offered — this is a single-user tool. */}
                    <InfoItem label="Label">
                      <AddressLabelRow chainId={currentChainId} address={address} />
                    </InfoItem>

                    {/* Browser-only annotation (localStorage, per chain):
                      same single-user invitation as the Label row, but the
                      data never leaves this browser — the editor's caveat
                      says so at the moment of typing. */}
                    <InfoItem label="Private Note">
                      <PrivateNoteChip chainId={currentChainId} address={address} />
                    </InfoItem>

                    <InfoItem label="Balance">
                      {realTimeQuery.data
                        ? `${realTimeQuery.data.balance} ${getChainSymbol(currentChainId)}`
                        : realTimeQuery.loading
                          ? 'Loading...'
                          : realTimeQuery.error
                            ? 'Error loading balance'
                            : 'N/A'}
                    </InfoItem>

                    {/* Discovered-holdings section: aggregated NET values from
                      the scanned transfers — approximations, honestly
                      labeled below the list. Before the first scan the
                      section offers the scan as a one-click affordance. */}
                    <InfoItem label="Token Holdings (discovered)">
                      {/* anchor target: the row always renders (every branch
                        of the conditional below is a present state, even
                        the not-scanned hint), so the chip always
                        resolves. The div is layout-neutral — block
                        content already lives in this value cell. */}
                      <div id={TOKEN_HOLDINGS_ANCHOR_ID} className={anchorTarget}>
                        {!transfersScanned ? (
                          <>
                            <span className={holdingsHint}>
                              Token transfers have not been scanned for this address.
                            </span>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => selectActivityTab('transfers')}
                            >
                              Scan Token Transfers
                            </Button>
                          </>
                        ) : holdingsQuery.loading && !holdingsQuery.data ? (
                          'Scanning token transfers...'
                        ) : holdingsQuery.error ? (
                          'Scan failed — see the Token Transfers tab.'
                        ) : holdings.length === 0 ? (
                          'No non-zero token holdings in the discovered transfers.'
                        ) : (
                          <>
                            <HoldingsList
                              chainId={currentChainId}
                              address={address}
                              holdings={holdings}
                              metas={tokenMetas}
                            />
                            {/* Estimated USD total over the rows that priced:
                            renders nothing until at least one price
                            landed (never a $0.00 placeholder). */}
                            {holdingsUsdEstimate !== null && (
                              <p className={holdingsEstimateStyle}>
                                Estimated value{' '}
                                <UsdValue
                                  usd={holdingsUsdEstimate.totalUsd}
                                  price={{
                                    usd: holdingsUsdEstimate.totalUsd,
                                    fetchedAt: holdingsUsdEstimate.fetchedAt,
                                  }}
                                />
                              </p>
                            )}
                            <p className={holdingsCaveat}>
                              Based on discovered transfers — may be incomplete
                              {holdingsUsdEstimate !== null &&
                                holdingsUsdEstimate.pricedTokens <
                                  holdingsUsdEstimate.erc20Tokens
                                ? ' · valued at market price where available'
                                : ''}
                            </p>
                          </>
                        )}
                      </div>
                    </InfoItem>

                    {/* Known Tokens (curated list, live balances): one cheap
                      Multicall3 batch over the per-chain known-token list —
                      fires for every address (EOA and contract alike), so
                      holdings exist on this page even before any transfer
                      scan; silent absence while in flight or on RPC
                      failure. anchor target: the bordered wrapper renders
                      only when the presence mirror above says the section
                      does (same shared-cache state), so the chip never
                      points at an empty row. */}
                    {knownTokensPresent ? (
                      <div id={KNOWN_TOKENS_ANCHOR_ID} className={anchorGridRow}>
                        <KnownTokens chainId={currentChainId} address={address} />
                      </div>
                    ) : (
                      <KnownTokens chainId={currentChainId} address={address} />
                    )}

                    {/* NFT holdings from the SAME first-page transfers scan
                      (no refetch): renders nothing when the window holds no
                      NFT rows — clean absence, never an empty-state card.
                      anchor target: same presence-mirror discipline as
                      Known Tokens above (the mirror reuses this exact
                      transfers array and loading flag). */}
                    {nftHoldingsPresent ? (
                      <div id={NFT_HOLDINGS_ANCHOR_ID} className={anchorGridRow}>
                        <NftHoldings
                          transfers={holdingsTransfers}
                          address={address}
                          chainId={currentChainId}
                          loading={holdingsScanning}
                        />
                      </div>
                    ) : (
                      <NftHoldings
                        transfers={holdingsTransfers}
                        address={address}
                        chainId={currentChainId}
                        loading={holdingsScanning}
                      />
                    )}

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
                            <TypedLink
                              to={`/chain/${currentChainId}/contract/${persistent.implementationAddress}`}
                              className={linkStyle}
                            >
                              {formatAddr(persistent.implementationAddress)}
                            </TypedLink>
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
            </div>

            {/* Cross-chain presence (bounded probe): collapsed one-line
                summary under the Overview card — balance+code reads on a
                fixed candidate set of other networks, chips expanded only
                on user intent. Self-contained: own probe, prices, states. */}
            <CrossChainStrip chainId={currentChainId} address={address} />

            {/* Token approvals (read-only erc20 approve scan): self-contained
                — own fetch/loading/error/caveat states; renders null when it
                has nothing useful to show, so it composes cleanly into the
                token area beside the discovered-holdings rows above.
                anchor target: renders for every valid address (only gated
                keys render null), so the chip always resolves. */}
            <div id={APPROVALS_ANCHOR_ID} className={anchorTarget}>
              <ApprovalSection chainId={currentChainId} address={address} />
            </div>

            {/* Balance-over-time chart: rides the same cached discovered-tx
                scan as the Transactions tab (?window= shared) and anchors to
                the LIVE RPC balance; self-gates for EOAs without history. */}
            <BalanceHistory
              className={tokenOverviewCard}
              chainId={currentChainId}
              address={address}
              currentBalance={
                realTimeQuery.data ? BigInt(realTimeQuery.data.balanceWei) : null
              }
              searchWindow={txSearchWindow}
            />

            {/* Token Overview: contracts only, and only when at least one
                token probe answered — a plain contract renders no card at
                all (silent, never an error state). Lines appear exactly
                when their probe responded; supply formats with the TOKEN's
                decimals, raw base units when decimals is unknown. */}
            {tokenClassification !== null && (
              <Card className={tokenOverviewCard}>
                <CardHeader>
                  <div className={headerRow}>
                    <CardTitle>Token Overview</CardTitle>
                    <Badge
                      variant={tokenClassification.isErc20 ? 'success' : 'warning'}
                      size="sm"
                      className={tokenBadgeStyle}
                    >
                      {tokenClassification.isErc20
                        ? 'ERC-20'
                        : 'Token (standard unknown — possibly ERC-721)'}
                    </Badge>
                    <TypedLink
                      to={`/chain/${currentChainId}/token/${address}`}
                      className={linkStyle}
                    >
                      View token page
                    </TypedLink>
                  </div>
                </CardHeader>
                <CardContent>
                  <InfoGrid>
                    {tokenClassification.name !== null && (
                      <InfoItem label="Name">{tokenClassification.name}</InfoItem>
                    )}
                    {tokenClassification.symbol !== null && (
                      <InfoItem label="Symbol">{tokenClassification.symbol}</InfoItem>
                    )}
                    {tokenClassification.decimals !== null && (
                      <InfoItem label="Decimals">
                        {tokenClassification.decimals}
                      </InfoItem>
                    )}
                    {tokenClassification.totalSupply !== null && (
                      <InfoItem label="Total Supply">
                        {formatTokenSupply(
                          tokenClassification.totalSupply,
                          tokenClassification.decimals,
                        )}
                        {tokenClassification.decimals === null && (
                          <span className={holdingsMuted}>
                            {' '}
                            (raw base units — decimals unknown)
                          </span>
                        )}
                      </InfoItem>
                    )}

                    {/* Holder balances are ERC-20 semantics — an
                        unknown-standard token renders no holder rows at
                        all instead of guessing meaning for ids/amounts. */}
                    {tokenIsErc20 && tokenHolders !== null && (
                      <InfoItem label="Top Holders (discovered)">
                        {!transfersScanned ? (
                          <>
                            <span className={holdingsHint}>
                              Holders are discovered from token transfers —
                              none have been scanned for this address yet.
                            </span>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => selectActivityTab('transfers')}
                            >
                              Scan Token Transfers
                            </Button>
                          </>
                        ) : tokenHoldersQuery.loading && !tokenHoldersData ? (
                          'Scanning token transfers...'
                        ) : tokenHoldersQuery.error ? (
                          'Scan failed — see the Token Transfers tab.'
                        ) : tokenHolders.holders.length === 0 ? (
                          'No holders discovered in the scanned transfers.'
                        ) : (
                          <>
                            {tokenHolders.holders.map(holder => (
                              <div key={holder.address} className={holderRow}>
                                <TypedLink
                                  to={`/chain/${currentChainId}/address/${holder.address}`}
                                  className={linkStyle}
                                  title={holder.address}
                                >
                                  {formatAddr(holder.address)}
                                </TypedLink>
                                <span>
                                  {tokenDecimals !== null
                                    ? formatUnits(holder.net, tokenDecimals)
                                    : holder.net.toString()}
                                  {tokenSymbolSuffix}
                                </span>
                              </div>
                            ))}
                            <p className={holdingsCaveat}>
                              Discovered via scanned transfers — may be
                              incomplete
                              {tokenHolders.excludedTransfers > 0
                                ? ` (non-ERC-20 rows excluded: ${tokenHolders.excludedTransfers.toLocaleString()})`
                                : ''}
                            </p>
                          </>
                        )}
                      </InfoItem>
                    )}
                  </InfoGrid>
                </CardContent>
              </Card>
            )}

            {/* Recent-activity card (anchor target: the id is shared by
                all three tabs — the chip's label is the ACTIVE tab's, and
                only that tab's content is in the DOM to jump to). The
                wrapper is unstyled; the card's margin-top collapses
                straight through it. */}
            <div id={ACTIVITY_ANCHOR_ID} className={anchorTarget}>
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
                    {/* CSV export (tx tab only): anchor download carrying the
                      CURRENT window param — what the list below shows is
                      what lands in the file. Disabled-with-reason while the
                      list is unsettled or the backend is unreachable. */}
                    {activityTab === 'transactions' && (
                      <a
                        className={cx(
                          exportCsvLink,
                          txExportDisabledReason !== undefined && exportCsvLinkDisabled,
                        )}
                        {...(txExportDisabledReason === undefined
                          ? { href: txExportHref, download: true }
                          : {})}
                        aria-disabled={
                          txExportDisabledReason !== undefined ? true : undefined
                        }
                        title={
                          txExportDisabledReason
                          ?? 'Download the discovered transactions as CSV'
                        }
                        data-testid="tx-export-csv"
                      >
                        Export CSV
                      </a>
                    )}
                    {/* Refresh honesty: the button refetches what the ACTIVE
                      tab shows — the tx history + the realtime balance read
                      that owns 'Last updated', the token-transfer scan
                      (through the refresh signal the transfers component
                      consumes), or the internal tab's traces (its own
                      refresh signal — the tx rows it re-reads come from the
                      shared cache). */}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        if (activityTab === 'transactions') {
                          void txQuery.refetch();
                          void realTimeQuery.refetch();
                        } else if (activityTab === 'transfers') {
                          setTransfersRefreshing(true);
                          setTransfersRefreshSignal(signal => signal + 1);
                        } else {
                          setInternalRefreshing(true);
                          setInternalRefreshSignal(signal => signal + 1);
                        }
                      }}
                      loading={
                        activityTab === 'transactions'
                          ? txQuery.fetching || realTimeQuery.fetching
                          : activityTab === 'transfers'
                            ? transfersRefreshing
                            : internalRefreshing
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
                  ) : activityTab === 'internal' ? (
                    <InternalTxns
                      chainId={currentChainId}
                      address={address}
                      /* The tx tab's OWN window rides along — no refetch
                       here; the traces read the rows the shared query
                       already settled (same key, cached). */
                      transactions={transactions}
                      txLoading={txQuery.loading}
                      txError={txQuery.error?.message}
                      txPage={txPage}
                      refreshSignal={internalRefreshSignal}
                      onRefreshed={() => setInternalRefreshing(false)}
                    />
                  ) : (
                    <>
                      {/* Indexing-scope notice (tx tab only): internal txs stay
                    outside the heuristic's reach at every coverage level —
                    the Internal Txns tab traces them on demand instead.
                    Token transfers moved to their own tab with its own
                    coverage banners; the coverage badge above carries the
                    full per-source wording (incl. the ERC-20/721/1155
                    enumeration). */}
                      <p className={tokenNotice}>
                        This list covers external transactions only — internal
                        transfers are traced in the Internal Txns tab, token
                        transfers in the Token Transfers tab.
                      </p>

                      {/* Advanced filters (tx tab only): From/To addresses,
                        Min/Max wei amounts and the Method selector,
                        URL-driven (?tfFrom= etc.) so filtered views are
                        shareable. The backend narrows the SAME cached
                        discovered set — the bar's standing scope line keeps
                        that honest. The Method field's chips offer only
                        selectors the loaded page itself carries. */}
                      <TxFilterBar
                        open={txFilterBarOpen}
                        onToggle={() => setTxFilterBarOpen(prev => !prev)}
                        values={txUrlFilterValues}
                        urlParamCount={txUrlFilterParamCount}
                        onApply={applyTxFilters}
                        onClear={clearTxFilters}
                        selectorOptions={txRowSelectorOptions}
                      />

                      {/* Deep Scan panel (tx tab only): the persistent
                        discovery job that can upgrade this list's coverage
                        from discovered to provably complete. Reads the
                        job riding this very payload (additive deepScan
                        field, parsed defensively) while its own live GET
                        settles; unmounting on tab switch also stops the
                        panel's poll cadence. */}
                      <DeepScan
                        chainId={currentChainId}
                        address={address}
                        txPayload={txData}
                      />

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

                      {/* Filtered-empty is NOT an error and NOT "no history":
                    the discovered set for this window simply holds no row
                    matching the active filters. The coverage banners above
                    keep their caveat (the window is still a partial
                    discovery), so this states only what happened. */}
                      {!txQuery.loading && !txQuery.error && hasTxFilters
                        && transactions.length === 0 && txTotal === 0 && (
                        <div data-testid="tx-filter-empty">
                          <Alert variant="info">
                            No discovered transactions in this window match the
                            current filters. Filters narrow the discovered set —
                            they never widen coverage.
                          </Alert>
                        </div>
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
            </div>
          </>
        )}
      </PageContainer>
    </>
  );
}
