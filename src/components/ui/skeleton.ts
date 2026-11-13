// Shared skeleton (first-load placeholder) building blocks. Linaria
// scopes keyframes per css block, so a reusable pulse must ship as a
// class that declares BOTH the animation and its keyframes; size and
// surface deltas then compose on top via cx (the Home feed skeleton
// convention). A parameterized pulse factory is not an option — wyw-in-js
// rejects interpolating function parameters into css templates — so each
// genuinely different animation is its own named export.
import { css } from '@linaria/core';

// Shared placeholder surface with the feed pulse (1.4s, full opacity
// dipping to 0.4) and the reduced-motion opt-out. The pulse animates
// opacity only, so it stays on the compositor (no layout work) and reads
// as a steady shimmer instead of a flicker. Keyframes are defined exactly
// once here; every skeleton size composes onto this base via cx.
export const skeletonBase = css`
  display: inline-block;
  background: var(--haze-color-border);
  border-radius: var(--haze-radius-sm, 4px);
  animation: home-skeleton-pulse 1.4s ease-in-out infinite;

  @keyframes home-skeleton-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

// Metadata-slot shimmer pulse (1.4s, full opacity dipping to 0.35): the
// byte-identical animation shared by the address page's NFT holdings
// thumbs, the token page's NFT tiles and every chart-shaped first-load
// placeholder. Those sites lay it over different backgrounds, so this
// class carries the pulse and the reduced-motion opt-out only.
export const shimmerPulse = css`
  animation: nft-shimmer-pulse 1.4s ease-in-out infinite;

  @keyframes nft-shimmer-pulse {
    0%,
    100% {
      opacity: 1;
    }

    50% {
      opacity: 0.35;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

// Wide-row placeholder shimmer (1.2s): a highlight gradient sweeping
// across the surface via background-position — the approvals-table
// convention. Genuinely different from the opacity pulses above (it
// animates background-position, not opacity), so it ships as its own
// class per this file's one-animation-per-export rule, gradient surface
// and reduced-motion opt-out included.
export const shimmerSweep = css`
  background: linear-gradient(
    90deg,
    var(--haze-color-bg-subtle) 25%,
    var(--haze-color-bg-muted) 50%,
    var(--haze-color-bg-subtle) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-sweep 1.2s ease-in-out infinite;

  @keyframes skeleton-sweep {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;
