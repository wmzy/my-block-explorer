// Admin token for self-hosted deployments. The backend gates sensitive
// operations (rpc-config reads/writes, contract cache invalidation,
// performance tooling) behind the x-admin-token header, mirroring
// ADMIN_TOKEN on the server. Stored per browser; attached to every
// request by the http chain in util/http.ts.
const STORAGE_KEY = 'my-block-explorer-admin-token';

export function getAdminToken(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Storage unavailable (private mode): token is simply not persisted.
  }
}

export function clearAdminToken(): void {
  try {
    globalThis.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore: nothing to clear.
  }
}

export function hasAdminToken(): boolean {
  const token = getAdminToken();
  return token !== null && token !== '';
}
