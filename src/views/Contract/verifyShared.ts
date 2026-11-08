// Shared plumbing for the three in-page verify panels (Sourcify bundle,
// local compile, manual trust mark): ONE result union and ONE plain-word
// infra-failure attribution. The panels used to hand-roll both, with the
// unreachable-backend sentence duplicated verbatim in each file.

import { isBackendUnreachable } from '@/util/http';
import { ApiError } from '@/util/apiError';

/**
 * A verify panel's settled outcome. The verified payload differs per
 * panel (Sourcify reports the match status, the compile panel reports
 * tier/contract/compiler), so it arrives as the type parameter; the
 * notice/error channels are shared verbatim.
 */
export type PanelResult<TVerified extends object = { status: string }> =
  | ({ kind: 'verified' } & TVerified)
  | { kind: 'notice'; text: string }
  | { kind: 'error'; text: string };

/**
 * Infra failures get plain-word attribution: which hop was unreachable.
 * 0 (backend never answered) and the 403 admin-token gate are the shared
 * taxonomy; a panel adds its own status-specific sentence (Sourcify's
 * 502, the compile budget's 504, the manual mark's 404-on-remove) via
 * `statusText`, and picks the action-noun fallback ('Verification
 * request failed.' / 'Request failed.').
 */
export function describeSubmitError(
  error: unknown,
  options: {
    fallback: string;
    statusText?: (error: ApiError) => string | null;
  },
): string {
  if (isBackendUnreachable(error)) {
    return 'The explorer API is unreachable — start the backend (or fix its address in ⚙ RPC settings) and try again.';
  }
  if (error instanceof ApiError && error.status === 403) {
    return 'Requires admin token — set it via ⚙️ RPC → Admin token. The server must have ADMIN_TOKEN configured.';
  }
  if (error instanceof ApiError && options.statusText !== undefined) {
    const specific = options.statusText(error);
    if (specific !== null) return specific;
  }
  return error instanceof Error ? error.message : options.fallback;
}
