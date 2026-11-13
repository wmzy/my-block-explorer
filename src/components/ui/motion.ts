// Shared motion (one-shot enters and indeterminate activity) building
// blocks, twin of skeleton.ts: linaria scopes keyframes per css block,
// so a reusable animation must ship as a class that declares BOTH the
// animation and its keyframes; site deltas then compose on top via cx.
// Distances, scales and durations are exposed as custom properties with
// the canonical defaults inline — keyframes cannot interpolate function
// parameters, so a consumer pins its exact prior visual by overriding
// the vars in its composed block instead of forking keyframes.
import { css } from '@linaria/core';

// The enter-rise shared by the ServiceSetup surfaces (the expanded
// connection panel, the setup screen's content column, the scan card):
// opacity 0 → 1 while translating up from below with a slight scale-up,
// on the same deceleration curve at every site. Defaults are the
// connection panel's own animation (0.3s, 8px, scale 0.96); the taller,
// slower sites override the --panel-enter-* vars rather than fork.
export const panelEnterBase = css`
  animation: panel-enter-rise var(--panel-enter-duration, 0.3s) cubic-bezier(0.16, 1, 0.3, 1);

  @keyframes panel-enter-rise {
    from {
      opacity: 0;
      transform: translateY(var(--panel-enter-distance, 8px))
        scale(var(--panel-enter-scale, 0.96));
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

// The indeterminate activity sweep (the scanning screen's progress
// fill): a translucent highlight gradient sliding across the element
// through an ::after overlay — "work is happening" when there is no
// N-of-M to show. The host keeps its own sizing/background; this class
// supplies the overlay (the host must be position: relative — provided),
// the sweep and the reduced-motion opt-out, where the band hides
// entirely because a frozen highlight reads as a stuck bar.
export const indeterminateSweepBase = css`
  position: relative;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      var(--haze-color-text-inverse) 50%,
      transparent 100%
    );
    animation: indeterminate-sweep 2s infinite;
  }

  @keyframes indeterminate-sweep {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    &::after {
      animation: none;
      opacity: 0;
    }
  }
`;
