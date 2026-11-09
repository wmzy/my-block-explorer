// Admin token for self-hosted deployments. The backend gates sensitive
// operations (rpc-config reads/writes, contract cache invalidation,
// performance tooling) behind the x-admin-token header, mirroring
// ADMIN_TOKEN on the server. Stored per browser; attached to every
// request by the http chain in util/http.ts. Storage access goes through
// the guarded helpers (util/storageAccess.ts): private-mode failures
// degrade to "no token" / "not persisted", never a throw.
import {
  readStorageItem,
  removeStorageItem,
  writeStorageItem,
} from '@/util/storageAccess';
import { ADMIN_TOKEN_STORAGE_KEY as STORAGE_KEY } from '@/util/storageKeys';

export function getAdminToken(): string | null {
  return readStorageItem(STORAGE_KEY);
}

export function setAdminToken(token: string): void {
  writeStorageItem(STORAGE_KEY, token);
}

export function clearAdminToken(): void {
  removeStorageItem(STORAGE_KEY);
}

export function hasAdminToken(): boolean {
  const token = getAdminToken();
  return token !== null && token !== '';
}
