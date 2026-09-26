import { z } from 'zod';
import {
  clampInternalTxDepth,
  DEFAULT_INTERNAL_TX_DEPTH,
} from '@/utils/internalTxScan';
import { checkAddressValidity } from './addressValidity';

// The address page's URL-driven state, shared by every writer on the page
// (the view for the tx tab and the active-tab switch, TokenTransfers for
// its own pagination and scan window). ONE schema is load-bearing:
// useSetSearch serializes the schema's OUTPUT, so a writer validating
// against a narrower schema would strip the other tabs' keys from the URL
// on every write.
// - ?page=  tx-list pagination (1 when absent or garbage; the view clamps
//   to >= 1 — the schema deliberately accepts 0/negatives so a malformed
//   deep link degrades instead of throwing during render).
// - ?window= deepened tx-history search window (blocks): absent (or
//   malformed/out-of-range) means the backend default window — the same
//   survival guarantees as ?page= (pagination, sharing, back/forward).
// - ?ttPage= token-transfers tab pagination, same survival guarantees as
//   ?page= (deep pages shareable, back/forward steps between pages).
// - ?ttWindow= deepened token-transfer scan window (blocks), the
//   transfers-tab twin of ?window= (separate key so the two tabs never
//   clobber each other's depth). Clamped to the backend's 1..50M range;
//   absent/malformed/out-of-range means the backend default window.
// - ?ttStandard= token-transfers standard filter chip ('erc20'/'erc721'
//   /'erc1155'). Same explicit-vs-absent discipline as ?tab=: an
//   EXPLICIT value always wins, absence means "all standards" — a
//   `.catch(...)` default would make "explicit all" indistinguishable
//   from "no filter in the URL" (there is no 'all' enum member to
//   dead-end on, so absence IS the all-state). The filter is client-side
//   over the fetched page (never a scan-shape change), so it shares no
//   path with the ?ttPage= beyond-data convergence.
// - ?itDepth= internal-txns tab trace depth: how many of the discovered
//   transactions the browser-side callTracer scan traces. Structurally
//   invalid values (non-integer, non-positive) degrade to undefined —
//   the scan's default depth — while a VALID integer outside the
//   supported range survives the parse and is silently clamped by the
//   effective-depth derivation (the ?ttWindow= clamp precedent), so a
//   shared ?itDepth=9 or ?itDepth=5000 link still widens/narrows the
//   sweep instead of snapping back to the default.
// - ?tab=  active activity tab. Optional on purpose: an EXPLICIT value
//   always wins, while absence lets a deep-linked transfers page
//   (?ttPage=2+) select the transfers tab (see effectiveActivityTab). A
//   `.catch(...)` default would make "explicit transactions"
//   indistinguishable from "no tab in the URL" and break one of the two.
//   The internal tab ('internal' = on-demand callTracer tracing) is
//   reachable only through an explicit ?tab=internal — no inference
//   selects it, so existing deep-link behavior is unchanged.
export const activityTabSchema = z.enum(['transactions', 'transfers', 'internal']);

export type ActivityTabId = z.infer<typeof activityTabSchema>;

// Token-standard filter chips of the transfers tab. Matches the row
// field the backend derives from the log's topic shape
// (TokenTransfer.logStandard) — not the metadata-disambiguated display
// enum.
export const transferStandardSchema = z.enum(['erc20', 'erc721', 'erc1155']);

export type TransferStandardId = z.infer<typeof transferStandardSchema>;

export const addressSearchSchema = z.object({
  page: z.coerce.number().catch(1),
  window: z.coerce.number().int().min(1).optional().catch(undefined),
  ttPage: z.coerce.number().catch(1),
  ttWindow: z.coerce.number().int().min(1).max(50_000_000).optional().catch(undefined),
  ttStandard: transferStandardSchema.optional().catch(undefined),
  itDepth: z.coerce.number().int().positive().optional().catch(undefined),
  tab: activityTabSchema.optional().catch(undefined),
  // Tx-tab advanced filters (?tfFrom= / ?tfTo= / ?tfMin= / ?tfMax=):
  // raw strings — addresses stay strings (never coerced) and wei amounts
  // stay exact beyond 2^53 (BigInt on the server). Same
  // optional().catch(undefined) discipline as ?tab=: never a `.catch(...)`
  // default (it would collapse "explicit default" with "absent" and
  // deadlock the filter bar's open/state machine). Malformed values
  // SURVIVE the parse as strings — effectiveTxFilters is the layer that
  // drops invalid ones, so the bar can show what a shared link carried.
  tfFrom: z.string().optional().catch(undefined),
  tfTo: z.string().optional().catch(undefined),
  tfMin: z.string().optional().catch(undefined),
  tfMax: z.string().optional().catch(undefined),
});

// Effective internal-tx trace depth for the internal tab. An explicit
// (valid) ?itDepth= wins after clamping into the scan's supported range;
// absence or a malformed value means the scan's default. Pure so the
// derivation (undefined → default, explicit wins, out-of-range clamps)
// is testable. Mirrors effectiveActivityTab's role for ?tab=.
export const effectiveInternalTxDepth = (itDepth: number | undefined): number =>
  clampInternalTxDepth(itDepth ?? DEFAULT_INTERNAL_TX_DEPTH);

// Effective activity tab for the address page. An explicit ?tab= always
// wins; only when it is absent does a deep-linked transfers page
// (?ttPage= 2 or deeper — a page number that only exists on the transfers
// tab) land the view on that tab. Pure so the derivation is testable.
export const effectiveActivityTab = (
  tab: ActivityTabId | undefined,
  ttPage: number,
): ActivityTabId => tab ?? (ttPage > 1 ? 'transfers' : 'transactions');

// Effective token-standard filter for the transfers tab. An explicit
// valid ?ttStandard= wins; absence (or a malformed value — the schema's
// .catch(undefined) already degraded it) means "all standards". Pure so
// the explicit-vs-absent contract is testable (the ?tab= lesson: the
// distinction must stay observable, never baked into a default). No
// inference branch exists on purpose — no other param implies a
// standard, unlike ttPage's tab inference.
export const effectiveTransferStandard = (
  ttStandard: TransferStandardId | undefined,
): TransferStandardId | undefined => ttStandard;

// Effective tx-tab advanced filters: the values safe to SEND (and to
// show as active). Absent means absent; an explicit value survives only
// when it is valid — addresses pass the same two-tier shape/checksum
// verdict as the server's getValidatedAddress (the frontend twin in
// ./addressValidity), wei amounts must be non-negative integer decimals.
// Invalid values degrade to undefined here (never to a default), so a
// malformed hand-crafted link can never fire a doomed request. Values
// pass through verbatim (no normalization): the backend compares
// case-insensitively. Pure so the absent-vs-explicit-vs-invalid
// degradation contract is testable.
export type EffectiveTxFilters = {
  fromAddress?: string;
  toAddress?: string;
  minValue?: string;
  maxValue?: string;
};

const TF_WEI_RE = /^\d+$/;

const validFilterAddress = (raw: string | undefined): string | undefined => {
  if (raw === undefined || raw === '') return undefined;
  return checkAddressValidity(raw).valid ? raw : undefined;
};

const validFilterWei = (raw: string | undefined): string | undefined => {
  if (raw === undefined || raw === '') return undefined;
  return TF_WEI_RE.test(raw) ? raw : undefined;
};

export const effectiveTxFilters = (search: {
  tfFrom?: string;
  tfTo?: string;
  tfMin?: string;
  tfMax?: string;
}): EffectiveTxFilters => ({
  ...(validFilterAddress(search.tfFrom) !== undefined
    ? { fromAddress: search.tfFrom }
    : {}),
  ...(validFilterAddress(search.tfTo) !== undefined ? { toAddress: search.tfTo } : {}),
  ...(validFilterWei(search.tfMin) !== undefined ? { minValue: search.tfMin } : {}),
  ...(validFilterWei(search.tfMax) !== undefined ? { maxValue: search.tfMax } : {}),
});

// Whether any effective filter is active — gates the honest
// filtered-empty state and the active-filter count.
export const hasActiveTxFilters = (filters: EffectiveTxFilters): boolean =>
  filters.fromAddress !== undefined
  || filters.toAddress !== undefined
  || filters.minValue !== undefined
  || filters.maxValue !== undefined;

// True when the token-transfers payload has settled (data present, not
// loading, no error) with zero rows at this page offset on a page past
// the first: the URL should converge (history replace) back to page 1 —
// an empty transfers page must never stay shareable. Pure so the
// convergence contract is testable.
export const shouldPinTransfersPage = (
  state: { hasData: boolean; loading: boolean; hasError: boolean },
  rows: number,
  page: number,
): boolean =>
  state.hasData && !state.loading && !state.hasError && rows === 0 && page > 1;
