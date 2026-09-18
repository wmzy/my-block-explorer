import { css } from '@linaria/core';
import { Button } from '@/components/ui/Button';

type DegradedModeBannerProps = {
  onOpenSetup: () => void;
  onDismiss: () => void;
};

// Top strip shown when the app runs without a backend (all discovery probes
// failed). RPC-backed pages keep working; only indexed surfaces are down.
// Dismissal is per-session (in-memory in DiscoveryGate) so a reload always
// re-shows the banner.
const bannerStyle = css`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--haze-space-3) var(--haze-space-4);
  padding: var(--haze-space-3) var(--haze-space-10);
  background: var(--haze-color-warning-subtle, #fef3c7);
  border-bottom: 1px solid var(--haze-color-warning, #d97706);
  color: var(--haze-color-text);
  box-shadow: var(--haze-shadow-md);
`;

const messageStyle = css`
  font-size: var(--haze-text-sm);
  line-height: var(--haze-leading-relaxed);
  color: var(--haze-color-text);
`;

const dismissStyle = css`
  position: absolute;
  top: 50%;
  right: var(--haze-space-3);
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--haze-radius-sm);
  background: transparent;
  color: var(--haze-color-text-secondary);
  font-size: var(--haze-text-lg);
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--haze-color-bg-muted);
    color: var(--haze-color-text);
  }
`;

export function DegradedModeBanner({ onOpenSetup, onDismiss }: DegradedModeBannerProps) {
  return (
    <div className={bannerStyle} role="status" aria-live="polite">
      <span className={messageStyle}>
        Backend not found — indexed data (contracts, events, search suggestions)
        unavailable.
      </span>
      <Button variant="secondary" size="sm" onClick={onOpenSetup}>
        Open setup
      </Button>
      <button type="button" className={dismissStyle} aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
