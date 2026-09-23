// NFT Holdings (discovered) section of the address Overview card.
// Presentation over rows the caller already fetched (the transfers tab's
// participant-mode scan — the same rows the Token Holdings section
// aggregates): the component never fetches transfers itself. The only
// network it does is the lazy per-item metadata preview (first 24 owned
// items: name + thumbnail via the nftMetadata service), which never
// blocks the rows. Renders NOTHING when the scanned window holds no NFT
// rows — clean absence, no empty-state card — and always carries the
// scan-window caveat when it does render.
import { useCallback, useMemo, useState } from 'react';
import { css, cx } from '@linaria/core';
import { TypedLink } from '@native-router/react';
import type { TokenTransfer } from '@/services/tokenTransfers';
import {
  nftMetadataKey,
  useNftMetadata,
  type NftMetadataItem,
  type NftMetadataOutcome,
} from '@/services/nftMetadata';
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

// How many owned items get lazy metadata previews (name + thumbnail).
// Purely a display cap: the discovered-holdings rows above stay complete.
const NFT_METADATA_PREVIEW_LIMIT = 24;

// Per-item metadata preview strip inside one contract row: thumbnails +
// names for resolved items, ordered like the holdings rows. Mirrors the
// row's right-align/desktop, left-align/phone stacking.
const nftItemStrip = css`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--haze-space-1) var(--haze-space-2);
  margin-top: var(--haze-space-2);

  @media (max-width: 768px) {
    justify-content: flex-start;
  }
`;

// One preview chip: 44px thumbnail + truncated name (full name in the
// title attribute). Max-width keeps one long name from monopolizing the
// strip; the name clips with an ellipsis.
const nftItemChip = css`
  display: inline-flex;
  align-items: center;
  gap: var(--haze-space-1);
  max-width: 14rem;
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
`;

const nftItemName = css`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const nftThumb = css`
  width: 44px;
  height: 44px;
  border-radius: var(--haze-radius-sm, 4px);
  object-fit: cover;
  flex-shrink: 0;
`;

// Muted placeholder when the item has no image or the image failed to
// load — never a broken-image glyph.
const nftThumbPlaceholder = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--haze-color-text-muted);
  background: var(--haze-color-bg-subtle);
  border: 1px solid var(--haze-color-border);
`;

// Metadata-slot skeleton: opacity-pulse only (compositor-friendly, same
// convention as the Home feed skeletons). Rendered solely while the
// metadata batch is in flight — the rows above never block on it.
const nftThumbShimmer = css`
  background: var(--haze-color-border);
  animation: nft-metadata-pulse 1.4s ease-in-out infinite;

  @keyframes nft-metadata-pulse {
    0%,
    100% {
      opacity: 1;
    }

    50% {
      opacity: 0.35;
    }
  }
`;

// Muted per-item note when metadata could not be fetched (transport
// failure) — retryable, so it never claims the item has no metadata.
const nftItemUnavailable = css`
  display: inline-flex;
  align-items: center;
  align-self: center;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
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

// Thumbnail with honest degradation: no image (or an unresolvable one)
// and load failures both land on a muted placeholder icon — never a
// broken-image glyph. The failed state is sticky per mount.
function NftItemThumb({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (src === null || failed) {
    return (
      <span
        className={cx(nftThumb, nftThumbPlaceholder)}
        title={failed ? 'image failed to load' : 'no image'}
        aria-hidden="true"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" />
          <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" />
          <path d="M2.5 12.2 6.5 8.2l3 3 2-2 2.9 2.9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <img
      className={nftThumb}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Per-item metadata preview strip for one contract row. `metadata` is
 * undefined while the batch resolves → shimmer placeholders confined to
 * this slot; the surrounding rows render and settle independently.
 * Outcome honesty: 'ok' renders thumbnail + name (name omitted when the
 * item genuinely has none), 'unavailable' renders a muted retryable note,
 * 'none' renders NOTHING — the row's sample-id display already covers
 * items without metadata.
 */
function NftItemPreviews({
  items,
  metadata,
}: {
  items: readonly NftMetadataItem[];
  metadata: Map<string, NftMetadataOutcome> | undefined;
}) {
  if (items.length === 0) return null;

  if (metadata === undefined) {
    return (
      <div className={nftItemStrip}>
        {items.map(item => (
          <span key={item.tokenId} className={cx(nftThumb, nftThumbShimmer)} aria-hidden="true" />
        ))}
      </div>
    );
  }

  return (
    <div className={nftItemStrip}>
      {items.map(item => {
        const outcome = metadata.get(nftMetadataKey(item.contract, item.tokenId));
        if (outcome?.status === 'ok') {
          return (
            <span key={item.tokenId} className={nftItemChip} data-testid="nft-item-chip">
              <NftItemThumb src={outcome.image} alt={outcome.name ?? `token ${item.tokenId}`} />
              {outcome.name !== null && (
                <span className={nftItemName} title={outcome.name}>
                  {outcome.name}
                </span>
              )}
            </span>
          );
        }
        if (outcome?.status === 'unavailable') {
          return (
            <span key={item.tokenId} className={nftItemUnavailable} title={`token ${item.tokenId}`}>
              metadata unavailable
            </span>
          );
        }
        // 'none' (or a missing entry): nothing extra — the sample ids above
        // already display these items.
        return null;
      })}
    </div>
  );
}

function NftContractRow({
  chainId,
  holding,
  previewItems,
  metadata,
}: {
  chainId: number;
  holding: NftContractHolding;
  previewItems: readonly NftMetadataItem[];
  metadata: Map<string, NftMetadataOutcome> | undefined;
}) {
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
      <NftItemPreviews items={previewItems} metadata={metadata} />
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

  // Metadata preview window: the first NFT_METADATA_PREVIEW_LIMIT owned
  // items across the holdings (holdings order, ascending id order within
  // each). totalOwnedItems counts everything held, so the view can
  // disclose the cap instead of implying completeness.
  const preview = useMemo(() => {
    const items: NftMetadataItem[] = [];
    const byContract = new Map<string, NftMetadataItem[]>();
    let totalOwnedItems = 0;
    for (const holding of aggregated.holdings) {
      totalOwnedItems += holding.heldCount;
      if (items.length >= NFT_METADATA_PREVIEW_LIMIT) continue;
      const ids =
        holding.standard === 'erc721'
          ? holding.heldIds
          : holding.balances.map(balance => balance.tokenId);
      const own: NftMetadataItem[] = [];
      for (const tokenId of ids) {
        if (items.length >= NFT_METADATA_PREVIEW_LIMIT) break;
        const item: NftMetadataItem = {
          contract: holding.contract,
          tokenId,
          standard: holding.standard,
        };
        items.push(item);
        own.push(item);
      }
      byContract.set(holding.contract.toLowerCase(), own);
    }
    return { items, byContract, totalOwnedItems };
  }, [aggregated]);

  // Lazy per-item resolution riding the service's module cache; never
  // blocks the rows above (skeletons live inside the metadata slot only).
  const nftMetadata = useNftMetadata(chainId, preview.items);

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
            previewItems={preview.byContract.get(holding.contract.toLowerCase()) ?? []}
            metadata={nftMetadata}
          />
        ))}
        {preview.totalOwnedItems > preview.items.length && (
          <p className={nftNote}>
            showing first {NFT_METADATA_PREVIEW_LIMIT} of{' '}
            {preview.totalOwnedItems.toLocaleString()} held items
          </p>
        )}
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
