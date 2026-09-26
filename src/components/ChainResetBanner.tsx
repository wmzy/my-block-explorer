// Dev-chain reset banner (PM-review P0): rendered from the Home page,
// it compares the live head against this browser's stored high-water
// mark for the chain (services/chainReset.ts) and, when the head went
// backwards past the reorg threshold, offers one-click clearing of the
// explorer's chain-scoped cached-immutable entries. Copy follows the
// honesty contract: the suspicion is named as a suspicion ("looks
// like"), the scope of the clear is stated, and nothing claims more
// knowledge than the head regression itself provides.
import { useState } from 'react';
import { css } from '@linaria/core';
import { Alert } from 'haze-ui';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/util/apiError';
import {
  acknowledgeChainReset,
  clearChainCachedData,
  dismissChainReset,
  isResetDismissed,
  useChainResetDetection,
  type ClearedChainCacheData,
  type StoredChainHead,
} from '@/services/chainReset';

// Same guidance the other gated writes give (403 = the browser has no or
// a wrong token while the server requires ADMIN_TOKEN — util/http already
// attached whatever this browser stores).
const ADMIN_TOKEN_GUIDANCE
  = 'Requires admin token — set it via ⚙ RPC → Admin token. The server must have ADMIN_TOKEN configured.';

const bannerRow = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--haze-space-3);
  margin-bottom: var(--haze-space-6);
`;

const bannerText = css`
  flex: 1 1 320px;
  min-width: 0;
`;

const bannerActions = css`
  display: flex;
  gap: var(--haze-space-2);
  flex-shrink: 0;
`;

const noteStyle = css`
  margin-top: var(--haze-space-2);
  font-size: var(--haze-font-size-sm, 0.875rem);
`;

export type ChainResetBannerProps = {
  chainId: number;
  /** The page's live head (null while feeds load observes nothing). */
  head: bigint | null;
};

/**
 * Pure visibility verdict for the banner: a suspicion with a readable
 * baseline that was not dismissed for THIS regression. Exported so tests
 * pin the exact logic the component applies.
 */
export function shouldShowResetBanner(
  suspected: boolean,
  storedHead: StoredChainHead | null,
  chainId: number,
): boolean {
  return (
    suspected
    && storedHead !== null
    && !isResetDismissed(chainId, storedHead.blockNumber)
  );
}

/**
 * Pure copy for the banner. The lead sentence is the pinned PM-review
 * copy; the detail stays honest — a head regression is evidence of a
 * reset, not proof, and the caches "may" be stale until refetched.
 */
export function chainResetCopy(storedBlockNumber: number, currentHead: number | null): {
  lead: string;
  detail: string;
} {
  const headMove
    = currentHead === null
      ? ''
      : ` The head moved backwards (block ${storedBlockNumber.toLocaleString()} → ${currentHead.toLocaleString()}), which usually means the node was reset (anvil/hardhat).`;
  return {
    lead: 'This chain looks like it was reset — cached contract data may be stale.',
    detail:
      `${headMove} Cached contract sources and storage layouts for this chain were fetched before the reset and may describe contracts that no longer exist.`
      + ' Clearing drops this explorer\u2019s cached-immutable entries for this chain; they are refetched on demand. Already-indexed event data is kept.',
  };
}

export function ChainResetBanner({ chainId, head }: ChainResetBannerProps) {
  const { suspected, storedHead } = useChainResetDetection(chainId, head);
  // Session-local hide for the Dismiss click; the durable part is the
  // head-keyed localStorage mark (a fresh regression re-arms the banner).
  const [hidden, setHidden] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState<ClearedChainCacheData | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (hidden || !shouldShowResetBanner(suspected, storedHead, chainId)) {
    return null;
  }
  // Narrowing guard only — shouldShowResetBanner already requires a
  // baseline whenever the suspicion is on.
  if (storedHead === null) return null;

  const handleClear = async () => {
    setClearing(true);
    setError(null);
    try {
      const counts = await clearChainCachedData(chainId);
      setCleared(counts);
      // Re-baseline the stored head to what the chain now reports, so
      // detection stops firing for this regression (and a future reset,
      // measured against the NEW high-water mark, re-arms the banner).
      acknowledgeChainReset(chainId, head === null ? storedHead.blockNumber : Number(head));
      toast.success(
        `Cleared ${counts.contractSources} cached contract source${
          counts.contractSources === 1 ? '' : 's'
        } and ${counts.storageLayouts} storage layout${
          counts.storageLayouts === 1 ? '' : 's'
        } — they will be refetched on demand.`,
      );
    }
    catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError(`${e.message} — ${ADMIN_TOKEN_GUIDANCE}`);
      }
      else if (e instanceof ApiError) {
        setError(e.message);
      }
      else {
        setError(
          'Could not clear the cached data — the explorer API is unreachable or returned an error.',
        );
      }
    }
    finally {
      setClearing(false);
    }
  };

  const handleDismiss = () => {
    dismissChainReset(chainId, storedHead.blockNumber);
    setHidden(true);
  };

  const copy = chainResetCopy(storedHead.blockNumber, head === null ? null : Number(head));

  return (
    <Alert variant="warning" data-testid="chain-reset-banner">
      <div className={bannerRow}>
        <div className={bannerText} data-testid="chain-reset-body">
          <span data-testid="chain-reset-lead">{copy.lead}</span>
          <div className={noteStyle}>{copy.detail}</div>
          {cleared !== null && (
            <div className={noteStyle} data-testid="chain-reset-cleared-note">
              Cleared {cleared.contractSources} contract source
              {cleared.contractSources === 1 ? '' : 's'} and {cleared.storageLayouts} storage
              layout{cleared.storageLayouts === 1 ? '' : 's'} for this chain — they will be
              refetched on demand.
            </div>
          )}
          {error !== null && (
            <div className={noteStyle} data-testid="chain-reset-error">
              {error}
            </div>
          )}
        </div>
        <div className={bannerActions}>
          <Button
            variant="danger"
            size="sm"
            loading={clearing}
            disabled={cleared !== null}
            onClick={() => {
              void handleClear();
            }}
            data-testid="chain-reset-clear"
          >
            Clear cached data
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            data-testid="chain-reset-dismiss"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </Alert>
  );
}
