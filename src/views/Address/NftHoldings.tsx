// NFT Holdings (discovered) section of the address Overview card. Pure
// presentation over rows the caller already fetched (the transfers tab's
// participant-mode scan — the same rows the Token Holdings section
// aggregates): this component never fetches. Renders NOTHING when the
// scanned window holds no NFT rows — clean absence, no empty-state card —
// and always carries the scan-window caveat when it does render.
import { useCallback, useMemo } from 'react';
import { css } from '@linaria/core';
import { TypedLink } from '@native-router/react';
import type { TokenTransfer } from '@/services/tokenTransfers';
import { useTokenMetas } from '@/views/Address/TokenTransfers';
import type { SharedTokenClass } from '@/views/Address/holdings';
import { aggregateNftHoldings, type NftContractHolding } from '@/views/Address/nftHoldings';
import { InfoItem } from '@/components/ui/InfoGrid';
import { Badge } from '@/components/ui/Badge';
import { linkStyle } from '@/components/ui/DataTable';

// One contract block: head line (link + standard badge + held count) and
// a muted meta line beneath. Rows right-align into the InfoItem value
// column on desktop and left-align when the card stacks at phone width.
const nftRow = css`
  margin-bottom: var(--haze-space-2);

  &:last-child {
    margin-bottom: 0;
  }
`;

const nftRowHead = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--haze-space-1) var(--haze-space-2);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);

  @media (max-width: 768px) {
    justify-content: flex-start;
  }
`;

const nftRowMeta = css`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--haze-space-1) var(--haze-space-2);
  margin-top: var(--haze-space-1);
  color: var(--haze-color-text-muted);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);

  @media (max-width: 768px) {
    justify-content: flex-start;
  }
`;

// Completeness caveat: must render with every list — discovered NFT
// holdings are a partial scan, never a claim of full holdings.
const nftCaveat = css`
  margin: var(--haze-space-2) 0 0;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

// Note for shared-signature rows whose standard stayed unresolved — the
// section never silently drops what it could not classify.
const nftNote = css`
  margin: var(--haze-space-1) 0 0;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

// Clamp disclosure for negative in-window nets (see nftHoldings.ts).
const nftInconsistent = css`
  color: var(--haze-color-warning);
`;

const shortAddress = (a: string) => (a ? `${a.slice(0, 8)}...${a.slice(-6)}` : 'N/A');

// Long token ids (uint256 scale) get a head/tail cut; the row's title
// attribute carries the full sample ids.
const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-8)}` : id);

/** Exact held-count copy: '3 token ids' vs '2 ids · 12 units total'. */
function heldCountText(holding: NftContractHolding): string {
  if (holding.standard === 'erc721') {
    return `${holding.heldCount} token ${holding.heldCount === 1 ? 'id' : 'ids'}`;
  }
  // Raw base units with grouping separators — never an invented decimal
  // interpretation (ERC-1155 decimals are not read anywhere here).
  return `${holding.heldCount} ${holding.heldCount === 1 ? 'id' : 'ids'} · ${holding.totalUnits.toLocaleString()} units total`;
}

function NftContractRow({ chainId, holding }: { chainId: number; holding: NftContractHolding }) {
  return (
    <div className={nftRow}>
      <div className={nftRowHead}>
        <TypedLink
          to={`/chain/${chainId}/contract/${holding.contract}`}
          className={linkStyle}
          title={holding.contract}
        >
          {shortAddress(holding.contract)}
        </TypedLink>
        <Badge variant="default" size="sm">
          {holding.standard === 'erc721' ? 'ERC-721' : 'ERC-1155'}
        </Badge>
        <span>{heldCountText(holding)}</span>
      </div>
      <div className={nftRowMeta}>
        {holding.sampleIds.length > 0 && (
          <span title={holding.sampleIds.join(', ')}>
            {holding.sampleIds.map(shortId).join(', ')}
            {holding.heldCount > holding.sampleIds.length
              ? ` +${holding.heldCount - holding.sampleIds.length} more`
              : ''}
          </span>
        )}
        <span>last activity block {holding.lastActivityBlock.toLocaleString()}</span>
        {holding.standard === 'erc1155' && holding.dataInconsistent && (
          <span className={nftInconsistent}>
            more units sent than received within the window — affected ids shown as not held
          </span>
        )}
      </div>
    </div>
  );
}

export type NftHoldingsProps = {
  /** Participant-mode transfer rows the caller already fetched. */
  transfers: readonly TokenTransfer[];
  /** The viewed address (checksummed or lowercase — compared loosely). */
  address: string;
  chainId: number;
  /** True while the caller's scan is in flight without rows yet. */
  loading: boolean;
};

export default function NftHoldings({ transfers, address, chainId, loading }: NftHoldingsProps) {
  // Shared-signature tokens (ERC-20/721) need metadata classification.
  // useTokenMetas rides the SAME module-level cache the transfers tab and
  // the Token Holdings section use, so tokens they already resolved cost
  // nothing here; entries stay undefined while loading → 'unknown' → the
  // rows count as unclassified until the shared cache settles.
  const metaTokens = useMemo(
    () => [
      ...new Set(
        transfers
          .filter(transfer => transfer.standard === 'erc20-or-erc721')
          .map(transfer => transfer.token.toLowerCase()),
      ),
    ],
    [transfers],
  );
  const tokenMetas = useTokenMetas(chainId, metaTokens);
  const classifyShared = useCallback(
    (token: string): SharedTokenClass => {
      const meta = tokenMetas[token.toLowerCase()];
      if (meta?.decimals !== undefined) return 'erc20';
      if (meta?.symbol !== undefined) return 'erc721';
      return 'unknown';
    },
    [tokenMetas],
  );
  const aggregated = useMemo(
    () => aggregateNftHoldings(transfers, address, classifyShared),
    [transfers, address, classifyShared],
  );

  // Clean absence in both nothing-yet states: first scan still in flight,
  // and a settled scan with no NFT rows (ERC-20-only windows included —
  // never an empty-state card).
  if (loading && transfers.length === 0) return null;
  if (aggregated.holdings.length === 0) return null;

  return (
    <InfoItem label="NFT Holdings (discovered)">
      <div>
        {aggregated.holdings.map(holding => (
          <NftContractRow
            key={`${holding.standard}:${holding.contract.toLowerCase()}`}
            chainId={chainId}
            holding={holding}
          />
        ))}
        {aggregated.unclassifiedTransfers > 0 && (
          <p className={nftNote}>
            {aggregated.unclassifiedTransfers} transfer
            {aggregated.unclassifiedTransfers === 1 ? '' : 's'} with unresolved token standard
            (ERC-20 vs ERC-721) excluded.
          </p>
        )}
        <p className={nftCaveat}>
          Discovered from the scanned transfer window — may be incomplete.
        </p>
      </div>
    </InfoItem>
  );
}
