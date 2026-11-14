// The exact body string POST /api/ops/uninstall demands — the API wants
// it verbatim, the /ops UI makes the operator type it. Import-free leaf
// by contract: services/opsSummary.ts is browser-imported (it must not
// pull the server graph that services/selfDestruct.ts lives in), and
// selfDestruct re-exports this for routes/ops.ts — one home, no twins.
export const UNINSTALL_CONFIRM_PHRASE = 'uninstall';
