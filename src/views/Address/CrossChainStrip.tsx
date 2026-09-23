// Cross-chain presence strip for the Address page: a bounded
// "also alive on other networks?" check under the Overview card. The
// probe (services/crossChainProbe) reads balance + code on a fixed
// candidate set through the shared cached RPC clients; this view layers
// DefiLlama spot prices on top where a chain's native coin is mapped and
// leaves everywhere else unpriced.
//
// Height contract: the strip is COLLAPSED to one quiet line until the
// user expands it — while probing it renders a single "Probing other
// networks" status line, after settling a one-line summary ("On 3 other
// networks · probing failed on 1"); the chip row only exists behind that
// intent. Honesty contract: per-chain failures render as visible
// "unavailable" chips with the reason (title), never as zero balances;
// a USD figure renders ONLY where a spot price resolved, and prices in
// different native units are never summed into a total — this is a
// presence probe, not an aggregation claim.
import { useEffect, useMemo, useState } from 'react';
import { css, cx } from '@linaria/core';
import { TypedLink } from '@native-router/react';
import { getChainInfo, getChainName, getChainSymbol } from '@/config/chains';
import {
  fetchUsdPrices,
  nativePriceId,
  tokenAmountToUsd,
  type UsdPriceSnapshot,
} from '@/services/prices';
import {
  PROBE_POPULAR_CHAIN_COUNT,
  orderProbeResults,
  probeAddressAcrossChains,
  type ProbeOutcome,
} from '@/services/crossChainProbe';
import { formatNativeTotal } from '@/views/Address/summaryStats';
import { UsdValue } from '@/components/ui/UsdValue';

// One quiet line between the Overview card and the activity area: no
// card chrome on purpose — the strip is a disclosure, not a data card.
const rootStyle = css`
  display: block;
  margin: var(--haze-space-4) 0 0;
`;

// The collapsed summary / loading line. A real button (keyboard- and
// screen-reader-reachable) styled down to a quiet text row; it never
// grows past one line, on any width.
const summaryButtonStyle = css`
  display: inline-flex;
  align-items: baseline;
  gap: var(--haze-space-2);
  max-width: 100%;
  padding: 0;
  border: none;
  background: none;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
  text-align: left;
  cursor: pointer;

  &:hover {
    color: var(--haze-color-text);
  }
`;

// The non-interactive loading line: same quiet density as the summary.
const loadingLineStyle = css`
  margin: 0;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
`;

// The 'discovered' glyph from CoverageBadge's color-independent
// vocabulary (◍ ring): the probe's finds are discovered presence, never
// a complete cross-chain history — the framing line below says so in
// words, the glyph just keeps the vocabulary consistent.
const summaryGlyphStyle = css`
  color: var(--haze-color-text-muted);
`;

// Honest framing line above the chips: one short sentence that keeps the
// bounded-probe semantics attached to the data.
const framingLineStyle = css`
  margin: var(--haze-space-2) 0 var(--haze-space-2);
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
`;

// Chip row: wraps on narrow screens (375px pass) instead of overflowing.
const chipRowStyle = css`
  display: flex;
  flex-wrap: wrap;
  gap: var(--haze-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
`;

// One chain chip: name + native balance (the chain's OWN decimals and
// symbol) + type dot + optional USD estimate.
const chipStyle = css`
  display: inline-flex;
  align-items: baseline;
  gap: var(--haze-space-2);
  max-width: 100%;
  padding: var(--haze-space-1) var(--haze-space-2);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-sm);
  font-size: var(--haze-text-sm);
  overflow-wrap: anywhere;
`;

// Successful probes are links into the probed chain's own address page.
const chipLinkStyle = css`
  color: inherit;
  text-decoration: none;

  &:hover {
    border-color: var(--haze-color-text-muted);
  }
`;

// Failed probes: visible honesty — muted, not a link (there is nothing
// on this chain the probe could read), reason in the title.
const chipFailedStyle = css`
  color: var(--haze-color-text-muted);
  background: var(--haze-color-bg-muted);
  cursor: help;
`;

// Type dot, color-independent shapes (CoverageBadge vocabulary): filled
// ● = code on that chain (contract or EIP-7702 delegated EOA), hollow ○
// = plain EOA, ✕ = the probe could not read the chain at all.
const chipDotStyle = css`
  font-size: var(--haze-text-xs);
`;

const dotContractStyle = css`
  color: var(--haze-color-text);
`;

const dotEoaStyle = css`
  color: var(--haze-color-text-muted);
`;

// Native balance text: one step up from the muted chrome so the figure
// reads as the chip's payload.
const chipBalanceStyle = css`
  color: var(--haze-color-text);
`;

// Staggered skeleton chips while (re)probing behind an already-given
// expand intent: one placeholder per popular slot, each entering the
// pulse a beat after the previous one.
const skeletonChipStyle = css`
  width: 9rem;
  height: 1.75rem;
  border-radius: var(--haze-radius-sm);
  background: var(--haze-color-bg-muted);
  animation: cross-chain-skeleton-pulse 1.4s ease-in-out infinite;

  @keyframes cross-chain-skeleton-pulse {
    0%,
    100% {
      opacity: 0.35;
    }
    50% {
      opacity: 0.7;
    }
  }
`;

// Stable identity for the "no prices yet" map — avoids a state churn
// render every effect run.
const EMPTY_PRICES: ReadonlyMap<number, UsdPriceSnapshot> = new Map();

const ok = (outcome: ProbeOutcome): outcome is Extract<ProbeOutcome, { status: 'ok' }> =>
  outcome.status === 'ok';

// "Presence" for the summary line: code on the chain, or a non-zero
// native balance. An address with neither has no footprint this
// balance+code probe can see — transaction-only activity leaves a nonce,
// which the bounded probe deliberately does not read.
const isDetected = (outcome: ProbeOutcome): boolean =>
  ok(outcome) && (outcome.isContract || outcome.balance > 0n);

export function CrossChainStrip({
  chainId,
  address,
}: {
  chainId: number;
  address: string;
}) {
  // null = probing (or no candidates yet); [] would mean "settled, zero
  // candidate chains" (clean absence).
  const [outcomes, setOutcomes] = useState<ProbeOutcome[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [spotByChain, setSpotByChain] = useState<ReadonlyMap<number, UsdPriceSnapshot>>(EMPTY_PRICES);

  useEffect(() => {
    let cancelled = false;
    setOutcomes(null);
    setSpotByChain(EMPTY_PRICES);
    // Never rejects by contract (see probeAddressAcrossChains); a chain
    // switch mid-flight only abandons the stale settle via `cancelled`.
    probeAddressAcrossChains(chainId, address as `0x${string}`).then(settled => {
      if (!cancelled) setOutcomes(settled);
    });
    return () => {
      cancelled = true;
    };
  }, [chainId, address]);

  // USD enrichment is layered AFTER the probe settles: one batched
  // DefiLlama spot request over the probed chains whose native coin is
  // mapped (nativePriceId). Unmapped chains and failed probes never
  // fetch and never render a figure — unknown stays unknown.
  useEffect(() => {
    if (outcomes === null) return;
    const idToChain = new Map<string, number>();
    for (const outcome of outcomes) {
      if (!ok(outcome)) continue;
      const coinId = nativePriceId(outcome.chainId);
      if (coinId !== null) idToChain.set(coinId, outcome.chainId);
    }
    if (idToChain.size === 0) return;
    let cancelled = false;
    // Never rejects (services/prices contract); a settled-null snapshot
    // simply stays absent from the map below.
    fetchUsdPrices([...idToChain.keys()]).then(snapshots => {
      if (cancelled) return;
      const byChain = new Map<number, UsdPriceSnapshot>();
      for (const [coinId, probedChainId] of idToChain) {
        const snapshot = snapshots.get(coinId);
        if (snapshot != null) byChain.set(probedChainId, snapshot);
      }
      setSpotByChain(byChain);
    });
    return () => {
      cancelled = true;
    };
  }, [outcomes]);

  // Display order: USD-known desc first, unknowns (unpriced AND failed)
  // after, chainId tiebreak — orderProbeResults never compares balances.
  // The usdOf closure derives each figure from that chain's OWN decimals
  // and only where a spot price resolved.
  const ordered = useMemo(() => {
    if (outcomes === null) return [];
    return orderProbeResults(outcomes, probedChainId => {
      const outcome = outcomes.find(o => o.chainId === probedChainId);
      if (outcome === undefined || !ok(outcome)) return null;
      const snapshot = spotByChain.get(probedChainId);
      if (snapshot === undefined) return null;
      return tokenAmountToUsd(
        outcome.balance,
        getChainInfo(probedChainId)?.nativeCurrency.decimals ?? 18,
        snapshot,
      );
    });
  }, [outcomes, spotByChain]);

  // Clean absence: nothing to probe (e.g. every candidate is the viewed
  // chain) — the strip renders nothing at all.
  if (outcomes !== null && outcomes.length === 0) return null;

  if (outcomes === null) {
    return (
      <section className={rootStyle} aria-label="Cross-chain presence">
        {/* One quiet line while probing; skeleton chips only where the
            user already gave expand intent (a re-probe after a chain
            switch), so the strip never pushes page height cold. */}
        {expanded ? (
          <ul className={chipRowStyle} aria-label="Probing other networks">
            {Array.from({ length: PROBE_POPULAR_CHAIN_COUNT }, (_, index) => (
              <li
                key={index}
                data-testid="cross-chain-skeleton"
                className={skeletonChipStyle}
                style={{ animationDelay: `${index * 120}ms` }}
              />
            ))}
          </ul>
        ) : (
          <p className={loadingLineStyle} role="status" data-testid="cross-chain-loading">
            Probing other networks…
          </p>
        )}
      </section>
    );
  }

  const detected = outcomes.filter(isDetected).length;
  const failed = outcomes.filter(outcome => !ok(outcome)).length;
  const summaryParts: string[] = [];
  if (detected > 0) {
    summaryParts.push(`On ${detected} other ${detected === 1 ? 'network' : 'networks'}`);
  }
  if (failed > 0) summaryParts.push(`probing failed on ${failed}`);
  if (summaryParts.length === 0) {
    summaryParts.push(`No presence detected on ${outcomes.length} other networks`);
  }

  return (
    <section className={rootStyle} aria-label="Cross-chain presence">
      <button
        type="button"
        className={summaryButtonStyle}
        aria-expanded={expanded}
        data-testid="cross-chain-summary"
        onClick={() => setExpanded(value => !value)}
      >
        <span className={summaryGlyphStyle} aria-hidden>
          ◍
        </span>
        {summaryParts.join(' · ')}
        <span aria-hidden>{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div>
          <p className={framingLineStyle}>
            Detected presence on other networks (bounded probe — not a complete
            cross-chain history)
          </p>
          <ul className={chipRowStyle}>
            {ordered.map(outcome => (
              <ProbeChip
                key={outcome.chainId}
                outcome={outcome}
                address={address}
                snapshot={spotByChain.get(outcome.chainId)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// One chain chip. Ok probes link into that chain's own address page;
// failed probes stay a muted non-link whose title carries the reason —
// visible honesty, never a hidden or zero-rendered failure.
function ProbeChip({
  outcome,
  address,
  snapshot,
}: {
  outcome: ProbeOutcome;
  address: string;
  snapshot: UsdPriceSnapshot | undefined;
}) {
  const { chainId } = outcome;
  const chainName = getChainName(chainId);

  if (!ok(outcome)) {
    return (
      <li>
        <span className={cx(chipStyle, chipFailedStyle)} title={outcome.reason}>
          <span className={chipDotStyle} aria-hidden>
            ✕
          </span>
          {chainName} · unavailable
        </span>
      </li>
    );
  }

  // The chain's OWN native units — never a hardcoded 18 (repo-verified
  // pitfall on non-18 chains).
  const decimals = getChainInfo(chainId)?.nativeCurrency.decimals ?? 18;
  const symbol = getChainSymbol(chainId);
  const usd = snapshot !== undefined ? tokenAmountToUsd(outcome.balance, decimals, snapshot) : null;

  return (
    <li>
      <TypedLink
        to={`/chain/${chainId}/address/${address}`}
        className={cx(chipStyle, chipLinkStyle)}
      >
        <span
          className={cx(chipDotStyle, outcome.isContract ? dotContractStyle : dotEoaStyle)}
          aria-hidden
        >
          {outcome.isContract ? '●' : '○'}
        </span>
        <span>{chainName}</span>
        <span className={chipBalanceStyle}>
          {formatNativeTotal(outcome.balance, decimals, symbol)}
        </span>
        {/* Renders nothing unless the spot snapshot resolved (UsdValue's
            own gating) — an unpriced chain never shows a figure. */}
        {usd !== null && <UsdValue usd={usd} price={snapshot} />}
      </TypedLink>
    </li>
  );
}
