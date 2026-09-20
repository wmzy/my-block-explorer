import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { DiscoveryStatus, ManualBaseFallback } from '@/hooks/useAutoDiscovery';
import { DEFAULT_PORTS } from '@/hooks/useAutoDiscovery';
import { DegradedModeBanner } from './DegradedModeBanner';
import { ScanningScreen } from './ScanningScreen';
import { SetupRequiredScreen } from './SetupRequiredScreen';
import { SwitchedBackendBanner } from './SwitchedBackendBanner';

type DiscoveryGateProps = {
  status: DiscoveryStatus;
  error: string | null;
  isScanning: boolean;
  setApiUrl: (url: string) => Promise<boolean>;
  discover: () => void;
  /**
   * Truthy when the stored manual base failed its probe and the session
   * runs on a scanned base instead (see useAutoDiscovery). Drives the
   * switched-backend warning banner while connected.
   */
  switchedFromManual?: ManualBaseFallback | null;
  /**
   * The app itself. RPC-backed pages (blocks, transactions, addresses)
   * work without the backend, so children render in degraded mode too —
   * only indexed surfaces show their own per-page error states.
   */
  children: ReactNode;
};

// Entry gate for the service-discovery lifecycle:
//
//   first run    → full-screen ScanningScreen until the probes settle
//   found        → app only; plus the switched-backend banner when the
//                  session fell back from a dead stored manual base
//   not found    → app in degraded mode + persistent dismissible banner;
//                  "Open setup" reveals the setup screen (npx instructions,
//                  manual URL form, retry) as an overlay
//
// Connecting mid-session (manual URL or a successful retry) simply flips
// the incoming status to 'found' — the gate subscribes to nothing else,
// so the banners disappear without remounting the app.
export function DiscoveryGate({
  status,
  error,
  isScanning,
  setApiUrl,
  discover,
  switchedFromManual = null,
  children,
}: DiscoveryGateProps) {
  // Latch: once the first discovery run settles (found / not-found /
  // error), the app is up for the rest of the session. Later re-scans
  // (retry, reconnect) must never yank the user back to the full-screen
  // scanning gate.
  const [settled, setSettled] = useState(
    () => status !== 'idle' && status !== 'discovering',
  );
  useEffect(() => {
    if (status !== 'idle' && status !== 'discovering') setSettled(true);
  }, [status]);

  const isConnected = status === 'found';

  // Banner dismissal is in-memory only (nothing persisted), so a reload
  // always shows the banner again. Connecting resets it so a later
  // disconnect re-warns.
  const [dismissed, setDismissed] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  useEffect(() => {
    if (isConnected) {
      setDismissed(false);
      setSetupOpen(false);
    }
  }, [isConnected]);

  // Switched-backend banner: session-scoped dismissal keyed by the
  // configured→using pair. The same situation re-rendered (or re-detected
  // by a later reconnect) stays dismissed, while a genuinely different
  // fallback later in the session warns again.
  const switchedKey = switchedFromManual
    ? `${switchedFromManual.configured}→${switchedFromManual.using}`
    : null;
  const [dismissedSwitchedKey, setDismissedSwitchedKey] = useState<string | null>(
    null,
  );

  if (!settled) {
    return <ScanningScreen ports={DEFAULT_PORTS} />;
  }

  const showBanner = !isConnected && !dismissed;
  const showSetupPanel = !isConnected && setupOpen;
  // Only meaningful while actually connected to the fallback: after a
  // disconnect the degraded-mode banner above tells the real story.
  const showSwitchedBanner =
    switchedKey !== null && isConnected && dismissedSwitchedKey !== switchedKey;

  return (
    <>
      {showBanner && (
        <DegradedModeBanner
          onOpenSetup={() => setSetupOpen(true)}
          onDismiss={() => setDismissed(true)}
        />
      )}
      {showSwitchedBanner && switchedFromManual && (
        <SwitchedBackendBanner
          configured={switchedFromManual.configured}
          using={switchedFromManual.using}
          onDismiss={() => setDismissedSwitchedKey(switchedKey)}
        />
      )}
      {showSetupPanel && (
        <SetupRequiredScreen
          error={error}
          isConnecting={isScanning}
          onSetApiUrl={setApiUrl}
          onDiscover={discover}
          onClose={() => setSetupOpen(false)}
        />
      )}
      {children}
    </>
  );
}
