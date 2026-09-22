// Address-label service (frontend): the user's personal annotation for an
// address, persisted through the backend (GET open; PUT/DELETE admin-token
// gated — the token rides along automatically via util/http's based()).
//
// Result semantics (honesty rules):
// - A settled result carries the (chainId, address) it was fetched for:
//   the query layer's result store keeps the previous settle across args
//   switches, so the view MUST guard on the embedded key before rendering
//   — otherwise navigating between addresses flashes the previous label
//   (same rationale as services/gasHistory.ts).
// - `undefined` means "no label set" (the API's 404 normalized to absence)
//   or "not settled yet"; the view distinguishes the two via loading.
// - Write helpers reject with ApiError: status 403 means the admin token
//   is missing/wrong (the view offers the settings hint), anything else is
//   a plain failure (the view keeps the editor open with the error shown).
import { api, get, put, del, withSignal } from '@/util/http';
import { ApiError } from '@/util/apiError';
import { bindQueryFn, createQueryCache, createQueryHook } from '@/util/useQuery';

/** A saved label exactly as the API stores it (note is null when absent). */
export type AddressLabelResult = {
  chainId: number;
  /** lowercase address key the label belongs to */
  address: string;
  label: string;
  note: string | null;
  /**
   * Row provenance: 'builtin' = bundled seed, 'user' = operator-authored.
   * An older backend without the field degrades to 'user'.
   */
  source: 'builtin' | 'user';
};

type LabelResponse = { label?: unknown; note?: unknown; source?: unknown };

// Shape guard for the API body: label is a non-empty string, note is a
// string or null. Anything else degrades to a thrown ApiError instead of
// rendering fabricated data. The source field is optional on the wire —
// anything but 'builtin' reads as 'user' (forward/backward compatible).
const parseLabelResponse = (
  body: LabelResponse,
  chainId: number,
  address: string,
): AddressLabelResult => {
  if (typeof body.label !== 'string' || body.label === '') {
    throw new ApiError('Malformed label response', 0);
  }
  const note = typeof body.note === 'string' ? body.note : null;
  const source = body.source === 'builtin' ? 'builtin' : 'user';
  return { chainId, address, label: body.label, note, source };
};

/**
 * Fetch the label for (chainId, address). A 404 settles as undefined —
 * "no label" is a valid state, not an error. All other failures reject
 * (the query layer surfaces them to the view's error branch).
 */
export async function fetchAddressLabel(
  chainId: number,
  address: string,
  signal?: AbortSignal,
): Promise<AddressLabelResult | undefined> {
  if (chainId <= 0 || address === '') return undefined;
  const lower = address.toLowerCase();
  try {
    const body = await get<LabelResponse>(
      `/api/chains/${chainId}/labels/${lower}`,
      undefined,
      withSignal(api, signal),
    );
    return parseLabelResponse(body, chainId, lower);
  }
  catch (error) {
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}

export const addressLabelCache = createQueryCache<AddressLabelResult | undefined, [
  number,
  string,
]>('address-label');

const queryAddressLabel = bindQueryFn(fetchAddressLabel, addressLabelCache);

const useAddressLabelQuery = createQueryHook({ queryFn: queryAddressLabel });

/** Read hook for the Address Overview's label row. */
export function useAddressLabel(chainId: number, address: string) {
  // Lowercase key: the same address in different checksum casings is one
  // storage key server-side, so it must be one cache entry client-side.
  return useAddressLabelQuery([chainId, address.toLowerCase()]);
}

/**
 * Upsert the label (full replace — an omitted/null note clears it, matching
 * the route's PUT semantics). Rejects with ApiError; status 403 = admin
 * token missing/invalid.
 */
export async function saveAddressLabel(
  chainId: number,
  address: string,
  label: string,
  note: string | null,
): Promise<AddressLabelResult> {
  const lower = address.toLowerCase();
  const body = await put<LabelResponse>(`/api/chains/${chainId}/labels/${lower}`, {
    label,
    note,
  });
  return parseLabelResponse(body, chainId, lower);
}

/**
 * Remove the label. Rejects with ApiError on failure (404 = nothing was
 * set — callers typically treat that as success-adjacent and refresh).
 */
export async function deleteAddressLabel(chainId: number, address: string): Promise<void> {
  await del(`/api/chains/${chainId}/labels/${address.toLowerCase()}`);
}

// True when a settled label result belongs to exactly this (chainId,
// address) pair — the guard every render-site must apply before reading a
// label out of the query store (cross-args settle protection).
export function labelMatchesTarget(
  result: AddressLabelResult | undefined,
  chainId: number,
  address: string,
): boolean {
  return (
    result?.chainId === chainId && result.address === address.toLowerCase()
  );
}
