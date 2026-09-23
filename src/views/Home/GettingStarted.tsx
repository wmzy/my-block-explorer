// First-run onboarding card for the three run modes (see
// docs/INSTALLATION.md "Three ways to run it"). Mounted by the Landing
// view at '/': while no backend was discovered and the user has not
// dismissed the guide, Landing holds its chain redirect so the card is
// actually readable; dismissal (or a backend connecting mid-session)
// releases the redirect. The card itself is presentational — visibility
// lives in the pure helpers below so the matrix is unit-testable.
import { css } from '@linaria/core';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import type { DiscoveryStatus } from '@/hooks/useAutoDiscovery';

// localStorage flag: '1' means the user dismissed the guide for good.
export const ONBOARDING_DISMISSED_KEY = 'be:onboardingDismissed';

// The command the setup ecosystem agrees on (SetupRequiredScreen's npx
// tab shows the same string); single-sourced here for the Copy button
// and the tests that pin it.
export const GETTING_STARTED_COMMAND = 'npx my-block-explorer --port 8201';

export const GETTING_STARTED_DOCS_URL =
  'https://github.com/wmzy/my-block-explorer/blob/main/docs/INSTALLATION.md';

export type GettingStartedVisibility = {
  /** null while discovery is still running — the card must not flash. */
  backendConnected: boolean | null;
  dismissed: boolean;
};

// Pure visibility derivation: the guide shows exactly when discovery has
// SETTLED with no backend (false, not the still-scanning null) and the
// persistent dismissal flag is unset. Everything else hides it.
export function shouldShowGettingStarted({
  backendConnected,
  dismissed,
}: GettingStartedVisibility): boolean {
  return backendConnected === false && !dismissed;
}

// Maps the discovery lifecycle onto the tri-state the visibility rule
// needs: 'found' → connected, 'idle'/'discovering' → still unknown (the
// DiscoveryGate keeps children unmounted while scanning, so Landing only
// ever sees the settled states — null is the belt-and-suspenders path),
// 'not-found'/'error' → no backend either way.
export function backendConnectedFromStatus(status: DiscoveryStatus): boolean | null {
  if (status === 'found') return true;
  if (status === 'idle' || status === 'discovering') return null;
  return false;
}

// Storage helpers isolated for testability (injectable storage). A read
// failure degrades to "not dismissed" — storage-unavailable browsers
// keep seeing the guide rather than having it vanish permanently.
export function readOnboardingDismissed(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(ONBOARDING_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeOnboardingDismissed(
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    storage.setItem(ONBOARDING_DISMISSED_KEY, '1');
  } catch {
    // Storage unavailable (private mode): dismissal lasts for this
    // session only, via the caller's component state.
  }
}

type GettingStartedProps = {
  /** Persist the dismissal flag and hide the card. */
  onDismiss: () => void;
};

// One line per run mode — the honest summary of what each mode gets
// (details and verification live in docs/INSTALLATION.md). Names are
// pinned by the tests so the copy cannot silently drift from the docs.
const RUN_MODES = [
  {
    name: 'RPC-only (no backend)',
    description:
      'Browse blocks, transactions, balances, gas and charts straight from public RPCs — nothing to install.',
  },
  {
    name: 'Local backend',
    description:
      'One local command also unlocks event indexing, labels, verified contracts and storage layouts.',
  },
  {
    name: 'Shared deployment',
    description:
      'Serve one backend to many browsers with ADMIN_TOKEN, a CORS allowlist and Docker.',
  },
] as const;

const containerStyle = css`
  /* Same full-viewport centering as the SetupRequiredScreen overlay this
     card sits beside in the first-run flow (the degraded-mode banner
     stays on top of both — established gate z-ordering). */
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--haze-space-4);
  background: var(--haze-color-bg);
`;

const contentWrapperStyle = css`
  width: 100%;
  max-width: 560px;
`;

const cardContentStyle = css`
  padding: var(--haze-space-8);
`;

const headerRowStyle = css`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--haze-space-4);
  margin-bottom: var(--haze-space-6);
`;

const titleStyle = css`
  font-size: var(--haze-text-2xl, 24px);
  font-weight: var(--haze-weight-bold);
  color: var(--haze-color-text);
  margin: 0 0 var(--haze-space-2) 0;
  letter-spacing: -0.02em;
`;

const subtitleStyle = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
  margin: 0;
  line-height: var(--haze-leading-relaxed);
`;

const closeStyle = css`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
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

const modesStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-3);
  list-style: none;
  margin: 0 0 var(--haze-space-6) 0;
  padding: 0;
`;

const modeItemStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
  padding: var(--haze-space-3) var(--haze-space-4);
  background: var(--haze-color-bg-subtle);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
`;

const modeNameStyle = css`
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text);
`;

const modeDescriptionStyle = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
  line-height: var(--haze-leading-relaxed);
`;

const commandRowStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  margin-bottom: var(--haze-space-6);
`;

const commandStyle = css`
  flex: 1;
  min-width: 0;
  padding: var(--haze-space-2) var(--haze-space-3);
  background: var(--haze-color-bg-muted);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  font-family: var(--haze-font-mono, monospace);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  overflow-x: auto;
  white-space: nowrap;
`;

const footerRowStyle = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--haze-space-3);
`;

const docsStyle = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);

  a {
    color: var(--haze-color-primary);
  }
`;

export function GettingStarted({ onDismiss }: GettingStartedProps) {
  const [copied, setCopied] = useState(false);

  // Copy pattern shared with SetupRequiredScreen: async clipboard write,
  // transient "Copied!" feedback, silent degradation when the clipboard
  // is unavailable.
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(GETTING_STARTED_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Silent fail - clipboard may be unavailable
    }
  }, []);

  return (
    <div className={containerStyle}>
      <div className={contentWrapperStyle}>
        <Card>
          <CardContent className={cardContentStyle}>
            <div className={headerRowStyle}>
              <div>
                <h1 className={titleStyle}>Three ways to run this explorer</h1>
                <p className={subtitleStyle}>
                  No local backend detected yet — the explorer is already browsing your
                  chain through its public RPC. A local backend adds the indexed
                  features.
                </p>
              </div>
              {/* Same dismiss path as "Don't show again": one mechanism,
                  both controls persist the flag. */}
              <button
                type="button"
                className={closeStyle}
                aria-label="Close getting started"
                onClick={onDismiss}
              >
                ×
              </button>
            </div>

            <ul className={modesStyle}>
              {RUN_MODES.map(mode => (
                <li key={mode.name} className={modeItemStyle}>
                  <span className={modeNameStyle}>{mode.name}</span>
                  <span className={modeDescriptionStyle}>{mode.description}</span>
                </li>
              ))}
            </ul>

            <div className={commandRowStyle}>
              <code className={commandStyle}>{GETTING_STARTED_COMMAND}</code>
              <Button variant="ghost" size="sm" onClick={handleCopy}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>

            <div className={footerRowStyle}>
              <span className={docsStyle}>
                Full setup guide:{' '}
                <a href={GETTING_STARTED_DOCS_URL} target="_blank" rel="noreferrer">
                  docs/INSTALLATION.md
                </a>
              </span>
              <Button variant="secondary" size="sm" onClick={onDismiss}>
                Don't show again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
