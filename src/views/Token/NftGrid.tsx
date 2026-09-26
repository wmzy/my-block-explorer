// Items (discovered) grid of the token page: the distinct NFT items the
// page's token-mode scan rows evidenced (see ./nftItems), as tiles with
// lazy per-item metadata through the nftMetadata service. The service's
// honesty states ARE the tile states: 'ok' renders image + name (each
// degrading honestly when the metadata genuinely lacks it — a failed
// image load lands on a muted placeholder, never a broken-image glyph),
// 'none' renders an id-only tile with a "no metadata" chip (a definitive
// answer — not retryable), and 'unavailable' renders an id-only tile
// with an "unavailable" chip plus a per-tile retry (transport failures
// are never cached by the service, so a retry is a genuine
// re-resolution of that one item). Clicking a tile copies its token id
// — no navigation; the tile's title carries the full id. The mandatory
// caveat renders in every non-empty state: this is a discovery grid
// over a scanned window, never the collection's supply.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css, cx } from '@linaria/core';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import {
  fetchNftMetadataBatch,
  nftMetadataKey,
  useNftMetadata,
  type NftMetadataItem,
  type NftMetadataOutcome,
} from '@/services/nftMetadata';
import { NFT_ITEMS_LIMIT, type NftItem } from './nftItems';

export type NftGridProps = {
  chainId: number;
  /** The NFT contract (any spelling — the service lowercases its keys). */
  contract: string;
  /** Derivation output (see deriveNftItems); non-empty by contract. */
  items: readonly NftItem[];
};

// Same spacing as the page's other cards (index.tsx's cardMargin twin —
// that one is module-private, so each card keeps its own).
const sectionMargin = css`
  margin-top: var(--haze-space-5);
`;

// Completeness caveat (index.tsx's caveat twin): discovered items are a
// partial scan, never a claim of the collection.
const caveat = css`
  margin: var(--haze-space-2) 0 0;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

// Responsive tile wrap: auto-fill between 136px and 160px keeps a 2-
// column minimum at 375px (287px of card-content width holds two 136px
// tiles plus the 8px gap) and grows to ~6 columns on desktop.
const tileGrid = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(136px, 160px));
  gap: var(--haze-space-2);
`;

// One tile: quiet surface, hover lift on the clickable affordance. The
// metadata slot (image + name) sits above the always-present id line so
// id-only tiles never change height when metadata settles.
const tile = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
  min-width: 0;
  padding: var(--haze-space-2);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  background: var(--haze-color-bg-subtle);
  cursor: pointer;
  text-align: left;

  &:hover {
    border-color: var(--haze-color-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--haze-color-primary);
    outline-offset: 1px;
  }
`;

// The image slot: square, covering — 136–160px per the grid track, so
// never a letterboxed or distorted thumbnail.
const tileImage = css`
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: var(--haze-radius-md);
  display: block;
`;

// Muted placeholder when the item has no image or the image failed to
// load — never a broken-image glyph.
const tileImagePlaceholder = css`
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--haze-color-text-muted);
  background: var(--haze-color-bg-muted);
`;

// Metadata-slot skeleton while the batch resolves: opacity-pulse only
// (compositor-friendly, the Home feed skeletons' convention).
const tileImageShimmer = css`
  background: var(--haze-color-bg-muted);
  animation: nft-tile-pulse 1.4s ease-in-out infinite;

  @keyframes nft-tile-pulse {
    0%,
    100% {
      opacity: 1;
    }

    50% {
      opacity: 0.35;
    }
  }
`;

// One-line tile name; the title attribute carries the full text.
const tileName = css`
  font-size: var(--haze-text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

// The token id line — an identifier, so mono (the truncated-hash
// convention's font). Holds one line at any id length.
const tileId = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

// Transient copy confirmation in place of the id prefix.
const tileCopied = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-success);
`;

// Quiet metadata chips: "no metadata" (definitive) and "metadata
// unavailable" (retryable) — muted, never an error red, because neither
// is a failure of the page.
const tileChip = css`
  align-self: flex-start;
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  background: var(--haze-color-bg-muted);
  border-radius: var(--haze-radius-full);
  padding: 0 var(--haze-space-2);
`;

// The 1155 amount line (net mint/burn of the window) and the burned
// marker for ids whose net went below zero (floored at 0 — never a
// fabricated supply).
const tileAmount = css`
  font-size: var(--haze-text-xs);
`;

const tileBurned = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-warning);
`;

// Per-tile retry for the 'unavailable' state: a real button (the tile
// itself is a div, so nesting stays valid HTML), sized to the chip row.
const retryButton = css`
  align-self: flex-start;
  font-size: var(--haze-text-xs);
  padding: 0 var(--haze-space-2);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-full);
  background: var(--haze-color-bg);
  color: var(--haze-color-text-muted);
  cursor: pointer;

  &:hover {
    border-color: var(--haze-color-primary);
    color: var(--haze-color-text);
  }

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
`;

// Long ids (uint256 scale) get a head/tail cut inside the tile; the
// tile's title carries the full id (twin of NftHoldings's shortId).
const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-8)}` : id);

// Image with honest degradation: no image, an unresolvable one, or a
// load failure all land on the muted placeholder. The failed state is
// sticky per mount (retrying the <img> adds noise, not honesty).
function TileImage({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (src === null || failed) {
    return (
      <span
        className={cx(tileImage, tileImagePlaceholder)}
        title={failed ? 'image failed to load' : 'no image'}
        aria-hidden="true"
      >
        <svg width="24" height="24" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" />
          <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" />
          <path d="M2.5 12.2 6.5 8.2l3 3 2-2 2.9 2.9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <img
      className={tileImage}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      data-testid="nft-tile-image"
    />
  );
}

type NftTileProps = {
  item: NftItem;
  contract: string;
  /** The service outcome for this tile, once the batch has landed. */
  outcome: NftMetadataOutcome | undefined;
  /** Per-tile retry handler for the 'unavailable' state. */
  onRetry: (item: NftMetadataItem) => void;
  /** True while THIS tile's retry request is in flight. */
  retrying: boolean;
};

function NftTile({ item, contract, outcome, onRetry, retrying }: NftTileProps) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  // Never leave a pending copy-confirmation timer behind on unmount.
  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const copyId = () => {
    const write = navigator.clipboard?.writeText?.(item.tokenId);
    if (write !== undefined) {
      // The confirmation appears only on a real copy; a clipboard
      // denial simply stays quiet (never a false "copied").
      void write.then(() => {
        setCopied(true);
        if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
      }).catch(() => undefined);
    }
  };

  const idText = `#${shortId(item.tokenId)}`;

  return (
    <div
      className={tile}
      role="button"
      tabIndex={0}
      data-testid="nft-item-tile"
      data-token-id={item.tokenId}
      data-standard={item.standard}
      title={`token id ${item.tokenId} — click to copy the id`}
      aria-label={`token id ${item.tokenId}, copy the id`}
      onClick={copyId}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          copyId();
        }
      }}
    >
      {outcome === undefined ? (
        // Batch in flight: the metadata slot shimmers; the id line is
        // row-derived and never blocks.
        <span className={cx(tileImage, tileImageShimmer)} aria-hidden="true" />
      ) : outcome.status === 'ok' ? (
        <>
          <TileImage src={outcome.image} alt={outcome.name ?? `token ${item.tokenId}`} />
          {outcome.name !== null && (
            <span className={tileName} title={outcome.name} data-testid="nft-tile-name">
              {outcome.name}
            </span>
          )}
        </>
      ) : outcome.status === 'none' ? (
        <span
          className={tileChip}
          data-testid="nft-tile-chip-none"
          title="the contract has no resolvable metadata URI for this token id"
        >
          no metadata
        </span>
      ) : (
        <span
          className={tileChip}
          data-testid="nft-tile-chip-unavailable"
          title="metadata could not be fetched (transport failure) — retryable"
        >
          metadata unavailable
        </span>
      )}

      {outcome?.status === 'unavailable' && (
        <button
          type="button"
          className={retryButton}
          data-testid="nft-tile-retry"
          disabled={retrying}
          onClick={event => {
            event.stopPropagation(); // the tile's copy click must not fire
            onRetry({ contract, tokenId: item.tokenId, standard: item.standard });
          }}
        >
          {retrying ? 'retrying…' : 'retry'}
        </button>
      )}

      <span className={tileId} data-testid="nft-tile-id">
        {copied ? <span className={tileCopied}>copied ✓</span> : idText}
      </span>

      {item.standard === 'erc1155' &&
        (item.burned || item.amount > 0n) &&
        (item.burned ? (
          <span
            className={cx(tileAmount, tileBurned)}
            data-testid="nft-tile-burned"
            title="more units burned than minted within the scanned window — net floored at 0"
          >
            burned
          </span>
        ) : (
          <span
            className={tileAmount}
            data-testid="nft-tile-amount"
            title="net units minted within the scanned window (mints minus burns)"
          >
            × {item.amount.toLocaleString()}
          </span>
        ))}
    </div>
  );
}

const UNAVAILABLE_OUTCOME: NftMetadataOutcome = Object.freeze({ status: 'unavailable' });

export default function NftGrid({ chainId, contract, items }: NftGridProps) {
  const metadataItems = useMemo<NftMetadataItem[]>(
    () => items.map(item => ({ contract, tokenId: item.tokenId, standard: item.standard })),
    [items, contract],
  );
  const metadata = useNftMetadata(chainId, metadataItems);

  // Per-tile retry results override the hook's batch map for their tile
  // only; one retry in flight at a time keeps the fan-out honest.
  const [retries, setRetries] = useState<ReadonlyMap<string, NftMetadataOutcome>>(
    () => new Map(),
  );
  const [retryingKey, setRetryingKey] = useState<string | null>(null);

  const retry = useCallback(
    (retryItem: NftMetadataItem) => {
      if (retryingKey !== null) return;
      const key = nftMetadataKey(retryItem.contract, retryItem.tokenId);
      setRetryingKey(key);
      // fetchNftMetadataBatch never rejects (the service's contract) and
      // does not cache 'unavailable' outcomes — this is a genuine
      // re-resolution of the one item, definitive outcomes landing on
      // the service cache for the whole page.
      void fetchNftMetadataBatch(chainId, [retryItem]).then(batch => {
        const outcome = batch.get(key) ?? UNAVAILABLE_OUTCOME;
        setRetries(prev => {
          const next = new Map(prev);
          next.set(key, outcome);
          return next;
        });
        setRetryingKey(null);
      });
    },
    [chainId, retryingKey],
  );

  return (
    <Card className={sectionMargin}>
      <CardHeader>
        <CardTitle>Items (discovered)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={tileGrid}>
          {items.map(item => {
            const key = nftMetadataKey(contract, item.tokenId);
            return (
              <NftTile
                key={item.tokenId}
                item={item}
                contract={contract}
                outcome={retries.get(key) ?? metadata?.get(key)}
                onRetry={retry}
                retrying={retryingKey === key}
              />
            );
          })}
        </div>
        <p className={caveat} data-testid="nft-items-caveat">
          Showing up to {NFT_ITEMS_LIMIT} items discovered from scanned transfers — not the
          full collection supply.
        </p>
      </CardContent>
    </Card>
  );
}
