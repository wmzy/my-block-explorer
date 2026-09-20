import { bannerStyle, bannerMessageStyle, bannerDismissStyle } from './bannerStyles';

type SwitchedBackendBannerProps = {
  /** The stored manual base whose health probe failed. */
  configured: string;
  /** The scanned base actually serving this session. */
  using: string;
  onDismiss: () => void;
};

// Top strip shown while the session runs on a scanned localhost backend
// because the stored manual one failed its probe. The app is connected,
// but indexed data comes from a different backend than the configured
// one, which the silent fallback would otherwise hide. Dismissal is
// per-session (in-memory in DiscoveryGate); the stored choice itself is
// never touched from here.
export function SwitchedBackendBanner({
  configured,
  using,
  onDismiss,
}: SwitchedBackendBannerProps) {
  return (
    <div className={bannerStyle} role="status" aria-live="polite">
      <span className={bannerMessageStyle}>
        Configured backend {configured} is unreachable — using {using} instead.
        Indexed data (contracts, events) may differ between backends.
      </span>
      <button type="button" className={bannerDismissStyle} aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
