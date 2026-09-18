import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { DiscoveryStatus } from '@/hooks/useAutoDiscovery';
import { DEFAULT_PORTS } from '@/hooks/useAutoDiscovery';
import { DegradedModeBanner } from './DegradedModeBanner';
import { ScanningScreen } from './ScanningScreen';
import { SetupRequiredScreen } from './SetupRequiredScreen';

type DiscoveryGateProps = {
  status: DiscoveryStatus;
  error: string | null;
  isScanning: boolean;
  setApiUrl: (url: string) => Promise<boolean>;
  discover: () => void;
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
//   found        → app only
//   not found    → app in degraded mode + persistent dismissible banner;
//                  "Open setup" reveals the setup screen (npx instructions,
//                  manual URL form, retry) as an overlay
//
// Connecting mid-session (manual URL or a successful retry) simply flips
// the incoming status to 'found' — the gate subscribes to nothing else,
// so the banner disappears without remounting the app.
export function DiscoveryGate({
  status,
  error,
  isScanning,
  setApiUrl,
  discover,
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

  if (!settled) {
    return <ScanningScreen ports={DEFAULT_PORTS} />;
  }

  const showBanner = !isConnected && !dismissed;
  const showSetupPanel = !isConnected && setupOpen;

  return (
    <>
      {showBanner && (
        <DegradedModeBanner
          onOpenSetup={() => setSetupOpen(true)}
          onDismiss={() => setDismissed(true)}
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
