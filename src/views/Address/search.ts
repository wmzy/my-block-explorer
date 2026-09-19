import { z } from 'zod';

// The address page's URL-driven state, shared by every writer on the page
// (the view for the tx tab, TokenTransfers for its own pagination). ONE
// schema is load-bearing: useSetSearch serializes the schema's OUTPUT, so
// a writer validating against a narrower schema would strip the other
// tabs' keys from the URL on every write.
// - ?page=  tx-list pagination (1 when absent or garbage; the view clamps
//   to >= 1 — the schema deliberately accepts 0/negatives so a malformed
//   deep link degrades instead of throwing during render).
// - ?window= deepened tx-history search window (blocks): absent (or
//   malformed/out-of-range) means the backend default window — the same
//   survival guarantees as ?page= (pagination, sharing, back/forward).
// - ?ttPage= token-transfers tab pagination, same survival guarantees as
//   ?page= (deep pages shareable, back/forward steps between pages).
export const addressSearchSchema = z.object({
  page: z.coerce.number().catch(1),
  window: z.coerce.number().int().min(1).optional().catch(undefined),
  ttPage: z.coerce.number().catch(1),
});
