# ADR-0007: Browser-side capability surface — node-dependent features run client-side

- Status: Accepted
- Date: 2026-09-26

## Context

Call traces (`debug_traceTransaction`), internal txns (`callTracer`),
mempool (`txpool_content`), gas history (`eth_feeHistory`) and fiat prices
depend on node capabilities or external services that vary wildly between
RPC providers — public nodes accept a POST and then never answer it. Backend
indexing them would violate both the lightweight-local positioning
(ADR-0003) and the data-separation split (ADR-0001: ephemeral data belongs
in the browser). AGENTS.md's feature-wave notes (2026-09-23 mempool page,
2026-09-22 internal-txns tab, gas tracker, DefiLlama price layer) document
each surface's honest-degradation behavior.

## Decision

- Node-capability features run **in the browser against the user's selected
  RPC** (shared client from `src/utils/realTimeData.ts`); price data comes
  from keyless, CORS-open DefiLlama (`src/services/prices.ts`). The backend
  never proxies or indexes them.
- Unsupported or failing providers render **honest states** — "not
  supported by this RPC", Retry — never fabricated data, never a silently
  empty list, never an infinitely pending skeleton.
- Every such fetch carries an **explicit request budget** (e.g. 8s for the
  mempool page) so a hung provider settles into the failed state; hung
  providers are a real, tested failure mode, not theoretical.

## Consequences

- Zero backend cost; capability varies per user's RPC and is disclosed
  per-feature (per-chart source labels, "this node's snapshot" caveats).
- These surfaces are structurally never `complete` — they report
  `sampled`/`discovered` under ADR-0002 and are not backfilled by indexing.
- Each new browser-side capability needs: a budget, an honest unsupported
  state, and a regression test pinning the hung-provider path.
