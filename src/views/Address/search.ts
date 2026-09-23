import { z } from 'zod';
import {
  clampInternalTxDepth,
  DEFAULT_INTERNAL_TX_DEPTH,
} from '@/utils/internalTxScan';

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

export const addressSearchSchema = z.object({
  page: z.coerce.number().catch(1),
  window: z.coerce.number().int().min(1).optional().catch(undefined),
  ttPage: z.coerce.number().catch(1),
  ttWindow: z.coerce.number().int().min(1).max(50_000_000).optional().catch(undefined),
  itDepth: z.coerce.number().int().positive().optional().catch(undefined),
  tab: activityTabSchema.optional().catch(undefined),
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
