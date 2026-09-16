// Runtime API base URL shared by the HTTP layer.
// The backend is discovered at runtime (port scan / localStorage /
// ServiceSetup gate before the app renders), so the base cannot be baked
// in at build time the way the painless template does. '' means
// same-origin (relative request URLs).

let apiBase = '';

const listeners = new Set<() => void>();

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
