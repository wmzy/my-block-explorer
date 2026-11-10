import { toast } from 'haze-ui';

// Clipboard write with a legacy execCommand fallback. The async Clipboard
// API is only available in secure contexts — plain-http on a LAN hostname
// is the common local-explorer case — and can still be rejected by
// permission policy or a focus race. execCommand is deprecated but stays
// the only copy path there; the boolean return lets callers report the
// honest outcome instead of guessing.

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or the write lost focus — try the legacy path.
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    // Off-screen and invisible: iOS scrolls to focused inputs and a
    // visible helper would flash a second copy of the payload.
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    let ok = false;
    try {
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
    } finally {
      // The helper must never leak into the DOM, even when execCommand
      // throws (older engines mark it unimplemented).
      textarea.remove();
    }
    return ok;
  } catch {
    return false;
  }
}

// Copy + toast feedback: the shared tail every toast-reporting copy
// affordance composes (RawDataBlock, CopyableHash, AddressQr) — write to
// the clipboard, then surface the honest outcome as a 2s toast and hand
// the boolean back for callers that also track state. Wording stays
// per-site because the PM copy genuinely differs: the generic cells say
// "Copied to clipboard!", the QR dialog says "Address copied to
// clipboard!" and ships its success as an info toast — so the defaults
// carry the shared wording and the QR site overrides both messages plus
// the success channel via copiedKind.
export type ToastCopyOptions = {
  /** Success wording; defaults to the shared "Copied to clipboard!". */
  copied?: string;
  /** Failure wording; defaults to the shared "Failed to copy". */
  failed?: string;
  /** Success toast channel: 'success' (default) or the QR dialog's 'info'. */
  copiedKind?: 'success' | 'info';
};

export async function toastCopy(text: string, opts: ToastCopyOptions = {}): Promise<boolean> {
  const ok = await copyText(text);
  const duration = 2000;
  if (ok) {
    const copied = opts.copied ?? 'Copied to clipboard!';
    if (opts.copiedKind === 'info') {
      toast.info(copied, { duration });
    } else {
      toast(copied, { variant: 'success', duration });
    }
  } else {
    toast(opts.failed ?? 'Failed to copy', { variant: 'danger', duration });
  }
  return ok;
}
