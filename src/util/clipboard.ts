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
