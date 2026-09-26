import { useEffect } from 'react';
import { useState } from 'react';
import { css } from '@linaria/core';
import { Dialog } from 'haze-ui';
import { useControl } from 'react-use-control';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { checksummedAddressOrNull } from '@/util/privateNotes';

// Header icon button: the same family as the page's back button (bordered
// subtle square), just icon-sized so it reads as a header action.
const qrButton = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  flex-shrink: 0;
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  background: var(--haze-color-bg-subtle);
  color: var(--haze-color-text-muted);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: var(--haze-color-bg-muted);
    color: var(--haze-color-text);
  }
`;

const dialogStyle = css`
  width: min(360px, 90vw);
`;

// The QR plate: white on purpose regardless of theme — scanners need the
// contrast, and the quiet zone is part of the symbol.
const qrPlate = css`
  display: flex;
  justify-content: center;
  padding: var(--haze-space-3);
  background: #ffffff;
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
`;

// The payload itself, readable under the symbol (the address a scanner
// receives — plain hex, not an EIP-681 URI).
const qrAddress = css`
  margin: var(--haze-space-3) 0 0;
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  overflow-wrap: anywhere;
  text-align: center;
`;

const qrActions = css`
  display: flex;
  justify-content: center;
  margin-top: var(--haze-space-3);
`;

const qrError = css`
  margin: var(--haze-space-4) 0;
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-muted);
  text-align: center;
`;

// Minimal QR corner-square glyph (drawn, not a font emoji, so it matches
// the header's icon weight on every platform).
function QrIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="5" height="5" rx="0.5" />
      <rect x="10" y="1" width="5" height="5" rx="0.5" />
      <rect x="1" y="10" width="5" height="5" rx="0.5" />
      <path d="M10 10h1.6v1.6H10zM13.4 10H15M10 13.4h1.6M13.4 13.4H15v1.6h-1.6z" />
    </svg>
  );
}

/**
 * The address QR affordance for the Address page header: an icon button
 * that opens the explorer's standard Dialog (haze-ui — native
 * `<dialog>`: Escape and backdrop click both close it) showing a QR of
 * the CHECKSUMMED address — the plain hex string, deliberately NOT an
 * EIP-681 payment URI (this explorer is read-only; a wallet that scans
 * it simply opens the account). The QR renders as an inline SVG produced
 * by the `qrcode` package's pure string renderer — no canvas involved,
 * so the same code path works in every browser and in tests — with a
 * copy-address button as the fallback for screens a camera cannot reach.
 *
 * The open state is a react-use-control Control, not a plain boolean:
 * haze-ui's Dialog treats a plain VALUE prop as the initial value only
 * (useControl seeds useState from it and never follows later changes —
 * see react-use-control's useControl). A Control shares the state itself,
 * so every open/false flip reaches the dialog. RpcConfig works the same
 * way (its parent passes a Control).
 */
export function AddressQr({ address }: { address: string }) {
  const [open, setOpen, openControl] = useControl(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The QR payload: EIP-55 checksummed form of the page address (null
  // would mean an invalid address — the Address page gates those out, and
  // this component never renders a symbol for something it cannot spell).
  const payload = checksummedAddressOrNull(address);

  useEffect(() => {
    if (!open || payload === null) return;
    let cancelled = false;
    setSvg(null);
    setError(null);
    QRCode.toString(payload, { type: 'svg', margin: 2, width: 232 })
      .then(markup => {
        if (!cancelled) setSvg(markup);
      })
      .catch(err => {
        if (!cancelled) {
          setError(
            `The QR code could not be generated — ${
              err instanceof Error ? err.message : 'unknown error'
            }. Copy the address below instead.`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, payload]);

  if (payload === null) return null;

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      toast('Address copied to clipboard!', { duration: 2000 });
    } catch {
      toast('Failed to copy address', { duration: 2000 });
    }
  };

  return (
    <>
      <button
        type="button"
        className={qrButton}
        onClick={() => setOpen(true)}
        aria-label="Show QR code for this address"
        title="Show QR code for this address"
        data-testid="address-qr-button"
      >
        <QrIcon />
      </button>
      <Dialog
        open={openControl}
        onClose={() => setOpen(false)}
        title="Scan to open in a wallet"
        className={dialogStyle}
      >
        <div className={qrPlate} data-testid="address-qr-plate">
          {svg !== null && <div role="img" aria-label={`QR code for ${payload}`} dangerouslySetInnerHTML={{ __html: svg }} />}
        </div>
        {error !== null && (
          <p className={qrError} data-testid="address-qr-error" role="alert">
            {error}
          </p>
        )}
        <p className={qrAddress} data-testid="address-qr-payload">
          {payload}
        </p>
        <div className={qrActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void copyAddress()}
            data-testid="address-qr-copy"
          >
            Copy address
          </Button>
        </div>
      </Dialog>
    </>
  );
}
