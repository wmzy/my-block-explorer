// The trace family's single browser-side RPC read: debug_traceTransaction
// with { tracer: 'callTracer' } (plus the narrow untyped-request escape
// hatch it rides). Traces are ephemeral node data, so every caller — the
// tx page's Call Trace card, the address tab's internal-tx scan, the
// block page's traced sweep — fetches them in the browser against the
// chain's RPC (data-separation rule) through THIS module, never a
// re-grown local copy of the cast + request + normalize pipeline.
//
// viem's typed client.request has no debug namespace, so the request goes
// through a narrow structural cast; keeping the cast here means the
// eth_getBlockByHash read beside it (the block sweep's tx list) shares
// the same single definition too.

// Relative imports on purpose: this module is browser-side (realTimeData's
// per-chain client factory) — keep it OUT of backend graphs (the vite.config
// esbuild bundle cannot resolve @/, and no backend service may reach the
// browser client cache; backend callers use traceFormat's clientRequest
// with their own RpcManager client).
import { createRpcClient } from './realTimeData';
import {
  clientRequest,
  normalizeCallTrace,
  type CallTraceNode,
  type UntypedRpcRequestArgs,
} from './traceFormat';

// Re-exported for the existing view call sites; the definition lives in
// the dependency-free leaf (traceFormat) so server-side walks import it
// without dragging this module's browser graph along.
export { clientRequest, type UntypedRpcRequestArgs };

/**
 * One RPC request through the shared per-chain browser client, bypassing
 * viem's typed schema for methods it does not carry (the debug namespace,
 * legacy full-tx eth_getBlockByHash). Nothing here interprets the
 * payload — honest parsing stays with the pure extractors.
 */
export async function rpcRequest(chainId: number, args: UntypedRpcRequestArgs): Promise<unknown> {
  const client = await createRpcClient(chainId);
  return clientRequest(client, args);
}

/**
 * Fetch and normalize one transaction's callTracer tree. Resolves null
 * when the payload is not a call frame at all (the caller's honest "no
 * calls recorded" state); rejects with the provider's error otherwise,
 * for the caller's unsupported/failed classification
 * (traceFormat.isTraceUnsupportedError).
 */
export async function fetchCallTraceTree(
  chainId: number,
  txHash: string,
): Promise<CallTraceNode | null> {
  const raw = await rpcRequest(chainId, {
    method: 'debug_traceTransaction',
    params: [txHash, { tracer: 'callTracer' }],
  });
  return normalizeCallTrace(raw);
}
