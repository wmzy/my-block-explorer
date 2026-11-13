import { useState, useEffect, useCallback, useRef } from 'react';
import { css, cx } from '@linaria/core';
import { toast } from 'haze-ui';
import { get, post } from '@/util/http';
import { ApiError } from '@/util/apiError';
import { useClickOutside } from '@/util/useClickOutside';

type DetectedIde = {
  id: string;
  displayName: string;
};

const buttonStyles = css`
  padding: 6px 12px;
  background: var(--haze-color-bg);
  color: var(--haze-color-text);
  border: 1px solid var(--haze-color-border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
  font-family: inherit;
  white-space: nowrap;
`;

// Transient success tint while the open request is confirmed.
const openedStyles = css`
  color: var(--haze-color-success);
  border-color: var(--haze-color-success);
  background: var(--haze-color-success-subtle);
`;

const dropdownWrapStyles = css`
  position: relative;
`;

const dropdownMenuStyles = css`
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  min-width: 140px;
  z-index: 10;
  overflow: hidden;
`;

const dropdownItemStyles = css`
  display: block;
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--haze-color-text);
  background: none;
  border: none;
  border-bottom: 1px solid var(--haze-color-border);
  cursor: pointer;
  text-align: left;
  font-family: inherit;

  &:hover {
    background: var(--haze-color-bg-muted);
  }
`;

// "Open in IDE" action: detected IDEs come from the backend, opening fires
// the write-side POST. Zero IDEs (or a failed detection) renders nothing —
// the action is impossible without a local IDE, and honest absence beats a
// permanently disabled button; one renders a direct action, several a
// dropdown.
export function OpenInIdeButton({ chainId, address }: { chainId: number; address: string }) {
  const [detectedIdes, setDetectedIdes] = useState<DetectedIde[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The Contract route reuses this component across contracts (params
    // change without a remount), so an in-flight detection can be left
    // behind. Without a cancelled guard a slow response for the PREVIOUS
    // address could land last and repaint the button with that contract's
    // IDEs — clicking it would then POST this address into the other
    // contract's IDE. Same guard the other async effects in views/ use.
    let cancelled = false;
    get<{ ides?: DetectedIde[] }>(`/api/chains/${chainId}/contracts/${address}/ides`)
      .then(data => {
        if (!cancelled) setDetectedIdes(data.ides ?? []);
      })
      .catch(() => {
        if (!cancelled) setDetectedIdes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [chainId, address]);

  useClickOutside(dropdownRef, () => setDropdownOpen(false), { enabled: dropdownOpen });

  const handleOpen = useCallback(
    async (ideId: string) => {
      setDropdownOpen(false);
      setOpening(true);
      setOpened(false);

      try {
        await post(`/api/chains/${chainId}/contracts/${address}/open-in-ide`, { ide: ideId });
        setOpened(true);
        setTimeout(() => setOpened(false), 2000);
      } catch (error) {
        // Remote users hit this when no local IDE bridge answers: surface
        // the failure instead of swallowing it. A 403 is the admin-token
        // gate on the write endpoint: same guidance as the clear-cache
        // 403 — the browser has no token set while the server requires
        // ADMIN_TOKEN.
        if (error instanceof ApiError && error.status === 403) {
          toast.danger(
            'Failed to open in IDE: requires admin token — set it via ⚙️ RPC → Admin token. The server must have ADMIN_TOKEN configured.',
          );
        } else {
          toast.danger(
            error instanceof Error && error.message
              ? `Failed to open in IDE: ${error.message}`
              : 'Failed to open in IDE. Please check that your IDE is running.',
          );
        }
      } finally {
        setOpening(false);
      }
    },
    [chainId, address],
  );

  if (detectedIdes.length === 0) {
    return null;
  }

  if (detectedIdes.length === 1) {
    return (
      <button
        className={cx(buttonStyles, opened && openedStyles)}
        onClick={() => handleOpen(detectedIdes[0].id)}
        disabled={opening}
      >
        {opening ? 'Opening...' : opened ? 'Opened!' : `Open in ${detectedIdes[0].displayName}`}
      </button>
    );
  }

  return (
    <div ref={dropdownRef} className={dropdownWrapStyles}>
      <button
        className={cx(buttonStyles, opened && openedStyles)}
        onClick={() => setDropdownOpen(prev => !prev)}
        disabled={opening}
      >
        {opening ? 'Opening...' : opened ? 'Opened!' : 'Open in IDE ▾'}
      </button>
      {dropdownOpen && (
        <div className={dropdownMenuStyles}>
          {detectedIdes.map(ide => (
            <button
              key={ide.id}
              className={dropdownItemStyles}
              onClick={() => handleOpen(ide.id)}
            >
              {ide.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
