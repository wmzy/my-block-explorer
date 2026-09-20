import { bannerStyle, bannerMessageStyle, bannerDismissStyle } from './bannerStyles';
import { Button } from '@/components/ui/Button';

type DegradedModeBannerProps = {
  onOpenSetup: () => void;
  onDismiss: () => void;
};

// Top strip shown when the app runs without a backend (all discovery probes
// failed). RPC-backed pages keep working; only indexed surfaces are down.
// Dismissal is per-session (in-memory in DiscoveryGate) so a reload always
// re-shows the banner.
export function DegradedModeBanner({ onOpenSetup, onDismiss }: DegradedModeBannerProps) {
  return (
    <div className={bannerStyle} role="status" aria-live="polite">
      <span className={bannerMessageStyle}>
        Backend not found — indexed data (contracts, events, search suggestions)
        unavailable.
      </span>
      <Button variant="secondary" size="sm" onClick={onOpenSetup}>
        Open setup
      </Button>
      <button type="button" className={bannerDismissStyle} aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
