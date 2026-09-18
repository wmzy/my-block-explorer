// Runtime API base URL shared by the HTTP layer, plus the localStorage
// slot for the explicitly chosen manual base.
//
// The backend is discovered at runtime (port scan / setup panel before the
// app renders data), so the base cannot be baked in at build time the way
// the painless template does. Precedence contract:
//
//   1. An explicitly stored manual base (entered in the setup panel) is
//      probed first on every startup and wins while it is alive.
//   2. The auto-scanned base (localhost:8201–8205) only fills the slot when
//      no manual base is stored or the stored one is dead — and never
//      overwrites the stored choice.
//   3. '' means "not connected": the app runs in degraded RPC-only mode
//      and backend-indexed surfaces must fail fast instead of firing a
//      request against an unintended same-origin target.

let apiBase = '';

const listeners = new Set<() => void>();

// Shared by the discovery hook (probe-on-startup) and ConnectionStatus
// (auto-reconnect health poll). Keep the literal stable: values written by
// older builds live under this key.
const MANUAL_BASE_STORAGE_KEY = 'my-block-explorer-api-url';

/** The explicitly chosen backend base, if the user ever saved one. */
export function getStoredManualBase(): string | null {
  return localStorage.getItem(MANUAL_BASE_STORAGE_KEY);
}

/** Persist an explicit (manual) backend base. It takes precedence over scans. */
export function storeManualBase(url: string): void {
  localStorage.setItem(MANUAL_BASE_STORAGE_KEY, url);
}

export function getApiBase(): string {
  return apiBase;
}

// Idempotent: re-setting the current value is a no-op and fires nothing.
export function setApiBase(url: string): void {
  if (apiBase === url) return;
  apiBase = url;
  for (const fn of listeners) {
    fn();
  }
}

// Returns the unsubscribe function.
export function onApiBaseChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
