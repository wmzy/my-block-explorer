// Shared skeleton (first-load placeholder) building blocks. Linaria
// scopes keyframes per css block, so a reusable pulse must ship as a
// class that declares BOTH the animation and its keyframes; size and
// surface deltas then compose on top via cx (the Home feed skeleton
// convention). A parameterized pulse factory is not an option — wyw-in-js
// rejects interpolating function parameters into css templates — so each
// genuinely different pulse cadence is its own named export.
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
// thumbs and the token page's NFT tiles. Those two sites lay it over
// different backgrounds, so this class carries the pulse only.
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
`;
