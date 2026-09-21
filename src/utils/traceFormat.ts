// Call-trace normalization for Geth callTracer results — the payload of
// debug_traceTransaction with { tracer: 'callTracer' }, fetched in the
// browser per the data-separation rule (traces are ephemeral node data).
//
// The tracer's raw JSON is hex quantities in strings plus loosely optional
// fields; this module turns it into a typed tree the tx-detail Call Trace
// card renders. Honesty rules:
// - value/gas/gasUsed are bigint-exact (Geth sends hex "0x…" strings;
//   decimal strings and JSON numbers are accepted for lenient nodes). A
//   missing or unparseable field stays null — never a fabricated 0.
// - selector is the first 4 data bytes of input, only when input carries
//   at least 4 bytes of calldata; "0x" and shorter inputs have none.
// - unknown `type` strings pass through verbatim (new EIPs grow the call
//   type set faster than UIs learn the names).
// - the ROOT is null only when the payload is not a call frame at all
//   (null/undefined/primitive/array/object without a string `type`);
//   individual odd fields degrade honestly, and a single malformed CHILD
//   is skipped rather than nuking its siblings.

/** One normalized call frame; `depth` is 0 for the tx's top-level frame. */
export type CallTraceNode = {
  /** Geth call type: CALL, STATICCALL, DELEGATECALL, CALLCODE, CREATE, CREATE2, SELFDESTRUCT — or whatever the node reported. */
  type: string;
  /** Sender of this frame; null when unreported. */
  from: string | null;
  /** Callee — created-contract address for CREATE/CREATE2, refund target for SELFDESTRUCT; null when unreported. */
  to: string | null;
  /** Exact wei moved by this frame; null when unreported (STATICCALL frames often omit it). */
  value: bigint | null;
  /** Gas limit of the frame; null when unreported. */
  gas: bigint | null;
  /** Gas actually consumed by the frame (inclusive of its subcalls); null when unreported. */
  gasUsed: bigint | null;
  /** Calldata (init code for CREATE frames); null when unreported. */
  input: string | null;
  /** Return data; null when unreported (common on reverted frames). */
  output: string | null;
  /** First 4 bytes of input (the function selector), when input has >= 4 data bytes. */
  selector: string | null;
  /** Geth error string for this frame (e.g. "execution reverted"); null when the frame did not report one. */
  error: string | null;
  /** Decoded revert reason, when the node surfaced one; null otherwise. */
  revertReason: string | null;
  /** 0 for the tx's top-level frame, +1 per nesting level. */
  depth: number;
  /** Sub-calls in execution order; empty when the frame made none. */
  calls: CallTraceNode[];
};

/**
 * Hex quantity ("0x…"), decimal string, or JSON number → exact bigint.
 * Negative or non-integer values are nonsense for gas/value and read as
 * null (absent), not 0.
 */
const parseQuantity = (raw: unknown): bigint | null => {
  if (typeof raw === 'bigint') return raw >= 0n ? raw : null;
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 0 ? BigInt(raw) : null;
  }
  if (typeof raw === 'string' && raw !== '') {
    try {
      const value = BigInt(raw);
      return value >= 0n ? value : null;
    } catch {
      return null;
    }
  }
  return null;
};

/** Non-empty string → itself, anything else → null (honest absence). */
const optionalString = (raw: unknown): string | null =>
  typeof raw === 'string' && raw !== '' ? raw : null;

/**
 * Function selector of a calldata hex string: the first 4 data bytes,
 * lowercased — null for "0x", shorter-than-4-byte inputs, or non-hex
 * strings. Same contract as selectorOf in utils/txDecode.
 */
const selectorOfInput = (input: string | null): string | null => {
  if (input === null || input.length < 10) return null;
  const selector = input.slice(0, 10).toLowerCase();
  return /^0x[0-9a-f]{8}$/.test(selector) ? selector : null;
};

const normalizeNode = (raw: unknown, depth: number): CallTraceNode | null => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  // `type` is the one field every call frame carries; without it this is
  // not a frame (empty results, proxies returning objects, error bodies).
  if (typeof record.type !== 'string' || record.type === '') return null;
  const input = optionalString(record.input);
  const calls = Array.isArray(record.calls)
    ? record.calls
        .map(child => normalizeNode(child, depth + 1))
        .filter((child): child is CallTraceNode => child !== null)
    : [];
  return {
    type: record.type,
    from: optionalString(record.from),
    to: optionalString(record.to),
    value: parseQuantity(record.value),
    gas: parseQuantity(record.gas),
    gasUsed: parseQuantity(record.gasUsed),
    input,
    output: optionalString(record.output),
    selector: selectorOfInput(input),
    error: optionalString(record.error),
    revertReason: optionalString(record.revertReason),
    depth,
    calls,
  };
};

/**
 * Normalize a raw callTracer result into the typed tree. Returns null when
 * the payload is not a call frame at all — the caller renders an honest
 * "no calls recorded" state, never a fabricated tree.
 */
export function normalizeCallTrace(raw: unknown): CallTraceNode | null {
  return normalizeNode(raw, 0);
}

/** Total frames in the tree, the root included. */
export function countNodes(node: CallTraceNode): number {
  return 1 + node.calls.reduce((total, child) => total + countNodes(child), 0);
}

/** Deepest nesting level; a single top-level frame is depth 0. */
export function maxDepth(node: CallTraceNode): number {
  return node.calls.reduce((deepest, child) => Math.max(deepest, maxDepth(child) + 1), 0);
}

/**
 * Frames in the tree that reported an error or revert reason — Geth marks
 * failure per frame (a revert swallowed by a try/catch stays on the child
 * only), so this walks the whole tree instead of trusting the root.
 */
export function countFailedCalls(node: CallTraceNode): number {
  const self = node.error !== null || node.revertReason !== null ? 1 : 0;
  return self + node.calls.reduce((total, child) => total + countFailedCalls(child), 0);
}

// Collects an error's whole cause chain plus JSON-RPC codes: viem wraps
// provider errors several layers deep, and proxies re-encode them, so
// "method not found" can live in any hop (or only as code -32601).
const errorChainText = (error: unknown): string => {
  const parts: string[] = [];
  let current: unknown = error;
  for (let hop = 0; hop < 8 && typeof current === 'object' && current !== null; hop += 1) {
    const record = current as Record<string, unknown>;
    if (typeof record.message === 'string') parts.push(record.message);
    if (record.code !== undefined) parts.push(String(record.code));
    current = record.cause;
  }
  return parts.join('\n');
};

// Same shape as the gas-history classifier: "method not found" and its
// provider phrasings. Bare "not found" is deliberately excluded — a
// missing transaction is a different (retryable) failure, not evidence
// that tracing is unsupported.
const TRACE_UNSUPPORTED_PATTERN =
  /(method[^\n]*not[^\n]*(found|exist|available|support))|not[^\n]*supported|does not exist|unimplemented/i;

/**
 * Did the debug_traceTransaction request fail because the endpoint does
 * not implement it? Drives the honest "not supported by this RPC" info
 * state instead of a fetch-error card.
 */
export function isTraceUnsupportedError(error: unknown): boolean {
  // Bare string rejections (no Error wrapper) still classify by text.
  const text = typeof error === 'string' ? error : errorChainText(error);
  return TRACE_UNSUPPORTED_PATTERN.test(text) || text.includes('-32601');
}
